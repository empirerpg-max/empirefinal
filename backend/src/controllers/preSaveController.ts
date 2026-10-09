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
// Colunas de "PreSave_Album" (A..T):
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
//  N FaixasJson       — [{ordem, tituloReal, mostrarNomeReal, jaLancada, revelada}]
//  O MissoesJson      — [{dia(1..duracao), tipo, peso, status: "pendente"|"completa"|"perdida", completadoEm, dados}]
//  P AlbumTopicId     — id do tópico criado imediatamente (comentários travados até o lançamento)
//  Q CodigoUnicoAlbum — preenchido só no dia do lançamento
//  R EncartesUrls     — join(", ")
//  S NomeJogadorExibicao (redundante com C, mantido por clareza em leituras manuais)
//  T CriadoEmISO
import {
  googleSheetsService,
  normalizeComparison,
  normalizeText,
} from "../services/googleSheetsService";
import { registrarLogSistema } from "../services/logSistemaService";
import { publicarAlbum } from "./gestaoController";
import { createAcervoEntrevistaController } from "./acervoController";
import { createSocialPostController } from "./socialController";

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

export interface PreSaveFaixa {
  ordem: number;
  tituloReal: string;
  mostrarNomeReal: boolean;
  jaLancada: boolean;
  revelada: boolean;
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
    _rowIndex: rowIndex,
  };
}

function campanhaToRow(c: PreSaveCampanha): string[] {
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
    String(c.duracaoDias),
    String(c.tetoFinal),
    c.status,
    JSON.stringify(c.faixas),
    JSON.stringify(c.missoes),
    c.albumTopicId,
    c.codigoUnicoAlbum,
    c.encartesUrls.join(", "),
    c.jogadorNome,
    c.criadoEmISO,
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
];

async function ensureHeader(): Promise<void> {
  const existing = await googleSheetsService.principal
    .readValues(PRESAVE_SHEET, "A1:T1")
    .catch(() => []);
  if (!existing || existing.length === 0 || !normalizeText(existing[0]?.[0])) {
    await googleSheetsService.principal.updateValues(PRESAVE_SHEET, "A1:T1", [HEADER]);
  }
}

async function readAllCampanhas(): Promise<PreSaveCampanha[]> {
  const rows = await googleSheetsService.principal
    .readValues(PRESAVE_SHEET, "A2:T20000")
    .catch(() => []);
  const out: PreSaveCampanha[] = [];
  for (let i = 0; i < (rows || []).length; i++) {
    const c = rowToCampanha(rows[i], i + 2);
    if (c) out.push(c);
  }
  return out;
}

async function writeCampanha(c: PreSaveCampanha): Promise<void> {
  await googleSheetsService.principal.updateValues(
    PRESAVE_SHEET,
    `A${c._rowIndex}:T${c._rowIndex}`,
    [campanhaToRow(c)],
  );
}

async function appendCampanha(c: PreSaveCampanha): Promise<number> {
  const rows = await googleSheetsService.principal
    .readValues(PRESAVE_SHEET, "A2:A20000")
    .catch(() => []);
  let ultimaLinha = 1;
  for (let i = 0; i < (rows || []).length; i++) {
    if (normalizeText(rows[i]?.[0])) ultimaLinha = i + 2;
  }
  const linhaAlvo = ultimaLinha + 1;
  c._rowIndex = linhaAlvo;
  await googleSheetsService.principal.updateValues(PRESAVE_SHEET, `A${linhaAlvo}:T${linhaAlvo}`, [
    campanhaToRow(c),
  ]);
  return linhaAlvo;
}

// ---- cálculo do teto (nunca exposto) ----

// Melhor (maior) valTotal do artista na aba SPOTIFY de chartsBase — base do
// cálculo do teto. Confirmado com o usuário: usa a música de melhor
// posição/mais recente do artista, lendo o valTotal (coluna F, total
// acumulado) e não o val semanal (coluna E).
async function getMelhorValTotalArtista(artista: string): Promise<number> {
  const rows = await googleSheetsService.chartsBase
    .readValues("SPOTIFY", "A1:ZZ5000")
    .catch(() => []);
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

// Progresso acumulado ATÉ AGORA (nunca o teto) — calculado a partir do
// estado persistido, sem precisar de cron por minuto:
// - modo "missao": soma (peso/100) * (teto/duracao) de cada dia já
//   completo. Dias "perdidos" (data já passou e não foi completado) não
//   contam nunca mais — sem fallback, de propósito.
// - modo "contagem": sobe linear e automático com o tempo decorrido,
//   sempre travado no teto reduzido (35%) no dia do lançamento.
export function calcularAcumulado(c: PreSaveCampanha): number {
  if (c.modo === "contagem") {
    const inicio = new Date(c.dataInicioISO).getTime();
    const agora = Date.now();
    const diasPassados = Math.max(0, (agora - inicio) / 86400000);
    const fracao = Math.min(1, diasPassados / c.duracaoDias);
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

// Marca como "perdida" (sem reposição) qualquer dia de missão cuja data já
// passou e que ainda estava "pendente" — chamado sempre que o estado é
// lido, pra manter o calendário honesto sem depender de um cron próprio.
function aplicarDiasPerdidos(c: PreSaveCampanha): boolean {
  if (c.modo !== "missao" || c.status !== "ativa") return false;
  const inicio = new Date(c.dataInicioISO).getTime();
  const hojeIndex = Math.floor((Date.now() - inicio) / 86400000) + 1; // dia 1 = dia da criação
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
  // Visão "contador público" — NUNCA inclui tetoFinal.
  return {
    id: c.id,
    artista: c.artista,
    albumTituloFull: c.albumTituloFull,
    capaUrl: c.capaUrl,
    modo: c.modo,
    dataLancamento: c.dataLancamento,
    status: c.status,
    albumTopicId: c.albumTopicId,
    acumuladoAtual: Math.round(calcularAcumulado(c)),
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
  };
}

// -------------------- CRIAR CAMPANHA --------------------

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
  faixas: { titulo: string; mostrarNomeReal: boolean; jaLancada: boolean }[];
  // modo "missao": mapa dia(1..duracao) -> tipo de missão (ou omitido/null = sem missão nesse dia)
  missoesPorDia?: Record<number, MissaoTipo | null>;
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

    await ensureHeader();

    const { tetoMissao, tetoContagem } = await calcularTetos(artista);
    const tetoFinal = modo === "missao" ? tetoMissao : tetoContagem;

    const albumArtistPrefix = `${artista} - `;
    const tituloLimpo = tituloAlbum.toLowerCase().startsWith(albumArtistPrefix.toLowerCase())
      ? tituloAlbum.slice(albumArtistPrefix.length).trim()
      : tituloAlbum;
    const albumTituloFull = `${artista} - ${tituloLimpo}`;

    const faixas: PreSaveFaixa[] = body.faixas.map((f, i) => ({
      ordem: i + 1,
      tituloReal: normalizeText(f.titulo) || `Track ${i + 1}`,
      mostrarNomeReal: !!f.mostrarNomeReal,
      jaLancada: !!f.jaLancada,
      revelada: !!f.mostrarNomeReal || !!f.jaLancada,
    }));

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
  perfilArtista?: string; // bastidores: nome do artista do perfil de "Tá na Mídia" escolhido (SOCIAL_PERFIS!A)
  faixaOrdemRevelada?: number; // tracklist_reveal: qual faixa revelar
  entrevista?: {
    titulo: string;
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
      const ordem = payload.faixaOrdemRevelada;
      const faixa = c.faixas.find((f) => f.ordem === ordem);
      if (!faixa) return { ok: false, error: "Escolha uma faixa oculta válida para revelar." };
      if (faixa.revelada) return { ok: false, error: "Essa faixa já foi revelada." };
      const resultado = await postarSocial();
      if (!resultado.ok) return resultado;
      faixa.revelada = true;
      faixa.mostrarNomeReal = true;
      return { ok: true, dados: { faixaOrdem: faixa.ordem, tituloReal: faixa.tituloReal } };
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
          capa: c.capaUrl,
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
    const body = (await request.json().catch(() => ({}))) as CompletarMissaoPayload;
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
    // remarcar. Só pode completar a missão do dia atual do calendário.
    const inicio = new Date(c.dataInicioISO).getTime();
    const hojeIndex = Math.floor((Date.now() - inicio) / 86400000) + 1;
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
    if (!resultado.ok) return jsonResponse({ success: false, error: resultado.error }, 400);

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
    const paraLancar = campanhas.filter((c) => c.status === "ativa" && c.dataLancamento <= hojeStr);

    for (const c of paraLancar) {
      try {
        aplicarDiasPerdidos(c);
        const acumuladoFinal = calcularAcumulado(c);

        const faixasPayload = c.faixas
          .filter((f) => !f.jaLancada)
          .map((f) => ({
            titulo: f.tituloReal,
            abrirTopico: true,
          }));

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
          faixas: faixasPayload as any,
        });

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
        lancados++;

        registrarLogSistema({
          categoria: "Ação concluída",
          oQueAconteceu: `Pre-save de "${c.albumTituloFull}" lançado automaticamente no dia D (modo ${c.modo}).`,
          onde: "processarLancamentosPreSaveScheduled",
        }).catch(() => {});
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
