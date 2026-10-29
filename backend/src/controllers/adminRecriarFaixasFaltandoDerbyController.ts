import { googleSheetsService, normalizeComparison, normalizeText } from "../services/googleSheetsService";
import { processarFaixasDoAlbum, type TrackItemPayload } from "./gestaoController";

// Causa raiz real do "álbum com só 3 faixas": a campanha de pre-save do
// DERBY tinha 11 faixas inéditas configuradas (ver FaixasJson em
// PreSave_Album), mas das ~63 execuções duplicadas do lançamento (bug já
// corrigido), NENHUMA conseguiu gravar as 8 últimas faixas (#4 a #11) —
// provavelmente o mesmo limite de requisições da API do Sheets já
// documentado como risco conhecido em processarFaixasDoAlbum (álbuns com
// muitas faixas inéditas seguidas, mesma classe de bug já visto e
// corrigido uma vez antes com o cursor local, mas que ainda pode estourar
// em runs de 11+ faixas sob throttling pesado). As 3 primeiras faixas (El
// Traidor, Nosotros, Tequerdad) conseguiram ser gravadas em pelo menos
// uma das 63 tentativas; as 8 seguintes, nunca.
//
// Esse endpoint usa a MESMA função real de lançamento (processarFaixasDoAlbum)
// pra recriar só as faixas que estão genuinamente faltando — lê a lista
// real configurada pelo jogador (PreSave_Album) e o que já existe hoje em
// Musicas, e grava só a diferença. Idempotente: se rodar de novo e as
// faixas já existirem, não duplica (reaproveita a mesma checagem de
// diag-faixas-presave-derby).
//
// GET /api/empire-play/admin/recriar-faixas-faltando-derby?confirmar=1
export async function adminRecriarFaixasFaltandoDerbyController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const confirmar = url.searchParams.get("confirmar") === "1";

  const presaveRows = await googleSheetsService.principal.readValues("PreSave_Album").catch(() => []);
  let capaUrl = "";
  let jogadorId = "";
  let dataLancamentoIso = "";
  let faixasRaw = "";
  let albumFullTitle = "";
  let artista = "";
  for (let i = 1; i < presaveRows.length; i++) {
    const row = presaveRows[i];
    if (!row) continue;
    const art = normalizeComparison(row[3]);
    const alb = normalizeComparison(row[4]);
    if (art.includes("cowboy fresh") && alb.includes("derby")) {
      artista = normalizeText(row[3]);
      albumFullTitle = normalizeText(row[4]);
      capaUrl = normalizeText(row[5]);
      jogadorId = normalizeText(row[1]);
      dataLancamentoIso = normalizeText(row[9]);
      faixasRaw = row[13] || "";
      break;
    }
  }

  if (!albumFullTitle) {
    return new Response(JSON.stringify({ success: false, error: "Campanha do DERBY não encontrada em PreSave_Album." }), {
      status: 404,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  let faixasCampanha: TrackItemPayload[] = [];
  try {
    faixasCampanha = JSON.parse(faixasRaw || "[]");
  } catch {
    faixasCampanha = [];
  }

  const albunsRows = await googleSheetsService.principal.readValues("Albuns", "A1:Z20000").catch(() => []);
  let albumTopicId = "";
  for (let i = 1; i < albunsRows.length; i++) {
    const row = albunsRows[i];
    if (!row) continue;
    const nome = normalizeComparison(normalizeText(row[6]));
    if (nome.includes("cowboy fresh") && nome.includes("derby")) {
      albumTopicId = normalizeText(row[1]);
      break;
    }
  }

  const musicasRows = await googleSheetsService.principal.readValues("Musicas", "A1:AE50000").catch(() => []);
  const titulosAtuais = new Set<string>();
  for (let i = 1; i < musicasRows.length; i++) {
    const row = musicasRows[i];
    if (!row) continue;
    const album = normalizeComparison(row[10]); // K
    if (album.includes("cowboy fresh") && album.includes("derby")) {
      titulosAtuais.add(normalizeComparison(normalizeText(row[7]))); // H
    }
  }

  const faltando = faixasCampanha.filter((f) => {
    const titulo = normalizeText(f.titulo || "");
    const comArtista = titulo.includes(" - ") ? titulo : `${artista} - ${titulo}`;
    return !titulosAtuais.has(normalizeComparison(comArtista)) && !titulosAtuais.has(normalizeComparison(titulo));
  });

  // dataFormatada: converte "YYYY-MM-DD" pra "DD/MM/AAAA" (padrão já usado
  // em todo o resto da planilha, ver dataFormatada em createAlbumController).
  const [ano, mes, dia] = dataLancamentoIso.split("-");
  const dataFormatada = dia && mes && ano ? `${dia}/${mes}/${ano}` : dataLancamentoIso;

  if (!confirmar) {
    return new Response(
      JSON.stringify(
        { success: true, confirmar, albumFullTitle, artista, capaUrl, jogadorId, dataFormatada, albumTopicId, totalFaltando: faltando.length, faltando },
        null,
        2,
      ),
      { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
    );
  }

  if (faltando.length === 0) {
    return new Response(JSON.stringify({ success: true, mensagem: "Nenhuma faixa faltando — nada a recriar." }, null, 2), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  const resultado = await processarFaixasDoAlbum(
    faltando,
    albumFullTitle,
    artista,
    capaUrl,
    jogadorId,
    dataFormatada,
    undefined,
    albumTopicId,
  );

  return new Response(
    JSON.stringify({ success: true, confirmar, recriadas: faltando.map((f) => f.titulo), resultado }, null, 2),
    { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
}
