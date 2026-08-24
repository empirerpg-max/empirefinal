import {
  googleSheetsService,
  normalizeHeader,
  normalizeText,
  normalizeComparison,
  dedupeHeaders,
} from "../services/googleSheetsService";
import { somarPrestigio } from "../services/prestigioService";
import { issueSessionToken } from "../services/sessionService";

const USUARIOS_SHEET = "Usuários";

// Senha nunca é gravada em texto puro na planilha — só o hash SHA-256
// (com um pepper fixo do app, já que a planilha não tem coluna própria pra
// salt por usuário). Suficiente pro nível de sensibilidade daqui (RPG entre
// amigos), mas ainda assim nunca expõe a senha real em texto plano.
const PASSWORD_PEPPER = "empire-hub-rpg-2026";

async function hashPassword(senha: string): Promise<string> {
  const data = new TextEncoder().encode(`${PASSWORD_PEPPER}:${senha}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Um hash SHA-256 é sempre 64 caracteres hex — usado pra distinguir "já é
// hash" de "senha inicial em texto puro digitada pelo admin na planilha".
const HASH_RE = /^[0-9a-f]{64}$/;
function looksLikeHash(v: string): boolean {
  return HASH_RE.test(v);
}

interface UsuariosRow {
  rec: Record<string, string>;
  rowIndex: number;
}

async function readUsuariosWithRowIndex(): Promise<UsuariosRow[]> {
  const rawRows = await googleSheetsService.usuarios.readValues(USUARIOS_SHEET).catch(() => []);
  if (!rawRows || rawRows.length < 2) return [];
  const headers = dedupeHeaders(
    USUARIOS_SHEET,
    rawRows[0].map((h, i) => normalizeHeader(h) || `coluna_${i + 1}`),
  );
  const out: UsuariosRow[] = [];
  rawRows.slice(1).forEach((row, i) => {
    if (!row.some((cell) => normalizeText(cell))) return;
    const rec: Record<string, string> = {};
    headers.forEach((h, hi) => {
      rec[h] = normalizeText(row[hi]);
    });
    out.push({ rec, rowIndex: i + 2 });
  });
  return out;
}

function colIndexToA1Letter(colIndex: number): string {
  let temp = colIndex;
  let letter = "";
  while (temp >= 0) {
    letter = String.fromCharCode((temp % 26) + 65) + letter;
    temp = Math.floor(temp / 26) - 1;
  }
  return letter;
}

/**
 * Concede o prestígio de "login_diario" no máximo 1x por dia por usuário.
 * Usa a coluna "Último login prestígio" (se existir na aba Usuários) pra
 * guardar a data (YYYY-MM-DD) do último crédito — se a coluna ainda não
 * existir, não credita (fail-safe: melhor não gamificar do que gamificar
 * sem controle de repetição).
 */
async function concederPrestigioLoginDiario(match: UsuariosRow, usuarioFallback: string): Promise<void> {
  const colKeys = Object.keys(match.rec);
  const ultimoLoginColIndex = colKeys.indexOf("ultimo_login_prestigio");
  if (ultimoLoginColIndex === -1) return;

  // Horário de Brasília (UTC-3), não UTC puro — sem esse ajuste, depois das
  // 21h (Brasília) o "hoje" em UTC já vira o dia seguinte, e um jogador que
  // já tinha logado mais cedo no MESMO dia local ganhava um segundo crédito
  // de login_diario só por reabrir o app à noite (prestígio "subindo do
  // nada"). Mesmo ajuste usado no cálculo de horário da Empire TV.
  const hoje = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const ultimoRegistrado = match.rec["ultimo_login_prestigio"] || "";
  if (ultimoRegistrado === hoje) return;

  const colLetter = colIndexToA1Letter(ultimoLoginColIndex);
  await googleSheetsService.usuarios.updateValues(USUARIOS_SHEET, `${colLetter}${match.rowIndex}`, [
    [hoje],
  ]);
  await somarPrestigio(
    { telegramId: match.rec["id"] || undefined, usuario: match.rec["usuario"] || usuarioFallback },
    "login_diario",
  );
}

/**
 * POST /api/auth/heartbeat
 * O login por usuário/senha só roda uma vez — depois disso a sessão fica
 * salva no localStorage do navegador e o app nunca mais chama
 * /api/auth/login de novo, então o prestígio de "login_diario" (que só era
 * concedido ali) nunca era creditado em dias seguintes, a não ser que o
 * jogador saísse e entrasse de novo manualmente. Este endpoint é chamado
 * pelo AuthGate toda vez que o app abre com uma sessão já salva — mesma
 * proteção de "no máximo 1x por dia" de concederPrestigioLoginDiario, só
 * não exige senha (a sessão local já prova quem é o jogador).
 */
export async function authHeartbeatController(request: Request): Promise<Response> {
  try {
    const body = (await request.json().catch(() => ({}))) as { telegramId?: string; usuario?: string };
    const telegramId = (body.telegramId || "").trim();
    const usuario = (body.usuario || "").trim();
    if (!telegramId && !usuario) {
      return new Response(JSON.stringify({ success: false, error: "telegramId ou usuario obrigatório." }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const rows = await readUsuariosWithRowIndex();
    const normId = normalizeComparison(telegramId);
    const normUsuario = normalizeComparison(usuario);
    const match = rows.find((r) => {
      const matchId = !!normId && normalizeComparison(r.rec["id"] || "") === normId;
      const matchUsuario = !!normUsuario && normalizeComparison(r.rec["usuario"] || "") === normUsuario;
      return matchId || matchUsuario;
    });
    if (match) {
      await concederPrestigioLoginDiario(match, usuario);
    }

    // Reemite o token de sessão a cada heartbeat, renovando a expiração —
    // assim uma sessão que continua sendo usada nunca "vence" no meio do uso
    // (o app abre com uma sessão salva e chama isso toda vez, ver comentário
    // acima).
    const sessionUsuario = match?.rec["usuario"] || usuario;
    const sessionId = match?.rec["id"] || telegramId;
    const token = await issueSessionToken(sessionUsuario, sessionId);

    return new Response(JSON.stringify({ success: true, token }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("[authHeartbeatController] Erro:", error);
    return new Response(JSON.stringify({ success: false, error: error.message || "Erro no heartbeat." }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

export interface LoginBody {
  usuario: string;
  senha: string;
}

/**
 * POST /api/auth/login
 * Login por usuário/senha contra a aba "Usuários" (colunas: Nome, ID,
 * Usuário, Senha, Notificações?, Foto do perfil, Tipo de perfil, Nível,
 * Badge, Prestígio). A coluna ID é o telegram_id histórico — usado só pra
 * relacionar com tudo que já existe no app (comentários, cadastros), nunca
 * pro login em si.
 *
 * Contas pré-cadastradas só entram depois que um admin define uma senha
 * inicial na coluna "Senha" da planilha (texto puro, digitado à mão — sem
 * isso, NINGUÉM entra, nem "reivindicando" a conta com qualquer senha,
 * como funcionava antes: isso permitia sequestro de conta por quem soubesse
 * o nome de usuário). No primeiro login com a senha inicial, o jogador é
 * obrigado a trocar por uma senha própria (`precisaTrocarSenha: true` na
 * resposta) via POST /api/auth/trocar-senha — só depois disso a senha vira
 * hash de verdade na planilha.
 */
export async function loginController(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as LoginBody;
    const usuario = (body.usuario || "").trim();
    const senha = body.senha || "";

    if (!usuario || !senha) {
      return new Response(
        JSON.stringify({ success: false, error: "Preencha usuário e senha." }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    const rows = await readUsuariosWithRowIndex();
    const normUsuario = normalizeComparison(usuario);
    const match = rows.find((r) => normalizeComparison(r.rec["usuario"] || "") === normUsuario);

    if (!match) {
      return new Response(
        JSON.stringify({ success: false, error: "Usuário não encontrado." }),
        { status: 404, headers: { "Content-Type": "application/json" } },
      );
    }

    const storedRaw = (match.rec["senha"] || "").trim();
    const incomingHash = await hashPassword(senha);

    if (!storedRaw) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Essa conta ainda não tem uma senha inicial definida. Peça a um admin para configurar.",
        }),
        { status: 403, headers: { "Content-Type": "application/json" } },
      );
    }

    let precisaTrocarSenha = false;
    if (looksLikeHash(storedRaw)) {
      if (storedRaw !== incomingHash) {
        return new Response(JSON.stringify({ success: false, error: "Senha incorreta." }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }
    } else {
      // Senha inicial em texto puro, digitada pelo admin na planilha.
      const initialHash = await hashPassword(storedRaw);
      if (initialHash !== incomingHash) {
        return new Response(JSON.stringify({ success: false, error: "Senha incorreta." }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }
      precisaTrocarSenha = true;
    }

    await concederPrestigioLoginDiario(match, usuario);

    const token = await issueSessionToken(match.rec["usuario"] || usuario, match.rec["id"] || "");

    return new Response(
      JSON.stringify({
        success: true,
        token,
        data: {
          id: match.rec["id"] || "",
          // Nome exibido no app vem da coluna "Usuário" (C), não da coluna
          // "Nome" (A) — decisão explícita: a coluna C é a fonte única de
          // verdade tanto pro login quanto pro nome mostrado.
          nome: match.rec["usuario"] || usuario,
          usuario: match.rec["usuario"] || usuario,
          tipoPerfil: match.rec["tipo_de_perfil"] || "Usuário",
          fotoPerfil: match.rec["foto_do_perfil"] || "",
          prestigio: match.rec["prestigio"] || "",
          precisaTrocarSenha,
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (error: any) {
    console.error("[loginController] Erro:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message || "Erro ao processar login." }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}

export interface TrocarSenhaBody {
  usuario: string;
  senhaAtual: string;
  novaSenha: string;
}

/**
 * POST /api/auth/trocar-senha
 * Exige a senha atual (bate contra o hash já salvo, ou contra a senha
 * inicial em texto puro que o admin ainda não trocou) pra gravar uma nova —
 * usado tanto pra forçar a troca no primeiro acesso quanto pra qualquer
 * jogador trocar a própria senha depois.
 */
export async function trocarSenhaController(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as TrocarSenhaBody;
    const usuario = (body.usuario || "").trim();
    const senhaAtual = body.senhaAtual || "";
    const novaSenha = body.novaSenha || "";

    if (!usuario || !senhaAtual || !novaSenha) {
      return new Response(
        JSON.stringify({ success: false, error: "Preencha usuário, senha atual e nova senha." }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }
    if (novaSenha.length < 4) {
      return new Response(
        JSON.stringify({ success: false, error: "A nova senha precisa ter pelo menos 4 caracteres." }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    const rows = await readUsuariosWithRowIndex();
    const normUsuario = normalizeComparison(usuario);
    const match = rows.find((r) => normalizeComparison(r.rec["usuario"] || "") === normUsuario);
    if (!match) {
      return new Response(JSON.stringify({ success: false, error: "Usuário não encontrado." }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    const storedRaw = (match.rec["senha"] || "").trim();
    if (!storedRaw) {
      return new Response(
        JSON.stringify({ success: false, error: "Essa conta ainda não tem uma senha inicial definida." }),
        { status: 403, headers: { "Content-Type": "application/json" } },
      );
    }

    const validHash = looksLikeHash(storedRaw) ? storedRaw : await hashPassword(storedRaw);
    const incomingHash = await hashPassword(senhaAtual);
    if (validHash !== incomingHash) {
      return new Response(JSON.stringify({ success: false, error: "Senha atual incorreta." }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const senhaColIndex = Object.keys(match.rec).indexOf("senha");
    if (senhaColIndex === -1) {
      return new Response(
        JSON.stringify({ success: false, error: "Coluna 'Senha' não encontrada na aba Usuários." }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
    const colLetter = colIndexToA1Letter(senhaColIndex);
    const novoHash = await hashPassword(novaSenha);
    await googleSheetsService.usuarios.updateValues(USUARIOS_SHEET, `${colLetter}${match.rowIndex}`, [
      [novoHash],
    ]);

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("[trocarSenhaController] Erro:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message || "Erro ao trocar senha." }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}

export interface UpdateProfileBody {
  usuario: string;
  nome?: string;
  fotoPerfil?: string;
}

/**
 * POST /api/auth/perfil
 * Atualiza nome e/ou foto de perfil do jogador logado, casando pela coluna
 * "Usuário" (a mesma chave usada no login) — nunca a senha.
 */
export async function updateProfileController(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as UpdateProfileBody;
    const usuario = (body.usuario || "").trim();

    if (!usuario) {
      return new Response(JSON.stringify({ success: false, error: "Usuário não informado." }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const rows = await readUsuariosWithRowIndex();
    const normUsuario = normalizeComparison(usuario);
    const match = rows.find((r) => normalizeComparison(r.rec["usuario"] || "") === normUsuario);

    if (!match) {
      return new Response(JSON.stringify({ success: false, error: "Usuário não encontrado." }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    const columnKeys = Object.keys(match.rec);
    const novoNome = body.nome?.trim();

    // O nome exibido no app é a coluna "Usuário" (C) — a mesma usada pro
    // login. Editar o "nome" aqui, portanto, renomeia o próprio usuário de
    // login (efeito esperado: a partir daqui, é esse novo valor que deve
    // ser digitado pra entrar).
    if (novoNome) {
      const usuarioColIndex = columnKeys.indexOf("usuario");
      if (usuarioColIndex !== -1) {
        const colLetter = colIndexToA1Letter(usuarioColIndex);
        await googleSheetsService.usuarios.updateValues(USUARIOS_SHEET, `${colLetter}${match.rowIndex}`, [
          [novoNome],
        ]);
      }
    }

    if (body.fotoPerfil !== undefined) {
      const fotoColIndex = columnKeys.indexOf("foto_do_perfil");
      if (fotoColIndex !== -1) {
        const colLetter = colIndexToA1Letter(fotoColIndex);
        await googleSheetsService.usuarios.updateValues(USUARIOS_SHEET, `${colLetter}${match.rowIndex}`, [
          [body.fotoPerfil],
        ]);
      }
    }

    const nomeAtualizado = novoNome || match.rec["usuario"] || usuario;

    return new Response(
      JSON.stringify({
        success: true,
        data: {
          id: match.rec["id"] || "",
          nome: nomeAtualizado,
          usuario: nomeAtualizado,
          tipoPerfil: match.rec["tipo_de_perfil"] || "Usuário",
          fotoPerfil: body.fotoPerfil !== undefined ? body.fotoPerfil : match.rec["foto_do_perfil"] || "",
          prestigio: match.rec["prestigio"] || "",
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (error: any) {
    console.error("[updateProfileController] Erro:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message || "Erro ao atualizar perfil." }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}
