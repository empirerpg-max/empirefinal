// Pre-save de álbum — Catálogo > Gestão Pre save.
//
// Feature nova (desenhada em conversa com o usuário, resumo completo no
// prompt que criou este arquivo). Resumo rápido das regras:
// - Só ÁLBUM por agora (singles ficam pra depois).
// - Dois modos: "contagem" (só countdown, sem esforço) e "missao"
//   (countdown + 1 missão por dia, 14 dias, cada missão paga uma fração
//   do crescimento daquele dia e, se perdida, essa fração se perde PRA
//   SEMPRE — sem fallback automático, diferente do Tour).
// - Teto final (nunca exposto ao jogador nem no contador público):
//     valTotal = melhor (maior) valTotal do artista na aba SPOTIFY de
//     chartsBase (getChart).
//     tetoMissao   = 0.3% de valTotal, distribuído em 1/14 por dia.
//     tetoContagem = 0.3% de valTotal * 35% (sem distribuição por dia —
//                    sobe linear e automático com o tempo).
// - No lançamento (dia D), reaproveita publicarAlbum/registrarAlbumNaEdicaoChartsAlbuns
//   (gestaoController.ts) pra lançar o álbum normalmente; se o modo foi
//   "missao", escreve o valor acumulado final na coluna S ("PRE-SAVE") da
//   linha recém-criada em "EDIÇÃO CHARTS ÁLBUMS". Modo "contagem" nunca
//   escreve nada em S (só teve o contador de vanity, nunca afeta o placar).
//
// Armazenamento: aba nova "PreSave_Album" dentro da planilha de Catálogo
// (googleSheetsService.principal — mesma planilha de "Albuns"/"Musicas").
// Essa aba foi criada manualmente pelo usuário, mas estava vazia no momento
// desta implementação — por isso o layout de colunas abaixo foi DEFINIDO
// aqui (documentado) em vez de inferido de dados existentes. Se a aba não
// tiver cabeçalho ainda, writeHeaderIfNeeded() escreve um na primeira
// escrita.
//
// Colunas de "PreSave_Album" (A..U):
//  A ID               — "PRESAVE-xxxxxxxx"
//  B JogadorId        — telegram id de quem criou a campanha
//  C JogadorNome
//  D Artista
//  E AlbumTituloFull  — "Artista - Título"
//  F CapaUrl
//  G TipoAlbum        — "Álbum" | "EP" | "Deluxe"
//  H Modo             — "missao" | "contagem"
//  I DataInicioISO
//  J DataLancamento   — "YYYY-MM-DD"
//  K DuracaoDias      — default 14 (PRESAVE_DURACAO_DIAS_DEFAULT)
//  L TetoFinal        — número, NUNCA exposto nas respostas públicas
//  M Status           — "ativa" | "lancada" | "cancelada"
//  N FaixasJson       — [{num, inedita, titulo, tipoSingle, tipoMusica,
//                         participantes, mediaUrl, letra, abrirTopico,
//                         mostrarNomeReal, revelada}] — MESMO formato de
//                        TrackConfig/TrackItemPayload (Gestao.tsx/
//                        gestaoController.ts): é o mesmo cadastro de álbum
//                        de verdade, só com 2 campos extras de pre-save
//                        (mostrarNomeReal/revelada) por cima.
//  O MissoesJson      — [{dia(1..duracao), tipo, peso, status: "pendente"|"completa"|"perdida", completadoEm, dados}]
//  P AlbumTopicId     — id do tópico criado imediatamente (comentários travados até o lançamento)
//  Q CodigoUnicoAlbum — preenchido só no dia do lançamento
//  R EncartesUrls     — join(", ")
//  S NomeJogadorExibicao (redundante com C, mantido por clareza em leituras manuais)
//  T CriadoEmISO
//  U ExtraMaterialJson — { shopAtivo, shop, infoAtivo, info, visualAtivo, arte }
//                        (mesmo formato de ExtraMaterialEditorValue,
//                        ExtraMaterial.tsx) — coletado na criação da
//                        campanha, só é de fato salvo em Extra_Albuns no
//                        dia do lançamento (quando o Código único existe).
import {
  googleSheetsService,
  normalizeComparison,
  normalizeText,
  type GoogleSheetRow,
} from "../services/googleSheetsService";
import { registrarLogSistema } from "../services/logSistemaService";
import { withWriteLock } from "../services/writeLockService";
import { publicarAlbum, type TrackItemPayload } from "./gestaoController";
import { createAcervoEntrevistaController } from "./acervoController";
import { createSocialPostController } from "./socialController";
import { saveExtraMaterialController } from "./extraMaterialController";

const PRESAVE_SHEET = "PreSave_Album";
export const PRESAVE_DURACAO_DIAS_DEFAULT = 14;
const TETO_PCT_BASE = 0.003; // 0,3% do valTotal
const TETO_PCT_MODO_CONTAGEM = 0.35; // 35% do teto-base quando não tem missão

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// POST lê do corpo JSON, como sempre; GET lê de url.searchParams — esse
// fallback é usado de propósito pelo workflow admin-call.yml (o sandbox
// não tem acesso de rede direto ao domínio do Worker, então rodar um
// endpoint admin em produção só é possível via GET sem corpo). Removido
// por engano numa rodada anterior (regressão real, já reportada e
// corrigida aqui) — nunca tirar esse suporte de novo.
async function readParamsBodyOrQuery(request: Request): Promise<Record<string, string>> {
  if (request.method === "GET") {
    const url = new URL(request.url);
    return Object.fromEntries(url.searchParams.entries());
  }
  const body = await request.json().catch(() => ({}));
  return (body && typeof body === "object" ? body : {}) as Record<string, string>;
}

function genId(prefix: string): string {
  const rand = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  return `${prefix}-${rand}`;
}

// As 10 missões possíveis do calendário (nome interno "9 missões" do
// resumo do usuário, mas são 10 tipos reais — pesos exatamente como
// fechado com ele). peso = % do 1/14 daquele dia que a missão entrega ao
// ser completada.
export type MissaoTipo =
  | "post_anuncio"
  | "bastidores"
  | "entrevista"
  | "tracklist_reveal"
  | "capa_alternativa"
  | "trecho_letra"
  | "making_of_video"
  | "enquete_fas"
  | "countdown_marco"
  | "desafio_som";

export const MISSOES_CATALOGO: Record<
  MissaoTipo,
  { peso: number; label: string; descricao: string }
> = {
  post_anuncio: {
    peso: 30,
    label: "Post de anúncio",
    descricao: "Post social (qualquer rede) anunciando a campanha.",
  },
  bastidores: {
    peso: 60,
    label: "Bastidores",
    descricao:
      'Post social (qualquer rede) publicado através de um perfil de "Tá na Mídia" disponível.',
  },
  entrevista: {
    peso: 65,
    label: "Entrevista",
    descricao: "Cadastro direto em Acervo > Entrevistas (não é post social).",
  },
  tracklist_reveal: {
    peso: 90,
    label: "Revelação de faixa",
    descricao:
      'Post social + escolha de qual faixa oculta revelar (substitui "Track X" pelo nome real).',
  },
  capa_alternativa: {
    peso: 35,
    label: "Capa alternativa",
    descricao: "Post social (qualquer rede).",
  },
  trecho_letra: { peso: 60, label: "Trecho de letra", descricao: "Post social (qualquer rede)." },
  making_of_video: {
    peso: 95,
    label: "Making of",
    descricao: "Post social exclusivo de TikTok OU vídeo real via Fórum > Vídeos.",
  },
  enquete_fas: { peso: 35, label: "Enquete pros fãs", descricao: "Post social (qualquer rede)." },
  countdown_marco: {
    peso: 40,
    label: "Marco da contagem",
    descricao: "Post social (qualquer rede).",
  },
  desafio_som: {
    peso: 100,
    label: "Desafio de som",
    descricao: "Post social EXCLUSIVO de TikTok.",
  },
};

// Mesmo formato de TrackConfig/TrackItemPayload (Gestao.tsx/
// gestaoController.ts) — é o mesmo cadastro de álbum de verdade (faixa
// existente buscada nos charts OU inédita, com tipoSingle/tipoMusica/
// participantes/mediaUrl/letra/abrirTopico), só com 2 campos extras de
// pre-save por cima: mostrarNomeReal (só relevante quando inedita=true —
// se false, o nome fica oculto como "Track N" até a missão
// tracklist_reveal ou o lançamento) e revelada (calculado: toda faixa já
// existente, ou inédita marcada pra mostrar nome real, já nasce revelada).
export interface PreSaveFaixa {
  num: number;
  inedita: boolean;
  titulo: string;
  tipoSingle?: string;
  tipoMusica?: string;
  participantes?: string[];
  mediaUrl?: string;
  letra?: string;
  abrirTopico?: boolean;
  mostrarNomeReal: boolean;
  revelada: boolean;
  instrumental?: boolean;
}

export interface PreSaveMissaoDia {
  dia: number; // 1..duracaoDias
  tipo: MissaoTipo | null; // null = "sem missão" nesse dia (modo contagem, ou dia vazio escolhido no modo missão)
  status: "pendente" | "completa" | "perdida";
  completadoEm?: string;
  dados?: unknown;
}

export interface PreSaveCampanha {
  id: string;
  jogadorId: string;
  jogadorNome: string;
  artista: string;
  albumTituloFull: string;
  capaUrl: string;
  tipoAlbum: string;
  modo: "missao" | "contagem";
  dataInicioISO: string;
  dataLancamento: string; // YYYY-MM-DD
  duracaoDias: number;
  tetoFinal: number; // NUNCA sai em resposta pública
  status: "ativa" | "lancada" | "cancelada";
  faixas: PreSaveFaixa[];
  missoes: PreSaveMissaoDia[];
  albumTopicId: string;
  codigoUnicoAlbum: string;
  encartesUrls: string[];
  criadoEmISO: string;
  // JSON bruto de ExtraMaterialEditorValue (ExtraMaterial.tsx) — "" quando
  // o jogador não ativou shop/info/visual na criação da campanha.
  extraMaterialJson: string;
  _rowIndex: number; // 1-based linha real na planilha (uso interno)
}

function parseJsonArraySafe<T>(raw: string | undefined): T[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function rowToCampanha(row: string[], rowIndex: number): PreSaveCampanha | null {
  const id = normalizeText(row[0]);
  if (!id) return null;
  return {
    id,
    jogadorId: normalizeText(row[1]),
    jogadorNome: normalizeText(row[2]),
    artista: normalizeText(row[3]),
    albumTituloFull: normalizeText(row[4]),
    capaUrl: normalizeText(row[5]),
    tipoAlbum: normalizeText(row[6]) || "Álbum",
    modo: normalizeText(row[7]) === "missao" ? "missao" : "contagem",
    dataInicioISO: normalizeText(row[8]),
    dataLancamento: normalizeText(row[9]),
    duracaoDias: parseInt(normalizeText(row[10]), 10) || PRESAVE_DURACAO_DIAS_DEFAULT,
    tetoFinal: parseFloat(normalizeText(row[11])) || 0,
    status: (normalizeText(row[12]) as PreSaveCampanha["status"]) || "ativa",
    faixas: parseJsonArraySafe<PreSaveFaixa>(row[13]),
    missoes: parseJsonArraySafe<PreSaveMissaoDia>(row[14]),
    albumTopicId: normalizeText(row[15]),
    codigoUnicoAlbum: normalizeText(row[16]),
    encartesUrls: normalizeText(row[17])
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    criadoEmISO: normalizeText(row[19]),
    extraMaterialJson: normalizeText(row[20]),
    _rowIndex: rowIndex,
  };
}

// IMPORTANTE — números NUNCA viram string nesta linha: GoogleSheetRow
// (ver googleSheetsService.ts) aceita `number` de verdade no array de
// valores, e a API do Sheets grava um JSON number assim recebido como
// CÉLULA NUMÉRICA de verdade, sem passar pelo parser de texto do
// valueInputOption=USER_ENTERED — é esse parser de texto (pensado pra
// interpretar o que um humano digitaria) que reinterpreta um PONTO como
// separador de milhar no locale PT-BR da planilha. Bug real confirmado em
// produção, duas vezes: primeiro gravando a string "1804278.114" (virou
// texto "1.804.278.114" na célula); depois, mesmo já arredondando com
// Math.round ANTES de converter pra string, o valor ainda saiu
// corrompido — prova de que NENHUMA conversão pra string é seguro aqui,
// só escrever o number nativo elimina o problema de vez (e cobre os
// outros possíveis no-1-ou-de-formato que uma string decimal sempre
// corre, independente de arredondar antes ou não). Math.round() segue
// aplicado por segurança (pre-save nunca precisa de casa decimal), mas a
// garantia real é o tipo `number`, não o arredondamento em si.
function campanhaToRow(c: PreSaveCampanha): GoogleSheetRow {
  return [
    c.id,
    c.jogadorId,
    c.jogadorNome,
    c.artista,
    c.albumTituloFull,
    c.capaUrl,
    c.tipoAlbum,
    c.modo,
    c.dataInicioISO,
    c.dataLancamento,
    Math.round(c.duracaoDias),
    Math.round(c.tetoFinal),
    c.status,
    JSON.stringify(c.faixas),
    JSON.stringify(c.missoes),
    c.albumTopicId,
    c.codigoUnicoAlbum,
    c.encartesUrls.join(", "),
    c.jogadorNome,
    c.criadoEmISO,
    c.extraMaterialJson || "",
  ];
}

const HEADER = [
  "ID",
  "JogadorId",
  "JogadorNome",
  "Artista",
  "AlbumTituloFull",
  "CapaUrl",
  "TipoAlbum",
  "Modo",
  "DataInicioISO",
  "DataLancamento",
  "DuracaoDias",
  "TetoFinal",
  "Status",
  "FaixasJson",
  "MissoesJson",
  "AlbumTopicId",
  "CodigoUnicoAlbum",
  "EncartesUrls",
  "JogadorNomeExibicao",
  "CriadoEmISO",
  "ExtraMaterialJson",
];

async function ensureHeader(): Promise<void> {
  const existing = await googleSheetsService.principal
    .readValues(PRESAVE_SHEET, "A1:U1")
    .catch(() => []);
  if (!existing || existing.length === 0 || !normalizeText(existing[0]?.[0])) {
    await googleSheetsService.principal.updateValues(PRESAVE_SHEET, "A1:U1", [HEADER]);
  }
}

// Colunas desta aba que são NÚMERO de verdade (índice 0-based) — só essas
// precisam do valor bruto (UNFORMATTED_VALUE). Índice 10 = K (DuracaoDias),
// 11 = L (TetoFinal).
const PRESAVE_COLUNAS_NUMERICAS = [10, 11];

async function readAllCampanhas(): Promise<PreSaveCampanha[]> {
  // Regressão real encontrada e corrigida: ler a aba INTEIRA com
  // UNFORMATTED_VALUE resolveu o teto (ver bug "tetoFinal virava 2" —
  // comentário mais abaixo), mas quebrou toda coluna de DATA (ex.
  // DataLancamento): o texto "2026-10-22" escrito via USER_ENTERED é
  // autodetectado pelo Sheets como data de verdade — o valor BRUTO
  // guardado por baixo é o número de série (dias desde 1899-12-30), não o
  // texto; só o valor FORMATADO (default, FORMATTED_VALUE) devolve
  // "2026-10-22" de volta. Ler tudo raw trocou um bug por outro
  // ("46317" em vez da data, NaN na tela).
  //
  // Fix: duas leituras da MESMA aba em paralelo — uma formatada (default,
  // certa pra texto/data) e uma bruta (certa pra número) — e MESCLA linha
  // a linha, usando o valor bruto só nas colunas que são número de
  // verdade (PRESAVE_COLUNAS_NUMERICAS), formatado em todas as outras.
  // Nunca lê a aba inteira só de um jeito só — cada coluna usa a leitura
  // certa pro tipo de dado que ela guarda.
  const [rowsFormatadas, rowsBrutas] = await Promise.all([
    googleSheetsService.principal.readValues(PRESAVE_SHEET, "A2:U20000").catch(() => []),
    googleSheetsService.principal.readValuesRaw(PRESAVE_SHEET, "A2:U20000").catch(() => []),
  ]);
  const rows = rowsFormatadas.map((rowFormatada, i) => {
    const rowBruta = rowsBrutas[i];
    if (!rowBruta) return rowFormatada;
    const combinada = [...rowFormatada];
    for (const col of PRESAVE_COLUNAS_NUMERICAS) {
      if (rowBruta[col] !== undefined) combinada[col] = rowBruta[col];
    }
    return combinada;
  });
  const out: PreSaveCampanha[] = [];
  for (let i = 0; i < (rows || []).length; i++) {
    const c = rowToCampanha(rows[i], i + 2);
    if (c) out.push(c);
  }
  return out;
}

// Trava por campanha (chave = id da campanha, não a aba inteira) — cobre o
// caso de duas escritas concorrentes na MESMA campanha (ex: duplo-clique
// completando a mesma missão duas vezes, ou completar-missão e
// recalcular-teto rodando quase juntos): sem isso, é um "lost update"
// clássico — a segunda escrita sobrescreve a primeira sem nenhum aviso.
// Não usa a trava genérica da aba (presave:PreSave_Album, usada só pra
// achar a próxima linha livre na criação) porque aqui o rowIndex já é
// conhecido — travar por campanha específica permite completar missões
// de campanhas DIFERENTES em paralelo, sem fila desnecessária.
async function writeCampanha(c: PreSaveCampanha): Promise<void> {
  await withWriteLock(`presave:campanha:${c.id}`, async () => {
    await googleSheetsService.principal.updateValues(
      PRESAVE_SHEET,
      `A${c._rowIndex}:U${c._rowIndex}`,
      [campanhaToRow(c)],
    );
  });
}

// Trava de concorrência (ver writeLockService.ts, "bug da Rayna") — mesmo
// padrão de risco de "achar última linha + escrever" sem proteção; duas
// campanhas criadas quase ao mesmo tempo podiam calcular a mesma linha.
async function appendCampanha(c: PreSaveCampanha): Promise<number> {
  return withWriteLock("presave:PreSave_Album", async () => {
    const rows = await googleSheetsService.principal
      .readValues(PRESAVE_SHEET, "A2:A20000")
      .catch(() => []);
    let ultimaLinha = 1;
    for (let i = 0; i < (rows || []).length; i++) {
      if (normalizeText(rows[i]?.[0])) ultimaLinha = i + 2;
    }
    const linhaAlvo = ultimaLinha + 1;
    c._rowIndex = linhaAlvo;
    await googleSheetsService.principal.updateValues(PRESAVE_SHEET, `A${linhaAlvo}:U${linhaAlvo}`, [
      campanhaToRow(c),
    ]);
    return linhaAlvo;
  });
}

// ---- cálculo do teto (nunca exposto) ----

// Melhor (maior) valTotal do artista na aba SPOTIFY de chartsBase — base do
// cálculo do teto. Confirmado com o usuário: usa a música de melhor
// posição/mais recente do artista, lendo o valTotal (coluna F, total
// acumulado) e não o val semanal (coluna E).
async function getMelhorValTotalArtista(artista: string): Promise<number> {
  // BUG REAL corrigido aqui (confirmado com dado de produção): a aba
  // SPOTIFY acumula o histórico INTEIRO desde 2020 numa lista só (230+
  // datas × ~100 posições = 20.000+ linhas, crescendo toda semana) —
  // qualquer range com cap fixo (ex: "A1:ZZ5000") corta a planilha antes
  // de chegar nas semanas recentes, já que as linhas vêm em ordem
  // cronológica (mais antiga primeiro). Mesmo padrão de chartsController.ts
  // (readSheet): lê SEM range (pega a aba inteira de verdade), sem
  // depender de um número que quebra de novo mais pra frente.
  const rows = await googleSheetsService.chartsBase.readValues("SPOTIFY").catch(() => []);
  if (!rows || rows.length < 2) return 0;
  const alvo = normalizeComparison(artista);
  let melhor = 0;
  // Layout confirmado em chartsController.ts (fetchC, ramo não-álbum/não-países):
  // pos=r2, tit=r3, val=r4, valTotal=r5, art=r7.
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const art = normalizeComparison(row[7]);
    if (art !== alvo) continue;
    const valTotal =
      parseFloat(
        String(row[5] || "0")
          .replace(/\./g, "")
          .replace(",", "."),
      ) || 0;
    if (valTotal > melhor) melhor = valTotal;
  }
  return melhor;
}

async function calcularTetos(
  artista: string,
): Promise<{ tetoMissao: number; tetoContagem: number; valTotal: number }> {
  const valTotal = await getMelhorValTotalArtista(artista);
  const tetoBase = valTotal * TETO_PCT_BASE;
  return { tetoMissao: tetoBase, tetoContagem: tetoBase * TETO_PCT_MODO_CONTAGEM, valTotal };
}

// Fuso horário do calendário de 14 dias: SEMPRE Brasília (UTC-3), ciclo de
// 24h corridas nesse fuso — combinado desde o início, mas até agora
// calculado errado (ver diaCampanhaAtual abaixo). Mesmo padrão de fuso já
// usado em processarLancamentosPreSaveScheduled (hojeStr).
const FUSO_CAMPANHA = "America/Sao_Paulo";

// "YYYY-MM-DD" do dia-calendário (em Brasília) de uma data qualquer.
function diaCalendarioBrasilia(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: FUSO_CAMPANHA });
}

// Diferença em DIAS-CALENDÁRIO (não em horas corridas) entre duas datas
// "YYYY-MM-DD" — parseadas como meia-noite UTC só pra fazer a subtração
// de dias de forma exata, sem nenhum artefato de fuso/horário de verão.
function diasEntreCalendario(aStr: string, bStr: string): number {
  const a = new Date(`${aStr}T00:00:00Z`).getTime();
  const b = new Date(`${bStr}T00:00:00Z`).getTime();
  return Math.round((b - a) / 86400000);
}

// BUG REAL corrigido aqui (reportado em produção, 2026-10): "que dia da
// campanha é hoje" estava calculado como horas corridas desde o instante
// exato da criação da campanha (dataInicioISO) dividido por 24h — isso
// NUNCA bate com o conceito combinado de "dia-calendário em Brasília".
// Exemplo real do bug: campanha criada 23:50 de um dia — 20 minutos
// depois já é outro dia-calendário em Brasília (óbvio pro jogador que
// virou "Dia 2"), mas o cálculo antigo ainda achava que só tinham passado
// alguns minutos de 24h, continuando a travar a missão do Dia 2 como "fora
// da janela". Isso também explicava o contador ficar preso em 0 pra
// sempre no modo com missão: se o dia "de hoje" calculado nunca bate com o
// dia agendado da missão, completarMissaoPreSaveController SEMPRE rejeita
// a tentativa (ver dia !== hojeIndex), então nenhuma missão jamais
// completa de verdade. Agora usa diferença de dia-calendário em Brasília
// — dia 1 é o dia-calendário da criação, dia 2 é o dia-calendário
// seguinte, etc., sem depender da hora exata em que a campanha nasceu.
function diaCampanhaAtual(c: PreSaveCampanha): number {
  const inicioStr = diaCalendarioBrasilia(new Date(c.dataInicioISO));
  const hojeStr = diaCalendarioBrasilia(new Date());
  return diasEntreCalendario(inicioStr, hojeStr) + 1;
}

// Progresso acumulado ATÉ AGORA (nunca o teto) — calculado a partir do
// estado persistido, sem precisar de cron por minuto:
// - modo "missao": soma (peso/100) * (teto/duracao) de cada dia já
//   completo. Dias "perdidos" (data já passou e não foi completado) não
//   contam nunca mais — sem fallback, de propósito.
// - modo "contagem": sobe 1/duracaoDias por DIA-CALENDÁRIO (Brasília)
//   completo desde a criação, sempre travado no teto reduzido (35%) no
//   dia do lançamento. Antes crescia fracionado por hora corrida — trocado
//   pra dia-calendário inteiro, consistente com o resto do cálculo de
//   "dia da campanha" (mesmo bug de fuso do item acima).
export function calcularAcumulado(c: PreSaveCampanha): number {
  if (c.modo === "contagem") {
    const diasCompletos = Math.max(0, diaCampanhaAtual(c) - 1); // dia 1 = 0 dias completos ainda
    const fracao = Math.min(1, diasCompletos / c.duracaoDias);
    return c.tetoFinal * fracao;
  }
  const porDia = c.tetoFinal / c.duracaoDias;
  return c.missoes
    .filter((m) => m.status === "completa")
    .reduce(
      (acc, m) => acc + porDia * ((MISSOES_CATALOGO[m.tipo as MissaoTipo]?.peso ?? 0) / 100),
      0,
    );
}

// Quanto cada dia JÁ PASSADO contribuiu — mesma lógica de calcularAcumulado,
// só que dia a dia em vez de só o total (pedido explícito: "todo dia tem
// que ter número e ir somando", não só um total solto sem contexto).
// - modo "contagem": cada dia-calendário completo libera exatamente
//   1/duracaoDias do teto, automático — todo dia já passado tem o MESMO
//   valor (porDia).
// - modo "missao": só os dias com missão "completa" têm valor (porDia *
//   peso/100); "perdida" ou "pendente" (ainda não chegou a vez) valem 0.
// Só devolve dias de 1 até min(duracaoDias, diaCampanhaAtual - 1) — o dia
// corrente ainda está em andamento, não "já passado", então não entra
// aqui (ele pode ainda ganhar sua fatia completando a missão).
// Valores aqui NÃO são arredondados individualmente — só o total
// (acumuladoAtual) e a soma destes dias são arredondados no mesmo lugar
// (campanhaPublica), garantindo que a soma exibida bate exatamente com o
// total exibido (arredondar cada dia separado e depois somar os
// arredondados podia divergir do total por alguns pontos).
export function valoresPorDia(c: PreSaveCampanha): { dia: number; valor: number }[] {
  const porDia = c.tetoFinal / c.duracaoDias;
  const diasPassados = Math.min(c.duracaoDias, Math.max(0, diaCampanhaAtual(c) - 1));
  const out: { dia: number; valor: number }[] = [];
  for (let dia = 1; dia <= diasPassados; dia++) {
    if (c.modo === "contagem") {
      out.push({ dia, valor: porDia });
      continue;
    }
    const missao = c.missoes.find((m) => m.dia === dia);
    const valor =
      missao?.status === "completa"
        ? porDia * ((MISSOES_CATALOGO[missao.tipo as MissaoTipo]?.peso ?? 0) / 100)
        : 0;
    out.push({ dia, valor });
  }
  return out;
}

// Marca como "perdida" (sem reposição) qualquer dia de missão cuja data já
// passou e que ainda estava "pendente" — chamado sempre que o estado é
// lido, pra manter o calendário honesto sem depender de um cron próprio.
function aplicarDiasPerdidos(c: PreSaveCampanha): boolean {
  if (c.modo !== "missao" || c.status !== "ativa") return false;
  const hojeIndex = diaCampanhaAtual(c);
  let mudou = false;
  for (const m of c.missoes) {
    if (m.status === "pendente" && m.tipo && m.dia < hojeIndex) {
      m.status = "perdida";
      mudou = true;
    }
  }
  return mudou;
}

function campanhaPublica(c: PreSaveCampanha) {
  // Visão "contador público" — NUNCA inclui tetoFinal. Inclui a tracklist
  // já sanitizada (nome real só se `revelada`, senão "Track N") pra dar
  // suporte à página pública de acompanhamento (qualquer jogador, não só
  // o criador) — ver PreSavePublicPage.tsx.
  return {
    id: c.id,
    artista: c.artista,
    albumTituloFull: c.albumTituloFull,
    capaUrl: c.capaUrl,
    tipoAlbum: c.tipoAlbum,
    duracaoDias: c.duracaoDias,
    modo: c.modo,
    dataLancamento: c.dataLancamento,
    status: c.status,
    albumTopicId: c.albumTopicId,
    faixas: c.faixas
      .sort((a, b) => a.num - b.num)
      .map((f) => ({
        num: f.num,
        titulo: f.revelada ? f.titulo : `Track ${f.num}`,
        revelada: f.revelada,
        jaLancada: !f.inedita,
      })),
    acumuladoAtual: Math.round(calcularAcumulado(c)),
    // Quanto cada dia já passado contribuiu — pra UI mostrar dia a dia
    // (e a soma bater com acumuladoAtual), não só o total solto.
    valoresPorDia: valoresPorDia(c),
  };
}

function campanhaDoDono(c: PreSaveCampanha) {
  // Visão do próprio criador — também sem o teto (o usuário fechou que o
  // teto é cálculo interno "nunca exposto", inclusive pro próprio jogador).
  return {
    ...campanhaPublica(c),
    tipoAlbum: c.tipoAlbum,
    duracaoDias: c.duracaoDias,
    faixas: c.faixas,
    missoes: c.missoes,
    encartesUrls: c.encartesUrls,
    criadoEmISO: c.criadoEmISO,
    extraMaterial: c.extraMaterialJson ? parseJsonSafe(c.extraMaterialJson) : null,
  };
}

function parseJsonSafe<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

// -------------------- CRIAR CAMPANHA --------------------

// Faixa recebida na criação — EXATAMENTE o mesmo formato de TrackConfig
// (Gestao.tsx)/TrackItemPayload (gestaoController.ts), já que é o mesmo
// cadastro de álbum de verdade; só ganha 1 campo extra de pre-save
// (mostrarNomeReal, só relevante se inedita=true).
export interface CriarPreSaveFaixaPayload {
  num: number;
  inedita: boolean;
  titulo: string;
  tipoSingle?: string;
  tipoMusica?: string;
  participantes?: string[];
  mediaUrl?: string;
  letra?: string;
  abrirTopico?: boolean;
  mostrarNomeReal?: boolean;
}

export interface CriarPreSavePayload {
  jogadorId: string;
  jogadorNome: string;
  artista: string;
  tituloAlbum: string;
  capaUrl: string;
  tipoAlbum?: string;
  modo: "missao" | "contagem";
  dataLancamento: string; // YYYY-MM-DD, obrigatoriamente futura
  duracaoDias?: number;
  encartesUrls?: string[];
  faixas: CriarPreSaveFaixaPayload[];
  // modo "missao": mapa dia(1..duracao) -> tipo de missão (ou omitido/null = sem missão nesse dia)
  missoesPorDia?: Record<number, MissaoTipo | null>;
  // Mesmo formato de ExtraMaterialEditorValue (ExtraMaterial.tsx) — opcional.
  extraMaterial?: unknown;
}

export async function criarCampanhaPreSaveController(request: Request): Promise<Response> {
  try {
    const body = (await request.json().catch(() => ({}))) as CriarPreSavePayload;
    const jogadorId = normalizeText(body.jogadorId);
    const jogadorNome = normalizeText(body.jogadorNome) || "Jogador";
    const artista = normalizeText(body.artista);
    const tituloAlbum = normalizeText(body.tituloAlbum);
    const capaUrl = normalizeText(body.capaUrl);
    const modo = body.modo === "missao" ? "missao" : "contagem";
    const dataLancamento = normalizeText(body.dataLancamento);
    const duracaoDias =
      body.duracaoDias && body.duracaoDias > 0 ? body.duracaoDias : PRESAVE_DURACAO_DIAS_DEFAULT;

    if (!artista || !tituloAlbum || !jogadorId) {
      return jsonResponse(
        { success: false, error: "Artista, título do álbum e jogador são obrigatórios." },
        400,
      );
    }
    // Capa obrigatória pra iniciar a campanha — regra explícita do usuário.
    if (!capaUrl) {
      return jsonResponse(
        { success: false, error: "Capa é obrigatória para iniciar uma campanha de pre-save." },
        400,
      );
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dataLancamento)) {
      return jsonResponse(
        { success: false, error: "Data de lançamento inválida (use YYYY-MM-DD)." },
        400,
      );
    }
    if (new Date(`${dataLancamento}T00:00:00`).getTime() <= Date.now()) {
      return jsonResponse(
        { success: false, error: "A data de lançamento precisa ser no futuro." },
        400,
      );
    }
    if (!Array.isArray(body.faixas) || body.faixas.length === 0) {
      return jsonResponse({ success: false, error: "Informe ao menos 1 faixa." }, 400);
    }
    // Mesma validação de handleSubmitAlbum (Gestao.tsx): faixa inédita
    // precisa de título (faixa existente precisa só dele, selecionado na
    // busca dos charts). O ÁUDIO da faixa inédita NÃO é exigido aqui —
    // diferente do álbum normal (que publica na hora), o pre-save só
    // publica de verdade no dia D, então o jogador pode cadastrar a faixa
    // sem o áudio final ainda pronto. A ausência de áudio é bloqueada no
    // lançamento (ver processarLancamentosPreSaveScheduled abaixo), não
    // na criação da campanha.
    for (const f of body.faixas) {
      if (!normalizeText(f.titulo)) {
        return jsonResponse(
          {
            success: false,
            error: `Informe o título/selecione a música de cada faixa (faixa #${f.num || "?"}).`,
          },
          400,
        );
      }
    }

    await ensureHeader();

    const { tetoMissao, tetoContagem, valTotal } = await calcularTetos(artista);
    // Math.round: nunca grava decimal em TetoFinal — ver comentário em
    // campanhaToRow sobre a corrupção de locale (ponto decimal
    // reinterpretado como separador de milhar pelo Sheets em PT-BR).
    const tetoFinal = Math.round(modo === "missao" ? tetoMissao : tetoContagem);
    // Diagnóstico: se o artista não tem nenhuma música no chart SPOTIFY
    // (ou o valTotal não pôde ser lido), o teto sai 0 e o contador de
    // pre-save fica preso em 0 PRA SEMPRE, mesmo com dias passando/missões
    // completadas — sem log nenhum, isso é indistinguível de um bug de
    // cálculo de dia. Avisa alto no LOGS pra não confundir os dois.
    if (valTotal <= 0) {
      registrarLogSistema({
        categoria: "Falha de escrita",
        oQueAconteceu: `Campanha de pre-save criada para "${artista}" com teto ZERO — não achei nenhuma música desse artista no chart SPOTIFY (ou valTotal veio 0). O contador de pre-save dessa campanha vai ficar sempre em 0.`,
        onde: "criarCampanhaPreSaveController",
      }).catch(() => {});
    }

    const albumArtistPrefix = `${artista} - `;
    const tituloLimpo = tituloAlbum.toLowerCase().startsWith(albumArtistPrefix.toLowerCase())
      ? tituloAlbum.slice(albumArtistPrefix.length).trim()
      : tituloAlbum;
    const albumTituloFull = `${artista} - ${tituloLimpo}`;

    const faixas: PreSaveFaixa[] = body.faixas.map((f, i) => {
      const inedita = f.inedita !== false; // default true (faixa inédita), igual Gestao.tsx
      const mostrarNomeReal = !inedita || !!f.mostrarNomeReal;
      return {
        num: f.num || i + 1,
        inedita,
        titulo: normalizeText(f.titulo) || `Track ${i + 1}`,
        tipoSingle: f.tipoSingle,
        tipoMusica: f.tipoMusica,
        participantes: (f.participantes || []).filter((p) => p && p.trim()),
        mediaUrl: f.mediaUrl,
        letra: f.letra,
        abrirTopico: !!f.abrirTopico,
        mostrarNomeReal,
        // Faixa já existente (não-inédita) não tem nome a esconder — nasce
        // revelada. Inédita só nasce revelada se o jogador explicitamente
        // marcou "mostrar nome real"; senão fica como "Track N" até a
        // missão tracklist_reveal ou o lançamento no dia D.
        revelada: mostrarNomeReal,
      };
    });

    const missoes: PreSaveMissaoDia[] = [];
    for (let dia = 1; dia <= duracaoDias; dia++) {
      const tipo = modo === "missao" ? (body.missoesPorDia?.[dia] ?? null) : null;
      missoes.push({ dia, tipo: tipo || null, status: "pendente" });
    }

    // Tópico do álbum é criado IMEDIATAMENTE — reaproveita o mesmo id de
    // tópico que o lançamento normal usaria (album_<ts>_<rand>, ver
    // publicarAlbum em gestaoController.ts). O registro em "Albuns" (que é
    // quem cria o tópico de fato no fórum) só acontece no DIA DO
    // LANÇAMENTO (processarLancamentosPreSaveScheduled), pra não duplicar
    // lógica — aqui só reservamos o id. Comentários ficam travados até lá
    // porque o tópico (em "Albuns") simplesmente não existe ainda.
    const albumTopicId = `album_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const campanha: PreSaveCampanha = {
      id: genId("PRESAVE"),
      jogadorId,
      jogadorNome,
      artista,
      albumTituloFull,
      capaUrl,
      tipoAlbum: normalizeText(body.tipoAlbum) || "Álbum",
      modo,
      dataInicioISO: new Date().toISOString(),
      dataLancamento,
      duracaoDias,
      tetoFinal,
      status: "ativa",
      faixas,
      missoes,
      albumTopicId,
      codigoUnicoAlbum: "",
      encartesUrls: (body.encartesUrls || []).filter(Boolean),
      criadoEmISO: new Date().toISOString(),
      extraMaterialJson: body.extraMaterial ? JSON.stringify(body.extraMaterial) : "",
      _rowIndex: -1,
    };

    await appendCampanha(campanha);

    registrarLogSistema({
      categoria: "Ação concluída",
      oQueAconteceu: `Campanha de pre-save criada para "${albumTituloFull}" (modo ${modo}, lançamento em ${dataLancamento}).`,
      onde: "criarCampanhaPreSaveController",
    }).catch(() => {});

    return jsonResponse({ success: true, data: campanhaDoDono(campanha) });
  } catch (error: any) {
    console.error("[criarCampanhaPreSaveController] Erro:", error);
    return jsonResponse(
      { success: false, error: error.message || "Erro ao criar campanha de pre-save." },
      500,
    );
  }
}

// -------------------- CONSULTAR ESTADO/CALENDÁRIO --------------------

export async function getMinhasCampanhasPreSaveController(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const jogadorId = normalizeText(url.searchParams.get("jogadorId") || "");
    const campanhas = await readAllCampanhas();
    const minhas = jogadorId ? campanhas.filter((c) => c.jogadorId === jogadorId) : campanhas;
    // Persiste dias perdidos encontrados na leitura (best-effort).
    for (const c of minhas) {
      if (aplicarDiasPerdidos(c)) await writeCampanha(c).catch(() => {});
    }
    return jsonResponse({ success: true, data: minhas.map(campanhaDoDono) });
  } catch (error: any) {
    console.error("[getMinhasCampanhasPreSaveController] Erro:", error);
    return jsonResponse(
      { success: false, error: error.message || "Erro ao buscar campanhas." },
      500,
    );
  }
}

export async function getCampanhaPreSaveController(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const id = normalizeText(url.searchParams.get("id") || "");
    const campanhas = await readAllCampanhas();
    const c = campanhas.find((x) => x.id === id);
    if (!c) return jsonResponse({ success: false, error: "Campanha não encontrada." }, 404);
    if (aplicarDiasPerdidos(c)) await writeCampanha(c).catch(() => {});
    return jsonResponse({ success: true, data: campanhaDoDono(c) });
  } catch (error: any) {
    console.error("[getCampanhaPreSaveController] Erro:", error);
    return jsonResponse(
      { success: false, error: error.message || "Erro ao buscar campanha." },
      500,
    );
  }
}

// -------------------- DIAGNÓSTICO / REPARO DO TETO --------------------
//
// Criado pra investigar o relato real de contador travado em 0 (campanhas
// do Max Gorghan e do Cowboy Fresh). Hipótese confirmada por raciocínio
// de código (não consigo ler a planilha de produção direto desta sessão
// — sem credenciais do Google Service Account configuradas aqui): o teto
// (tetoFinal) é calculado UMA VEZ, na criação da campanha, e persistido —
// nunca recalculado depois. getMelhorValTotalArtista tinha um bug real
// (corrigido na mesma rodada desta investigação) que lia a aba SPOTIFY com
// um cap fixo ("A1:ZZ5000"), e essa aba acumula 20.000+ linhas cronológicas
// desde 2020 — qualquer artista cujas linhas recentes ficassem depois da
// linha 5000 tinha valTotal=0 computado, e portanto tetoFinal=0 GRAVADO
// PRA SEMPRE na campanha, mesmo com o fuso corrigido e missões completadas
// depois: 0 (teto) * qualquer coisa = 0 (acumulado). Isso explicaria tanto
// o caso com missão (Max Gorghan) quanto o sem missão (Cowboy Fresh) com a
// MESMA causa raiz, já que os dois dependem do mesmo cálculo de teto.
//
// GET /api/presave/auditoria-lancamentos — só leitura, nunca escreve nada.
// Pedido explícito depois do bug real do Max Gorghan/FOLLIA (álbum
// publicado ~10 dias antes da dataLancamento combinada): lista TODA
// campanha (ativa OU já lançada) junto com dataLancamento, status e
// "hoje" (Brasília), marcando `suspeita` quando o status não combina com
// a data — "lancada" com dataLancamento ainda no futuro (lançou antes da
// hora) ou "ativa" com dataLancamento já formatada errado (não bate
// com YYYY-MM-DD, o mesmo jeito que causou o bug). Não decide nem corrige
// nada sozinho — só reúne a evidência real pra decisão humana.
export async function auditoriaLancamentosPreSavecontroller(): Promise<Response> {
  try {
    const campanhas = await readAllCampanhas();
    const hojeStr = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
    const DATA_ISO_REGEX = /^\d{4}-\d{2}-\d{2}$/;
    const linhas = campanhas.map((c) => {
      const dataValida = DATA_ISO_REGEX.test(c.dataLancamento);
      const lancadaAntesDaHora =
        c.status === "lancada" && dataValida && c.dataLancamento > hojeStr;
      const dataInvalida = !dataValida && !!c.dataLancamento;
      return {
        id: c.id,
        artista: c.artista,
        albumTituloFull: c.albumTituloFull,
        status: c.status,
        dataLancamento: c.dataLancamento,
        rowIndex: c._rowIndex,
        suspeita: lancadaAntesDaHora
          ? "lancada_antes_da_hora"
          : dataInvalida
            ? "data_formato_invalido"
            : null,
      };
    });
    return jsonResponse({
      success: true,
      hoje: hojeStr,
      total: linhas.length,
      suspeitas: linhas.filter((l) => l.suspeita),
      todas: linhas,
    });
  } catch (error: any) {
    return jsonResponse(
      { success: false, error: error.message || "Erro na auditoria de lançamentos." },
      500,
    );
  }
}

// GET /api/presave/diagnostico?id=... — devolve o estado real armazenado
// (sem nunca expor o teto na resposta pública de outros endpoints, mas
// aqui É o propósito: diagnosticar o problema do teto) + o valTotal/teto
// que SERIAM calculados agora com o bug já corrigido, pra comparar.
export async function getDiagnosticoTetoPreSaveController(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const id = normalizeText(url.searchParams.get("id") || "");
    const campanhas = await readAllCampanhas();
    const c = campanhas.find((x) => x.id === id);
    if (!c) return jsonResponse({ success: false, error: "Campanha não encontrada." }, 404);
    const recalculo = await calcularTetos(c.artista);
    return jsonResponse({
      success: true,
      data: {
        id: c.id,
        artista: c.artista,
        modo: c.modo,
        status: c.status,
        tetoFinalArmazenado: c.tetoFinal,
        acumuladoCalculadoAgora: Math.round(calcularAcumulado(c)),
        valTotalRecalculadoAgora: recalculo.valTotal,
        tetoQueSeriaCalculadoAgora:
          c.modo === "missao" ? recalculo.tetoMissao : recalculo.tetoContagem,
        missoes: c.modo === "missao" ? c.missoes : undefined,
        diaCampanhaAtual: diaCampanhaAtual(c),
        dataInicioISO: c.dataInicioISO,
      },
    });
  } catch (error: any) {
    return jsonResponse(
      { success: false, error: error.message || "Erro ao diagnosticar campanha." },
      500,
    );
  }
}

// POST /api/presave/recalcular-teto { campanhaId } — só reescreve
// tetoFinal quando o valor ARMAZENADO parece quebrado (nunca sobrescreve
// um teto já calculado de verdade) e o recálculo (com o bug do cap já
// corrigido) dá um valor plausível. Nunca muda o acumulado já registrado
// em missões completadas — só desbloqueia o cálculo de acumulado parar de
// multiplicar por um teto zerado/corrompido.
//
// "Parece quebrado" NÃO é só "=== 0" — bug real confirmado em produção: o
// valor gravado podia ser uma STRING corrompida por reinterpretação de
// locale (ex: célula virou texto "1.804.278.114" em vez do número
// 1804278; ver comentário em campanhaToRow) — ao reler essa célula,
// parseFloat("1.804.278.114") para no segundo ponto e devolve 1.804, não
// NaN e não 0, mas um número minúsculo e claramente errado (nenhum teto
// real fica abaixo de milhares, já que é 0,3% de um valTotal de milhões).
// Por isso o limiar de reparo é "< 1000", não "=== 0".
const TETO_MINIMO_PLAUSIVEL = 1000;

export async function recalcularTetoPreSaveController(request: Request): Promise<Response> {
  try {
    const params = await readParamsBodyOrQuery(request);
    const campanhaId = normalizeText(params.campanhaId);
    const campanhas = await readAllCampanhas();
    const c = campanhas.find((x) => x.id === campanhaId);
    if (!c) return jsonResponse({ success: false, error: "Campanha não encontrada." }, 404);
    if (Number.isFinite(c.tetoFinal) && c.tetoFinal >= TETO_MINIMO_PLAUSIVEL) {
      return jsonResponse({
        success: false,
        error: `Essa campanha já tem um teto armazenado plausível (${c.tetoFinal}) — não parece esse bug. Não sobrescrevi nada.`,
      });
    }
    const recalculo = await calcularTetos(c.artista);
    const novoTeto = Math.round(
      c.modo === "missao" ? recalculo.tetoMissao : recalculo.tetoContagem,
    );
    if (novoTeto < TETO_MINIMO_PLAUSIVEL) {
      return jsonResponse({
        success: false,
        error: `Recalculei e o teto ainda saiu baixo/0 (${novoTeto}, valTotal=${recalculo.valTotal}) — o artista "${c.artista}" realmente não tem música encontrada no chart SPOTIFY agora. Não é o bug do cap/locale; precisa investigar o cruzamento de nome do artista.`,
      });
    }
    const tetoAnterior = c.tetoFinal;
    c.tetoFinal = novoTeto;
    await writeCampanha(c);
    registrarLogSistema({
      categoria: "Ação concluída",
      oQueAconteceu: `Teto da campanha de pre-save "${c.albumTituloFull}" recalculado de ${tetoAnterior} pra ${novoTeto} (valTotal=${recalculo.valTotal}) — reparo do bug do cap fixo em SPOTIFY/corrupção de locale.`,
      onde: "recalcularTetoPreSaveController",
    }).catch(() => {});
    return jsonResponse({
      success: true,
      data: {
        tetoAnterior,
        tetoNovo: novoTeto,
        valTotal: recalculo.valTotal,
        acumuladoAgora: Math.round(calcularAcumulado(c)),
      },
    });
  } catch (error: any) {
    return jsonResponse(
      { success: false, error: error.message || "Erro ao recalcular teto." },
      500,
    );
  }
}

// POST (ou GET, mesmo motivo dos endpoints acima) /api/presave/compensar-maximo-retroativo
// { campanhaId } — reparo retroativo APROVADO EXPLICITAMENTE pelo
// coordenador/usuário, só pra campanhas modo "missao": marca como
// "completa" (com dados.compensacao=true) todo dia de missão que estava
// "perdida" (ou "pendente" com data já passada, mesmo efeito) — ou seja,
// todo dia perdido por causa dos bugs de fuso/cap/teto já corrigidos (não
// por o jogador simplesmente não ter postado nada) recebe o crédito
// máximo retroativo. Só altera o status/dados da missão (nunca o peso,
// nunca o teto, nunca o dia em si) — a fórmula de cálculo
// (calcularAcumulado/valoresPorDia) já sabe somar "completa" normalmente,
// então não precisa de nenhum campo novo. Idempotente: já marcada
// "completa" fica como está; dia ainda "pendente" com data futura (ainda
// não chegou a vez) não é tocado.
export async function compensarMaximoRetroativoPreSaveController(
  request: Request,
): Promise<Response> {
  try {
    const params = await readParamsBodyOrQuery(request);
    const campanhaId = normalizeText(params.campanhaId);
    const campanhas = await readAllCampanhas();
    const c = campanhas.find((x) => x.id === campanhaId);
    if (!c) return jsonResponse({ success: false, error: "Campanha não encontrada." }, 404);
    if (c.modo !== "missao") {
      return jsonResponse({
        success: false,
        error: `Campanha "${c.id}" é modo "${c.modo}", não "missao" — compensação retroativa só existe pra modo missão (modo contagem já acumula automaticamente todo dia, sem depender de missão nenhuma).`,
      });
    }
    aplicarDiasPerdidos(c); // garante que todo dia vencido sem ação já virou "perdida" antes de compensar
    const acumuladoAntes = Math.round(calcularAcumulado(c));
    const agora = new Date().toISOString();
    let diasCompensados = 0;
    for (const m of c.missoes) {
      if (m.status === "perdida") {
        m.status = "completa";
        m.completadoEm = agora;
        m.dados = {
          compensacao: true,
          motivo:
            "Compensação retroativa máxima — dia perdido por bug já corrigido (fuso/cap do chart/corrupção de teto), aprovado explicitamente pelo coordenador/usuário.",
        };
        diasCompensados++;
      }
    }
    if (diasCompensados === 0) {
      return jsonResponse({
        success: true,
        data: { diasCompensados: 0, acumuladoAntes, acumuladoDepois: acumuladoAntes },
        aviso: "Nenhum dia 'perdida' encontrado pra compensar — nada foi alterado.",
      });
    }
    await writeCampanha(c);
    const acumuladoDepois = Math.round(calcularAcumulado(c));
    registrarLogSistema({
      categoria: "Ação concluída",
      oQueAconteceu: `Compensação retroativa máxima aplicada na campanha de pre-save "${c.albumTituloFull}" (${c.id}): ${diasCompensados} dia(s) perdido(s) marcado(s) como completo(s). Acumulado foi de ${acumuladoAntes} pra ${acumuladoDepois}.`,
      onde: "compensarMaximoRetroativoPreSaveController",
    }).catch(() => {});
    return jsonResponse({
      success: true,
      data: { diasCompensados, acumuladoAntes, acumuladoDepois },
    });
  } catch (error: any) {
    return jsonResponse(
      { success: false, error: error.message || "Erro ao compensar retroativamente." },
      500,
    );
  }
}

// POST /api/presave/vincular-faixa-existente { campanhaId, faixaNum, tituloMusicaExistente }
// Reparo pontual + genérico pra um bug real de produção: o jogador do Max
// Gorghan cadastrou "Follia" (faixa #2 da campanha PRESAVE-7da5f189) como
// inédita com mediaUrl="-" (placeholder), porque na hora de criar a
// campanha a busca de "Música Existente" tinha o bug do cap fixo do
// SPOTIFY (já corrigido) e não achava "Max Gorghan - Follia", mesmo ela
// já sendo uma música real e ativa no chart. Esse endpoint corrige QUALQUER
// faixa nessa mesma situação (não hardcoded só pra Follia): troca
// inedita=true/mediaUrl placeholder pra inedita=false, titulo = o título
// real da música existente (mesmo formato que outras faixas vinculadas já
// usam, ex: faixa #8 "Fuori Rotta" na mesma campanha) — sem precisar subir
// áudio nenhum, porque faixa existente nunca precisa de mediaUrl próprio.
export async function vincularFaixaExistentePreSaveController(request: Request): Promise<Response> {
  try {
    const params = await readParamsBodyOrQuery(request);
    const campanhaId = normalizeText(params.campanhaId);
    const faixaNum = Number(params.faixaNum);
    const tituloMusicaExistente = normalizeText(params.tituloMusicaExistente);
    if (!campanhaId || !faixaNum || !tituloMusicaExistente) {
      return jsonResponse(
        { success: false, error: "campanhaId, faixaNum e tituloMusicaExistente são obrigatórios." },
        400,
      );
    }
    const campanhas = await readAllCampanhas();
    const c = campanhas.find((x) => x.id === campanhaId);
    if (!c) return jsonResponse({ success: false, error: "Campanha não encontrada." }, 404);
    const faixa = c.faixas.find((f) => f.num === faixaNum);
    if (!faixa)
      return jsonResponse(
        { success: false, error: `Faixa #${faixaNum} não encontrada nessa campanha.` },
        404,
      );

    const faixaAntes = { ...faixa };
    faixa.inedita = false;
    faixa.titulo = tituloMusicaExistente;
    faixa.mediaUrl = undefined;
    faixa.tipoSingle = undefined;
    faixa.tipoMusica = undefined;
    faixa.letra = undefined;
    faixa.abrirTopico = undefined;
    // Faixa existente nunca fica "oculta" (Track N) — já é conhecida,
    // sempre nasce revelada, igual as outras faixas existentes da mesma
    // campanha (ex: "Fuori Rotta").
    faixa.mostrarNomeReal = true;
    faixa.revelada = true;

    await writeCampanha(c);
    registrarLogSistema({
      categoria: "Ação concluída",
      oQueAconteceu: `Faixa #${faixaNum} da campanha de pre-save "${c.albumTituloFull}" corrigida: era inédita (título "${faixaAntes.titulo}", mediaUrl "${faixaAntes.mediaUrl || ""}") e virou vinculada à música existente "${tituloMusicaExistente}" — bug do cap fixo do SPOTIFY impedia achar essa música na busca no momento da criação da campanha.`,
      onde: "vincularFaixaExistentePreSaveController",
    }).catch(() => {});

    return jsonResponse({ success: true, data: { faixaAntes, faixaDepois: faixa } });
  } catch (error: any) {
    return jsonResponse(
      { success: false, error: error.message || "Erro ao vincular faixa existente." },
      500,
    );
  }
}

// Edita nome/letra/instrumental de uma faixa já cadastrada na campanha —
// pedido explícito do usuário pra corrigir dados da tracklist sem precisar
// recriar a campanha inteira. Só o dono da campanha pode editar. Só faz
// sentido pra faixa INÉDITA (a letra/título de faixa já existente vem do
// cadastro real em Musicas, editado por lá — ver vincularFaixaExistentePreSaveController
// acima, que já zera esses campos ao vincular). Editar o título de uma
// faixa JÁ REVELADA é permitido (corrigir erro de digitação, por ex.), mas
// nunca MUDA o status de revelada — o nome só vira público pela missão
// tracklist_reveal normal se ainda estiver oculta.
export async function editarFaixaPreSavecontroller(request: Request): Promise<Response> {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      campanhaId?: string;
      jogadorId?: string;
      faixaNum?: number;
      titulo?: string;
      letra?: string;
      instrumental?: boolean;
    };
    const campanhaId = normalizeText(body.campanhaId);
    const faixaNum = Number(body.faixaNum);
    if (!campanhaId || !faixaNum) {
      return jsonResponse({ success: false, error: "campanhaId e faixaNum são obrigatórios." }, 400);
    }
    const campanhas = await readAllCampanhas();
    const c = campanhas.find((x) => x.id === campanhaId);
    if (!c) return jsonResponse({ success: false, error: "Campanha não encontrada." }, 404);
    if (normalizeText(body.jogadorId) !== c.jogadorId) {
      return jsonResponse(
        { success: false, error: "Só quem criou a campanha pode editar a tracklist." },
        403,
      );
    }
    const faixa = c.faixas.find((f) => f.num === faixaNum);
    if (!faixa)
      return jsonResponse(
        { success: false, error: `Faixa #${faixaNum} não encontrada nessa campanha.` },
        404,
      );
    if (!faixa.inedita) {
      return jsonResponse(
        {
          success: false,
          error: "Essa faixa já existe no catálogo — edite o título/letra dela em Fórum > Músicas.",
        },
        400,
      );
    }

    if (body.titulo !== undefined) {
      const tituloLimpo = normalizeText(body.titulo);
      if (!tituloLimpo) return jsonResponse({ success: false, error: "Título não pode ficar vazio." }, 400);
      faixa.titulo = tituloLimpo;
    }
    if (body.instrumental !== undefined) {
      faixa.instrumental = !!body.instrumental;
      // Instrumental e letra são mutuamente exclusivos — marcar uma música
      // como instrumental some com qualquer letra salva antes.
      if (faixa.instrumental) faixa.letra = undefined;
    }
    if (body.letra !== undefined && !faixa.instrumental) {
      const letraLimpa = normalizeText(body.letra);
      faixa.letra = letraLimpa || undefined;
    }

    await writeCampanha(c);
    registrarLogSistema({
      categoria: "Ação concluída",
      oQueAconteceu: `Faixa #${faixaNum} ("${faixa.titulo}") da campanha de pre-save "${c.albumTituloFull}" editada (título/letra/instrumental).`,
      onde: "editarFaixaPreSavecontroller",
    }).catch(() => {});

    return jsonResponse({ success: true, data: campanhaDoDono(c) });
  } catch (error: any) {
    console.error("[editarFaixaPreSavecontroller] Erro:", error);
    return jsonResponse({ success: false, error: error.message || "Erro ao editar faixa." }, 500);
  }
}

// Contador público (visível a todos) — usado na página do álbum e no
// banner da home. NUNCA inclui o teto.
export async function getContadorPublicoPreSaveController(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const albumTopicId = normalizeText(url.searchParams.get("albumTopicId") || "");
    const id = normalizeText(url.searchParams.get("id") || "");
    const campanhas = await readAllCampanhas();
    const c = campanhas.find(
      (x) => (albumTopicId && x.albumTopicId === albumTopicId) || (id && x.id === id),
    );
    if (!c) return jsonResponse({ success: false, error: "Campanha não encontrada." }, 404);
    return jsonResponse({ success: true, data: campanhaPublica(c) });
  } catch (error: any) {
    console.error("[getContadorPublicoPreSaveController] Erro:", error);
    return jsonResponse(
      { success: false, error: error.message || "Erro ao buscar contador." },
      500,
    );
  }
}

// Banner da Home — campanhas ativas (ainda não lançadas), mais recentes
// primeiro. Reaproveita o mesmo slot do spotlight banner do Market (ver
// SpotlightBannerCarousel.tsx) só como referência de padrão visual — é um
// componente próprio, não o mesmo carrossel.
export async function getCampanhasAtivasParaBannerController(): Promise<Response> {
  try {
    const campanhas = await readAllCampanhas();
    const ativas = campanhas
      .filter((c) => c.status === "ativa")
      .sort((a, b) => new Date(a.dataLancamento).getTime() - new Date(b.dataLancamento).getTime())
      .slice(0, 10);
    return jsonResponse({ success: true, data: ativas.map(campanhaPublica) });
  } catch (error: any) {
    console.error("[getCampanhasAtivasParaBannerController] Erro:", error);
    return jsonResponse(
      { success: false, error: error.message || "Erro ao buscar banners de pre-save." },
      500,
    );
  }
}

// Leaderboard histórico "mais pre-saves da história" — soma o acumulado de
// TODAS as campanhas (ativas + já lançadas) por artista. Cancelada não
// conta. Nunca expõe teto (campanhaPublica já cuida disso).
export async function getLeaderboardPreSaveController(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const limit = Math.min(50, parseInt(url.searchParams.get("limit") || "20", 10) || 20);
    const campanhas = await readAllCampanhas();
    const porArtista = new Map<string, { artista: string; total: number; campanhas: number }>();
    for (const c of campanhas) {
      if (c.status === "cancelada") continue;
      const acumulado = calcularAcumulado(c);
      const atual = porArtista.get(c.artista) || { artista: c.artista, total: 0, campanhas: 0 };
      atual.total += acumulado;
      atual.campanhas += 1;
      porArtista.set(c.artista, atual);
    }
    const ranking = [...porArtista.values()]
      .sort((a, b) => b.total - a.total)
      .slice(0, limit)
      .map((r, i) => ({
        posicao: i + 1,
        artista: r.artista,
        totalPreSaves: Math.round(r.total),
        campanhas: r.campanhas,
      }));
    return jsonResponse({ success: true, data: ranking });
  } catch (error: any) {
    console.error("[getLeaderboardPreSaveController] Erro:", error);
    return jsonResponse(
      { success: false, error: error.message || "Erro ao montar leaderboard." },
      500,
    );
  }
}

// -------------------- COMPLETAR MISSÃO DO DIA --------------------

export interface CompletarMissaoPayload {
  campanhaId: string;
  dia: number;
  jogadorId: string;
  // Dados da missão — o que é obrigatório varia por tipo (ver
  // MISSOES_CATALOGO/validarEExecutarMissao):
  rede?: string; // rede do post social ("twitter" | "instagram" | "tiktok" | ...)
  texto?: string;
  mediaUrl?: string;
  // O front (GestaoPreSave.tsx) agora publica o post de verdade ANTES de
  // chamar esse endpoint — pelo mesmo composer/caminho real do Social
  // (<SocialPostComposer>, salvarPostSocial), com suporte a tudo que o
  // Social tem (Stories, múltiplas fotos, áudio, material anexado etc.),
  // em vez do mini-form simplificado antigo que só mandava texto+mediaUrl
  // pra esse endpoint recriar o post aqui. Quando essa flag vem true, NÃO
  // cria um segundo post (evita duplicar) — só confirma a missão.
  postJaPublicado?: boolean;
  perfilArtista?: string; // bastidores: nome do artista do perfil de "Tá na Mídia" escolhido (SOCIAL_PERFIS!A)
  faixaOrdemRevelada?: number; // tracklist_reveal: qual faixa revelar
  entrevista?: {
    titulo: string;
    capa?: string; // opcional — mesmo formato do cadastro de Entrevistas do Acervo
    perguntas: { pergunta: string; resposta: string }[];
    musicas: string[];
  };
  videoRealId?: string; // making_of_video, caminho "vídeo real via Fórum > Vídeos" (id de vídeo já cadastrado lá)
}

// Valida de verdade o caminho "vídeo real" da missão making_of_video:
// o videoId precisa existir em "Music Videos" (coluna F —
// message_thread_id, mesmo id gerado em createVideoController,
// gestaoController.ts) e pertencer ao artista da campanha. "Music Videos"
// não tem uma coluna de "dono" própria preenchida de verdade — o título
// (coluna B) é sempre gravado como "{artista} - {título}" (ver
// createVideoController), então a posse é confirmada por esse prefixo,
// igual o resto do app faz pra álbuns/faixas. Devolve a mensagem de erro,
// ou "" quando está tudo certo.
async function validarVideoRealPertenceAoArtista(
  videoId: string,
  artista: string,
): Promise<string> {
  const id = normalizeText(videoId);
  if (!id) return "Informe o vídeo cadastrado em Fórum > Vídeos.";
  const rows = await googleSheetsService.principal
    .readValues("Music Videos", "A1:T20000")
    .catch(() => []);
  if (!rows || rows.length < 2)
    return "Não foi possível conferir o cadastro de vídeos — tenta de novo.";
  const prefixoArtista = normalizeComparison(`${artista} - `);
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (normalizeText(row[5]) !== id) continue; // F — message_thread_id
    const titulo = normalizeComparison(row[1]); // B — título do tópico ("Artista - Título")
    if (!titulo.startsWith(prefixoArtista)) {
      return `Esse vídeo não pertence a "${artista}" — escolha um vídeo cadastrado por esse artista em Fórum > Vídeos.`;
    }
    return "";
  }
  return "Vídeo não encontrado em Fórum > Vídeos — cadastre-o lá antes de completar essa missão.";
}

async function validarEExecutarMissao(
  c: PreSaveCampanha,
  missao: PreSaveMissaoDia,
  payload: CompletarMissaoPayload,
): Promise<{ ok: true; dados?: unknown } | { ok: false; error: string }> {
  const tipo = missao.tipo as MissaoTipo;

  // Todo tipo, exceto "entrevista", acontece dentro de Gestão Pre save mas
  // publica de verdade em Social (createSocialPostController) — nunca
  // redireciona pro compositor nativo do Social, ainda que o resultado
  // final apareça lá (regra explícita do usuário).
  const postarSocial = async (redeForcada?: string) => {
    const rede = redeForcada || payload.rede;
    if (!rede) return { ok: false as const, error: "Escolha uma rede social para esse post." };
    // Post já publicado de verdade pelo front via <SocialPostComposer>
    // (mesmo caminho real do Social) — só confirma a missão, sem recriar o
    // post aqui (evitaria duplicar).
    if (payload.postJaPublicado) return { ok: true as const, dados: { rede } };
    if (!payload.texto?.trim() && !payload.mediaUrl) {
      return { ok: false as const, error: "Escreva um texto ou envie uma mídia para o post." };
    }
    const fakeRequest = new Request("https://internal.empire/api/social/posts", {
      method: "POST",
      body: JSON.stringify({
        tgId: payload.jogadorId || c.jogadorId,
        payload: JSON.stringify({
          tipo: rede,
          subtipo: "presave",
          autor: c.artista,
          texto: payload.texto || "",
          media_url: payload.mediaUrl || "",
          media_tipo: payload.mediaUrl ? "imagem" : undefined,
        }),
      }),
    });
    const resp = await createSocialPostController(fakeRequest);
    const data = (await resp.json().catch(() => ({ ok: false }))) as {
      ok?: boolean;
      error?: string;
    };
    if (!resp.ok || data.ok === false)
      return { ok: false as const, error: data.error || "Falha ao publicar o post." };
    return { ok: true as const, dados: { rede } };
  };

  switch (tipo) {
    case "post_anuncio":
    case "capa_alternativa":
    case "trecho_letra":
    case "enquete_fas":
    case "countdown_marco":
      return postarSocial();

    case "desafio_som":
      // Exclusivo de TikTok — nenhuma outra rede permitida.
      return postarSocial("tiktok");

    case "making_of_video": {
      // Dois caminhos possíveis: (a) post exclusivo de TikTok, ou (b) vídeo
      // real via Fórum > Vídeos (o jogador já cadastrou lá antes de
      // completar essa missão aqui) — nesse 2º caminho, valida de verdade
      // contra "Music Videos" (gestaoController.ts/createVideoController):
      // o vídeo precisa existir (coluna F = message_thread_id) e pertencer
      // ao artista da campanha.
      if (payload.videoRealId) {
        const erro = await validarVideoRealPertenceAoArtista(payload.videoRealId, c.artista);
        if (erro) return { ok: false, error: erro };
        return { ok: true, dados: { caminho: "video_real", videoId: payload.videoRealId } };
      }
      return postarSocial("tiktok");
    }

    case "bastidores": {
      // DEVE ser publicado através de um perfil de SOCIAL_PERFIS/"Tá na
      // Mídia" disponível pro jogador — mesma lista que social.tsx mostra
      // em viewMode === "Midia" (perfisPublicos: linhas com
      // telegram_id="Todos", uma por artista) mais os próprios artistas do
      // jogador (telegram_id === jogadorId). O front replica essa mesma
      // lista visual (ver GestaoPreSave.tsx); aqui só confirma de verdade
      // que o nome escolhido corresponde a um perfil de verdade disponível
      // — nunca confia só num ID de texto solto digitado à mão.
      const perfilArtista = normalizeComparison(payload.perfilArtista);
      if (!perfilArtista) {
        return {
          ok: false,
          error: 'Escolha um perfil de "Tá na Mídia" para publicar os bastidores.',
        };
      }
      const jogadorIdAlvo = normalizeText(payload.jogadorId || c.jogadorId);
      const perfisRows = await googleSheetsService.usuarios
        .readValues("SOCIAL_PERFIS", "A1:H20000")
        .catch(() => []);
      const disponivel = (perfisRows || []).slice(1).some((row) => {
        const artista = normalizeComparison(row[0]);
        if (artista !== perfilArtista) return false;
        const telegramId = normalizeComparison(row[5]);
        return telegramId === "todos" || telegramId === normalizeComparison(jogadorIdAlvo);
      });
      if (!disponivel) {
        return { ok: false, error: "Esse perfil não está disponível para publicar bastidores." };
      }
      const resultado = await postarSocial();
      if (!resultado.ok) return resultado;
      return {
        ok: true,
        dados: { ...(resultado.dados as object), perfilArtista: payload.perfilArtista },
      };
    }

    case "tracklist_reveal": {
      const num = payload.faixaOrdemRevelada;
      const faixa = c.faixas.find((f) => f.num === num);
      if (!faixa) return { ok: false, error: "Escolha uma faixa oculta válida para revelar." };
      if (faixa.revelada) return { ok: false, error: "Essa faixa já foi revelada." };
      const resultado = await postarSocial();
      if (!resultado.ok) return resultado;
      faixa.revelada = true;
      faixa.mostrarNomeReal = true;
      return { ok: true, dados: { faixaNum: faixa.num, titulo: faixa.titulo } };
    }

    case "entrevista": {
      const entrevista = payload.entrevista;
      if (
        !entrevista?.titulo?.trim() ||
        !entrevista.perguntas?.length ||
        !entrevista.musicas?.length
      ) {
        return {
          ok: false,
          error: "Preencha título, ao menos 1 pergunta/resposta e ao menos 1 música da entrevista.",
        };
      }
      const fakeRequest = new Request("https://internal.empire/api/acervo/entrevistas", {
        method: "POST",
        body: JSON.stringify({
          artista: c.artista,
          titulo: entrevista.titulo,
          capa: entrevista.capa || c.capaUrl,
          perguntas: entrevista.perguntas,
          musicas: entrevista.musicas,
          tgId: payload.jogadorId || c.jogadorId,
        }),
      });
      const resp = await createAcervoEntrevistaController(fakeRequest);
      const data = (await resp.json().catch(() => ({ ok: false }))) as {
        ok?: boolean;
        error?: string;
      };
      if (!resp.ok || data.ok === false)
        return { ok: false, error: data.error || "Falha ao cadastrar a entrevista." };
      return { ok: true, dados: { entrevistaTitulo: entrevista.titulo } };
    }

    default:
      return { ok: false, error: "Tipo de missão inválido." };
  }
}

export async function completarMissaoPreSaveController(request: Request): Promise<Response> {
  try {
    // dryRun (só GET, só pra investigar via admin-call.yml) — roda a MESMA
    // validação de ponta a ponta sem persistir nada, pra descobrir qual
    // checagem está barrando um jogador sem arriscar completar a missão
    // dele sem querer (admin-call.yml não manda corpo POST, só querystring).
    const url = new URL(request.url);
    const dryRun = url.searchParams.get("dryRun") === "1";
    const body: CompletarMissaoPayload = dryRun
      ? {
          campanhaId: url.searchParams.get("campanhaId") || "",
          dia: Number(url.searchParams.get("dia") || 0),
          jogadorId: url.searchParams.get("jogadorId") || "",
          rede: url.searchParams.get("rede") || "instagram",
          postJaPublicado: true,
          faixaOrdemRevelada: url.searchParams.get("faixaOrdemRevelada")
            ? Number(url.searchParams.get("faixaOrdemRevelada"))
            : undefined,
          perfilArtista: url.searchParams.get("perfilArtista") || undefined,
        }
      : ((await request.json().catch(() => ({}))) as CompletarMissaoPayload);
    const campanhaId = normalizeText(body.campanhaId);
    const dia = Number(body.dia);
    if (!campanhaId || !dia)
      return jsonResponse({ success: false, error: "Campanha e dia são obrigatórios." }, 400);

    const campanhas = await readAllCampanhas();
    const c = campanhas.find((x) => x.id === campanhaId);
    if (!c) return jsonResponse({ success: false, error: "Campanha não encontrada." }, 404);
    if (c.status !== "ativa")
      return jsonResponse({ success: false, error: "Essa campanha não está mais ativa." }, 400);
    if (c.modo !== "missao")
      return jsonResponse(
        { success: false, error: "Essa campanha não tem missões (modo contagem)." },
        400,
      );

    aplicarDiasPerdidos(c);

    const missao = c.missoes.find((m) => m.dia === dia);
    if (!missao || !missao.tipo)
      return jsonResponse({ success: false, error: "Esse dia não tem missão agendada." }, 400);
    // Travado no dia exato — igual Tour, sem flexibilidade de antecipar ou
    // remarcar. Só pode completar a missão do dia atual do calendário
    // (dia-calendário em Brasília — ver diaCampanhaAtual).
    const hojeIndex = diaCampanhaAtual(c);
    if (dia !== hojeIndex) {
      return jsonResponse(
        {
          success: false,
          error: "Essa missão só pode ser completada no dia exato em que está agendada.",
        },
        400,
      );
    }
    if (missao.status === "completa")
      return jsonResponse({ success: false, error: "Essa missão já foi completada." }, 400);
    if (missao.status === "perdida")
      return jsonResponse(
        { success: false, error: "Esse dia já passou — a missão foi perdida (sem reposição)." },
        400,
      );

    const resultado = await validarEExecutarMissao(c, missao, body);
    if (!resultado.ok) return jsonResponse({ success: false, error: resultado.error, dryRun }, 400);

    if (dryRun) {
      return jsonResponse({ success: true, dryRun: true, passaria: true, dados: resultado.dados });
    }

    missao.status = "completa";
    missao.completadoEm = new Date().toISOString();
    missao.dados = resultado.dados;

    await writeCampanha(c);

    registrarLogSistema({
      categoria: "Ação concluída",
      oQueAconteceu: `Missão "${missao.tipo}" (dia ${dia}) completada na campanha de pre-save "${c.albumTituloFull}".`,
      onde: "completarMissaoPreSaveController",
    }).catch(() => {});

    return jsonResponse({ success: true, data: campanhaDoDono(c) });
  } catch (error: any) {
    console.error("[completarMissaoPreSaveController] Erro:", error);
    return jsonResponse(
      { success: false, error: error.message || "Erro ao completar missão." },
      500,
    );
  }
}

// -------------------- CANCELAR CAMPANHA --------------------

export async function cancelarCampanhaPreSaveController(request: Request): Promise<Response> {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      campanhaId?: string;
      jogadorId?: string;
    };
    const campanhaId = normalizeText(body.campanhaId);
    const campanhas = await readAllCampanhas();
    const c = campanhas.find((x) => x.id === campanhaId);
    if (!c) return jsonResponse({ success: false, error: "Campanha não encontrada." }, 404);
    if (normalizeText(body.jogadorId) !== c.jogadorId) {
      return jsonResponse(
        { success: false, error: "Só quem criou a campanha pode cancelá-la." },
        403,
      );
    }
    if (c.status !== "ativa")
      return jsonResponse({ success: false, error: "Essa campanha não está mais ativa." }, 400);
    c.status = "cancelada";
    await writeCampanha(c);
    return jsonResponse({ success: true });
  } catch (error: any) {
    console.error("[cancelarCampanhaPreSaveController] Erro:", error);
    return jsonResponse(
      { success: false, error: error.message || "Erro ao cancelar campanha." },
      500,
    );
  }
}

// -------------------- LANÇAMENTO NO DIA D (hook do cron) --------------------

// Chamado pelo scheduled() do worker (src/server.ts), a cada ciclo do cron
// existente (10 min) — encontra campanhas "ativa" cuja dataLancamento já
// chegou e lança o álbum de verdade, reaproveitando publicarAlbum
// (gestaoController.ts) pra não duplicar lógica nenhuma do lançamento
// normal. Nunca lança excessão pra fora — cada falha individual só fica
// registrada no LOGS didático, sem travar as demais campanhas do lote.
export async function processarLancamentosPreSaveScheduled(): Promise<{
  lancados: number;
  falhas: number;
}> {
  let lancados = 0;
  let falhas = 0;
  try {
    const campanhas = await readAllCampanhas();
    const hojeStr = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }); // YYYY-MM-DD
    // Bug real confirmado em produção: álbum publicado ~10 dias antes da
    // data combinada (Max Gorghan/FOLLIA, PRESAVE-7da5f189) — a comparação
    // de string `c.dataLancamento <= hojeStr` confia ciegamente que
    // dataLancamento sempre vem no formato certo "YYYY-MM-DD". Se por
    // QUALQUER motivo (leitura caindo pro fallback GViz, célula
    // temporariamente corrompida, linha desalinhada etc. — mesma classe
    // de bug já vista na corrupção dessa mesma coluna) o valor lido vier
    // vazio ("") ou num formato que não seja data, a comparação lexical
    // podia dar falso positivo (string vazia é "menor" que qualquer data,
    // por exemplo) e lançar o álbum achando que o dia já passou. Fix:
    // NUNCA lança uma campanha cuja dataLancamento não bata exatamente
    // com o formato esperado — trata "formato inválido" como "ainda não
    // é dia de lançar" (falha segura, nunca o oposto) e registra no LOGS
    // didático pra alguém notar, em vez de arriscar lançar antes da hora.
    const DATA_ISO_REGEX = /^\d{4}-\d{2}-\d{2}$/;
    for (const c of campanhas) {
      if (c.status === "ativa" && c.dataLancamento && !DATA_ISO_REGEX.test(c.dataLancamento)) {
        falhas++;
        registrarLogSistema({
          categoria: "Erro do app",
          oQueAconteceu: `Campanha de pre-save "${c.albumTituloFull}" (${c.id}) tem dataLancamento num formato inesperado ("${c.dataLancamento}", esperado YYYY-MM-DD) — NÃO lancei por segurança (evita repetir o bug do álbum lançado antes da hora). Confira a célula J da linha ${c._rowIndex} de "PreSave_Album".`,
          onde: "processarLancamentosPreSaveScheduled",
        }).catch(() => {});
      }
    }
    const paraLancar = campanhas.filter(
      (c) =>
        c.status === "ativa" &&
        DATA_ISO_REGEX.test(c.dataLancamento) &&
        c.dataLancamento <= hojeStr,
    );

    for (const c of paraLancar) {
      try {
        // BUG REAL confirmado em produção (Max Gorghan, "Follia", lançou 4
        // vezes no mesmo dia D): nada aqui impedia duas execuções do cron
        // (rodando a cada 10min, mas que pode sobrepor se uma invocação
        // demorar mais que isso, ou disparar de novo antes da anterior
        // terminar) de lerem a MESMA campanha como "ativa" e publicarem o
        // álbum duas (ou mais) vezes em paralelo — o status só virava
        // "lancada" no FIM do processamento (linha ~1875, bem depois de
        // publicarAlbum já ter rodado), quando já era tarde demais pra
        // impedir a segunda cópia. withWriteLock trava por campanha
        // (chave própria, D1) ANTES de publicar, e TTL generoso (5min,
        // cobre o publicarAlbum inteiro — o TTL padrão de 20s é curto
        // demais pra isso, pensado pra round-trips rápidos de Sheets).
        // Dentro da trava, relê o status direto da planilha — se outra
        // execução já lançou essa campanha enquanto esperava a trava
        // liberar, pula sem publicar de novo.
        const lancou = await withWriteLock(
          `presave:lancamento:${c.id}`,
          async () => {
            const statusAtual = await googleSheetsService.principal
              .readValues(PRESAVE_SHEET, `M${c._rowIndex}:M${c._rowIndex}`)
              .catch(() => []);
            // Coluna M (índice 12, 0-based) = "Status" — ver campanhaToRow/
            // rowToCampanha acima; confirmado lendo o mapeamento real, não
            // assumido.
            const statusJaMudou = normalizeComparison(statusAtual?.[0]?.[0] || "") !== "ativa";
            if (statusJaMudou) {
              return false; // outra execução concorrente já lançou essa campanha
            }
            await lancarCampanhaPreSave(c);
            return true;
          },
          { ttlMs: 5 * 60_000 },
        );
        if (lancou) lancados++;
      } catch (err: any) {
        falhas++;
        console.error(
          `[processarLancamentosPreSaveScheduled] Falha ao lançar campanha ${c.id}:`,
          err,
        );
        registrarLogSistema({
          categoria: "Falha de escrita",
          oQueAconteceu: `Falha ao lançar automaticamente o pre-save de "${c.albumTituloFull}": ${err?.message || err}`,
          onde: "processarLancamentosPreSaveScheduled",
        }).catch(() => {});
      }
    }
  } catch (err) {
    console.error("[processarLancamentosPreSaveScheduled] Erro geral:", err);
  }
  return { lancados, falhas };
}

// Extraído de dentro do loop de processarLancamentosPreSaveScheduled —
// roda inteiro dentro da trava por campanha (ver acima), nunca chamado
// direto de outro lugar.
async function lancarCampanhaPreSave(c: PreSaveCampanha): Promise<void> {
  aplicarDiasPerdidos(c);
    const acumuladoFinal = calcularAcumulado(c);

        // Só faixas INÉDITAS entram no payload de lançamento — faixa já
        // existente (inedita=false) já está nos charts/catálogo de antes e
        // continua como está (mesma regra do lançamento normal de álbum,
        // ver publicarAlbum/processarFaixasDoAlbum). O título real já é o
        // que foi coletado na criação da campanha (nunca "Track N" — esse
        // nome oculto é só de exibição pré-lançamento, ver campanhaDoDono/
        // front; o backend sempre guarda o título real).
        // Faixa inédita SEM áudio até o dia D (permitido na criação da
        // campanha — ver criarCampanhaPreSaveController — já que o jogador
        // pode cadastrar sem o áudio final ainda pronto) não pode virar um
        // lançamento "mudo" silencioso: fica de fora do payload de
        // lançamento (não publica faixa sem áudio nenhum) e é registrada
        // no LOGS didático pra alguém notar e completar depois (mesma
        // degradação que publicarAlbum já usa pra faixa que falha ao
        // gravar — nunca trava o álbum inteiro por causa de 1 faixa).
        const faixasSemAudio = c.faixas.filter((f) => f.inedita && !normalizeText(f.mediaUrl));
        const faixasPayload: TrackItemPayload[] = c.faixas
          .filter((f) => f.inedita && normalizeText(f.mediaUrl))
          .map((f) => ({
            num: f.num,
            inedita: true,
            titulo: f.titulo,
            tipoSingle: f.tipoSingle,
            tipoMusica: f.tipoMusica,
            participantes: f.participantes,
            mediaUrl: f.mediaUrl,
            letra: f.letra,
            abrirTopico: f.abrirTopico,
          }));

        if (faixasSemAudio.length > 0) {
          registrarLogSistema({
            categoria: "Falha de escrita",
            oQueAconteceu: `Pre-save de "${c.albumTituloFull}" lançado no dia D, mas ${faixasSemAudio.length} faixa(s) sem áudio ficaram de fora: ${faixasSemAudio.map((f) => f.titulo).join(", ")}. Suba o áudio e publique essas faixas manualmente (faixa pendente) depois.`,
            onde: "processarLancamentosPreSaveScheduled",
          }).catch(() => {});
        }

        const resultado = await publicarAlbum({
          tituloAlbum: c.albumTituloFull.startsWith(`${c.artista} - `)
            ? c.albumTituloFull.slice(c.artista.length + 3)
            : c.albumTituloFull,
          artistaAlbum: c.artista,
          tipoAlbum: c.tipoAlbum,
          capaUrl: c.capaUrl,
          encartesUrls: c.encartesUrls,
          nomeJogador: c.jogadorNome,
          jogadorId: c.jogadorId,
          faixas: faixasPayload,
        });

        // Material extra (Shop/Info/Visual) coletado na criação da
        // campanha só pode ser salvo agora, com o Código único real em
        // mãos (mesmo fluxo de handleSubmitAlbum em Gestao.tsx).
        if (c.extraMaterialJson && resultado.codigoUnico) {
          try {
            const extra = parseJsonSafe<{
              shopAtivo?: boolean;
              shop?: unknown[];
              infoAtivo?: boolean;
              info?: string;
              visualAtivo?: boolean;
              arte?: unknown[];
            }>(c.extraMaterialJson);
            if (extra && (extra.shopAtivo || extra.infoAtivo || extra.visualAtivo)) {
              const fakeRequest = new Request("https://internal.empire/api/gestao/extra", {
                method: "POST",
                body: JSON.stringify({
                  codigoUnico: resultado.codigoUnico,
                  tipo: "album",
                  shop: extra.shopAtivo ? extra.shop || [] : [],
                  info: extra.infoAtivo ? extra.info || "" : "",
                  arte: extra.visualAtivo ? extra.arte || [] : [],
                }),
              });
              await saveExtraMaterialController(fakeRequest);
            }
          } catch (err) {
            console.warn(
              "[processarLancamentosPreSaveScheduled] Falha ao salvar material extra:",
              err,
            );
          }
        }

        // Modo "missao": grava o valor final acumulado na coluna S
        // ("PRE-SAVE") da linha recém-criada em "EDIÇÃO CHARTS ÁLBUMS" —
        // a fórmula de Q já usa essa coluna (S2*3,33 quando C2=1). Modo
        // "contagem" NUNCA escreve nada em S (vanity puro, nunca afeta o
        // placar do álbum).
        if (c.modo === "missao" && resultado.codigoUnico) {
          try {
            const rows = await googleSheetsService.edicaoCharts.readValues(
              "EDIÇÃO CHARTS ÁLBUMS",
              "A1:T20000",
            );
            const header = rows[0] || [];
            // Confirma o índice real da coluna "PRE-SAVE" lendo o cabeçalho
            // em vez de assumir a posição 19 (S) às ciegas — se o usuário
            // mover a coluna, isso continua certo.
            let colIndex = header.findIndex(
              (h) => normalizeComparison(h) === "pre save" || normalizeComparison(h) === "presave",
            );
            if (colIndex < 0) colIndex = 18; // fallback: S = índice 18 (0-based), 19ª coluna
            const colLetra = String.fromCharCode(65 + colIndex);
            let linhaAlvo = -1;
            for (let i = 1; i < rows.length; i++) {
              if (
                normalizeComparison(rows[i]?.[17]) === normalizeComparison(resultado.codigoUnico)
              ) {
                linhaAlvo = i + 1;
                break;
              }
            }
            if (linhaAlvo > 0) {
              await googleSheetsService.edicaoCharts.updateValues(
                "EDIÇÃO CHARTS ÁLBUMS",
                `${colLetra}${linhaAlvo}:${colLetra}${linhaAlvo}`,
                [[String(Math.round(acumuladoFinal))]],
              );
            }
          } catch (err) {
            console.warn(
              "[processarLancamentosPreSaveScheduled] Falha ao gravar coluna PRE-SAVE:",
              err,
            );
          }
        }

  c.status = "lancada";
  c.codigoUnicoAlbum = resultado.codigoUnico || "";
  await writeCampanha(c);

  registrarLogSistema({
    categoria: "Ação concluída",
    oQueAconteceu: `Pre-save de "${c.albumTituloFull}" lançado automaticamente no dia D (modo ${c.modo}).`,
    onde: "processarLancamentosPreSaveScheduled",
  }).catch(() => {});
}

// -------------------- LOCK DE COMENTÁRIOS (pré-lançamento) --------------------

// Chamado por createCommentController (forumController.ts) antes de gravar
// QUALQUER comentário num tópico de álbum. O tópico de uma campanha de
// pre-save é criado (reservado) imediatamente ao iniciar a campanha, mas
// comentários ficam travados até o dia do lançamento de verdade — regra
// explícita do usuário. Não basta confiar em "o álbum ainda não existe em
// Albuns": o tópico já existe (foi reservado), então sem essa checagem
// explícita o comentário seria aceito mesmo assim (ou falharia de um jeito
// confuso lá na frente). Devolve null quando não há lock (sem campanha
// pre-save para esse topicId, ou campanha já "lancada"/"cancelada").
export async function getPreSaveLockParaTopico(
  albumTopicId: string,
): Promise<{ albumTituloFull: string; dataLancamento: string } | null> {
  const id = normalizeText(albumTopicId);
  if (!id) return null;
  try {
    const campanhas = await readAllCampanhas();
    const c = campanhas.find((x) => x.albumTopicId === id && x.status === "ativa");
    if (!c) return null;
    return { albumTituloFull: c.albumTituloFull, dataLancamento: c.dataLancamento };
  } catch (err) {
    console.warn("[getPreSaveLockParaTopico] Falha ao checar lock de pre-save:", err);
    // Em caso de falha de leitura, nunca bloqueia por engano — só não
    // trava um comentário que, na pior hipótese, já deveria estar liberado.
    return null;
  }
}
