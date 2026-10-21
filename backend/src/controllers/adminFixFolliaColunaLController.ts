import { googleSheetsService } from "../services/googleSheetsService";

// FIX do fix: adminLimparFolliaDuplicadosController esvaziou só A:K das
// linhas duplicadas de "Albuns" — esqueceu a coluna L (Código único,
// copiada separadamente por registrarAlbumNaEdicaoChartsAlbuns, ver
// gestaoController.ts). Com L ainda preenchido, a linha deixa de ser
// 100% vazia e readSheetObjects (googleSheetsService.ts) NÃO filtra mais
// essas linhas — viram álbuns "fantasma" sem título/capa/artista
// (fallback "Álbum N"), inundando o Fórum > Álbuns. As 52 linhas
// duplicadas do FOLLIA são sempre as mesmas (102–153, já confirmadas
// nos diagnósticos anteriores) — esvazia só a coluna L nelas.
//
// GET /api/empire-play/admin/fix-follia-coluna-l?dryRun=1
export async function adminFixFolliaColunaLController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const dryRun = url.searchParams.get("dryRun") === "1";

  const linhaInicial = 102;
  const linhaFinal = 153;

  const rows = await googleSheetsService.principal
    .readValues("Albuns", `L${linhaInicial}:L${linhaFinal}`)
    .catch(() => []);
  const linhasComLPreenchido = rows
    .map((row, i) => ({ linha: linhaInicial + i, valor: row?.[0] || "" }))
    .filter((r) => r.valor);

  if (dryRun) {
    return new Response(
      JSON.stringify({ success: true, dryRun: true, linhasComLPreenchido }, null, 2),
      { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
    );
  }

  let ok = 0;
  let falha = 0;
  for (const r of linhasComLPreenchido) {
    const sucesso = await googleSheetsService.principal
      .updateValues("Albuns", `L${r.linha}`, [[""]])
      .catch(() => false);
    if (sucesso) ok++;
    else falha++;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  return new Response(
    JSON.stringify({ success: true, dryRun: false, ok, falha, linhasLimpas: linhasComLPreenchido.map((r) => r.linha) }, null, 2),
    { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
}
