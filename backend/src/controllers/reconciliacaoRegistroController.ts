import { googleSheetsService, normalizeComparison, normalizeText } from "../services/googleSheetsService";
import { gravarLinhaRegistro } from "./registroLogController";

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
// RECONSTRUÇÃO — pedido explícito do usuário depois do incidente de
// limparRegistroExcedente (removida): em vez de tentar diferenciar "linha
// certa" de "linha duplicada" dentro de REGISTRO (é isso que tinha bug),
// RECONSTRÓI do zero, só com o que dá pra confirmar direto na fonte:
//   - Comentarios_MV / Comentarios_Albuns: têm coluna de Data de verdade —
//     filtra comentário raiz (sem resposta) com Data >= corte.
//   - Comentarios_Musicas: NUNCA teve coluna de data (createCommentController
//     grava Data ali a partir de agora, ver forumController.ts) — pro
//     histórico, usa o corte por LINHA que o usuário confirmou
//     manualmente (linha 990 em diante = comentários de música de verdade
//     feitos no período).
//   - Empire Hits: só houve 1 transmissão real no dia (confirmado via
//     Agenda_TV) — mantém no máximo 1 crédito por (jogador, tier)
//     existente em REGISTRO, já que não dá pra ter mais que isso legítimo.
// Título usado é o BRUTO da planilha de origem (Musicas!H / Music Videos!B
// / Albuns!G) — sem passar pela resolução "canônica" via EDIÇÃO CHARTS que
// causou o bug anterior (produzia falso-negativo silencioso).
//
// DRY-RUN por padrão: só mostra o que faria. Só executa (limpa REGISTRO e
// escreve de novo) com confirmar=true — depois do que aconteceu, nada
// mexe em produção sem uma segunda confirmação explícita.
// =========================================================================
const MUSICAS_LINHA_CORTE = 990; // confirmado manualmente pelo usuário

function parseDataBR(valor: string): number | null {
  // Formato gravado por toLocaleString("pt-BR", {timeZone: "America/Sao_Paulo"}):
  // "09/09/2026 14:30:00" ou "09/09/2026, 14:30:00" (vírgula depende do ambiente).
  const m = (valor || "").trim().match(/^(\d{2})\/(\d{2})\/(\d{4}),?\s+(\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  const [, dd, mm, yyyy, hh, mi, ss] = m;
  // Constrói como se fosse horário de Brasília (UTC-3) pra comparar com o
  // corte, que também é dado em horário de Brasília.
  return Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh) + 3, Number(mi), Number(ss));
}

interface RegistroPlanejado {
  jogador: string;
  conteudo: string;
  tipo: string;
}

interface DiagnosticoFonte {
  linhasVarridas: number;
  semTopicoOuJogador: number;
  comResposta: number;
  dataInvalidaOuForaDoCorte?: number;
  semTituloEncontrado: number;
  aceitas: number;
}

async function planejarComentarios(
  corteTs: number,
): Promise<{ planejados: RegistroPlanejado[]; diagnostico: { musicas: DiagnosticoFonte; mv: DiagnosticoFonte; albuns: DiagnosticoFonte } }> {
  const [comentariosMusicas, comentariosMV, comentariosAlbuns, musicas, musicVideos, albuns] = await Promise.all([
    googleSheetsService.principal.readValues("Comentarios_Musicas"),
    googleSheetsService.principal.readValues("Comentarios_MV"),
    googleSheetsService.principal.readValues("Comentarios_Albuns"),
    googleSheetsService.principal.readValues("Musicas"),
    googleSheetsService.principal.readValues("Music Videos"),
    googleSheetsService.principal.readValues("Albuns"),
  ]);

  const tituloPorTopico = (rows: string[][], colTopicId: number, colTitulo: number): Map<string, string> => {
    const mapa = new Map<string, string>();
    for (let i = 1; i < rows.length; i++) {
      const topicId = normalizeComparison(rows[i]?.[colTopicId] || "");
      const titulo = normalizeText(rows[i]?.[colTitulo]);
      if (topicId && titulo) mapa.set(topicId, titulo);
    }
    return mapa;
  };
  const titulosMusicas = tituloPorTopico(musicas, 1, 7); // B, H
  const titulosVideos = tituloPorTopico(musicVideos, 5, 1); // F, B
  const titulosAlbuns = tituloPorTopico(albuns, 1, 6); // B, G

  const planejados: RegistroPlanejado[] = [];
  const diagnostico = {
    musicas: { linhasVarridas: 0, semTopicoOuJogador: 0, comResposta: 0, semTituloEncontrado: 0, aceitas: 0 },
    mv: { linhasVarridas: 0, semTopicoOuJogador: 0, comResposta: 0, dataInvalidaOuForaDoCorte: 0, semTituloEncontrado: 0, aceitas: 0 },
    albuns: { linhasVarridas: 0, semTopicoOuJogador: 0, comResposta: 0, dataInvalidaOuForaDoCorte: 0, semTituloEncontrado: 0, aceitas: 0 },
  };

  // Comentarios_Musicas — sem data, corte por linha (confirmado pelo usuário).
  for (let i = Math.max(1, MUSICAS_LINHA_CORTE - 1); i < comentariosMusicas.length; i++) {
    diagnostico.musicas.linhasVarridas++;
    const row = comentariosMusicas[i];
    const topicId = normalizeComparison(row?.[0] || "");
    const jogador = normalizeText(row?.[2]);
    const replyTo = normalizeText(row?.[4]);
    if (!topicId || !jogador) { diagnostico.musicas.semTopicoOuJogador++; continue; }
    if (replyTo) { diagnostico.musicas.comResposta++; continue; }
    const titulo = titulosMusicas.get(topicId);
    if (!titulo) { diagnostico.musicas.semTituloEncontrado++; continue; }
    diagnostico.musicas.aceitas++;
    planejados.push({ jogador, conteudo: titulo, tipo: TIPO_MUSICA });
  }

  // Comentarios_MV — Data real na coluna E (índice 4).
  for (let i = 1; i < comentariosMV.length; i++) {
    diagnostico.mv.linhasVarridas++;
    const row = comentariosMV[i];
    const topicId = normalizeComparison(row?.[0] || "");
    const jogador = normalizeText(row?.[2]);
    const data = parseDataBR(normalizeText(row?.[4]));
    const replyTo = normalizeText(row?.[5]);
    if (!topicId || !jogador) { diagnostico.mv.semTopicoOuJogador++; continue; }
    if (replyTo) { diagnostico.mv.comResposta++; continue; }
    if (data === null || data < corteTs) { diagnostico.mv.dataInvalidaOuForaDoCorte++; continue; }
    const titulo = titulosVideos.get(topicId);
    if (!titulo) { diagnostico.mv.semTituloEncontrado++; continue; }
    diagnostico.mv.aceitas++;
    planejados.push({ jogador, conteudo: titulo, tipo: TIPO_MUSICA });
  }

  // Comentarios_Albuns — mesma estrutura de Comentarios_MV.
  for (let i = 1; i < comentariosAlbuns.length; i++) {
    diagnostico.albuns.linhasVarridas++;
    const row = comentariosAlbuns[i];
    const topicId = normalizeComparison(row?.[0] || "");
    const jogador = normalizeText(row?.[2]);
    const data = parseDataBR(normalizeText(row?.[4]));
    const replyTo = normalizeText(row?.[5]);
    if (!topicId || !jogador) { diagnostico.albuns.semTopicoOuJogador++; continue; }
    if (replyTo) { diagnostico.albuns.comResposta++; continue; }
    if (data === null || data < corteTs) { diagnostico.albuns.dataInvalidaOuForaDoCorte++; continue; }
    const titulo = titulosAlbuns.get(topicId);
    if (!titulo) { diagnostico.albuns.semTituloEncontrado++; continue; }
    diagnostico.albuns.aceitas++;
    planejados.push({ jogador, conteudo: `(ALBUM) - ${titulo}`, tipo: TIPO_ALBUM });
  }

  return { planejados, diagnostico };
}

export async function reconstruirRegistroDesdeCorte(confirmar: boolean): Promise<{
  confirmar: boolean;
  corte: string;
  comentariosPlanejados: number;
  diagnosticoComentarios?: { musicas: DiagnosticoFonte; mv: DiagnosticoFonte; albuns: DiagnosticoFonte };
  empireHitsPreservados: { chave: string; existiam: number; mantidas: number }[];
  totalLinhasFinal: number;
  executado: boolean;
  erro?: string;
}> {
  try {
    return await reconstruirRegistroDesdeCorteInterno(confirmar);
  } catch (err: any) {
    console.warn("[reconstruirRegistroDesdeCorte] Erro:", err);
    return {
      confirmar,
      corte: "",
      comentariosPlanejados: 0,
      empireHitsPreservados: [],
      totalLinhasFinal: 0,
      executado: false,
      erro: err?.message || String(err),
    };
  }
}

async function reconstruirRegistroDesdeCorteInterno(confirmar: boolean): Promise<{
  confirmar: boolean;
  corte: string;
  comentariosPlanejados: number;
  diagnosticoComentarios: { musicas: DiagnosticoFonte; mv: DiagnosticoFonte; albuns: DiagnosticoFonte };
  empireHitsPreservados: { chave: string; existiam: number; mantidas: number }[];
  totalLinhasFinal: number;
  executado: boolean;
}> {
  // Corte: quarta-feira mais recente, 00:00 no horário de Brasília.
  const agora = new Date();
  const hojeBRT = new Date(agora.getTime() - 3 * 60 * 60 * 1000); // desloca pra "ver" a data local BRT em UTC
  const diaSemana = hojeBRT.getUTCDay(); // 0=domingo ... 3=quarta
  const diasDesdeQuarta = (diaSemana - 3 + 7) % 7;
  const corteData = new Date(
    Date.UTC(hojeBRT.getUTCFullYear(), hojeBRT.getUTCMonth(), hojeBRT.getUTCDate() - diasDesdeQuarta, 3, 0, 0),
  );
  const corteTs = corteData.getTime();

  const [{ planejados: comentariosPlanejados, diagnostico: diagnosticoComentarios }, registroRows] = await Promise.all([
    planejarComentarios(corteTs),
    googleSheetsService.registrosCharts.readValues("REGISTRO"),
  ]);

  // Empire Hits — sem data em REGISTRO pra filtrar por período, então só
  // reduz o excedente óbvio: no máximo 1 crédito por (jogador, tier), já
  // que só houve 1 transmissão real no período (confirmado via Agenda_TV).
  const empireHitsPorChave = new Map<string, number>();
  for (let i = 1; i < registroRows.length; i++) {
    const tipo = normalizeText(registroRows[i]?.[3] || "");
    if (!normalizeComparison(tipo).startsWith("empire hits")) continue;
    const jogador = normalizeComparison(registroRows[i]?.[1] || "");
    const chave = `${jogador}|${normalizeComparison(tipo)}`;
    empireHitsPorChave.set(chave, (empireHitsPorChave.get(chave) || 0) + 1);
  }
  const empireHitsPreservados = [...empireHitsPorChave.entries()].map(([chave, existiam]) => ({
    chave,
    existiam,
    mantidas: Math.min(existiam, 1),
  }));

  const totalLinhasFinal =
    comentariosPlanejados.length + empireHitsPreservados.reduce((soma, e) => soma + e.mantidas, 0);

  if (!confirmar) {
    return {
      confirmar: false,
      corte: corteData.toISOString(),
      comentariosPlanejados: comentariosPlanejados.length,
      diagnosticoComentarios,
      empireHitsPreservados,
      totalLinhasFinal,
      executado: false,
    };
  }

  // Executa: limpa TODO o conteúdo (B:D) de REGISTRO — inclusive fora do
  // escopo dessa reconstrução, tipos que essa função não sabe recalcular
  // não sobrevivem (não existiam outros tipos além de comentário/Empire
  // Hits nas linhas revisadas até aqui). Depois escreve de novo, do zero.
  const totalLinhasExistentes = registroRows.length - 1;
  if (totalLinhasExistentes > 0) {
    await googleSheetsService.registrosCharts.updateValues(
      "REGISTRO",
      `B2:D${registroRows.length}`,
      Array.from({ length: totalLinhasExistentes }, () => ["", "", ""]),
    );
  }

  for (const p of comentariosPlanejados) {
    await gravarLinhaRegistro([p.jogador, p.conteudo, p.tipo]);
  }
  // Empire Hits: reescreve só as linhas preservadas (até 1 por jogador+tier).
  // Reconstrói o nome "de exibição" a partir da própria linha original já
  // lida (primeira ocorrência de cada chave), já que REGISTRO só guarda o
  // nome normalizado na chave — precisa do texto original da linha.
  const primeiraOcorrenciaEmpireHits = new Map<string, { jogador: string; tipo: string }>();
  for (let i = 1; i < registroRows.length; i++) {
    const tipo = normalizeText(registroRows[i]?.[3] || "");
    if (!normalizeComparison(tipo).startsWith("empire hits")) continue;
    const jogador = normalizeText(registroRows[i]?.[1] || "");
    const chave = `${normalizeComparison(jogador)}|${normalizeComparison(tipo)}`;
    if (!primeiraOcorrenciaEmpireHits.has(chave)) primeiraOcorrenciaEmpireHits.set(chave, { jogador, tipo });
  }
  for (const e of empireHitsPreservados) {
    const original = primeiraOcorrenciaEmpireHits.get(e.chave);
    if (!original) continue;
    for (let n = 0; n < e.mantidas; n++) {
      await gravarLinhaRegistro([original.jogador, "", original.tipo]);
    }
  }

  return {
    confirmar: true,
    corte: corteData.toISOString(),
    comentariosPlanejados: comentariosPlanejados.length,
    diagnosticoComentarios,
    empireHitsPreservados,
    totalLinhasFinal,
    executado: true,
  };
}

