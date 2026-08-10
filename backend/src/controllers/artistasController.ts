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

    const normId = normalizeComparison(telegramId);
    const pairs = await readArtistOwnerPairs();
    const nomes = Array.from(
      new Set(
        pairs.filter(([, dono]) => normalizeComparison(dono) === normId).map(([artista]) => artista),
      ),
    );

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
