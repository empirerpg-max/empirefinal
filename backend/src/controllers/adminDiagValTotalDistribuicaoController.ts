import { googleSheetsService, normalizeComparison } from "../services/googleSheetsService";

// Só leitura. Varre a aba SPOTIFY (chartsBase) inteira e devolve o
// melhor valTotal já alcançado por CADA artista, ordenado do menor pro
// maior — usado pra calibrar um "teto base" de pre-save pra artista sem
// nenhum histórico de chart (hoje fica travado em 0), escolhendo um
// valor claramente abaixo do que qualquer artista com chart real já tem.
//
// GET /api/empire-play/admin/diagnostico-valtotal-distribuicao
export async function adminDiagValTotalDistribuicaoController(): Promise<Response> {
  const rows = await googleSheetsService.chartsBase.readValues("SPOTIFY").catch(() => []);
  if (!rows || rows.length < 2) {
    return new Response(JSON.stringify({ success: false, error: "Aba SPOTIFY vazia/inacessível." }), {
      status: 500,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  const melhorPorArtista = new Map<string, number>();
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const art = (row[7] || "").trim();
    if (!art) continue;
    const valTotal =
      parseFloat(String(row[5] || "0").replace(/\./g, "").replace(",", ".")) || 0;
    const key = normalizeComparison(art);
    const atual = melhorPorArtista.get(key) || 0;
    if (valTotal > atual) melhorPorArtista.set(key, valTotal);
  }

  const valores = Array.from(melhorPorArtista.values())
    .filter((v) => v > 0)
    .sort((a, b) => a - b);

  const pct = (p: number) => valores[Math.floor((valores.length - 1) * p)];

  return new Response(
    JSON.stringify(
      {
        success: true,
        totalArtistas: valores.length,
        minimo: valores[0],
        p10: pct(0.1),
        p25: pct(0.25),
        mediana: pct(0.5),
        p75: pct(0.75),
        maximo: valores[valores.length - 1],
      },
      null,
      2,
    ),
    { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
}
