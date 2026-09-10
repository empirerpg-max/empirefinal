import { googleSheetsService, normalizeComparison, normalizeText } from "../services/googleSheetsService";
import { gravarLinhaRegistro } from "./registroLogController";
import { registrarLogSistema } from "../services/logSistemaService";

// Correção pontual (rodada pelo cron, ver server.ts "scheduled") pros
// comentários que JÁ foram salvos em Comentarios_Musicas/Comentarios_MV/
// Comentarios_Albuns mas nunca geraram a linha correspondente em REGISTRO —
// bug real, já corrigido pra comentários NOVOS (ver registroLogController.ts:
// nome canônico por Código único + retry em colisão de linha), mas que
// deixou um rastro de pontos "perdidos" pra comentários antigos.
//
// Como REGISTRO não guarda nenhum link de volta pro comentário que o gerou,
// a única forma de saber "quantos pontos esse jogador deveria ter por essa
// música" é CONTAR: quantos comentários ele tem nessa música/vídeo/álbum vs.
// quantas linhas ele já tem em REGISTRO pro mesmo conteúdo canônico. Se
// contagem de comentários > contagem em REGISTRO, a diferença é o que
// "sumiu" — e é isso que essa função completa, escrevendo só a diferença
// (nunca duplica o que já existe).
const TIPO_MUSICA = "COMENTÁRIOS (SINGLES, VÍDEOS, MÚSICAS)";
const TIPO_ALBUM = "COMENTÁRIOS (TODOS OS TIPOS DE ÁLBUM)";
const LOTE_MAX_CHAVES = 5;

interface ComentarioResolvido {
  jogador: string;
  titulo: string;
  isAlbum: boolean;
  codigoUnico: string;
  tipo: string;
}

async function mapearTopicos(
  sheetName: string,
  colTopicId: number,
  colTitulo: number,
  colArtista: number,
  colCodigo: number,
): Promise<Map<string, { titulo: string; codigoUnico: string }>> {
  const rows = await googleSheetsService.principal.readValues(sheetName);
  const mapa = new Map<string, { titulo: string; codigoUnico: string }>();
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const topicId = normalizeComparison(row?.[colTopicId] || "");
    if (!topicId) continue;
    const tituloBruto = normalizeText(row?.[colTitulo]);
    const artista = colArtista >= 0 ? normalizeText(row?.[colArtista]) : "";
    const titulo = artista ? `${artista} - ${tituloBruto}` : tituloBruto;
    const codigoUnico = normalizeText(row?.[colCodigo]);
    mapa.set(topicId, { titulo, codigoUnico });
  }
  return mapa;
}

async function coletarComentariosResolvidos(): Promise<ComentarioResolvido[]> {
  const [
    comentariosMusicas,
    comentariosMV,
    comentariosAlbuns,
    topicosMusicas,
    topicosVideos,
    topicosAlbuns,
  ] = await Promise.all([
    googleSheetsService.principal.readValues("Comentarios_Musicas"),
    googleSheetsService.principal.readValues("Comentarios_MV"),
    googleSheetsService.principal.readValues("Comentarios_Albuns"),
    mapearTopicos("Musicas", 1, 7, 13, 25),
    mapearTopicos("Music Videos", 5, 1, -1, 20),
    mapearTopicos("Albuns", 1, 6, -1, 11),
  ]);

  const resolvidos: ComentarioResolvido[] = [];

  // Resposta a outro comentário (replyTo preenchido) NUNCA gera linha em
  // REGISTRO — mesma regra do createCommentController (`if (!isReply)`).
  // Sem filtrar isso aqui, toda resposta contava como "comentário que
  // devia ter REGISTRO e não tem", e como resposta é atividade normal de
  // chat (nunca some, só cresce), essa função ficava injetando linha
  // duplicada pro mesmo (jogador, título, tipo) a cada rodada do cron,
  // pra sempre — foi isso que inundou REGISTRO de linha repetida.
  // Comentarios_Musicas não tem coluna Data (replyTo na E, índice 4);
  // Comentarios_MV/Comentarios_Albuns têm (replyTo na F, índice 5) —
  // mesmos índices usados em getCommentsController.
  for (let i = 1; i < comentariosMusicas.length; i++) {
    const row = comentariosMusicas[i];
    const topicId = normalizeComparison(row?.[0] || "");
    const jogador = normalizeText(row?.[2]);
    const replyTo = normalizeText(row?.[4]);
    if (!topicId || !jogador || replyTo) continue;
    const info = topicosMusicas.get(topicId);
    if (!info?.titulo) continue;
    resolvidos.push({ jogador, titulo: info.titulo, isAlbum: false, codigoUnico: info.codigoUnico, tipo: TIPO_MUSICA });
  }

  for (let i = 1; i < comentariosMV.length; i++) {
    const row = comentariosMV[i];
    const topicId = normalizeComparison(row?.[0] || "");
    const jogador = normalizeText(row?.[2]);
    const replyTo = normalizeText(row?.[5]);
    if (!topicId || !jogador || replyTo) continue;
    const info = topicosVideos.get(topicId);
    if (!info?.titulo) continue;
    resolvidos.push({ jogador, titulo: info.titulo, isAlbum: false, codigoUnico: info.codigoUnico, tipo: TIPO_MUSICA });
  }

  for (let i = 1; i < comentariosAlbuns.length; i++) {
    const row = comentariosAlbuns[i];
    const topicId = normalizeComparison(row?.[0] || "");
    const jogador = normalizeText(row?.[2]);
    const replyTo = normalizeText(row?.[5]);
    if (!topicId || !jogador || replyTo) continue;
    const info = topicosAlbuns.get(topicId);
    if (!info?.titulo) continue;
    resolvidos.push({ jogador, titulo: info.titulo, isAlbum: true, codigoUnico: info.codigoUnico, tipo: TIPO_ALBUM });
  }

  return resolvidos;
}

interface FlagsKvLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
}

const CURSOR_KV_KEY = "reconciliacao-registro-cursor";

export async function reconciliarPontosComentariosScheduled(
  flags?: FlagsKvLike,
): Promise<{ chavesProcessadas: number; linhasGravadas: number }> {
  const [comentarios, edicaoMusicas, edicaoAlbuns] = await Promise.all([
    coletarComentariosResolvidos(),
    googleSheetsService.edicaoCharts.readValues("EDIÇÃO CHARTS"),
    googleSheetsService.edicaoCharts.readValues("EDIÇÃO CHARTS ÁLBUMS"),
  ]);

  // Mesma lógica de buscarNomeCanonico (registroLogController.ts), mas com
  // EDIÇÃO CHARTS/EDIÇÃO CHARTS ÁLBUMS já carregadas uma vez só — chamar
  // buscarNomeCanonico por comentário faria uma leitura de planilha nova
  // pra CADA um dos possivelmente centenas de comentários.
  const porCodigoMusicas = new Map<string, string>();
  const porTituloMusicas = new Map<string, string>();
  for (let i = 1; i < edicaoMusicas.length; i++) {
    const codigo = normalizeComparison(edicaoMusicas[i]?.[55] || "");
    const titulo = normalizeText(edicaoMusicas[i]?.[1]);
    if (codigo && titulo) porCodigoMusicas.set(codigo, titulo);
    if (titulo) porTituloMusicas.set(normalizeComparison(titulo), titulo);
  }
  const porCodigoAlbuns = new Map<string, string>();
  const porTituloAlbuns = new Map<string, string>();
  for (let i = 1; i < edicaoAlbuns.length; i++) {
    const codigo = normalizeComparison(edicaoAlbuns[i]?.[17] || "");
    const titulo = normalizeText(edicaoAlbuns[i]?.[3]);
    if (codigo && titulo) porCodigoAlbuns.set(codigo, titulo);
    if (titulo) porTituloAlbuns.set(normalizeComparison(titulo), titulo);
  }

  const resolverNomeCanonicoLocal = (titulo: string, isAlbum: boolean, codigoUnico: string): string => {
    const porCodigo = isAlbum ? porCodigoAlbuns : porCodigoMusicas;
    const porTitulo = isAlbum ? porTituloAlbuns : porTituloMusicas;
    const codigoNorm = codigoUnico ? normalizeComparison(codigoUnico) : "";
    if (codigoNorm && porCodigo.has(codigoNorm)) return porCodigo.get(codigoNorm)!;
    const tituloNorm = normalizeComparison(titulo);
    if (porTitulo.has(tituloNorm)) return porTitulo.get(tituloNorm)!;
    return titulo;
  };

  // Agrupa por (jogador, conteúdo canônico, tipo) — a mesma chave que
  // REGISTRO usa, então dá pra comparar contagem com contagem.
  const contagemComentarios = new Map<string, { jogador: string; conteudo: string; tipo: string; count: number }>();
  for (const c of comentarios) {
    const nomeCanonico = resolverNomeCanonicoLocal(c.titulo, c.isAlbum, c.codigoUnico);
    const conteudo = c.isAlbum ? `(ALBUM) - ${nomeCanonico}` : nomeCanonico;
    const chave = `${normalizeComparison(c.jogador)}|${normalizeComparison(conteudo)}|${normalizeComparison(c.tipo)}`;
    const atual = contagemComentarios.get(chave);
    if (atual) atual.count++;
    else contagemComentarios.set(chave, { jogador: c.jogador, conteudo, tipo: c.tipo, count: 1 });
  }

  const registroRows = await googleSheetsService.registrosCharts.readValues("REGISTRO");
  const contagemRegistro = new Map<string, number>();
  for (let i = 1; i < registroRows.length; i++) {
    const row = registroRows[i];
    const jogador = normalizeComparison(row?.[1] || "");
    const conteudo = normalizeComparison(row?.[2] || "");
    const tipo = normalizeComparison(row?.[3] || "");
    if (!jogador && !conteudo) continue;
    const chave = `${jogador}|${conteudo}|${tipo}`;
    contagemRegistro.set(chave, (contagemRegistro.get(chave) || 0) + 1);
  }

  // Só as chaves com diferença de verdade (comentários > registros) — é
  // isso que sobrou "sem ponto". Ordenado pra dar cursor estável entre
  // execuções do cron.
  const chavesFaltantes = [...contagemComentarios.entries()]
    .filter(([chave, dado]) => dado.count > (contagemRegistro.get(chave) || 0))
    .sort(([a], [b]) => a.localeCompare(b));

  const cursorSalvo = flags ? Number(await flags.get(CURSOR_KV_KEY).catch(() => null)) : NaN;
  const inicio = Number.isFinite(cursorSalvo) && cursorSalvo >= 0 && cursorSalvo < chavesFaltantes.length ? cursorSalvo : 0;

  let chavesProcessadas = 0;
  let linhasGravadas = 0;
  let i = inicio;
  for (; i < chavesFaltantes.length && chavesProcessadas < LOTE_MAX_CHAVES; i++) {
    const [, dado] = chavesFaltantes[i];
    const faltam = dado.count - (contagemRegistro.get(`${normalizeComparison(dado.jogador)}|${normalizeComparison(dado.conteudo)}|${normalizeComparison(dado.tipo)}`) || 0);
    for (let n = 0; n < faltam; n++) {
      const ok = await gravarLinhaRegistro([dado.jogador, dado.conteudo, dado.tipo]);
      if (ok) linhasGravadas++;
    }
    chavesProcessadas++;
  }

  // Terminou a lista inteira nesta rodada — zera o cursor pra próxima
  // varredura (comentários futuros já não caem mais aqui, ver
  // createCommentController; isso é só pro backlog antigo).
  const proximoCursor = i >= chavesFaltantes.length ? 0 : i;
  if (flags) await flags.put(CURSOR_KV_KEY, String(proximoCursor)).catch(() => {});

  return { chavesProcessadas, linhasGravadas };
}

// =========================================================================
// LIMPEZA DE EXCEDENTE — correção pontual, de uso único, pros dois bugs que
// inundaram REGISTRO de linha duplicada (ambos já corrigidos no código):
//   1. Esta própria reconciliação acima contava RESPOSTA de comentário como
//      "comentário sem registro" (não checava replyTo) — a cada rodada do
//      cron (10 em 10 min) injetava de novo a mesma linha faltante que
//      nunca ia parar de "faltar", porque resposta é atividade normal que
//      nunca some.
//   2. tvController.ts fatiava uma transmissão real do Empire Hits em vários
//      "grupos" de 1 segmento só (Topico_ID inconsistente por segmento),
//      cada um creditando presença de novo pros mesmos espectadores.
//
// Em vez de tentar reconstruir quando cada linha ruim foi gravada (REGISTRO
// não tem coluna de data), a correção é por CONTAGEM: recalcula quantas
// linhas cada (jogador, conteúdo, tipo) DEVERIA ter — comentários reais
// (sem resposta) pra linhas de comentário, e número de transmissões reais
// do Empire Hits (Agenda_TV, agrupadas por data+programa, mesma correção
// de tvController.ts) pra linhas de Empire Hits — e apaga só o excedente,
// mantendo as primeiras ocorrências de cada chave (linha mais antiga =
// mais provável de ser o registro original de verdade).
const MARCADOR_LIMPEZA = "limparRegistroExcedente";

async function contarBroadcastsReaisEmpireHits(): Promise<number> {
  const rows = await googleSheetsService.agendaTV.readValues("Agenda_TV").catch(() => []);
  // Agenda_TV: A Programa | B Tipo | C Material | D Buff | E Data | ...
  const datasEmpireHits = new Set<string>();
  for (let i = 1; i < rows.length; i++) {
    const programa = normalizeComparison(rows[i]?.[0] || "");
    if (!programa.includes("empire hits")) continue;
    const data = normalizeText(rows[i]?.[4] || "");
    if (data) datasEmpireHits.add(data);
  }
  return datasEmpireHits.size;
}

export async function limparRegistroExcedente(): Promise<{
  jaAplicado: boolean;
  linhasRemovidas: number;
  detalhes: { chave: string; existiam: number; permitidas: number; removidas: number }[];
  erro?: string;
}> {
  try {
    return await limparRegistroExcedenteInterno();
  } catch (err: any) {
    // Nunca lança — igual toda outra correção pontual desse arquivo — mas
    // devolve o erro de verdade na resposta em vez de um "erro interno"
    // genérico, pra dar pra diagnosticar sem precisar de acesso a log de
    // servidor.
    console.warn("[limparRegistroExcedente] Erro:", err);
    return {
      jaAplicado: false,
      linhasRemovidas: 0,
      detalhes: [],
      erro: err?.message || String(err),
    };
  }
}

async function limparRegistroExcedenteInterno(): Promise<{
  jaAplicado: boolean;
  linhasRemovidas: number;
  detalhes: { chave: string; existiam: number; permitidas: number; removidas: number }[];
}> {
  const logsExistentes = await googleSheetsService.logsSistema.readValues("LOGS").catch(() => []);
  const jaRodou = logsExistentes
    .slice(1)
    .some((r) => normalizeText(r[3]) === MARCADOR_LIMPEZA && normalizeText(r[1]) === "Ação concluída");
  if (jaRodou) return { jaAplicado: true, linhasRemovidas: 0, detalhes: [] };

  const [comentarios, edicaoMusicas, edicaoAlbuns, registroRows, broadcastsReais] = await Promise.all([
    coletarComentariosResolvidos(),
    googleSheetsService.edicaoCharts.readValues("EDIÇÃO CHARTS"),
    googleSheetsService.edicaoCharts.readValues("EDIÇÃO CHARTS ÁLBUMS"),
    googleSheetsService.registrosCharts.readValues("REGISTRO"),
    contarBroadcastsReaisEmpireHits(),
  ]);

  const porCodigoMusicas = new Map<string, string>();
  const porTituloMusicas = new Map<string, string>();
  for (let i = 1; i < edicaoMusicas.length; i++) {
    const codigo = normalizeComparison(edicaoMusicas[i]?.[55] || "");
    const titulo = normalizeText(edicaoMusicas[i]?.[1]);
    if (codigo && titulo) porCodigoMusicas.set(codigo, titulo);
    if (titulo) porTituloMusicas.set(normalizeComparison(titulo), titulo);
  }
  const porCodigoAlbuns = new Map<string, string>();
  const porTituloAlbuns = new Map<string, string>();
  for (let i = 1; i < edicaoAlbuns.length; i++) {
    const codigo = normalizeComparison(edicaoAlbuns[i]?.[17] || "");
    const titulo = normalizeText(edicaoAlbuns[i]?.[3]);
    if (codigo && titulo) porCodigoAlbuns.set(codigo, titulo);
    if (titulo) porTituloAlbuns.set(normalizeComparison(titulo), titulo);
  }
  const resolverNomeCanonicoLocal = (titulo: string, isAlbum: boolean, codigoUnico: string): string => {
    const porCodigo = isAlbum ? porCodigoAlbuns : porCodigoMusicas;
    const porTitulo = isAlbum ? porTituloAlbuns : porTituloMusicas;
    const codigoNorm = codigoUnico ? normalizeComparison(codigoUnico) : "";
    if (codigoNorm && porCodigo.has(codigoNorm)) return porCodigo.get(codigoNorm)!;
    const tituloNorm = normalizeComparison(titulo);
    if (porTitulo.has(tituloNorm)) return porTitulo.get(tituloNorm)!;
    return titulo;
  };

  // Quantas linhas de comentário cada (jogador, conteúdo, tipo) DEVERIA ter.
  const permitidasComentario = new Map<string, number>();
  for (const c of comentarios) {
    const nomeCanonico = resolverNomeCanonicoLocal(c.titulo, c.isAlbum, c.codigoUnico);
    const conteudo = c.isAlbum ? `(ALBUM) - ${nomeCanonico}` : nomeCanonico;
    const chave = `${normalizeComparison(c.jogador)}|${normalizeComparison(conteudo)}|${normalizeComparison(c.tipo)}`;
    permitidasComentario.set(chave, (permitidasComentario.get(chave) || 0) + 1);
  }

  // Agrupa as linhas de REGISTRO existentes por chave, na ordem em que
  // aparecem (linha mais antiga primeiro).
  const linhasPorChave = new Map<string, { linha: number; tipo: string }[]>();
  for (let i = 1; i < registroRows.length; i++) {
    const row = registroRows[i];
    const jogador = normalizeComparison(row?.[1] || "");
    const conteudo = normalizeComparison(row?.[2] || "");
    const tipo = normalizeText(row?.[3] || "");
    if (!jogador && !conteudo && !tipo) continue;
    const chave = `${jogador}|${conteudo}|${normalizeComparison(tipo)}`;
    const linhaSheet = i + 1; // array 0-indexed, linha 1 = cabeçalho
    if (!linhasPorChave.has(chave)) linhasPorChave.set(chave, []);
    linhasPorChave.get(chave)!.push({ linha: linhaSheet, tipo });
  }

  const paraDeletar: number[] = [];
  const detalhes: { chave: string; existiam: number; permitidas: number; removidas: number }[] = [];

  for (const [chave, ocorrencias] of linhasPorChave.entries()) {
    const tipo = ocorrencias[0].tipo;
    const isEmpireHits = normalizeComparison(tipo).startsWith("empire hits");
    const isComentario = normalizeComparison(tipo).startsWith("comentarios") || normalizeComparison(tipo).startsWith("comentários");

    let permitidas: number;
    if (isEmpireHits) {
      // Teto conservador: nenhum jogador pode ter mais créditos daquele tier
      // do que o número de transmissões reais do Empire Hits que existiram.
      permitidas = broadcastsReais;
    } else if (isComentario) {
      permitidas = permitidasComentario.get(chave) ?? 0;
    } else {
      // Tipo que essa correção não sabe validar (ex: outros tipos de
      // REGISTRO fora do escopo dos dois bugs) — nunca mexe.
      continue;
    }

    if (ocorrencias.length <= permitidas) continue;
    const excedente = ocorrencias.slice(permitidas); // mantém as primeiras `permitidas`, resto é excedente
    for (const o of excedente) paraDeletar.push(o.linha);
    detalhes.push({ chave, existiam: ocorrencias.length, permitidas, removidas: excedente.length });
  }

  if (paraDeletar.length > 0) {
    await googleSheetsService.registrosCharts.deleteRows("REGISTRO", paraDeletar);
  }

  await registrarLogSistema({
    categoria: "Ação concluída",
    oQueAconteceu: `Limpeza de excedente em REGISTRO: ${paraDeletar.length} linha(s) removida(s) em ${detalhes.length} chave(s) (broadcasts reais de Empire Hits contados: ${broadcastsReais}).`,
    onde: MARCADOR_LIMPEZA,
  }).catch(() => {});

  return { jaAplicado: false, linhasRemovidas: paraDeletar.length, detalhes };
}
