import {
  googleSheetsService,
  listSheetTabs,
  normalizeHeader,
  normalizeText,
  normalizeComparison,
  dedupeHeaders,
} from "../services/googleSheetsService";

const SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbwxbkUndhZPtFvtK1uIFTkPNN-m6WeiFVMU3IDzuahsC0oQp8Ba2GLQFOAPkWv8eiA3/exec";

// TEMPORÁRIO — investiga por que as fotos de "meus artistas" sumiram pra
// alguns jogadores: compara os nomes vindos da aba ARTISTAS (fonte de
// vínculo) contra o catálogo do Apps Script (listar_todos, fonte da foto)
// pra achar quais nomes não estão batendo.
export async function debugFotosArtistasController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const usuario = url.searchParams.get("usuario") || "Hugo";

  const rawRows = await googleSheetsService.usuarios.readValues("Usuários").catch(() => []);
  const headers = dedupeHeaders(
    "Usuários",
    (rawRows[0] || []).map((h, i) => normalizeHeader(h) || `coluna_${i + 1}`),
  );
  const usuarioCol = headers.indexOf("usuario");
  const nomeCol = headers.indexOf("nome");
  const idCol = headers.indexOf("id");
  const normUsuario = normalizeComparison(usuario);
  const row = rawRows
    .slice(1)
    .find(
      (r) =>
        (usuarioCol !== -1 && normalizeComparison(r[usuarioCol]) === normUsuario) ||
        (nomeCol !== -1 && normalizeComparison(r[nomeCol]) === normUsuario),
    );
  const telegramId = row ? normalizeText(row[idCol]) : "";

  const artRows = await googleSheetsService.usuarios.readValues("ARTISTAS").catch(() => []);
  const artHeaders = dedupeHeaders(
    "ARTISTAS",
    (artRows[0] || []).map((h, i) => normalizeHeader(h) || `coluna_${i + 1}`),
  );
  const artCol = artHeaders.indexOf("nome");
  const ownerCol = artHeaders.indexOf("id_usuario");
  const meusNomes = artRows
    .slice(1)
    .filter((r) => normalizeComparison(r[ownerCol]) === normalizeComparison(telegramId))
    .map((r) => normalizeText(r[artCol]));

  let catalogo: any[] = [];
  let catalogoErro: string | null = null;
  try {
    const res = await fetch(`${SCRIPT_URL}?acao=listar_todos`);
    catalogo = await res.json();
  } catch (err: any) {
    catalogoErro = err?.message || String(err);
  }

  const catalogoPorNomeNorm = new Map(
    (Array.isArray(catalogo) ? catalogo : []).map((a) => [normalizeComparison(a.nome), a]),
  );

  const comparacao = meusNomes.map((nome) => {
    const match = catalogoPorNomeNorm.get(normalizeComparison(nome));
    return {
      nome_na_aba_artistas: nome,
      encontrado_no_catalogo: !!match,
      nome_no_catalogo: match?.nome ?? null,
      foto_no_catalogo: match?.foto ?? null,
    };
  });

  return new Response(
    JSON.stringify(
      {
        usuario,
        telegramId,
        total_catalogo: Array.isArray(catalogo) ? catalogo.length : 0,
        catalogo_erro: catalogoErro,
        comparacao,
      },
      null,
      2,
    ),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

// TEMPORÁRIO — resolve os gids das abas de badges/gamificação (planilha
// "usuarios") pro nome real e lê a estrutura ao vivo. Será removido depois
// do mapeamento.
const GIDS_ALVO = [838747018, 1763967987, 1242318680];

export async function debugGamificacaoController(): Promise<Response> {
  const out: Record<string, unknown> = {};
  const tabs = await listSheetTabs("usuarios");
  out._abas = tabs;

  for (const gid of GIDS_ALVO) {
    const tab = tabs.find((t) => t.sheetId === gid);
    if (!tab) {
      out[`gid_${gid}`] = { erro: "não encontrada" };
      continue;
    }
    try {
      out[tab.title] = await googleSheetsService.usuarios.readValues(tab.title, "A1:P20");
    } catch (err: any) {
      out[tab.title] = { erro: err?.message || String(err) };
    }
  }

  return new Response(JSON.stringify(out), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
