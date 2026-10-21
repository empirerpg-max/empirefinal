import { googleSheetsService, normalizeText } from "../services/googleSheetsService";
import { processarFaixasDoAlbum, type TrackItemPayload } from "./gestaoController";

// Fix retroativo: o bug em lancarCampanhaPreSave (preSaveController.ts,
// já corrigido) excluía faixas não-inéditas (já vinculadas pelo jogador
// na criação da campanha) e faixas inéditas sem áudio do payload de
// lançamento — por isso o álbum FOLLIA (Max Gorghan) principal (linha
// 101 de "Albuns", mantido após a limpeza dos 52 duplicados) foi ao ar
// sem NENHUMA faixa, mesmo a campanha tendo faixas cadastradas desde a
// criação. Esse endpoint lê as faixas originais da campanha
// (PreSave_Album, coluna N = FaixasJson) e roda a MESMA lógica que
// publicarAlbum usaria (processarFaixasDoAlbum), mas mirando o álbum já
// existente (sem criar um novo, sem tocar no que já foi lançado).
//
// ?dryRun=1 só mostra o que seria gravado.
// GET /api/empire-play/admin/fix-follia-faixas?dryRun=1
export async function adminFixFolliaFaixasController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const dryRun = url.searchParams.get("dryRun") === "1";

  const presaveRows = await googleSheetsService.principal.readValues("PreSave_Album", "A1:U2000").catch(() => []);
  let campanhaRow: string[] | null = null;
  for (let i = 1; i < presaveRows.length; i++) {
    if (normalizeText(presaveRows[i]?.[0]) === "PRESAVE-7da5f189") {
      campanhaRow = presaveRows[i];
      break;
    }
  }
  if (!campanhaRow) {
    return new Response(JSON.stringify({ success: false, error: "Campanha PRESAVE-7da5f189 não encontrada." }, null, 2), {
      status: 404,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  const jogadorId = normalizeText(campanhaRow[1]);
  const artista = normalizeText(campanhaRow[3]);
  const albumTituloFull = normalizeText(campanhaRow[4]);
  const capaUrl = normalizeText(campanhaRow[5]);
  let faixasCampanha: unknown[] = [];
  try {
    faixasCampanha = JSON.parse(normalizeText(campanhaRow[13]) || "[]");
  } catch {
    faixasCampanha = [];
  }

  const albunsRows = await googleSheetsService.principal.readValues("Albuns", "A1:L200").catch(() => []);
  const albumRow = albunsRows[100]; // linha 101 (1-based) = índice 100
  if (!albumRow || normalizeText(albumRow[6]) !== albumTituloFull) {
    return new Response(
      JSON.stringify(
        { success: false, error: "Linha 101 de Albuns não é mais o álbum FOLLIA esperado — abortei por segurança.", encontrado: albumRow },
        null,
        2,
      ),
      { status: 409, headers: { "Content-Type": "application/json; charset=utf-8" } },
    );
  }
  const albumTopicId = normalizeText(albumRow[1]);
  const dataFormatada = normalizeText(albumRow[0]);

  const faixasPayload: TrackItemPayload[] = (faixasCampanha as Record<string, unknown>[]).map((f) => ({
    num: Number(f.num) || 0,
    inedita: !!f.inedita,
    titulo: String(f.titulo || ""),
    tipoSingle: f.tipoSingle ? String(f.tipoSingle) : undefined,
    tipoMusica: f.tipoMusica ? String(f.tipoMusica) : undefined,
    participantes: Array.isArray(f.participantes) ? (f.participantes as string[]) : undefined,
    mediaUrl: f.mediaUrl ? String(f.mediaUrl) : undefined,
    letra: f.letra ? String(f.letra) : undefined,
    abrirTopico: !!f.abrirTopico,
  }));

  if (dryRun) {
    return new Response(
      JSON.stringify(
        { success: true, dryRun: true, albumTopicId, dataFormatada, artista, albumTituloFull, jogadorId, faixasPayload },
        null,
        2,
      ),
      { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
    );
  }

  const resultado = await processarFaixasDoAlbum(
    faixasPayload,
    albumTituloFull,
    artista,
    capaUrl,
    jogadorId,
    dataFormatada,
    undefined,
    albumTopicId,
  );

  // Corrige o "Número de faixas" (coluna E) em EDIÇÃO CHARTS ÁLBUMS, que
  // ficou gravado como 0 no lançamento original (sem faixa nenhuma).
  const codigoUnicoAlbum = normalizeText(albumRow[11]); // L
  if (codigoUnicoAlbum) {
    const edicaoChartsRows = await googleSheetsService.edicaoCharts
      .readValues("EDIÇÃO CHARTS ÁLBUMS", "A1:R20000")
      .catch(() => []);
    for (let i = 1; i < edicaoChartsRows.length; i++) {
      if (normalizeText(edicaoChartsRows[i]?.[17]) === codigoUnicoAlbum) {
        await googleSheetsService.edicaoCharts
          .updateValues("EDIÇÃO CHARTS ÁLBUMS", `E${i + 1}`, [[String(faixasPayload.length)]])
          .catch(() => {});
        break;
      }
    }
  }

  return new Response(
    JSON.stringify({ success: true, dryRun: false, albumTopicId, resultado }, null, 2),
    { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
}
