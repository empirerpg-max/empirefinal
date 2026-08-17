import {
  googleSheetsService,
  normalizeHeader,
  normalizeText,
  normalizeComparison,
  dedupeHeaders,
} from "../services/googleSheetsService";

const ARTISTAS_SHEET = "ARTISTAS";
const USUARIOS_SHEET = "Usuários";

/**
 * Resolve um "usuario" (login) pro ID (telegram_id histórico), via a aba
 * Usuários — usado só quando a chamada vem com `usuario` em vez de
 * `telegramId` direto.
 */
async function resolveIdByUsuario(usuario: string): Promise<string> {
  const rawRows = await googleSheetsService.usuarios.readValues(USUARIOS_SHEET).catch(() => []);
  if (!rawRows || rawRows.length < 2) return "";
  const headers = dedupeHeaders(
    USUARIOS_SHEET,
    rawRows[0].map((h, i) => normalizeHeader(h) || `coluna_${i + 1}`),
  );
  const usuarioCol = headers.indexOf("usuario");
  const nomeCol = headers.indexOf("nome");
  const idCol = headers.indexOf("id");
  if (idCol === -1 || (usuarioCol === -1 && nomeCol === -1)) return "";
  const normUsuario = normalizeComparison(usuario);
  const row = rawRows
    .slice(1)
    .find(
      (r) =>
        (usuarioCol !== -1 && normalizeComparison(r[usuarioCol]) === normUsuario) ||
        (nomeCol !== -1 && normalizeComparison(r[nomeCol]) === normUsuario),
    );
  return row ? normalizeText(row[idCol]) : "";
}

/**
 * Lê a aba "ARTISTAS" da planilha "Usuários" (nova fonte de verdade da
 * associação artista↔dono, substituindo o Apps Script legado que lê de
 * outra planilha e estava com dados incorretos/desatualizados). O dono de
 * cada artista é a coluna "ID Usuário" (telegram_id) — direto, sem precisar
 * de nome. Devolve pares [nomeDoArtista, idDoDono].
 */
async function readArtistOwnerPairs(): Promise<[string, string][]> {
  const rawRows = await googleSheetsService.usuarios.readValues(ARTISTAS_SHEET).catch(() => []);
  if (!rawRows || rawRows.length < 2) return [];

  const headers = dedupeHeaders(
    ARTISTAS_SHEET,
    rawRows[0].map((h, i) => normalizeHeader(h) || `coluna_${i + 1}`),
  );
  const artCol = headers.indexOf("nome");
  const ownerCol = headers.indexOf("id_usuario");
  if (artCol === -1 || ownerCol === -1) return [];

  const pairs: [string, string][] = [];
  for (const row of rawRows.slice(1)) {
    const artista = normalizeText(row[artCol]);
    const dono = normalizeText(row[ownerCol]);
    if (artista && dono) pairs.push([artista, dono]);
  }
  return pairs;
}

/**
 * GET /api/artistas/meus-nomes?telegramId=... ou ?usuario=NomeOuUsuarioDoLogin
 * Devolve só os NOMES dos artistas do jogador logado — a lista completa de
 * cada artista continua vindo do Apps Script legado (/listar_todos), o
 * frontend cruza os dois. `usuario`, quando vier sem `telegramId`, é
 * resolvido pro ID via a aba Usuários antes de casar com ARTISTAS.
 */
/**
 * Nomes dos artistas de um dono, direto da aba ARTISTAS (fonte de verdade).
 * Reaproveitada por qualquer feature que precise saber "quais artistas são
 * meus" a partir de um telegram_id (ex.: Ponto).
 */
export async function getArtistNamesForOwner(telegramId: string): Promise<string[]> {
  if (!telegramId) return [];
  const normId = normalizeComparison(telegramId);
  const pairs = await readArtistOwnerPairs();
  return Array.from(
    new Set(pairs.filter(([, dono]) => normalizeComparison(dono) === normId).map(([artista]) => artista)),
  );
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

interface ArtistasRow {
  rec: Record<string, string>;
  rowIndex: number;
  headers: string[];
}

async function readArtistasRows(): Promise<ArtistasRow[]> {
  const rawRows = await googleSheetsService.usuarios.readValues(ARTISTAS_SHEET).catch(() => []);
  if (!rawRows || rawRows.length < 2) return [];
  const headers = dedupeHeaders(
    ARTISTAS_SHEET,
    rawRows[0].map((h, i) => normalizeHeader(h) || `coluna_${i + 1}`),
  );
  const out: ArtistasRow[] = [];
  rawRows.slice(1).forEach((row, i) => {
    if (!row.some((cell) => normalizeText(cell))) return;
    const rec: Record<string, string> = {};
    headers.forEach((h, hi) => {
      rec[h] = normalizeText(row[hi]);
    });
    out.push({ rec, rowIndex: i + 2, headers });
  });
  return out;
}

/**
 * GET /api/artistas/disponiveis
 * Artistas da aba ARTISTAS sem dono (coluna "ID Usuário" vazia) — candidatos
 * a vínculo. Cada artista livre já existe como linha própria na aba (não
 * precisa criar linha nova pra vincular, só preencher o dono).
 */
export async function getArtistasDisponiveisController(): Promise<Response> {
  try {
    const rows = await readArtistasRows();
    const disponiveis = rows
      .filter((r) => r.rec["nome"] && !r.rec["id_usuario"])
      .map((r) => ({
        nome: r.rec["nome"],
        foto: r.rec["foto"] || "",
        gravadora: r.rec["gravadora"] || "",
      }));
    return new Response(JSON.stringify({ success: true, data: disponiveis }), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  } catch (error: any) {
    console.error("[getArtistasDisponiveisController] Erro:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message || "Erro ao listar artistas disponíveis." }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}

export interface VincularArtistaBody {
  nome: string;
  telegramId: string;
}

/**
 * POST /api/artistas/vincular
 * Vincula um artista SEM dono (linha já existe na aba ARTISTAS) ao jogador —
 * preenche "ID Usuário" e recalcula "ID_unico" (padrão Nome+ID já usado nas
 * linhas vinculadas). Recusa se o artista já tiver dono, pra nunca roubar
 * vínculo de outro jogador.
 */
export async function vincularArtistaController(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as VincularArtistaBody;
    const nome = (body.nome || "").trim();
    const telegramId = (body.telegramId || "").trim();

    if (!nome || !telegramId) {
      return new Response(JSON.stringify({ ok: false, erro: "nome e telegramId são obrigatórios." }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const rows = await readArtistasRows();
    const normNome = normalizeComparison(nome);
    const match = rows.find((r) => normalizeComparison(r.rec["nome"]) === normNome);

    if (!match) {
      return new Response(JSON.stringify({ ok: false, erro: "Artista não encontrado." }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (match.rec["id_usuario"]) {
      return new Response(JSON.stringify({ ok: false, erro: "Esse artista já tem dono." }), {
        status: 409,
        headers: { "Content-Type": "application/json" },
      });
    }

    const idUsuarioCol = match.headers.indexOf("id_usuario");
    const idUnicoCol = match.headers.indexOf("id_unico");
    if (idUsuarioCol === -1) {
      return new Response(
        JSON.stringify({ ok: false, erro: "Coluna 'ID Usuário' não encontrada na aba ARTISTAS." }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }

    await googleSheetsService.usuarios.updateValues(
      ARTISTAS_SHEET,
      `${colIndexToA1Letter(idUsuarioCol)}${match.rowIndex}`,
      [[telegramId]],
    );
    if (idUnicoCol !== -1) {
      await googleSheetsService.usuarios.updateValues(
        ARTISTAS_SHEET,
        `${colIndexToA1Letter(idUnicoCol)}${match.rowIndex}`,
        [[`${match.rec["nome"]}${telegramId}`]],
      );
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("[vincularArtistaController] Erro:", error);
    return new Response(JSON.stringify({ ok: false, erro: error.message || "Erro ao vincular artista." }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

export interface CriarArtistaBody {
  nome: string;
  foto: string;
  gravadora: string;
  telegramId: string;
}

/**
 * POST /api/artistas/criar
 * Cria um artista novo (que ainda não existe na aba ARTISTAS) já vinculado
 * ao jogador que criou. Recusa nome duplicado, pra não colidir com um
 * artista já existente (vinculado ou livre).
 */
export async function criarArtistaController(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as CriarArtistaBody;
    const nome = (body.nome || "").trim();
    const gravadora = (body.gravadora || "").trim();
    const foto = (body.foto || "").trim();
    const telegramId = (body.telegramId || "").trim();

    if (!nome || !gravadora || !telegramId) {
      return new Response(
        JSON.stringify({ ok: false, erro: "nome, gravadora e telegramId são obrigatórios." }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    const rows = await readArtistasRows();
    const normNome = normalizeComparison(nome);
    if (rows.some((r) => normalizeComparison(r.rec["nome"]) === normNome)) {
      return new Response(JSON.stringify({ ok: false, erro: "Já existe um artista com esse nome." }), {
        status: 409,
        headers: { "Content-Type": "application/json" },
      });
    }

    const headers =
      rows[0]?.headers ||
      [
        "nome",
        "foto",
        "status",
        "saldo",
        "gravadora",
        "fortuna_real",
        "fortuna_de_bens",
        "fortuna_total",
        "prestigio",
        "fadiga",
        "id_usuario",
        "data_contrato",
        "meses_contrato",
        "multa",
        "fortuna_calculo",
        "id_unico",
      ];
    const values: Record<string, string> = {
      nome,
      foto,
      gravadora,
      id_usuario: telegramId,
      id_unico: `${nome}${telegramId}`,
    };
    const row = headers.map((h) => values[h] ?? "");

    await googleSheetsService.usuarios.appendRow(ARTISTAS_SHEET, row);

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("[criarArtistaController] Erro:", error);
    return new Response(JSON.stringify({ ok: false, erro: error.message || "Erro ao criar artista." }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

const INFOS_ACTS_SHEET = "INFOS ACTS";

/**
 * GET /api/artistas/infos?nome=<nome>
 * Biografia (e foto "de origem") do artista — vive numa aba própria
 * ("INFOS ACTS", planilha registrosCharts): A nome | C foto | E biografia.
 * O dono do artista edita a biografia direto nessa aba (não tem tela de
 * edição no app pra isso — só leitura aqui). O upload de foto novo (quando
 * existir essa feature) deve gravar em F, não em C.
 */
export async function getArtistInfoController(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const nome = normalizeText(url.searchParams.get("nome"));
    if (!nome) {
      return new Response(JSON.stringify({ success: false, error: "nome é obrigatório." }), {
        status: 400,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }

    const rows = await googleSheetsService.registrosCharts.readValues(INFOS_ACTS_SHEET).catch(() => []);
    const normNome = normalizeComparison(nome);
    const row = rows.slice(1).find((r) => normalizeComparison(r[0]) === normNome);

    return new Response(
      JSON.stringify({
        success: true,
        data: {
          foto: row ? normalizeText(row[2]) : "",
          biografia: row ? normalizeText(row[4]) : "",
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
    );
  } catch (error: any) {
    console.error("[getArtistInfoController] Erro:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message || "Erro ao buscar informações do artista." }),
      { status: 500, headers: { "Content-Type": "application/json; charset=utf-8" } },
    );
  }
}

/**
 * POST /api/artistas/foto
 * Grava o link do novo upload de foto do artista na coluna F da aba
 * "INFOS ACTS" (nunca sobrescreve a coluna C — essa é editada à mão pelo
 * dono do artista direto na planilha, junto com a biografia). Cria a linha
 * se o artista ainda não tiver uma nessa aba.
 */
export async function setArtistFotoController(request: Request): Promise<Response> {
  try {
    const body = (await request.json().catch(() => ({}))) as { nome?: string; fotoUrl?: string };
    const nome = (body.nome || "").trim();
    const fotoUrl = (body.fotoUrl || "").trim();
    if (!nome || !fotoUrl) {
      return new Response(JSON.stringify({ success: false, error: "nome e fotoUrl são obrigatórios." }), {
        status: 400,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }

    const rows = await googleSheetsService.registrosCharts.readValues(INFOS_ACTS_SHEET).catch(() => []);
    const normNome = normalizeComparison(nome);
    const rowIndex = rows.findIndex((r, i) => i > 0 && normalizeComparison(r[0]) === normNome);

    if (rowIndex !== -1) {
      await googleSheetsService.registrosCharts.updateValues(INFOS_ACTS_SHEET, `F${rowIndex + 1}`, [[fotoUrl]]);
    } else {
      await googleSheetsService.registrosCharts.appendRow(INFOS_ACTS_SHEET, [nome, "", "", "", "", fotoUrl]);
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  } catch (error: any) {
    console.error("[setArtistFotoController] Erro:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message || "Erro ao gravar foto do artista." }),
      { status: 500, headers: { "Content-Type": "application/json; charset=utf-8" } },
    );
  }
}

export async function getMeusArtistasNomesController(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    let telegramId = normalizeText(url.searchParams.get("telegramId"));
    const usuario = normalizeText(url.searchParams.get("usuario") || url.searchParams.get("nome"));

    if (!telegramId && usuario) {
      telegramId = await resolveIdByUsuario(usuario);
    }

    if (!telegramId) {
      return new Response(JSON.stringify({ success: true, data: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }

    const nomes = await getArtistNamesForOwner(telegramId);

    return new Response(JSON.stringify({ success: true, data: nomes }), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  } catch (error: any) {
    console.error("[getMeusArtistasNomesController] Erro:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message || "Erro ao buscar meus artistas." }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}
