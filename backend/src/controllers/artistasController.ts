import {
  googleSheetsService,
  normalizeHeader,
  normalizeText,
  normalizeComparison,
  dedupeHeaders,
} from "../services/googleSheetsService";

const ARTISTAS_SHEET = "ARTISTAS";
const USUARIOS_SHEET = "Usuários";

/** Resolve um ID (telegram_id histórico ou ID do login) pro Nome do jogador, via a aba Usuários. */
async function resolveNomeById(id: string): Promise<string> {
  const rawRows = await googleSheetsService.usuarios.readValues(USUARIOS_SHEET).catch(() => []);
  if (!rawRows || rawRows.length < 2) return "";
  const headers = dedupeHeaders(
    USUARIOS_SHEET,
    rawRows[0].map((h, i) => normalizeHeader(h) || `coluna_${i + 1}`),
  );
  const idCol = headers.indexOf("id");
  const nomeCol = headers.indexOf("nome");
  if (idCol === -1 || nomeCol === -1) return "";
  const normId = normalizeComparison(id);
  const row = rawRows.slice(1).find((r) => normalizeComparison(r[idCol]) === normId);
  return row ? normalizeText(row[nomeCol]) : "";
}

/**
 * Lê a aba "ARTISTAS" da planilha "Usuários" (nova fonte de verdade da
 * associação artista↔dono, substituindo o Apps Script legado que ainda lê
 * de outra planilha e misturava donos errados). A aba tem duas listas lado
 * a lado: "Nome"/"Nome do Jogador" (mais antiga) e "LISTA DE ARTISTAS"/
 * "NOME DO OFF" (mais completa) — unimos as duas.
 *
 * Devolve pares [nomeExibicaoDoArtista, nomeDoDono].
 */
async function readArtistOwnerPairs(): Promise<[string, string][]> {
  const rawRows = await googleSheetsService.usuarios.readValues(ARTISTAS_SHEET).catch(() => []);
  if (!rawRows || rawRows.length < 2) return [];

  const headers = dedupeHeaders(
    ARTISTAS_SHEET,
    rawRows[0].map((h, i) => normalizeHeader(h) || `coluna_${i + 1}`),
  );
  const colPairs = [
    [headers.indexOf("nome"), headers.indexOf("nome_do_jogador")],
    [headers.indexOf("lista_de_artistas"), headers.indexOf("nome_do_off")],
  ].filter(([a, b]) => a !== -1 && b !== -1);

  const pairs: [string, string][] = [];
  for (const row of rawRows.slice(1)) {
    for (const [artCol, ownerCol] of colPairs) {
      const artista = normalizeText(row[artCol]);
      const dono = normalizeText(row[ownerCol]);
      if (artista && dono) pairs.push([artista, dono]);
    }
  }
  return pairs;
}

/**
 * GET /api/artistas/meus-nomes?telegramId=... ou ?usuario=NomeDoOFF
 * Devolve só os NOMES dos artistas do jogador logado — a lista completa de
 * cada artista continua vindo do Apps Script legado (/listar_todos), o
 * frontend cruza os dois. Corrige o bug de dono errado (ex: Hugo aparecendo
 * como dono de Matthew E Adam Fountaine, sendo que Adam Fountaine é do
 * Filipe). `telegramId` é resolvido pro Nome do jogador via a aba Usuários
 * antes de casar com a aba ARTISTAS — mantém compatível com todas as telas
 * que já chamam essa função passando o telegram_id/ID do login.
 */
export async function getMeusArtistasNomesController(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const telegramId = normalizeText(url.searchParams.get("telegramId"));
    let usuario = normalizeText(url.searchParams.get("usuario") || url.searchParams.get("nome"));

    if (!usuario && telegramId) {
      usuario = await resolveNomeById(telegramId);
    }

    if (!usuario) {
      return new Response(JSON.stringify({ success: true, data: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }

    const normUsuario = normalizeComparison(usuario);
    const pairs = await readArtistOwnerPairs();
    const nomes = Array.from(
      new Set(
        pairs
          .filter(([, dono]) => normalizeComparison(dono) === normUsuario)
          .map(([artista]) => artista),
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
