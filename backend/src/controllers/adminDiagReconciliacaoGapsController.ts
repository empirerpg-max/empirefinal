import { googleSheetsService, normalizeText, normalizeComparison } from "../services/googleSheetsService";

// Investigação SOMENTE LEITURA dos 3 gaps reais revelados pela migração de
// 2026-10-13 (ver adminMigrarCatalogoD1Controller.ts) — NUNCA grava nada,
// só lê Sheets/D1 e monta o diagnóstico. GET /api/empire-play/admin/
// diagnostico-reconciliacao-gaps
//
// Mesma transformação de ID usada na migração — duplicada aqui de
// propósito (controller de diagnóstico puro, não deve importar/alterar o
// de migração) pra não arriscar side-effect nenhum.
function idMidiaParaD1(tipo: string, topicId: string): string {
  if (/^(musica|video|album|arquivo)_/.test(topicId)) return topicId;
  return `${tipo}_legado_${topicId}`;
}

// Remove sufixos de "edição" comuns (Deluxe Edition, ano entre parênteses,
// Remix, etc.) pra comparar o NOME BASE do álbum — usado só pra sugerir
// candidato parecido no Gap A, nunca pra decidir vínculo de verdade.
function stripEdicao(nome: string): string {
  return normalizeComparison(nome)
    .replace(/\(([^)]*)\)/g, "") // remove qualquer coisa entre parênteses
    .replace(/\b(deluxe|edition|edicao|remix|version|versao|extended|platinum|anniversary|remaster(ed)?)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export async function adminDiagReconciliacaoGapsController(): Promise<Response> {
  const diagnostico: Record<string, unknown> = {};

  // ===================== GAP A — vínculo música -> álbum =====================
  try {
    const musicasRows = await googleSheetsService.principal.readValues("Musicas", "A:AE").catch(() => []);
    const albunsRows = await googleSheetsService.principal.readValues("Albuns", "A:L").catch(() => []);

    // Reconstrói o mesmo índice "artista - titulo" -> id de álbum que a
    // migração usa (ver adminMigrarCatalogoD1Controller.ts).
    const albunsPorNome = new Map<string, { id: string; tituloCru: string; linha: number }>();
    const albunsLista: { tituloCru: string; linha: number; baseNormalizado: string }[] = [];
    for (let i = 1; i < albunsRows.length; i++) {
      const row = albunsRows[i];
      if (!row || !row.some((c) => normalizeText(c))) continue;
      const topicId = normalizeText(row[1]); // B
      if (!topicId) continue;
      const nomeAlbum = normalizeText(row[6]) || "Sem título"; // G — Novo Nome
      const dashMatch = nomeAlbum.match(/^(.+?)\s[-–—]\s(.+)$/);
      const titulo = dashMatch ? dashMatch[2].trim() : nomeAlbum;
      const artista = dashMatch ? dashMatch[1].trim() : normalizeText(row[5]) || "Artista não informado";
      const id = idMidiaParaD1("album", topicId);
      const chave = normalizeComparison(`${artista} - ${titulo}`);
      albunsPorNome.set(chave, { id, tituloCru: `${artista} - ${titulo}`, linha: i + 1 });
      albunsLista.push({ tituloCru: `${artista} - ${titulo}`, linha: i + 1, baseNormalizado: stripEdicao(`${artista} - ${titulo}`) });
    }

    const NOMES_SEM_ALBUM_REAL = new Set([normalizeComparison("Playlists Avulsas")]);
    type Pendencia = { musicaId: string; musicaLinha: number; musicaTitulo: string; nomeAlbum: string };
    const pendencias: Pendencia[] = [];

    for (let i = 1; i < musicasRows.length; i++) {
      const row = musicasRows[i];
      if (!row || !row.some((c) => normalizeText(c))) continue;
      const topicId = normalizeText(row[1]);
      const tituloBruto = normalizeText(row[7]);
      if (!topicId || !tituloBruto) continue; // mesma linha pulada da migração (Gap 2, já resolvido)
      const musicaId = idMidiaParaD1("musica", topicId);
      const nomesAlbum = [row[10], row[26], row[27], row[28], row[29]] // K, AA, AB, AC, AD
        .map((v) => normalizeText(v))
        .filter((v): v is string => !!v);
      for (const nome of nomesAlbum) {
        if (NOMES_SEM_ALBUM_REAL.has(normalizeComparison(nome))) continue;
        if (!albunsPorNome.has(normalizeComparison(nome))) {
          pendencias.push({ musicaId, musicaLinha: i + 1, musicaTitulo: tituloBruto, nomeAlbum: nome });
        }
      }
    }

    // Agrupa por nomeAlbum (vários músicas podem citar o mesmo álbum não
    // encontrado) e sugere candidato(s) parecido(s) em Albuns, ignorando
    // sufixos de edição.
    const porNomeAlbum = new Map<string, Pendencia[]>();
    for (const p of pendencias) {
      const arr = porNomeAlbum.get(p.nomeAlbum) || [];
      arr.push(p);
      porNomeAlbum.set(p.nomeAlbum, arr);
    }

    const relatorioGapA = Array.from(porNomeAlbum.entries()).map(([nomeAlbum, afetadas]) => {
      const baseAlvo = stripEdicao(nomeAlbum);
      const candidatos = albunsLista.filter((a) => a.baseNormalizado === baseAlvo && a.baseNormalizado.length > 0);
      return {
        nomeAlbum,
        quantidadeMusicasAfetadas: afetadas.length,
        musicas: afetadas.map((a) => ({ musicaId: a.musicaId, linha: a.musicaLinha, titulo: a.musicaTitulo })),
        candidatosParecidosEmAlbuns: candidatos.map((c) => ({ tituloCru: c.tituloCru, linha: c.linha })),
      };
    });

    diagnostico.gapA_vinculoAlbum = {
      totalCasosDistintos: relatorioGapA.length,
      totalMusicasAfetadas: pendencias.length,
      casos: relatorioGapA,
    };
  } catch (err) {
    diagnostico.gapA_vinculoAlbum = { erro: (err as Error).message };
  }

  // ===================== GAP B — 6 músicas da Rayna sem ID de tópico =====================
  try {
    const TITULOS_ALVO = [
      "New Chapter",
      "Small World",
      "Waiting (A Different Man)",
      "Mea Culpa",
      "Still Here",
      "Closure",
    ];
    const musicasRows = await googleSheetsService.principal.readValues("Musicas", "A:AE").catch(() => []);
    const linhasAlvo: Record<string, unknown>[] = [];
    for (let i = 1; i < musicasRows.length; i++) {
      const row = musicasRows[i];
      if (!row || !row.some((c) => normalizeText(c))) continue;
      const titulo = normalizeText(row[7]); // H
      if (!TITULOS_ALVO.some((t) => normalizeComparison(t) === normalizeComparison(titulo))) continue;
      linhasAlvo.push({
        linha: i + 1,
        topicId_B: normalizeText(row[1]) || null,
        titulo_H: titulo,
        actPrincipal_N: normalizeText(row[13]) || null,
        codigoUnico_Z: normalizeText(row[25]) || null,
        dataLancamento_A: normalizeText(row[0]) || null,
        rowCompletaAE: row,
      });
    }

    // EDIÇÃO CHARTS só guarda Título (B) e Código único (BD) — não tem ID
    // de tópico nenhum (confirmado lendo forumController.ts/
    // resolverTituloPorCodigoUnico e gestaoController.ts) — mas lê mesmo
    // assim pra confirmar se essas 6 músicas JÁ aparecem lá (indicando que
    // já foram "lançadas nos charts" apesar de sem tópico) ou se realmente
    // não existem em lugar nenhum fora de Musicas.
    const edicaoRows = await googleSheetsService.edicaoCharts
      .readValues("EDIÇÃO CHARTS", "A2:BD5000")
      .catch(() => []);
    const presentesEmEdicaoCharts = TITULOS_ALVO.map((titulo) => {
      const linha = edicaoRows.find((r) => normalizeComparison(r[1]) === normalizeComparison(titulo));
      return {
        titulo,
        encontradoEmEdicaoCharts: !!linha,
        codigoUnicoEmEdicaoCharts: linha ? normalizeText(linha[55]) || null : null,
      };
    });

    diagnostico.gapB_raynaSemTopico = {
      linhasEncontradasEmMusicas: linhasAlvo,
      presentesEmEdicaoCharts,
      observacao:
        "EDIÇÃO CHARTS não guarda ID de tópico (só Título e Código único) — mesmo se aparecer ali, não dá pra recuperar o ID do tópico por esse caminho. Só confirma se a música já foi considerada 'lançada' nos charts apesar de não ter tópico criado no Telegram.",
    };
  } catch (err) {
    diagnostico.gapB_raynaSemTopico = { erro: (err as Error).message };
  }

  // ===================== GAP C — 11 comentários órfãos por FK =====================
  try {
    const IDS_ALVO = new Set([
      "musica_legado_76",
      "musica_legado_2131",
      "musica_legado_2134",
      "musica_1786392477347_acjnry",
      "musica_legado_musicas_191",
      "musica_legado_musicas_197",
      "video_legado_1628",
      "video_legado_1638",
      "video_legado_videos_idx215",
      "album_legado_494",
    ]);

    type Ocorrencia = {
      sheet: string;
      linha: number;
      topicIdCru: string;
      idCalculado: string;
      jogadorNome: string;
      textoResumo: string;
    };
    const ocorrencias: Ocorrencia[] = [];

    const varrer = async (sheet: string, tipoMidia: string, colTopicId: number, colJogador: number, colTexto: number) => {
      const rows = await googleSheetsService.principal.readValues(sheet).catch(() => []);
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row || !row.some((c) => normalizeText(c))) continue;
        const topicIdCru = normalizeText(row[colTopicId]);
        const texto = normalizeText(row[colTexto]);
        if (!topicIdCru || !texto) continue;
        const idCalculado = idMidiaParaD1(tipoMidia, topicIdCru);
        if (!IDS_ALVO.has(idCalculado)) continue;
        ocorrencias.push({
          sheet,
          linha: i + 1,
          topicIdCru,
          idCalculado,
          jogadorNome: normalizeText(row[colJogador]) || "Anônimo",
          textoResumo: texto.slice(0, 80),
        });
      }
    };
    await varrer("Comentarios_Musicas", "musica", 0, 2, 3);
    await varrer("Comentarios_MV", "video", 0, 2, 3);
    await varrer("Comentarios_Albuns", "album", 0, 2, 3);

    // Pra cada id alvo, confirma se existe (ou não) uma linha ATUAL em
    // Musicas/Music Videos/Albuns cujo "ID do tópico" produziria esse MESMO
    // id depois de idMidiaParaD1 — se existir, o comentário na verdade
    // DEVERIA ter casado (bug real de transformação); se não existir em
    // lugar nenhum, é comentário órfão de dado já quebrado na origem.
    const idsReaisHoje = new Set<string>();
    const dumpPorId = new Map<string, { sheet: string; linha: number; titulo: string }>();
    const indexarMidia = async (sheet: string, tipo: string, colTopicId: number, colTitulo: number) => {
      const rows = await googleSheetsService.principal.readValues(sheet).catch(() => []);
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row || !row.some((c) => normalizeText(c))) continue;
        const topicId = normalizeText(row[colTopicId]);
        if (!topicId) continue;
        const id = idMidiaParaD1(tipo, topicId);
        idsReaisHoje.add(id);
        dumpPorId.set(id, { sheet, linha: i + 1, titulo: normalizeText(row[colTitulo]) || "" });
      }
    };
    await indexarMidia("Musicas", "musica", 1, 7);
    await indexarMidia("Music Videos", "video", 5, 1);
    await indexarMidia("Albuns", "album", 1, 6);

    const classificacaoPorId = Array.from(IDS_ALVO).map((id) => ({
      id,
      existeHojeComEsseIdExato: idsReaisHoje.has(id),
      midiaCorrespondente: dumpPorId.get(id) || null,
      ocorrenciasNosComentarios: ocorrencias.filter((o) => o.idCalculado === id),
    }));

    diagnostico.gapC_comentariosOrfaos = {
      classificacaoPorId,
      observacao:
        "'existeHojeComEsseIdExato: true' + midiaCorrespondente preenchido = bug real de transformação (o comentário DEVERIA ter casado, a mídia existe com esse id exato mas a migração de comentário talvez tenha rodado antes/depois de alguma mudança). 'false' = comentário órfão de uma mídia que não existe (mais) com esse id — dado já quebrado na origem (ID do tópico da Sheet mudou ou a mídia foi removida depois do comentário).",
    };
  } catch (err) {
    diagnostico.gapC_comentariosOrfaos = { erro: (err as Error).message };
  }

  return new Response(JSON.stringify({ success: true, data: diagnostico }, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
