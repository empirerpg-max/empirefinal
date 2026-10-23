import { googleSheetsService, normalizeText } from "../services/googleSheetsService";

// Fix retroativo (único): o backfill original gravou 11 linhas em INFOS ACTS
// usando appendRow("A:ZZ"), que deixa a API do Sheets adivinhar a coluna —
// como a coluna A estava vazia em várias linhas da aba, ela colocou o nome
// na coluna C em vez de A (["","","Hayley Wonderwall"] em vez de
// ["Hayley Wonderwall"]). Move o nome de C pra A e limpa C, só nas linhas
// onde A está vazio e C tem o nome esperado — nunca mexe em linha que já
// tem A preenchido.
//
// ?dryRun=1 só lista o que seria corrigido.
// GET /api/empire-play/admin/fix-coluna-errada-infos-acts?dryRun=1
export async function adminFixColunaErradaInfosActsController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const dryRun = url.searchParams.get("dryRun") === "1";

  const nomesEsperados = [
    "OVERDRIVE",
    "Perpétua Puerto",
    "John Groff",
    "808",
    "Cowboy Fresh",
    "Max Gorghan",
    "Sebastian",
    "Peter Johnson",
    "Brida",
    "ASTRoLUnAR",
    "Hayley Wonderwall",
  ];

  const rows = await googleSheetsService.registrosCharts.readValues("INFOS ACTS");

  const corrigir: { linha: number; nome: string }[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    const a = normalizeText(row[0]);
    const c = normalizeText(row[2]);
    if (a) continue;
    if (!c || !nomesEsperados.includes(c)) continue;
    corrigir.push({ linha: i + 1, nome: c });
  }

  if (dryRun) {
    return new Response(JSON.stringify({ success: true, dryRun: true, total: corrigir.length, corrigir }, null, 2), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  let corrigidas = 0;
  const falharam: { linha: number; nome: string }[] = [];
  for (const { linha, nome } of corrigir) {
    const ok = await googleSheetsService.registrosCharts.updateValues("INFOS ACTS", `A${linha}:C${linha}`, [
      [nome, "", ""],
    ]);
    if (ok) {
      corrigidas++;
    } else {
      falharam.push({ linha, nome });
    }
  }

  return new Response(
    JSON.stringify({ success: falharam.length === 0, total: corrigir.length, corrigidas, falharam }, null, 2),
    { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
}
