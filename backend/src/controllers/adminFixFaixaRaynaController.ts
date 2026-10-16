import { googleSheetsService, normalizeText, normalizeComparison } from "../services/googleSheetsService";
import { getCatalogoDb, buildMusicaUpsertStatement } from "../services/musicasDbService";

// Correção retroativa pontual: "I Am Hollywood" (Rayna, código único
// EMP686, linha 455 de Musicas) foi publicada via "Lançar Faixa de Álbum"
// antes do fix em publicarFaixaPendenteController/editController.ts (ver
// commits 2026-10-16) — o tópico foi criado de verdade (Pendente? já é
// "Não"), mas Musicas!H tinha perdido o prefixo "Artista - " (editada
// antes por Fórum > Músicas > Editar, mesmo bug corrigido agora), o que
// fez o match com EDIÇÃO CHARTS falhar silenciosamente: data/tipo nunca
// atualizaram pro lançamento real, e INFOS MÚSICAS nunca recebeu a capa
// (chamada com o título sem prefixo, que não bate com nada).
//
// GET /api/empire-play/admin/fix-faixa-rayna-i-am-hollywood
const LINHA_MUSICAS = 455;
const CODIGO_UNICO = "EMP686";
const TITULO_CORRETO = "Rayna - I Am Hollywood";

export async function adminFixFaixaRaynaController(): Promise<Response> {
  const resultado: Record<string, unknown> = {};

  // 1. Corrige Musicas!H — mesma raiz do bug, pra parar de divergir de
  // EDIÇÃO CHARTS pra sempre.
  const musicasRow = (await googleSheetsService.principal.readValues("Musicas", `A${LINHA_MUSICAS}:Z${LINHA_MUSICAS}`).catch(() => []))[0];
  if (!musicasRow) {
    return new Response(JSON.stringify({ success: false, error: `Linha ${LINHA_MUSICAS} não encontrada em Musicas.` }), {
      status: 404,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }
  const tituloAtual = normalizeText(musicasRow[7]);
  const codigoAtual = normalizeText(musicasRow[25]);
  if (codigoAtual !== CODIGO_UNICO) {
    return new Response(
      JSON.stringify({
        success: false,
        error: `Linha ${LINHA_MUSICAS} tem código único "${codigoAtual}", esperado "${CODIGO_UNICO}" — abortando pra não corrigir a linha errada.`,
      }),
      { status: 409, headers: { "Content-Type": "application/json; charset=utf-8" } },
    );
  }
  resultado.tituloAntes = tituloAtual;
  if (tituloAtual !== TITULO_CORRETO) {
    await googleSheetsService.principal.updateValues("Musicas", `H${LINHA_MUSICAS}`, [[TITULO_CORRETO]]);
    resultado.tituloCorrigido = true;
  } else {
    resultado.tituloCorrigido = false;
  }
  const capaUrl = normalizeText(musicasRow[3]);
  const tipoSingleMusicas = normalizeText(musicasRow[8]) || "PÓS-ALBUM";
  const tipoMusicaMusicas = normalizeText(musicasRow[9]) || "SOLO";

  // 1b. Data de lançamento (Musicas!A) — ESQUECIDA na primeira rodada
  // dessa correção: só a data de EDIÇÃO CHARTS tinha sido atualizada, a de
  // Musicas (que é a que "Fórum > Músicas"/ordenação por mais recente usa
  // de verdade, via D1 data_lancamento_iso) continuava com a data velha do
  // álbum (19/09/2026) — por isso a faixa sumia da lista mesmo já
  // publicada: longe demais na ordenação/paginação por data pra aparecer
  // na primeira tela, e a busca no Fórum filtra por pendente+outros campos
  // que dependiam do D1 estar atualizado (ver passo 4 abaixo).
  const dataFormatadaMusicas = new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
  resultado.dataMusicasAntes = normalizeText(musicasRow[0]);
  await googleSheetsService.principal.updateValues("Musicas", `A${LINHA_MUSICAS}`, [[dataFormatadaMusicas]]);
  resultado.dataMusicasDepois = dataFormatadaMusicas;

  // 2. Corrige EDIÇÃO CHARTS — acha a linha pelo código único (coluna BD,
  // índice 55) e atualiza data (A) + tipo (C:D) pro lançamento real.
  const chartsRows = await googleSheetsService.edicaoCharts.readValues("EDIÇÃO CHARTS", "A:BD").catch(() => []);
  let linhaCharts: number | null = null;
  for (let i = 1; i < chartsRows.length; i++) {
    if (normalizeText(chartsRows[i]?.[55]) === CODIGO_UNICO) {
      linhaCharts = i + 1;
      break;
    }
  }
  if (!linhaCharts) {
    resultado.edicaoChartsErro = "Linha não encontrada pelo código único — nada corrigido lá.";
  } else {
    const dataAntes = normalizeText(chartsRows[linhaCharts - 1]?.[0]);
    const tipoSingleAntes = normalizeText(chartsRows[linhaCharts - 1]?.[2]);
    resultado.edicaoChartsLinha = linhaCharts;
    resultado.edicaoChartsDataAntes = dataAntes;
    resultado.edicaoChartsTipoSingleAntes = tipoSingleAntes;
    const dataFormatada = new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
    await googleSheetsService.edicaoCharts.updateValues("EDIÇÃO CHARTS", `A${linhaCharts}`, [[dataFormatada]]);
    await googleSheetsService.edicaoCharts.updateValues("EDIÇÃO CHARTS", `B${linhaCharts}`, [[TITULO_CORRETO]]);
    await googleSheetsService.edicaoCharts.updateValues("EDIÇÃO CHARTS", `C${linhaCharts}:D${linhaCharts}`, [
      [tipoSingleMusicas, tipoMusicaMusicas],
    ]);
    resultado.edicaoChartsDataDepois = dataFormatada;
    resultado.edicaoChartsTipoSingleDepois = tipoSingleMusicas;
    // WEEKS (F) também reseta pra 1 ao publicar — mesma regra agora
    // aplicada em atualizarFaixaNosChartsAoPublicar (gestaoController.ts),
    // faltava aqui na correção retroativa.
    resultado.edicaoChartsWeeksAntes = normalizeText(chartsRows[linhaCharts - 1]?.[5]);
    await googleSheetsService.edicaoCharts.updateValues("EDIÇÃO CHARTS", `F${linhaCharts}`, [["1"]]);
    resultado.edicaoChartsWeeksDepois = "1";
  }

  // 3. INFOS MÚSICAS — garante que existe uma linha com o título CORRETO
  // (pode já existir uma órfã com o título sem prefixo, gravada na hora da
  // publicação original; não apaga ela, só garante a certa).
  if (capaUrl) {
    const infosRows = await googleSheetsService.registrosCharts.readValues("INFOS MÚSICAS").catch(() => []);
    const jaExiste = infosRows
      .slice(1)
      .some((r) => normalizeComparison(r[0] || "") === normalizeComparison(TITULO_CORRETO));
    if (!jaExiste) {
      await googleSheetsService.registrosCharts.appendRow("INFOS MÚSICAS", [
        TITULO_CORRETO,
        "",
        "SIM",
        capaUrl,
        "",
        "",
        capaUrl,
        "",
        "",
        "",
        "",
      ]);
      resultado.infosMusicasCriada = true;
    } else {
      resultado.infosMusicasCriada = false;
    }
  }

  // 4. Espelha pro D1 DIRETO — Fórum > Músicas lê exclusivamente do D1
  // (ver empirePlayController.ts/readMusicasFromD1), não da planilha. Sem
  // isso, nada do que foi corrigido acima (título, data) aparece lá até a
  // próxima escrita real (editar/publicar de novo) — foi por isso que a
  // busca "i am" não achava nada mesmo com o Sheets já corrigido.
  const db = getCatalogoDb();
  if (db) {
    const parseDateIso = (br: string): string | null => {
      const m = br.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
      return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
    };
    await buildMusicaUpsertStatement(db, {
      codigoUnico: CODIGO_UNICO,
      idTopico: normalizeText(musicasRow[1]) || null,
      titulo: TITULO_CORRETO,
      artista: normalizeText(musicasRow[13]) || "Rayna",
      artista2: normalizeText(musicasRow[14]) || null,
      artista3: normalizeText(musicasRow[15]) || null,
      artista4: normalizeText(musicasRow[16]) || null,
      artista5: normalizeText(musicasRow[17]) || null,
      artista6: normalizeText(musicasRow[18]) || null,
      album: normalizeText(musicasRow[10]) || null,
      capaUrl: capaUrl || null,
      audioUrl: normalizeText(musicasRow[2]) || null,
      letra: normalizeText(musicasRow[4]) || null,
      tipoSingle: tipoSingleMusicas,
      tipoMusica: tipoMusicaMusicas,
      dataLancamento: dataFormatadaMusicas,
      dataLancamentoIso: parseDateIso(dataFormatadaMusicas),
      weeks: 1,
      ordem: musicasRow[20] ? Number(musicasRow[20]) || null : null,
      comentariosPara: normalizeText(musicasRow[5]) || null,
      pendente: normalizeComparison(normalizeText(musicasRow[23])) === "sim",
    })
      .run()
      .then(() => {
        resultado.d1Atualizado = true;
      })
      .catch((err) => {
        resultado.d1Erro = err instanceof Error ? err.message : String(err);
      });
  } else {
    resultado.d1Erro = "Binding CATALOGO_DB não disponível.";
  }

  return new Response(JSON.stringify({ success: true, ...resultado }, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
