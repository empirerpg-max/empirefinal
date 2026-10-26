import { googleSheetsService, normalizeComparison } from "../services/googleSheetsService";
import { readMusicasFromD1 } from "./empirePlayController";

// Correção em lote do mesmo bug achado na "Stamp On It": várias linhas de
// Top_50_Spotify (e possivelmente Apple/YT) tinham capa/áudio ERRADOS,
// muitas repetindo o MESMO arquivo (clássico sinal de célula arrastada por
// cima de várias linhas na planilha) — confirmado ao vivo via
// diagnostico-varredura-chart-capas: 20 de 100 linhas divergentes do
// catálogo real (D1), a maioria com a MESMA capa da Hayley Wonderwall e o
// MESMO áudio errado repetidos. Reescreve só as células divergentes com o
// valor real do catálogo (capa_da_musica/link_do_audio), linha por linha —
// nunca mexe em mais nada da linha (posição, nome).
//
// GET /api/empire-play/admin/fix-varredura-chart-capas?sheet=Top_50_Spotify&dryRun=1
export async function adminFixVarreduraChartCapasController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const sheet = url.searchParams.get("sheet") || "Top_50_Spotify";
  const dryRun = url.searchParams.get("dryRun") === "1";

  const d1Rows = (await readMusicasFromD1()) ?? [];
  const porChave = new Map<string, { capa: string; audio: string }>();
  for (const rec of d1Rows as any[]) {
    const titulo = String(rec.nome_da_musica || rec.titulo || "").trim();
    const artista = String(rec.act_principal || rec.artista || "").trim();
    if (!titulo) continue;
    const chave = normalizeComparison(`${artista} - ${titulo}`);
    if (!porChave.has(chave)) {
      porChave.set(chave, {
        capa: String(rec.capa_da_musica || rec.capa_url || "").trim(),
        audio: String(rec.id_do_arquivo || rec.audio_url || "").trim(),
      });
    }
  }

  const rows = await googleSheetsService.principal.readValues(sheet);
  const header = rows[0] || [];
  const colNome = header.findIndex((h) => normalizeComparison(h) === normalizeComparison("Nome da Música"));
  const colCapa = header.findIndex((h) => normalizeComparison(h) === normalizeComparison("Capa da Música"));
  const colAudio = header.findIndex((h) => normalizeComparison(h) === normalizeComparison("Link do áudio"));
  if (colNome === -1) {
    return new Response(JSON.stringify({ success: false, error: "Coluna 'Nome da Música' não encontrada.", header }), {
      status: 500,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  const corrigidas: { linha: number; nome: string; capa: boolean; audio: boolean }[] = [];
  const entradas: { sheetName: string; range: string; values: string[][] }[] = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const nome = (row[colNome] || "").trim();
    if (!nome) continue;
    const real = porChave.get(normalizeComparison(nome));
    if (!real) continue;

    const linha = i + 1;
    let capaOk = true;
    let audioOk = true;

    if (colCapa !== -1 && real.capa) {
      const capaAtual = (row[colCapa] || "").trim();
      if (capaAtual && capaAtual !== real.capa) {
        capaOk = false;
        if (!dryRun) {
          entradas.push({
            sheetName: sheet,
            range: `${String.fromCharCode(65 + colCapa)}${linha}`,
            values: [[real.capa]],
          });
        }
      }
    }
    if (colAudio !== -1 && real.audio) {
      const audioAtual = (row[colAudio] || "").trim();
      if (audioAtual && audioAtual !== real.audio) {
        audioOk = false;
        if (!dryRun) {
          entradas.push({
            sheetName: sheet,
            range: `${String.fromCharCode(65 + colAudio)}${linha}`,
            values: [[real.audio]],
          });
        }
      }
    }

    if (!capaOk || !audioOk) {
      corrigidas.push({ linha, nome, capa: !capaOk, audio: !audioOk });
    }
  }

  if (!dryRun && entradas.length > 0) {
    await googleSheetsService.principal.updateValuesBatch(entradas);
  }

  return new Response(
    JSON.stringify({ success: true, sheet, dryRun, totalCorrigidas: corrigidas.length, corrigidas }, null, 2),
    { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
}
