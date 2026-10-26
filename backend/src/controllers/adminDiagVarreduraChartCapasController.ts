import { googleSheetsService, normalizeComparison } from "../services/googleSheetsService";
import { readMusicasFromD1 } from "./empirePlayController";

// Só leitura. Generaliza o diagnóstico que achou o bug da "Stamp On It":
// as abas de chart do Início (Top_50_Spotify, Top_Songs_Apple_Music,
// Top_Videos_YT) têm colunas de capa/áudio PRÓPRIAS, preenchidas na mão/por
// import, independentes do D1/Musicas — então podem divergir silenciosamente
// do catálogo real. Varre TODA linha de cada aba, casa com o D1 por
// artista+título (mesmo "Artista - Título" que a própria aba usa como
// "Nome da música") e reporta qualquer capa/áudio que não bate com o que o
// catálogo (fonte real) tem pra essa música — sem corrigir nada ainda, só
// lista os suspeitos pra decisão.
//
// GET /api/empire-play/admin/diagnostico-varredura-chart-capas?sheet=Top_50_Spotify
export async function adminDiagVarreduraChartCapasController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const sheet = url.searchParams.get("sheet") || "Top_50_Spotify";

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

  const chartRows = await googleSheetsService.principal.readSheetObjects(sheet).catch(() => []);
  const suspeitos: {
    nome: string;
    posicao: string;
    capaNaAba: string;
    capaNoCatalogo: string;
    audioNaAba: string;
    audioNoCatalogo: string;
    capaDivergente: boolean;
    audioDivergente: boolean;
  }[] = [];

  for (const row of chartRows) {
    const nome = String(row["nome_da_musica"] || "").trim();
    if (!nome) continue;
    const chave = normalizeComparison(nome);
    const real = porChave.get(chave);
    if (!real) continue; // não achou no catálogo — não dá pra comparar, pula.

    const capaNaAba = String(row["capa_da_musica"] || "").trim();
    const audioNaAba = String(row["link_do_audio"] || "").trim();
    const capaDivergente = !!capaNaAba && !!real.capa && capaNaAba !== real.capa;
    const audioDivergente = !!audioNaAba && !!real.audio && audioNaAba !== real.audio;

    if (capaDivergente || audioDivergente) {
      suspeitos.push({
        nome,
        posicao: String(row["posicao"] || ""),
        capaNaAba,
        capaNoCatalogo: real.capa,
        audioNaAba,
        audioNoCatalogo: real.audio,
        capaDivergente,
        audioDivergente,
      });
    }
  }

  return new Response(JSON.stringify({ success: true, sheet, totalLinhas: chartRows.length, suspeitos }, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
