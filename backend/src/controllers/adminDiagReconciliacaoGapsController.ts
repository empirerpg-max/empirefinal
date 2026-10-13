import { googleSheetsService, normalizeText, normalizeComparison } from "../services/googleSheetsService";
import { getCatalogoDb } from "../services/catalogoDbService";

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

// ===========================================================================
// Auditoria COLUNA POR COLUNA — tipo='musica' (pergunta direta do usuário:
// "quero entender se todas as células estão preenchidas devidamente [...]
// tem muito mais que precisa ser validado"). SOMENTE LEITURA: lê o D1 de
// verdade (SELECT * FROM midia WHERE tipo='musica') e compara, campo por
// campo, com o valor atual lido direto do Sheets "Musicas" (A:AE) — a mesma
// leitura e as mesmas transformações que adminMigrarCatalogoD1Controller.ts
// usa pra montar cada MidiaUpsert, duplicadas aqui de propósito (controller
// de diagnóstico puro, não deve importar/alterar o de migração).
//
// GET /api/empire-play/admin/diagnostico-auditoria-colunas-musicas
// ===========================================================================

interface LinhaMusicaD1 {
  id: string;
  titulo: string | null;
  artista: string | null;
  feat_artistas: string | null;
  album_id: string | null;
  album_id_2: string | null;
  album_id_3: string | null;
  album_id_4: string | null;
  album_id_5: string | null;
  capa_url: string | null;
  audio_url: string | null;
  letra: string | null;
  letra_sincronizada: string | null;
  data_lancamento: string | null;
  data_lancamento_iso: string | null;
  codigo_unico: string | null;
  metacritic_avg: number | null;
  genero: string | null;
  track_order: number | null;
  pendente: number | null;
  weeks: number | null;
  weeks_video: number | null;
  id_criador: string | null;
  comentarios_para: string | null;
  metacritic_por_jogador: string | null;
  reportado_incorreto: number | null;
  tipo_single: string | null;
  tipo_musica: string | null;
  shop_url: string | null;
  loja_info: string | null;
  arte_extra_url: string | null;
}

// Cada entrada: [rótulo exibido, campo esperado (Sheets, já transformado
// igual à migração), campo correspondente na linha D1].
type ColunaAuditada = { campo: string; esperado: unknown; noD1: unknown };

function valoresIguais(a: unknown, b: unknown): boolean {
  const na = a === undefined || a === null || a === "" ? null : a;
  const nb = b === undefined || b === null || b === "" ? null : b;
  if (na === null && nb === null) return true;
  if (typeof na === "number" || typeof nb === "number") return Number(na) === Number(nb);
  return String(na) === String(nb);
}

export async function adminDiagAuditoriaColunasMusicasController(): Promise<Response> {
  const db = getCatalogoDb();
  if (!db) {
    return new Response(JSON.stringify({ success: false, error: "Binding CATALOGO_DB não disponível." }), {
      status: 500,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  // --- 1) Reconstrói o "esperado" pra cada música, EXATAMENTE como a
  // migração monta hoje (mesmos índices de coluna, mesmo apelido aprovado
  // de álbum — ver adminMigrarCatalogoD1Controller.ts). ---
  const musicasRows = await googleSheetsService.principal.readValues("Musicas", "A:AE").catch(() => []);
  const albunsRows = await googleSheetsService.principal.readValues("Albuns", "A:L").catch(() => []);
  const extraRows = await googleSheetsService.principal.readValues("Extra_Musicas", "A:D").catch(() => []);

  const albumIdPorNome = new Map<string, string>();
  for (let i = 1; i < albunsRows.length; i++) {
    const row = albunsRows[i];
    if (!row || !row.some((c) => normalizeText(c))) continue;
    const topicId = normalizeText(row[1]); // B
    if (!topicId) continue;
    const nomeAlbum = normalizeText(row[6]) || "Sem título"; // G
    const dashMatch = nomeAlbum.match(/^(.+?)\s[-–—]\s(.+)$/);
    const titulo = dashMatch ? dashMatch[2].trim() : nomeAlbum;
    const artista = dashMatch ? dashMatch[1].trim() : normalizeText(row[5]) || "Artista não informado";
    albumIdPorNome.set(normalizeComparison(`${artista} - ${titulo}`), idMidiaParaD1("album", topicId));
  }
  const NOMES_SEM_ALBUM_REAL = new Set([normalizeComparison("Playlists Avulsas")]);
  // Mesmos 6 apelidos aprovados pelo usuário (ver adminMigrarCatalogoD1Controller.ts) —
  // repetidos aqui pra essa auditoria comparar contra o MESMO esperado que a
  // migração (já corrigida) agora produz, não contra o esperado pré-fix.
  const APELIDOS_ALBUM_APROVADOS = new Map<string, string>([
    [normalizeComparison("Kyeh - KDLA"), normalizeComparison("KYEH - KDLA (Full Album)")],
    [normalizeComparison("Kyeh - KDLA (Deluxe Edition)"), normalizeComparison("KYEH - KDLA (Full Album)")],
    [normalizeComparison("Alexxa Hills - villain (deluxe edition)"), normalizeComparison("Alexxa Hills - villain")],
    [normalizeComparison("Rayna - Lasso"), normalizeComparison("Rayna - Lasso (2026)")],
    [normalizeComparison("Paul Carter - end of an era."), normalizeComparison("Paul Carter - end of an era. (EP)")],
    [
      normalizeComparison("Paul Carter - Evergreen (deluxe edition)"),
      normalizeComparison("Paul Carter - Evergreen (Deluxe)"),
    ],
  ]);
  const resolverAlbumId = (nome: string): string | null => {
    if (!nome) return null;
    if (NOMES_SEM_ALBUM_REAL.has(normalizeComparison(nome))) return null;
    const chave = normalizeComparison(nome);
    return (
      albumIdPorNome.get(chave) ??
      (APELIDOS_ALBUM_APROVADOS.has(chave) ? albumIdPorNome.get(APELIDOS_ALBUM_APROVADOS.get(chave)!) : undefined) ??
      null
    );
  };

  const extraPorCodigoUnico = new Map<string, { shop: string | null; info: string | null; arte: string | null }>();
  for (let i = 1; i < extraRows.length; i++) {
    const row = extraRows[i];
    if (!row || !row.some((c) => normalizeText(c))) continue;
    const codigoUnico = normalizeText(row[0]);
    if (!codigoUnico) continue;
    extraPorCodigoUnico.set(codigoUnico, {
      shop: normalizeText(row[1]) || null,
      info: normalizeText(row[2]) || null,
      arte: normalizeText(row[3]) || null,
    });
  }

  function parseDateToIso(dataBR: string | null): string | null {
    if (!dataBR) return null;
    const m = dataBR.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    if (!m) return null;
    return `${m[3]}-${m[2]}-${m[1]}`;
  }

  type MusicaEsperada = {
    id: string;
    linha: number;
    titulo: string;
    artista: string;
    featArtistas: string[] | null;
    albumId: string | null;
    albumId2: string | null;
    albumId3: string | null;
    albumId4: string | null;
    albumId5: string | null;
    capaUrl: string | null;
    audioUrl: string | null;
    letra: string | null;
    letraSincronizada: string | null;
    dataLancamento: string | null;
    dataLancamentoIso: string | null;
    codigoUnico: string | null;
    metacriticAvg: number | null;
    genero: string | null;
    trackOrder: number | null;
    pendente: boolean;
    weeks: number | null;
    weeksVideo: number | null;
    idCriador: string | null;
    comentariosPara: string | null;
    metacriticPorJogador: string | null;
    reportadoIncorreto: boolean;
    tipoSingle: string | null;
    tipoMusica: string | null;
    shopUrl: string | null;
    lojaInfo: string | null;
    arteExtraUrl: string | null;
  };

  const musicasEsperadas: MusicaEsperada[] = [];
  for (let i = 1; i < musicasRows.length; i++) {
    const row = musicasRows[i];
    if (!row || !row.some((c) => normalizeText(c))) continue;
    const topicId = normalizeText(row[1]); // B
    const tituloBruto = normalizeText(row[7]); // H
    if (!topicId || !tituloBruto) continue; // mesma linha pulada pela migração (Gap 2, já resolvido/reportado)
    const dataLancamento = normalizeText(row[0]) || null;
    const nomesAlbum = [row[10], row[26], row[27], row[28], row[29]].map((v) => normalizeText(v));
    const featArtistasArr = [row[14], row[15], row[16], row[17], row[18]]
      .map((v) => normalizeText(v))
      .filter((v): v is string => !!v);
    const codigoUnico = normalizeText(row[25]) || null;
    const extra = codigoUnico ? extraPorCodigoUnico.get(codigoUnico) : undefined;
    musicasEsperadas.push({
      id: idMidiaParaD1("musica", topicId),
      linha: i + 1,
      titulo: tituloBruto,
      artista: normalizeText(row[13]) || "Artista não informado",
      featArtistas: featArtistasArr.length ? featArtistasArr : null,
      albumId: resolverAlbumId(nomesAlbum[0]),
      albumId2: resolverAlbumId(nomesAlbum[1]),
      albumId3: resolverAlbumId(nomesAlbum[2]),
      albumId4: resolverAlbumId(nomesAlbum[3]),
      albumId5: resolverAlbumId(nomesAlbum[4]),
      capaUrl: normalizeText(row[3]) || null,
      audioUrl: normalizeText(row[2]) || null,
      letra: normalizeText(row[4]) || null,
      letraSincronizada: normalizeText(row[30]) || null,
      dataLancamento,
      dataLancamentoIso: parseDateToIso(dataLancamento),
      codigoUnico,
      metacriticAvg: Number(normalizeText(row[22])) || null,
      genero: normalizeText(row[19]) || null,
      trackOrder: Number(normalizeText(row[20])) || null,
      pendente: normalizeText(row[23]).toLowerCase() === "sim",
      weeks: Number(normalizeText(row[11])) || null,
      weeksVideo: Number(normalizeText(row[12])) || null,
      idCriador: normalizeText(row[6]) || null,
      comentariosPara: normalizeText(row[5]) || null,
      metacriticPorJogador: normalizeText(row[21]) || null,
      reportadoIncorreto: normalizeText(row[24]).toLowerCase() === "sim",
      tipoSingle: normalizeText(row[8]) || null,
      tipoMusica: normalizeText(row[9]) || null,
      shopUrl: extra?.shop ?? null,
      lojaInfo: extra?.info ?? null,
      arteExtraUrl: extra?.arte ?? null,
    });
  }

  // --- 2) Lê o D1 de verdade ---
  const { results: linhasD1 } = await db
    .prepare("SELECT * FROM midia WHERE tipo = 'musica'")
    .all<LinhaMusicaD1>();
  const d1PorId = new Map<string, LinhaMusicaD1>();
  for (const row of linhasD1) d1PorId.set(row.id, row);

  // --- 3) Compara campo por campo ---
  // [rótulo, extrator do esperado, extrator do valor D1]
  const COLUNAS: { campo: string; get: (m: MusicaEsperada) => unknown; getD1: (r: LinhaMusicaD1) => unknown }[] = [
    { campo: "titulo", get: (m) => m.titulo, getD1: (r) => r.titulo },
    { campo: "artista", get: (m) => m.artista, getD1: (r) => r.artista },
    {
      campo: "feat_artistas",
      get: (m) => (m.featArtistas ? JSON.stringify(m.featArtistas) : null),
      getD1: (r) => r.feat_artistas,
    },
    { campo: "album_id", get: (m) => m.albumId, getD1: (r) => r.album_id },
    { campo: "album_id_2", get: (m) => m.albumId2, getD1: (r) => r.album_id_2 },
    { campo: "album_id_3", get: (m) => m.albumId3, getD1: (r) => r.album_id_3 },
    { campo: "album_id_4", get: (m) => m.albumId4, getD1: (r) => r.album_id_4 },
    { campo: "album_id_5", get: (m) => m.albumId5, getD1: (r) => r.album_id_5 },
    { campo: "capa_url", get: (m) => m.capaUrl, getD1: (r) => r.capa_url },
    { campo: "audio_url", get: (m) => m.audioUrl, getD1: (r) => r.audio_url },
    { campo: "letra", get: (m) => m.letra, getD1: (r) => r.letra },
    { campo: "letra_sincronizada", get: (m) => m.letraSincronizada, getD1: (r) => r.letra_sincronizada },
    { campo: "data_lancamento", get: (m) => m.dataLancamento, getD1: (r) => r.data_lancamento },
    { campo: "data_lancamento_iso", get: (m) => m.dataLancamentoIso, getD1: (r) => r.data_lancamento_iso },
    { campo: "codigo_unico", get: (m) => m.codigoUnico, getD1: (r) => r.codigo_unico },
    { campo: "metacritic_avg", get: (m) => m.metacriticAvg, getD1: (r) => r.metacritic_avg },
    { campo: "genero", get: (m) => m.genero, getD1: (r) => r.genero },
    { campo: "track_order", get: (m) => m.trackOrder, getD1: (r) => r.track_order },
    { campo: "pendente", get: (m) => (m.pendente ? 1 : 0), getD1: (r) => r.pendente },
    { campo: "weeks", get: (m) => m.weeks, getD1: (r) => r.weeks },
    { campo: "weeks_video", get: (m) => m.weeksVideo, getD1: (r) => r.weeks_video },
    { campo: "id_criador", get: (m) => m.idCriador, getD1: (r) => r.id_criador },
    { campo: "comentarios_para", get: (m) => m.comentariosPara, getD1: (r) => r.comentarios_para },
    { campo: "metacritic_por_jogador", get: (m) => m.metacriticPorJogador, getD1: (r) => r.metacritic_por_jogador },
    { campo: "reportado_incorreto", get: (m) => (m.reportadoIncorreto ? 1 : 0), getD1: (r) => r.reportado_incorreto },
    { campo: "tipo_single", get: (m) => m.tipoSingle, getD1: (r) => r.tipo_single },
    { campo: "tipo_musica", get: (m) => m.tipoMusica, getD1: (r) => r.tipo_musica },
    { campo: "shop_url", get: (m) => m.shopUrl, getD1: (r) => r.shop_url },
    { campo: "loja_info", get: (m) => m.lojaInfo, getD1: (r) => r.loja_info },
    { campo: "arte_extra_url", get: (m) => m.arteExtraUrl, getD1: (r) => r.arte_extra_url },
  ];

  type DivergenciaLinha = { musicaId: string; linha: number; titulo: string; esperado: unknown; noD1: unknown };
  const resumoPorColuna: {
    campo: string;
    sheetsPreenchido: number;
    d1Preenchido: number;
    musicaNaoEncontradaNoD1: number; // sheets tem a linha, mas o id não existe em d1PorId de forma alguma
    // "Sheets tem valor, D1 está vazio" — BUG REAL, prioridade máxima.
    casosPerdidos: number;
    // "Os dois têm valor, mas são diferentes" — não necessariamente bug
    // (pode ser que o Sheets mudou depois da última migração).
    casosDivergentes: number;
    linhasPerdidas: DivergenciaLinha[];
    linhasDivergentes: DivergenciaLinha[];
  }[] = [];

  let musicasSemLinhaNoD1 = 0;
  for (const coluna of COLUNAS) {
    let sheetsPreenchido = 0;
    let d1Preenchido = 0;
    let musicaNaoEncontradaNoD1 = 0;
    const linhasPerdidas: DivergenciaLinha[] = [];
    const linhasDivergentes: DivergenciaLinha[] = [];

    for (const m of musicasEsperadas) {
      const esperado = coluna.get(m);
      const temEsperado = esperado !== null && esperado !== undefined && esperado !== "";
      if (temEsperado) sheetsPreenchido++;

      const linhaD1 = d1PorId.get(m.id);
      if (!linhaD1) {
        musicaNaoEncontradaNoD1++;
        continue;
      }
      const valorD1 = coluna.getD1(linhaD1);
      const temD1 = valorD1 !== null && valorD1 !== undefined && valorD1 !== "";
      if (temD1) d1Preenchido++;

      if (temEsperado && !temD1) {
        linhasPerdidas.push({ musicaId: m.id, linha: m.linha, titulo: m.titulo, esperado, noD1: valorD1 });
      } else if (temEsperado && temD1 && !valoresIguais(esperado, valorD1)) {
        linhasDivergentes.push({ musicaId: m.id, linha: m.linha, titulo: m.titulo, esperado, noD1: valorD1 });
      }
    }

    resumoPorColuna.push({
      campo: coluna.campo,
      sheetsPreenchido,
      d1Preenchido,
      musicaNaoEncontradaNoD1,
      casosPerdidos: linhasPerdidas.length,
      casosDivergentes: linhasDivergentes.length,
      // Lista completa pros casos perdidos (prioridade máxima — bug real de
      // migração); divergência limitada a 30 exemplos pra não inchar a
      // resposta (contagem agregada já diz o tamanho real do problema).
      linhasPerdidas,
      linhasDivergentes: linhasDivergentes.slice(0, 30),
    });
  }
  musicasSemLinhaNoD1 = musicasEsperadas.filter((m) => !d1PorId.has(m.id)).length;

  return new Response(
    JSON.stringify(
      {
        success: true,
        data: {
          totalMusicasEsperadas: musicasEsperadas.length,
          totalLinhasNoD1: linhasD1.length,
          musicasEsperadasSemLinhaNoD1: musicasSemLinhaNoD1,
          musicasSemLinhaNoD1_detalhe: musicasEsperadas
            .filter((m) => !d1PorId.has(m.id))
            .map((m) => ({ musicaId: m.id, linha: m.linha, titulo: m.titulo })),
          resumoPorColuna,
          observacao:
            "casosPerdidos = Sheets TEM valor e D1 está vazio (bug real de migração, prioridade máxima). " +
            "casosDivergentes = os dois têm valor mas são diferentes (pode ser Sheets atualizado depois da última migração, não necessariamente bug). " +
            "Campo legitimamente opcional (ex: feat_artistas, album_id_2-5, letra_sincronizada) com Sheets também vazio NÃO entra em nenhuma das duas listas — é vazio esperado.",
        },
      },
      null,
      2,
    ),
    { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
}
