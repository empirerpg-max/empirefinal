import {
  googleSheetsService,
  normalizeHeader,
  normalizeText,
  normalizeComparison,
  dedupeHeaders,
} from "../services/googleSheetsService";

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
 * Como a Senha ainda está vazia pra todo mundo (conta pré-cadastrada, senha
 * nunca definida): se a conta encontrada não tem hash de senha gravado
 * ainda, a primeira tentativa de login "reivindica" a conta — grava o hash
 * da senha digitada. A partir daí, login exige que a senha bata com o hash.
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

    const storedHash = (match.rec["senha"] || "").trim();
    const incomingHash = await hashPassword(senha);

    if (!storedHash) {
      // Primeira vez: reivindica a conta gravando o hash da senha escolhida.
      const senhaColIndex = Object.keys(match.rec).indexOf("senha");
      if (senhaColIndex === -1) {
        return new Response(
          JSON.stringify({
            success: false,
            error: "Coluna 'Senha' não encontrada na aba Usuários.",
          }),
          { status: 500, headers: { "Content-Type": "application/json" } },
        );
      }
      const colLetter = colIndexToA1Letter(senhaColIndex);
      await googleSheetsService.usuarios.updateValues(USUARIOS_SHEET, `${colLetter}${match.rowIndex}`, [
        [incomingHash],
      ]);
    } else if (storedHash !== incomingHash) {
      return new Response(JSON.stringify({ success: false, error: "Senha incorreta." }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
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
