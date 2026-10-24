import { googleSheetsService, normalizeComparison } from "../services/googleSheetsService";
import { mirrorMusicaRowParaD1 } from "./gestaoController";

// Conserto pontual: acha a(s) linha(s) da planilha Musicas que casam com um
// "código único" exato (coluna Z) e espelha SÓ ESSA(S) linha(s) pra tabela
// `musicas` do D1 via mirrorMusicaRowParaD1 (já existente, usado em outros
// fixes pontuais) — nada mais é tocado (sem varrer ou reescrever o resto da
// tabela). Feito pra cobrir casos em que o upsert pro D1 nunca rodou na hora
// da criação (ex.: Abaddon, código EMP663) e o D1 ficou sem essa linha
// enquanto a planilha já tinha o dado certo.
//
// GET /api/empire-play/admin/fix-backfill-musica-d1?codigoUnico=EMP663
export async function adminFixBackfillMusicaD1Controller(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const codigoUnico = (url.searchParams.get("codigoUnico") || "").trim();
  if (!codigoUnico) {
    return new Response(JSON.stringify({ success: false, error: "codigoUnico é obrigatório." }), {
      status: 400,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  const rows = await googleSheetsService.principal.readValues("Musicas");
  const alvo = normalizeComparison(codigoUnico);
  const linhas = rows
    .slice(1)
    .map((row, i) => ({ linha: i + 2, titulo: (row[7] || "").trim(), codigoUnico: (row[25] || "").trim() }))
    .filter((r) => normalizeComparison(r.codigoUnico) === alvo);

  if (linhas.length === 0) {
    return new Response(
      JSON.stringify({ success: false, error: `Nenhuma linha na planilha Musicas com código único "${codigoUnico}".` }),
      { status: 404, headers: { "Content-Type": "application/json; charset=utf-8" } },
    );
  }

  for (const { linha } of linhas) {
    await mirrorMusicaRowParaD1(linha);
  }

  return new Response(JSON.stringify({ success: true, espelhadas: linhas }, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
