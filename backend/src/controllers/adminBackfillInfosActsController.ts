import { googleSheetsService, normalizeComparison, normalizeText } from "../services/googleSheetsService";

// Fix retroativo (único) pro bug corrigido em criarArtistaController/
// getArtistInfoController: todo artista que já existia em ARTISTAS mas
// nunca teve ninguém editando foto/bio/capa pelo app (logo, sem linha
// nenhuma em INFOS ACTS) fica com perfil vazio sem explicação nenhuma —
// caso real da Hayley Wonderwall. Cria a linha faltante (só o nome, resto
// em branco) pra cada artista de ARTISTAS sem linha correspondente em
// INFOS ACTS. Idempotente — nunca sobrescreve uma linha já existente.
//
// ?dryRun=1 só lista quem seria criado, sem gravar nada.
// GET /api/empire-play/admin/backfill-infos-acts?dryRun=1
export async function adminBackfillInfosActsController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const dryRun = url.searchParams.get("dryRun") === "1";

  const [artistasRows, infosRows] = await Promise.all([
    googleSheetsService.usuarios.readValues("ARTISTAS").catch(() => []),
    googleSheetsService.registrosCharts.readValues("INFOS ACTS").catch(() => []),
  ]);

  const nomesComInfos = new Set(infosRows.slice(1).map((r) => normalizeComparison(r[0])));
  const faltando: string[] = [];
  for (const row of artistasRows.slice(1)) {
    const nome = normalizeText(row[0]);
    if (!nome) continue;
    if (nomesComInfos.has(normalizeComparison(nome))) continue;
    faltando.push(nome);
  }

  if (dryRun) {
    return new Response(JSON.stringify({ success: true, dryRun: true, totalFaltando: faltando.length, faltando }, null, 2), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  // appendRow("A:ZZ") deixa a API do Sheets ADIVINHAR em que coluna a "tabela"
  // começa, olhando o range inteiro — como a coluna A está vazia em várias
  // linhas (estrutura legada da aba), ela "detectou" a tabela começando na
  // coluna C e jogou o nome ali, não em A. Resultado real visto na planilha:
  // os 11 artistas (inclusive Hayley Wonderwall) foram gravados como
  // ["","","Hayley Wonderwall"] em vez de ["Hayley Wonderwall"] — toda
  // leitura que espera o nome em A (inclusive este próprio endpoint, rodando
  // de novo) continuava achando a linha "vazia". Fix: escreve direto na
  // célula A{linha}, sem passar pela heurística de append.
  let nextRow = infosRows.length + 1;
  let criadas = 0;
  const falharam: string[] = [];
  for (const nome of faltando) {
    const ok = await googleSheetsService.registrosCharts.updateValues("INFOS ACTS", `A${nextRow}`, [[nome]]);
    if (ok) {
      criadas++;
      nextRow++;
    } else {
      falharam.push(nome);
    }
  }

  return new Response(
    JSON.stringify({ success: falharam.length === 0, totalFaltando: faltando.length, criadas, falharam }, null, 2),
    {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    },
  );
}
