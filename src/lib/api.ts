// Empire Hub — Apps Script API client
// Mantém Apps Script + Google Sheets como backend.

export const SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbwxbkUndhZPtFvtK1uIFTkPNN-m6WeiFVMU3IDzuahsC0oQp8Ba2GLQFOAPkWv8eiA3/exec";

// Empire TV usa um Apps Script separado (planilha Agenda_TV)
export const TV_SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycby7OeFYuai1QoTEXD427-Kn_2KBvh3nakD4iKSuOji9-i3x7sK8DD59BHRBRc5Ow1YB/exec";

export interface Artist {
  nome: string;
  foto: string;
  status: string;
  saldo: number;
  gravadora: string;
  fortuna_real: number;
  fortuna_bens: number;
  fortuna_total: number;
  prestigio: number;
  fadiga: number;
  seguidores: number;
  vendas_total: number;
  telegram_id?: string;
  tour_info?: unknown;
  descricao?: string;
  genero?: string;
  pais?: string;
}

export interface RadarItem {
  timestamp: string;
  nome: string;
  acao: string;
  foto: string;
}

export interface Projeto {
  tipo: string;
  titulo: string;
  status: string;
  data?: string;
  detalhe?: string;
  [k: string]: unknown;
}

export interface AlbumFaixa {
  numero: number;
  titulo: string;
  artistas: string; // ex: "YAN feat. Matthew"
  duracao?: string; // "3:24"
  drive_url: string; // link público do Drive (mp3)
  letra?: string;
}

export interface AlbumPayload {
  id?: string;
  artista: string;
  titulo: string;
  genero: string;
  data: string; // YYYY-MM-DD
  capa_url: string; // link Drive da capa
  contracapa_url?: string;
  encarte: string[]; // links Drive (N imagens)
  faixas: AlbumFaixa[];
  descricao?: string;
  telegram_id?: string;
}

export interface MarketItem {
  categoria: string; // MARKET, IMOVEIS, CARREIRA, ...
  item: string; // "Mansao", "Convite Met Gala"...
  preco: number; // EC
  efeito: string; // descrição livre
}

export interface MuralItem {
  id: string;
  vendedor: string;
  titulo: string;
  teaser: string;
  preco: number;
}

export interface BemItem {
  id?: string;
  artista: string;
  categoria: string;
  item: string;
  valor: number; // valor de compra ($)
  data: string; // ISO
  status?: string; // Ativo / Vendido
}

// ---- Bolsa de Valores ----
export interface EmpresaBolsa {
  id: string;
  dono: string;
  nome: string;
  segmento: string;
  capital_inicial: number;
  valor_atual: number;
  lucro_acumulado: number;
  dias_zerados: number;
  criada_em: string;
  ativa: boolean;
}

export interface BolsaLogItem {
  data: string;
  artista: string;
  tipo: "EMPRESA" | "TOUR";
  ref_id: string;
  ref_nome: string;
  resultado_dia: number;
  valor_apos: number;
}

// ---- Empire TV ----
export interface ProgramaTV {
  id: string;
  titulo: string;
  subtitulo: string;
  categoria: string;
  ao_vivo: boolean;
  finalizado?: boolean;
  status?: string;
  espectadores: number;
  cover: string;
  stream_url: string;
  data?: string;       // DD/MM/YYYY
  horario?: string;    // HH:mm
  data_inicio?: string;
  duracao_min?: number;
  buff?: string;
  topico_url?: string;
}

function qs(params: Record<string, string | number | undefined>) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    u.set(k, String(v));
  }
  u.set("_t", String(Date.now()));
  return u.toString();
}

// --- Cache em memória SWR (stale-while-revalidate) ---
// Persiste em sessionStorage para navegação instantânea entre rotas.
const cache = new Map<string, { data: unknown; ts: number }>();
const CACHE_FRESH = 120_000; // 2 min: reduz refetch em navegação rápida
const CACHE_STALE = 10 * 60_000; // 10 min: ainda serve enquanto revalida
const inflight = new Map<string, Promise<unknown>>();
const SS_KEY = "empire_api_cache_v1";

// Hidrata cache do sessionStorage (uma vez, no boot)
(() => {
  if (typeof sessionStorage === "undefined") return;
  try {
    const raw = sessionStorage.getItem(SS_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Array<[string, { data: unknown; ts: number }]>;
    const cutoff = Date.now() - CACHE_STALE;
    for (const [k, v] of parsed) if (v && v.ts > cutoff) cache.set(k, v);
  } catch {}
})();

let persistTimer: ReturnType<typeof setTimeout> | null = null;
function persistCache() {
  if (typeof sessionStorage === "undefined") return;
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    try {
      // Só entradas pequenas (evita estourar o storage)
      const entries: Array<[string, { data: unknown; ts: number }]> = [];
      for (const [k, v] of cache) {
        const size = JSON.stringify(v.data).length;
        if (size < 100_000) entries.push([k, v]);
      }
      sessionStorage.setItem(SS_KEY, JSON.stringify(entries));
    } catch {}
  }, 500);
}

async function rawCall<T = unknown>(params: Record<string, unknown>, base: string = SCRIPT_URL): Promise<T> {
  const isPost = params.payload || JSON.stringify(params).length > 1000;
  const options: RequestInit = { method: isPost ? "POST" : "GET" };
  if (isPost) options.body = JSON.stringify(params);
  const url = isPost ? base : `${base}?${qs(params as Record<string, string | number | undefined>)}`;
  const res = await fetch(url, options);
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as unknown as T;
  }
}

function fetchAndStore<T>(key: string, params: Record<string, unknown>, base: string): Promise<T> {
  const p = rawCall<T>(params, base)
    .then((data) => {
      cache.set(key, { data, ts: Date.now() });
      inflight.delete(key);
      persistCache();
      return data;
    })
    .catch((e) => {
      inflight.delete(key);
      throw e;
    });
  inflight.set(key, p);
  return p;
}

async function call<T = unknown>(params: Record<string, unknown>, opts: { cache?: boolean; tv?: boolean } = {}): Promise<T> {
  const base = opts.tv ? TV_SCRIPT_URL : SCRIPT_URL;
  if (!opts.cache) return rawCall<T>(params, base);
  const key = (opts.tv ? "TV::" : "HUB::") + JSON.stringify(params);
  const hit = cache.get(key);
  const age = hit ? Date.now() - hit.ts : Infinity;
  if (hit && age < CACHE_FRESH) return hit.data as T;
  if (hit && age < CACHE_STALE) {
    if (!inflight.has(key)) fetchAndStore<T>(key, params, base).catch(() => {});
    return hit.data as T;
  }
  if (inflight.has(key)) return inflight.get(key)! as Promise<T>;
  return fetchAndStore<T>(key, params, base);
}

export function invalidateCache() {
  cache.clear();
  if (typeof sessionStorage !== "undefined") {
    try { sessionStorage.removeItem(SS_KEY); } catch {}
  }
}


function normalizeArtist(a: Record<string, unknown>): Artist {
  return {
    nome: String(a.nome || "").trim(),
    foto: String(a.foto || ""),
    status: String(a.status || "Livre"),
    saldo: Number(a.saldo || 0),
    gravadora: String(a.gravadora || "Independent").replace(/\s*#\d+$/, ""),
    fortuna_real: Number(a.fortuna_real || 0),
    fortuna_bens: Number(a.fortuna_bens || 0),
    fortuna_total: Number(a.fortuna_total || 0),
    prestigio: Number(a.prestigio || 0),
    fadiga: Number(a.fadiga || 0),
    seguidores: Number(a.seguidores || 0),
    vendas_total: Number(a.vendas_total || 0),
    telegram_id: a.telegram_id ? String(a.telegram_id) : undefined,
    tour_info: a.tour_info,
    descricao: (a.descricao || "")?.toString().trim(),
    genero: (a.genero || "")?.toString().trim(),
    pais: (a.pais || "")?.toString().trim(),
  };
}

export interface CommonResponse {
  ok?: boolean;
  erro?: string;
  message?: string;
  id?: string;
}

export const api = {
  // chamada genérica de baixo nível (mantida para compatibilidade com chamadas diretas)
  call: <T = unknown>(params: Record<string, unknown>, opts: { cache?: boolean } = {}) =>
    call<T>(params, opts),

  // Dono do artista agora vem da aba ARTISTAS da planilha "Usuários" (nosso
  // Worker), não mais do Apps Script legado — que misturava donos errados
  // (ex: artista de outro jogador aparecendo como "meu"). O Worker resolve
  // o ID (telegram_id histórico, ou o próprio ID do login) pro nome do
  // jogador e casa contra a aba ARTISTAS; aqui só cruzamos os nomes
  // devolvidos com a lista completa de artistas (ainda vinda do Apps
  // Script) pra ter os dados econômicos de cada um.
  async meusArtistas(telegramId: string): Promise<Artist[]> {
    if (!telegramId || telegramId === "guest") return [];
    const [nomesRes, todos] = await Promise.all([
      fetch(`/api/artistas/meus-nomes?telegramId=${encodeURIComponent(telegramId)}`)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
      api.listarTodos(),
    ]);
    const meusNomes: string[] = Array.isArray(nomesRes?.data) ? nomesRes.data : [];
    const meusNomesNorm = new Set(meusNomes.map((n) => n.trim().toLowerCase()));
    return todos.filter((a) => meusNomesNorm.has(a.nome.trim().toLowerCase()));
  },
  async listarTodos(): Promise<Artist[]> {
    const data = await call<Record<string, unknown>[]>({ acao: "listar_todos" }, { cache: true });
    return Array.isArray(data) ? data.map((a) => normalizeArtist(a)) : [];
  },
  async radar(): Promise<RadarItem[]> {
    const data = await call<RadarItem[]>({ acao: "radar" }, { cache: true });
    return Array.isArray(data) ? data : [];
  },
  async projetos(nome: string): Promise<Projeto[]> {
    const data = await call<Projeto[]>({ acao: "projetos", nome }, { cache: true });
    return Array.isArray(data) ? data : [];
  },

  async comprarTour(p: {
    nome: string;
    tipo: string;
    titulo: string;
    dataInicio: string;
    qtd: number;
    continente: string;
  }): Promise<CommonResponse> {
    invalidateCache();
    return call<CommonResponse>({
      acao: "compra_unificada_tour",
      nome: p.nome,
      tipo: p.tipo,
      titulo: p.titulo,
      dataInicio: p.dataInicio,
      qtd: p.qtd,
      continente: p.continente,
    });
  },
  async comprarCinema(p: {
    nome: string;
    titulo: string;
    tipo: string;
    genero: string;
    dataInicio: string;
  }): Promise<CommonResponse> {
    invalidateCache();
    return call<CommonResponse>({ acao: "compra_cinema", ...p });
  },
  async viral(nome: string, musica: string): Promise<CommonResponse> {
    return call<CommonResponse>({ acao: "viral", artista: nome, musica });
  },
  async filantropia(nome: string, causa: string, valor: string): Promise<CommonResponse> {
    return call<CommonResponse>({ acao: "filantropia", artista: nome, causa, valor });
  },
  async publicarLeilao(p: { nome: string; descricao: string; lanceMini: number }): Promise<CommonResponse> {
    invalidateCache();
    return call<CommonResponse>({ acao: "publicar_leilao", ...p });
  },
  async darLance(p: { nome: string; itemId: string | number; valor: number }): Promise<CommonResponse> {
    invalidateCache();
    return call<CommonResponse>({ acao: "lance_leilao", ...p });
  },
  async listarLeiloes(): Promise<unknown[]> {
    const r = await call<unknown[]>({ acao: "leilao" }, { cache: true });
    return Array.isArray(r) ? r : [];
  },
  async payola(p: { nome: string; musica: string; valor: number }): Promise<CommonResponse> {
    invalidateCache();
    return call<CommonResponse>({ acao: "payola", ...p });
  },
  async rescisao(p: { nome: string; destino: string }): Promise<CommonResponse> {
    invalidateCache();
    return call<CommonResponse>({ acao: "rescisao", ...p });
  },
  async venderComposicao(p: { nome: string; titulo: string; preco: number }): Promise<CommonResponse> {
    invalidateCache();
    return call<CommonResponse>({ acao: "vender_composicao", ...p });
  },
  async comprarImovel(p: { nome: string; tipo: string; cidade: string }): Promise<CommonResponse> {
    invalidateCache();
    return call<CommonResponse>({ acao: "comprar_imovel", ...p });
  },

  // ---- Empire Market ----
  async listarCategoriasMarket(): Promise<string[]> {
    const r = await call<unknown>({ acao: "listar_categorias_market" }, { cache: true });
    if (Array.isArray(r)) return r.map((x) => String(x || "").trim()).filter(Boolean);
    return [];
  },
  async listarMarket(): Promise<MarketItem[]> {
    const r = await call<Record<string, unknown>[]>({ acao: "listar_market" }, { cache: true });
    return Array.isArray(r)
      ? r.map((x) => ({
          categoria: String(x.categoria || ""),
          item: String(x.item || ""),
          preco: Number(x.preco || 0),
          efeito: String(x.efeito || ""),
        }))
      : [];
  },
  async listarMural(): Promise<MuralItem[]> {
    const r = await call<MuralItem[]>({ acao: "mural" }, { cache: true });
    return Array.isArray(r) ? r : [];
  },
  async comprarMarket(p: { nome: string; categoria: string; item: string }): Promise<CommonResponse> {
    invalidateCache();
    return call<CommonResponse>({ acao: "comprar_market", nome: p.nome, categoria: p.categoria, item: p.item });
  },
  async comprarMural(p: { nome: string; id: string }): Promise<CommonResponse> {
    invalidateCache();
    return call<CommonResponse>({ acao: "comprar_item", nome: p.nome, id: p.id });
  },
  async meusBens(nome: string): Promise<BemItem[]> {
    const r = await call<BemItem[]>({ acao: "meus_bens", nome }, { cache: true });
    return Array.isArray(r) ? r : [];
  },
  async venderBem(p: { nome: string; id: string }): Promise<CommonResponse> {
    invalidateCache();
    return call<CommonResponse>({ acao: "vender_bem", nome: p.nome, id: p.id });
  },

  // ---- Bolsa de Valores ----
  async fundarEmpresa(p: {
    nome: string;
    nomeEmpresa: string;
    segmento: string;
    investimento: number;
  }): Promise<CommonResponse> {
    invalidateCache();
    return call<CommonResponse>({ acao: "fundar_empresa", ...p });
  },
  async listarEmpresas(): Promise<EmpresaBolsa[]> {
    const r = await call<EmpresaBolsa[]>({ acao: "listar_empresas" }, { cache: true });
    return Array.isArray(r) ? r : [];
  },
  async minhasEmpresas(telegramId: string): Promise<EmpresaBolsa[]> {
    const r = await call<EmpresaBolsa[]>(
      { acao: "minhas_empresas", telegram_id: telegramId },
      { cache: true },
    );
    return Array.isArray(r) ? r : [];
  },
  async historicoBolsa(p: { nome?: string; limit?: number } = {}): Promise<BolsaLogItem[]> {
    const r = await call<BolsaLogItem[]>(
      { acao: "historico_bolsa", nome: p.nome || "", limit: p.limit || 120 },
      { cache: true },
    );
    return Array.isArray(r) ? r : [];
  },

  // ---- Empire TV ----
  async listarProgramasTV(): Promise<ProgramaTV[]> {
    // Em paralelo:
    //  - listar_programas_tv: catálogo completo (passado/agendado/ao vivo por status)
    //  - buildPayload (sem acao): detecta o que está broadcasting AGORA pelo horário
    //    e grava "Transmitindo" na planilha como efeito colateral.
    const [r, live] = await Promise.all([
      call<Record<string, unknown>[]>({ acao: "listar_programas_tv" }, { cache: true, tv: true }),
      call<Record<string, unknown>>({}, { tv: true }).catch(() => ({} as Record<string, unknown>)),
    ]);
    if (!Array.isArray(r)) return [];

    const current = (live && typeof live === "object" ? (live as any).current : null) || null;
    const liveRowNum = current && current.status === "broadcasting" ? String(current.rowNum ?? "") : "";
    const liveKey = current && current.status === "broadcasting"
      ? `${String(current.programa || "").trim()}|${String(current.data || "")}|${String(current.horarioStr || "")}`
      : "";

    return r.map((x) => {
      const titulo    = String(x.titulo    ?? x.programa  ?? "");
      const categoria = String(x.categoria ?? x.tipo      ?? "");
      const subtitulo = String(x.subtitulo ?? x.material  ?? "");
      const cover     = driveImg(String(x.cover ?? x.capaUrl ?? "")) || String(x.cover ?? x.capaUrl ?? "");
      const stream    = String(x.stream_url ?? x.topicoUrl ?? "");
      const estado    = String(x.estado    ?? "").toLowerCase();
      const data      = x.data      ? String(x.data)      : undefined;
      const horario   = x.horarioStr ? String(x.horarioStr) : (x.horario ? String(x.horario) : undefined);
      const dataInicio = x.data_inicio
        ? String(x.data_inicio)
        : (data && horario ? `${data} ${horario}` : undefined);
      const rowNum = String(x.rowNum ?? "");
      const key = `${titulo.trim()}|${data || ""}|${horario || ""}`;
      const isLiveFromPayload = !!liveKey && (
        (liveRowNum && rowNum && liveRowNum === rowNum) || key === liveKey
      );
      const aoVivo = isLiveFromPayload
        || estado === "ao_vivo"
        || x.ao_vivo === true
        || String(x.ao_vivo || "").toLowerCase() === "true"
        || String(x.ao_vivo || "") === "1"
        || String(x.ao_vivo || "").toLowerCase() === "sim";
      const finalizado = !aoVivo && (
        estado === "arquivo"
        || String(x.status || "").toLowerCase() === "finalizado"
        || String(x.status || "").toLowerCase() === "concluido"
        || String(x.status || "").toLowerCase() === "concluído"
        || String(x.status || "").toLowerCase() === "transmitido"
      );
      return {
        id: String(x.id ?? x.rowNum ?? titulo ?? Math.random().toString(36).slice(2)),
        titulo,
        subtitulo,
        categoria,
        ao_vivo: aoVivo,
        finalizado,
        status: aoVivo ? "transmitindo" : (x.status ? String(x.status) : undefined),
        espectadores: Number(x.espectadores || 0),
        cover,
        stream_url: stream,
        data,
        horario,
        data_inicio: dataInicio,
        duracao_min: x.duracao_min ? Number(x.duracao_min) : undefined,
        buff: x.buff ? String(x.buff) : undefined,
        topico_url: stream || undefined,
      };
    });
  },

  async registrarPresencaTV(p: {
    programa_id: string; telegram_id: string; nome: string; watched_seconds: number;
  }): Promise<CommonResponse> {
    return call<CommonResponse>({ acao: "registrar_presenca_tv", ...p, watched_seconds: String(p.watched_seconds) }, { tv: true });
  },
  async listarPresencaTV(programa_id: string): Promise<Array<{ telegram_id: string; nome: string; watched_seconds: number; percentual: number }>> {
    const r = await call<any[]>({ acao: "listar_presenca_tv", programa_id }, { tv: true });
    return Array.isArray(r) ? r.map((x) => ({
      telegram_id: String(x.telegram_id || ""),
      nome: String(x.nome || "Anônimo"),
      watched_seconds: Number(x.watched_seconds || 0),
      percentual: Number(x.percentual || 0),
    })) : [];
  },
  async salvarChatTV(p: { programa_id: string; mensagens: Array<{ user: string; text: string; ts: number; reply_to?: { id: string; user: string; text: string } }>; total_msgs: number }): Promise<CommonResponse> {
    return call<CommonResponse>({
      acao: "salvar_chat_tv",
      sala: p.programa_id,
      total_msgs: String(p.total_msgs),
      json: JSON.stringify(p.mensagens),
    }, { tv: true });
  },
  async listarArquivoTV(): Promise<Array<{ data: string; hora: string; sala: string; total_msgs: number }>> {
    const r = await call<any[]>({ acao: "listar_arquivo_tv" }, { cache: true, tv: true });
    return Array.isArray(r) ? r.map((x) => ({
      data: String(x.data || ""),
      hora: String(x.hora || ""),
      sala: String(x.sala || ""),
      total_msgs: Number(x.total_msgs || 0),
    })) : [];
  },

  // ---- Álbuns ----
  async lancarAlbum(payload: AlbumPayload): Promise<CommonResponse> {
    invalidateCache();
    return call<CommonResponse>({ acao: "lancar_album", payload: JSON.stringify(payload) });
  },
  async getAlbum(id: string): Promise<AlbumPayload | null> {
    const r = await call<AlbumPayload & { error?: string }>({ acao: "get_album", id }, { cache: true });
    if (!r || r.error) return null;
    return r;
  },
  async listarAlbuns(nome?: string): Promise<AlbumPayload[]> {
    const r = await call<AlbumPayload[]>({ acao: "listar_albuns", nome: nome || "" }, { cache: true });
    return Array.isArray(r) ? r : [];
  },
  async editarAlbum(payload: AlbumPayload): Promise<CommonResponse> {
    invalidateCache();
    return call<CommonResponse>({ acao: "editar_album", payload: JSON.stringify(payload) });
  },
  async editarFaixaAlbum(payload: { album_id: string; numero: number; [key: string]: any }): Promise<CommonResponse> {
    invalidateCache();
    return call<CommonResponse>({ acao: "editar_faixa_album", payload: JSON.stringify(payload) });
  },
  async excluirAlbum(id: string, telegramId?: string): Promise<CommonResponse> {
    invalidateCache();
    return call<CommonResponse>({ acao: "excluir_album", id, telegram_id: telegramId || "" });
  },

  // ---- Playlists ----
  async listarPlaylists(telegramId?: string): Promise<PlaylistPayload[]> {
    const r = await call<PlaylistPayload[]>(
      { acao: "listar_playlists", telegram_id: telegramId || "" },
      { cache: true },
    );
    return Array.isArray(r) ? r : [];
  },
  async getPlaylist(id: string): Promise<PlaylistPayload | null> {
    const r = await call<PlaylistPayload & { error?: string }>({ acao: "get_playlist", id }, { cache: true });
    if (!r || r.error) return null;
    return r;
  },
  async salvarPlaylist(payload: PlaylistPayload, telegramId?: string): Promise<CommonResponse> {
    invalidateCache();
    return call<CommonResponse>({
      acao: "salvar_playlist",
      payload: JSON.stringify(payload),
      telegram_id: telegramId || payload.telegram_id || "",
    });
  },
  async listarFaixasCatalogo(): Promise<any[]> {
    const r = await call<any[]>({ acao: "listar_faixas_catalogo" }, { cache: true });
    return Array.isArray(r) ? r : [];
  },
  async excluirPlaylist(id: string, telegramId?: string): Promise<CommonResponse> {
    invalidateCache();
    return call<CommonResponse>({ acao: "excluir_playlist", id, telegram_id: telegramId || "" });
  },

  // ---- Bet ----
  async getMusicasBet(): Promise<{ semana: string; musicas: unknown[] } | null> {
    const acoes = ["musicas_bet", "get_musicas_bet", "musicas_charts", "get_musicas_charts"];
    for (const acao of acoes) {
      const r = await call<{ semana: string; musicas: unknown[]; erro?: string }>({ acao }, { cache: true });
      if (r && !r.erro && Array.isArray(r.musicas) && r.musicas.length > 0) return r;
    }
    return null;
  },
  async bet(p: { nome: string; valor: number; semana: string; previsoes: string }): Promise<CommonResponse> {
    invalidateCache();
    return call<CommonResponse>({ acao: "bet", ...p });
  },
  async listTours(): Promise<any[]> {
    const acoes = ["listar_todas_tours", "tours", "controle_tours", "listar_tours"];
    for (const acao of acoes) {
      const r = await call<any[]>({ acao }, { cache: true });
      if (Array.isArray(r) && r.length > 0) return r;
    }
    return [];
  },
  async ranking(): Promise<Artist[]> {
    const data = await call<Record<string, unknown>[]>({ acao: "ranking" }, { cache: true });
    return Array.isArray(data) ? data.map((a) => normalizeArtist(a)) : [];
  },
  async charts(): Promise<Artist[]> {
    const data = await call<Record<string, unknown>[]>({ acao: "charts" }, { cache: true });
    return Array.isArray(data) ? data.map((a) => normalizeArtist(a)) : [];
  },
  async getAgendaTour(nome: string): Promise<any> {
    return call<any>({ acao: "agenda_tour", nome }, { cache: true });
  },
  async vincularImagemTour(nome: string, url: string): Promise<CommonResponse> {
    invalidateCache();
    return call<CommonResponse>({ acao: "vincular_imagem_tour", nome, url });
  },
  async searchSongs(query: string): Promise<any[]> {
    const r = await call<any[]>({ acao: "buscar_musicas", q: query }, { cache: true });
    return Array.isArray(r) ? r : [];
  },
  async getArtistasSemId(): Promise<Artist[]> {
    const data = await call<Record<string, unknown>[]>({ acao: "artistas_sem_id" }, { cache: true });
    return Array.isArray(data) ? data.map((a) => normalizeArtist(a)) : [];
  },
  async vincularArtista(nome: string, telegramId: string): Promise<CommonResponse> {
    invalidateCache();
    return call<CommonResponse>({ acao: "vincular_artista", nome, telegram_id: telegramId });
  },
  async criarArtista(payload: {
    nome: string;
    foto: string;
    gravadora: string;
    telegram_id: string;
  }): Promise<CommonResponse> {
    invalidateCache();
    return call<CommonResponse>({
      acao: "criar_artista",
      nome: payload.nome,
      foto: payload.foto,
      gravadora: payload.gravadora,
      telegram_id: payload.telegram_id,
    });
  },
  async topCharts(): Promise<Record<string, ChartData>> {
    const data = await call<Record<string, ChartData>>({ acao: "top_charts" }, { cache: true });
    return data || {};
  },

  // ---- Social ----
  async listarPostsSocial(): Promise<any[]> {
    const r = await call<any[]>({ acao: "listarPostsSocial" }, { cache: false });
    return Array.isArray(r) ? r : [];
  },
  async salvarPostSocial(payload: any, tgId: string): Promise<CommonResponse> {
    invalidateCache();
    return call<CommonResponse>({ acao: "salvarPostSocial", payload: JSON.stringify(payload), tgId });
  },
  async listarPerfisSocial(tgId?: string): Promise<any[]> {
    const r = await call<any[]>({ acao: "listarPerfisSocial", tgId }, { cache: false });
    return Array.isArray(r) ? r : [];
  },
  async salvarPerfilSocial(payload: any, tgId: string): Promise<CommonResponse> {
    invalidateCache();
    return call<CommonResponse>({ acao: "salvarPerfilSocial", payload: JSON.stringify(payload), tgId });
  },
  async curtirPostSocial(postId: string, tgId: string): Promise<any> {
    return call<any>({ acao: "curtirPostSocial", postId, tgId });
  },
  async comentarPostSocial(payload: any, tgId: string): Promise<any> {
    return call<any>({ acao: "comentarPostSocial", payload: JSON.stringify(payload), tgId });
  },
  async listarComentariosSocial(postId: string): Promise<any[]> {
    const r = await call<any[]>({ acao: "listarComentariosSocial", postId }, { cache: false });
    return Array.isArray(r) ? r : [];
  },
  async salvarNewsSocial(payload: any, tgId: string): Promise<any> {
    return call<any>({ acao: "salvarNewsSocial", payload: JSON.stringify(payload), tgId });
  },
  async listarNewsSocial(): Promise<any[]> {
    const r = await call<any[]>({ acao: "listarNewsSocial" }, { cache: false });
    return Array.isArray(r) ? r : [];
  },

  // ---- Games & Economy ----
  async syncGameCoins(
    tgId: string,
    wager: number,
    won: number,
    gameContext?: string,
    artistName?: string,
  ): Promise<CommonResponse & { novoSaldo?: number }> {
    invalidateCache();
    return call<CommonResponse & { novoSaldo?: number }>({
      acao: "sync_game_coins",
      telegram_id: tgId,
      wager,
      won,
      gameContext,
      artistName,
    });
  },
  async savePetState(tgId: string, payload: string): Promise<CommonResponse> {
    return call<CommonResponse>({ acao: "save_pet_state", telegram_id: tgId, payload });
  },
  async getPetState(tgId: string): Promise<CommonResponse & { payload?: string; lastUpdate?: number }> {
    return call<CommonResponse & { payload?: string; lastUpdate?: number }>({
      acao: "get_pet_state",
      telegram_id: tgId,
    });
  },

  // ---- Queridômetro ----
  async getQueridometroStatus(tgId: string): Promise<
    CommonResponse & {
      meuPerfil?: any;
      artistas?: any[];
      artistasAlvos?: any[];
      meusArtistas?: any[];
      ranking?: any[];
      votosRestantes?: number;
      reacoesRecebidas?: any[];
      reacoesPublicas?: Array<{ para?: string; fotoPara?: string; emoji?: string; data?: string }>;
      configEmojis?: any[];
      semana?: string;
    }
  > {
    return call({ acao: "queridometro_status", tgId });
  },
  async postQueridometroVoto(
    tgId: string,
    de: string,
    para: string,
    emoji: string,
  ): Promise<CommonResponse & { msg?: string }> {
    return call({ acao: "queridometro_votar", tgId, de, para, emoji });
  },

  // ---- PONTO (pontos + playlists por planilha externa) ----
  async getJogador(tgId: string): Promise<{ nomeOff?: string; artistas?: string[]; erro?: string }> {
    return call({ acao: "ponto_get_jogador", tgId });
  },
  async listarPontosJogador(tgId: string): Promise<{
    colunas?: string[];
    editaveis?: string[];
    linhas?: Array<{ linha: number; artista: string; valores: Record<string, any> }>;
    erro?: string;
  }> {
    return call({ acao: "ponto_listar_pontos", tgId });
  },
  async salvarCelulaPontos(p: { tgId: string; linha: number; coluna: string; valor: any }): Promise<CommonResponse> {
    invalidateCache();
    return call({ acao: "ponto_salvar_celula", tgId: p.tgId, linha: p.linha, coluna: p.coluna, valor: p.valor });
  },
  async distribuirPontosAleatorio(tgId: string): Promise<CommonResponse> {
    invalidateCache();
    return call({ acao: "ponto_distribuir_aleatorio", tgId });
  },
  async listarPlaylistsJogador(tgId: string): Promise<{
    colunas?: string[];
    editaveis?: string[];
    linhas?: Array<{ linha: number; artista: string; valores: Record<string, any> }>;
    erro?: string;
  }> {
    return call({ acao: "ponto_listar_playlists", tgId });
  },
  async salvarCelulaPlaylist(p: { tgId: string; linha: number; coluna: string; valor: any }): Promise<CommonResponse> {
    invalidateCache();
    return call({
      acao: "ponto_salvar_playlist_celula",
      tgId: p.tgId,
      linha: p.linha,
      coluna: p.coluna,
      valor: p.valor,
    });
  },
  async distribuirPlaylistsAuto(tgId: string): Promise<CommonResponse & { resumo?: string }> {
    invalidateCache();
    return call({ acao: "ponto_distribuir_playlists_auto", tgId });
  },

  // ---- PONTO Playlists ECOIN ----
  async listarMusicasEdicao(tgId: string): Promise<{
    musicas?: Array<{ linha: number; musica: string; artista: string }>;
    erro?: string;
  }> {
    return call({ acao: "ponto_listar_musicas_edicao", tgId });
  },
  async saldoEcoin(tgId: string): Promise<{
    saldos?: Record<string, any>;
    erro?: string;
  }> {
    return call({ acao: "ponto_saldo_ecoin", tgId });
  },
  async salvarPlaylistEcoin(p: {
    tgId: string;
    musica: string;
    artista: string;
    plataforma: string;
    playlist: string;
  }): Promise<CommonResponse & { saldo?: any; linha?: number }> {
    invalidateCache();
    return call({ acao: "ponto_salvar_playlist_ecoin", ...p });
  },
};

export interface ChartData {
  musica: string;
  artista: string;
  foto: string;
  data: string;
  url: string;
  erro?: string;
}

export interface PlaylistTrack {
  album_id: string;
  faixa_numero: number;
  titulo: string;
  artistas: string;
  drive_url: string;
  capa_url?: string;
  duracao?: string;
}

export interface PlaylistPayload {
  id?: string;
  titulo: string;
  descricao?: string;
  capa_url?: string;
  owner: string;
  telegram_id?: string;
  tracks: PlaylistTrack[];
  data?: string;
}

export function fmtEC(n: number) {
  return `E$C ${(n || 0).toLocaleString("pt-BR")}`;
}

export function fmtMoney(n: number) {
  return `$${(n || 0).toLocaleString("pt-BR")}`;
}

export function driveImg(url: string | undefined | null, size: number = 400): string | undefined {
  if (!url) return undefined;
  if (url.includes("lh3.googleusercontent.com")) {
    if (!url.includes("=")) return `${url}=w${size}-h${size}-p`;
    return url;
  }
  const m = String(url).match(/[-\w]{25,}/);
  if (!m) return url;
  return `https://lh3.googleusercontent.com/d/${m[0]}=w${size}-h${size}-p`;
}

export function driveAudioSrc(url: string | undefined | null): string | undefined {
  if (!url) return undefined;
  const m = String(url).match(/[-\w]{25,}/);
  if (!m) return undefined;
  return `https://drive.google.com/file/d/${m[0]}/preview`;
}

export function driveDirectAudio(url: string | undefined | null): string | undefined {
  if (!url) return undefined;
  const m = String(url).match(/[-\w]{25,}/);
  if (!m) return undefined;
  return `https://drive.google.com/uc?export=download&id=${m[0]}`;
}
