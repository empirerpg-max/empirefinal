import { googleSheetsService, normalizeComparison } from "../services/googleSheetsService";
import { readAllCampanhas } from "./preSaveController";
import { processarFaixasDoAlbum, dedupeArtistPrefix, type TrackItemPayload } from "./gestaoController";
import { registrarLogSistema } from "../services/logSistemaService";

// Fix pontual, mas genérico (reutilizável pra qualquer campanha de
// pre-save que tenha sofrido o mesmo bug): álbum "Samantha Cooper - WELL,
// IT'S OVER" (PRESAVE-f4ed19ad) lançou com só 3 das 11 faixas cadastradas
// porque processarFaixasDoAlbum abortava o `for` inteiro sem log quando
// registrarFaixaNosCharts falhava numa faixa (já corrigido — ver commit
// "faixa inédita de álbum não pode mais abortar o resto do lançamento").
// Esse endpoint relança só as faixas que FALTAM de verdade (comparando a
// tracklist da campanha com o que já existe em Musicas pra esse álbum),
// reaproveitando processarFaixasDoAlbum — nunca duplica faixa já
// existente.
//
// GET /api/gestao/admin/relancar-faixas-faltantes-presave?campanhaId=PRESAVE-xxxx&confirmar=1
export async function adminRelancarFaixasFaltantesPreSaveController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const campanhaId = (url.searchParams.get("campanhaId") || "").trim();
  const confirmar = url.searchParams.get("confirmar") === "1";
  if (!campanhaId) {
    return new Response(JSON.stringify({ success: false, error: "Parâmetro 'campanhaId' é obrigatório." }), {
      status: 400,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  const campanhas = await readAllCampanhas();
  const c = campanhas.find((x) => x.id === campanhaId);
  if (!c) {
    return new Response(JSON.stringify({ success: false, error: `Campanha ${campanhaId} não encontrada.` }), {
      status: 404,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }
  if (c.status !== "lancada") {
    return new Response(
      JSON.stringify({
        success: false,
        error: `Campanha ${campanhaId} está com status "${c.status}" (só faz sentido relançar faixas de uma campanha já "lancada").`,
      }),
      { status: 400, headers: { "Content-Type": "application/json; charset=utf-8" } },
    );
  }

  const albumFullTitle = c.albumTituloFull.startsWith(`${c.artista} - `)
    ? c.albumTituloFull.slice(c.artista.length + 3)
    : c.albumTituloFull;
  const albumFullTitleCompleto = `${c.artista} - ${albumFullTitle}`;

  // Data de lançamento real usada pelas faixas já publicadas desse álbum —
  // lê de uma linha já existente em Musicas pra esse álbum, pra manter a
  // mesma data das faixas irmãs (nunca usa "hoje", que poderia já ser um
  // dia diferente do lançamento de verdade).
  const musicasRows = await googleSheetsService.principal.readValues("Musicas", "A:Z").catch(() => []);
  const albumNorm = normalizeComparison(albumFullTitleCompleto);
  const linhasDoAlbum = musicasRows
    .map((row, i) => ({ linha: i + 1, row }))
    .filter(({ row }) => normalizeComparison(row[10] || "") === albumNorm);

  if (linhasDoAlbum.length === 0) {
    return new Response(
      JSON.stringify({ success: false, error: `Nenhuma linha em Musicas encontrada pro álbum "${albumFullTitleCompleto}" — não dá pra confirmar que ele já foi lançado de verdade.` }),
      { status: 404, headers: { "Content-Type": "application/json; charset=utf-8" } },
    );
  }
  // BUG encontrado no dry-run real (2026-11-11): usar simplesmente a
  // primeira linha do álbum pegava a data de uma faixa PRÉ-EXISTENTE (ex:
  // "CURSED BLESSED", single solto lançado meses antes do álbum, mesmo
  // "Álbum" só por referência) em vez da data real do lançamento do álbum
  // em si. As faixas de verdade lançadas junto com o álbum ficam com
  // "Pendente?" = "Sim" (coluna X) — prioriza a data de uma dessas; só cai
  // pra primeira linha encontrada se nenhuma faixa pendente existir.
  const linhaDoLancamentoReal =
    linhasDoAlbum.find(({ row }) => normalizeComparison(row[23] || "") === "sim") || linhasDoAlbum[0];
  const dataFormatada = linhaDoLancamentoReal.row[0] || "";

  // Títulos já presentes em Musicas pra esse álbum (normalizados) — usado
  // pra achar quais faixas da campanha ainda NÃO foram lançadas. Compara
  // pelo título completo "Artista - Título" que processarFaixasDoAlbum
  // monta (mesmo dedupeArtistPrefix usado lá).
  const titulosJaLancados = new Set(
    linhasDoAlbum.map(({ row }) => normalizeComparison(row[7] || "")),
  );

  const faixasFaltando = c.faixas.filter((f) => {
    const tituloSemPrefixo = dedupeArtistPrefix(f.titulo, c.artista);
    const songTitle = tituloSemPrefixo.includes(" - ") ? tituloSemPrefixo : `${c.artista} - ${tituloSemPrefixo}`;
    return !titulosJaLancados.has(normalizeComparison(songTitle));
  });

  if (faixasFaltando.length === 0) {
    return new Response(
      JSON.stringify({ success: true, mensagem: "Nenhuma faixa faltando — todas as faixas da campanha já estão em Musicas.", totalFaixasCampanha: c.faixas.length }),
      { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
    );
  }

  if (!confirmar) {
    return new Response(
      JSON.stringify({
        success: true,
        dryRun: true,
        albumFullTitle: albumFullTitleCompleto,
        dataFormatada,
        totalFaixasCampanha: c.faixas.length,
        totalJaLancadas: linhasDoAlbum.length,
        faixasFaltando: faixasFaltando.map((f) => ({ num: f.num, titulo: f.titulo, inedita: f.inedita })),
        aviso: "Dry-run — nada foi gravado. Repita com &confirmar=1 pra lançar essas faixas de verdade.",
      }),
      { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
    );
  }

  const faixasPayload: TrackItemPayload[] = faixasFaltando.map((f) => ({
    num: f.num,
    inedita: f.inedita,
    titulo: f.titulo,
    tipoSingle: f.tipoSingle,
    tipoMusica: f.tipoMusica,
    participantes: f.participantes,
    mediaUrl: f.mediaUrl,
    letra: f.letra,
    abrirTopico: f.abrirTopico,
  }));

  const resultado = await processarFaixasDoAlbum(
    faixasPayload,
    albumFullTitleCompleto,
    c.artista,
    c.capaUrl,
    c.jogadorId,
    dataFormatada,
    undefined,
    c.albumTopicId,
  );

  registrarLogSistema({
    categoria: "Ação concluída",
    oQueAconteceu: `[admin fix] Relançadas ${faixasFaltando.length} faixa(s) faltante(s) do álbum "${albumFullTitleCompleto}" (campanha de pre-save ${campanhaId}): ${faixasFaltando.map((f) => f.titulo).join(", ")}.`,
    onde: "adminRelancarFaixasFaltantesPreSaveController",
  }).catch(() => {});

  return new Response(
    JSON.stringify({
      success: true,
      albumFullTitle: albumFullTitleCompleto,
      faixasRelancadas: faixasFaltando.map((f) => ({ num: f.num, titulo: f.titulo })),
      resultado,
    }),
    { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
}
