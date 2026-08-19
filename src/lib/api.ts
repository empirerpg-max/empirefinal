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

export interface NivelInfo {
  nivel: number;
  fase: string;
  nome: string;
  badge: string;
  prestigio: number;
}

export interface NivelJogador {
  prestigioAtual: number;
  nivelAtual: NivelInfo | null;
  proximoNivel: NivelInfo | null;
  progresso: number;
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


// Compara nomes ignorando acento/maiúscula — mesma lógica do
// normalizeComparison do backend. Sem isso, "Anníbal Páris" vindo da aba
// ARTISTAS (fonte de verdade do vínculo) podia não bater com a grafia
// vinda do catálogo geral (Apps Script) e sumir da lista "meus artistas"
// mesmo estando corretamente vinculado.
function normalizeNome(v: string): string {
  return (v || "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
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
    // A aba ARTISTAS é a fonte de verdade de posse — nunca escondemos um
    // artista por ele não ter (ou não bater o nome) no catálogo legado
    // (Apps Script). Quando não acha os dados completos lá, mostra um
    // perfil mínimo só com o nome mesmo assim.
    const porNomeNorm = new Map(todos.map((a) => [normalizeNome(a.nome), a]));
    return meusNomes.map(
      (nome) =>
        porNomeNorm.get(normalizeNome(nome)) || {
          ...normalizeArtist({}),
          nome,
        },
    );
  },
  async meuNivel(identificador: { telegramId?: string; usuario?: string }): Promise<NivelJogador | null> {
    const { telegramId, usuario } = identificador;
    if (!telegramId && !usuario) return null;
    const params = new URLSearchParams();
    if (telegramId) params.set("telegramId", telegramId);
    if (usuario) params.set("usuario", usuario);
    try {
      const res = await fetch(`/api/user/nivel?${params.toString()}`);
      if (!res.ok) return null;
      const json = await res.json();
      return json.success ? (json.data as NivelJogador) : null;
    } catch {
      return null;
    }
  },
  // Biografia (e foto de origem) do artista — aba própria "INFOS ACTS" na
  // planilha registrosCharts, editada direto pelo dono do artista lá (não
  // tem tela de edição no app pra isso). Fonte real da biografia — o campo
  // "descricao" que vinha do Apps Script legado às vezes trazia lixo (até
  // uma data crua) em vez de texto de verdade.
  async getArtistInfo(nome: string): Promise<{ foto: string; biografia: string } | null> {
    try {
      const res = await fetch(`/api/artistas/infos?nome=${encodeURIComponent(nome)}`);
      if (!res.ok) return null;
      const json = await res.json();
      return json.success ? json.data : null;
    } catch {
      return null;
    }
  },
  // Grava o link do novo upload de foto na coluna F da aba INFOS ACTS —
  // nunca sobrescreve a foto "oficial" (coluna C, editada à mão pelo dono).
  async setArtistFoto(nome: string, fotoUrl: string): Promise<CommonResponse> {
    const res = await fetch("/api/artistas/foto", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nome, fotoUrl }),
    });
    return res.json();
  },
  // REVERTIDO pro Apps Script: a aba ARTISTAS não guarda saldo/fortuna
  // prontos (a maioria das linhas vem vazia nessas colunas) — o Apps
  // Script calcula esses valores dinamicamente cruzando outras planilhas
  // (vendas, compras etc.), então não dá pra ler direto de uma aba só.
  // Deixado como TODO até mapear onde esse cálculo realmente acontece.
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
  // Migrado do Apps Script (TV_SCRIPT_URL) pro nosso backend — lê direto a
  // aba Programacao_RPG (planilha Agenda_TV) e já calcula "ao vivo agora"
  // numa passada só, sem a segunda chamada extra que o Apps Script exigia.
  async listarProgramasTV(): Promise<ProgramaTV[]> {
    try {
      const res = await fetch(`/api/tv/programas`);
      if (!res.ok) return [];
      const json = await res.json();
      const data = Array.isArray(json?.data) ? json.data : [];
      return data.map((x: Record<string, unknown>) => ({
        id: String(x.id || ""),
        titulo: String(x.titulo || ""),
        subtitulo: String(x.subtitulo || ""),
        categoria: String(x.categoria || ""),
        ao_vivo: !!x.ao_vivo,
        finalizado: !!x.finalizado,
        status: x.status ? String(x.status) : undefined,
        espectadores: Number(x.espectadores || 0),
        cover: driveImg(String(x.cover || "")) || String(x.cover || ""),
        stream_url: String(x.stream_url || ""),
        data: x.data ? String(x.data) : undefined,
        horario: x.horario ? String(x.horario) : undefined,
        data_inicio: x.data && x.horario ? `${x.data} ${x.horario}` : undefined,
        duracao_min: x.duracao_min ? Number(x.duracao_min) : undefined,
        buff: x.buff ? String(x.buff) : undefined,
        topico_url: x.topico_url ? String(x.topico_url) : undefined,
      }));
    } catch {
      return [];
    }
  },

  async registrarPresencaTV(p: {
    programa_id: string; telegram_id: string; nome: string; watched_seconds: number;
  }): Promise<CommonResponse> {
    const res = await fetch("/api/tv/presenca", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(p),
    });
    return res.json();
  },
  async listarPresencaTV(programa_id: string): Promise<Array<{ telegram_id: string; nome: string; watched_seconds: number; percentual: number }>> {
    try {
      const res = await fetch(`/api/tv/presenca?programa_id=${encodeURIComponent(programa_id)}`);
      if (!res.ok) return [];
      const json = await res.json();
      const data = Array.isArray(json?.data) ? json.data : [];
      return data.map((x: Record<string, unknown>) => ({
        telegram_id: String(x.telegram_id || ""),
        nome: String(x.nome || "Anônimo"),
        watched_seconds: Number(x.watched_seconds || 0),
        percentual: Number(x.percentual || 0),
      }));
    } catch {
      return [];
    }
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

  // ---- Playlists (migrado do Apps Script pro Worker) ----
  async listarPlaylists(): Promise<PlaylistPayload[]> {
    const res = await fetch("/api/playlists");
    const data = await res.json().catch(() => null);
    return Array.isArray(data) ? data : [];
  },
  async getPlaylist(id: string): Promise<PlaylistPayload | null> {
    const res = await fetch(`/api/playlists/${encodeURIComponent(id)}`);
    const data = await res.json().catch(() => null);
    if (!data || (data as { error?: string }).error) return null;
    return data as PlaylistPayload;
  },
  async salvarPlaylist(payload: PlaylistPayload, telegramId?: string): Promise<CommonResponse> {
    const res = await fetch("/api/playlists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payload: JSON.stringify(payload), tgId: telegramId || payload.telegram_id || "" }),
    });
    return res.json();
  },
  async listarFaixasCatalogo(): Promise<any[]> {
    const res = await fetch("/api/playlists/catalogo");
    const data = await res.json().catch(() => null);
    return Array.isArray(data) ? data : [];
  },
  async excluirPlaylist(id: string, telegramId?: string): Promise<CommonResponse> {
    const res = await fetch("/api/playlists/excluir", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, tgId: telegramId || "" }),
    });
    return res.json();
  },

  // ---- Salvos (faixas curtidas) ----
  async listarSalvos(tgId: string): Promise<PlaylistTrack[]> {
    if (!tgId) return [];
    const res = await fetch(`/api/salvos?tgId=${encodeURIComponent(tgId)}`);
    const data = await res.json().catch(() => null);
    return Array.isArray(data) ? data : [];
  },
  async salvarFaixa(tgId: string, track: PlaylistTrack): Promise<CommonResponse & { already?: boolean }> {
    const res = await fetch("/api/salvos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tgId, track }),
    });
    return res.json();
  },
  async removerSalvo(tgId: string, driveUrl: string): Promise<CommonResponse> {
    const res = await fetch("/api/salvos/remover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tgId, drive_url: driveUrl }),
    });
    return res.json();
  },

  async criarAlbumAntigo(payload: {
    artista: string;
    titulo: string;
    genero?: string;
    data?: string;
    descricao?: string;
    capa_url?: string;
    contracapa_url?: string;
    telegram_id?: string;
    faixas: {
      numero: number;
      titulo: string;
      artistas: string;
      duracao?: string;
      drive_url: string;
      letra?: string;
    }[];
  }): Promise<CommonResponse> {
    const res = await fetch("/api/playlists/albuns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return res.json();
  },

  async listarAlbunsAntigos(): Promise<
    {
      id: string;
      artista: string;
      titulo: string;
      genero?: string;
      data?: string;
      descricao?: string;
      capa_url?: string;
      totalFaixas: number;
    }[]
  > {
    const res = await fetch("/api/albuns-antigos");
    const data = await res.json().catch(() => null);
    return Array.isArray(data) ? data : [];
  },
  async getAlbumAntigo(id: string): Promise<{
    id: string;
    artista: string;
    titulo: string;
    genero?: string;
    data?: string;
    descricao?: string;
    capa_url?: string;
    faixas: {
      numero: number;
      titulo: string;
      artistas: string;
      duracao?: string;
      drive_url: string;
      letra?: string;
    }[];
  } | null> {
    const res = await fetch(`/api/albuns-antigos/${encodeURIComponent(id)}`);
    const data = await res.json().catch(() => null);
    if (!data || data.error) return null;
    return data;
  },

  // ---- Ponto ----
  async listarPontos(telegramId: string): Promise<{
    artistas: string[];
    grupos: {
      artista: string;
      musicas: {
        linha: number;
        artista: string;
        musica: string;
        weeks: string;
        pontosDisponiveis: string;
        pontosUtilizados: string;
        categorias: Record<string, string>;
        dataLancamento: string;
      }[];
    }[];
  }> {
    const res = await fetch(`/api/ponto?telegramId=${encodeURIComponent(telegramId)}`);
    const data = await res.json().catch(() => null);
    return data && Array.isArray(data.grupos) ? data : { artistas: [], grupos: [] };
  },
  async salvarPontoCelula(
    telegramId: string,
    linha: number,
    coluna: string,
    valor: string,
  ): Promise<CommonResponse> {
    const res = await fetch("/api/ponto/salvar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ telegramId, linha, coluna, valor }),
    });
    return res.json();
  },
  async distribuirPontosAleatorioNovo(telegramId: string): Promise<CommonResponse & { distribuidas?: number }> {
    const res = await fetch("/api/ponto/distribuir-aleatorio", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ telegramId }),
    });
    return res.json();
  },
  async limparPontoCelula(telegramId: string, linha: number): Promise<CommonResponse> {
    const res = await fetch("/api/ponto/limpar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ telegramId, linha }),
    });
    return res.json();
  },

  // ---- PONTO Playlists (ECOIN + INVESTIMENTO) ----
  async listarInvestimentos(telegramId: string): Promise<{
    artistas: string[];
    grupos: Array<{
      artista: string;
      saldo: number;
      linhas: Array<{
        linha: number;
        musica: string;
        bankAccount: string;
        spotify: string;
        spotifyValor: string;
        apple: string;
        appleValor: string;
        youtube: string;
        youtubeValor: string;
        total: string;
      }>;
    }>;
  }> {
    const res = await fetch(`/api/ponto/playlists?telegramId=${encodeURIComponent(telegramId)}`);
    const data = await res.json().catch(() => null);
    return data && Array.isArray(data.grupos) ? data : { artistas: [], grupos: [] };
  },
  async iniciarInvestimento(p: {
    telegramId: string;
    artista: string;
    musica: string;
  }): Promise<CommonResponse & { linha?: number }> {
    const res = await fetch("/api/ponto/playlists/iniciar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(p),
    });
    return res.json();
  },
  async investirPlaylist(p: {
    telegramId: string;
    linha: number;
    plataforma: string;
    playlist: string;
  }): Promise<CommonResponse> {
    const res = await fetch("/api/ponto/playlists/investir", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(p),
    });
    return res.json();
  },
  async limparInvestimento(telegramId: string, linha: number): Promise<CommonResponse> {
    const res = await fetch("/api/ponto/playlists/limpar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ telegramId, linha }),
    });
    return res.json();
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
  // Artistas livres (sem dono) vêm direto da aba ARTISTAS (Worker próprio) —
  // não mais do Apps Script legado, que ficava desconectado da fonte que
  // "Meus Artistas" lê e fazia vínculos "sumirem" pro jogador.
  async getArtistasSemId(): Promise<Artist[]> {
    try {
      const res = await fetch("/api/artistas/disponiveis");
      if (!res.ok) return [];
      const json = await res.json();
      const data = Array.isArray(json?.data) ? json.data : [];
      return data.map((a: Record<string, unknown>) => normalizeArtist(a));
    } catch {
      return [];
    }
  },
  async vincularArtista(nome: string, telegramId: string): Promise<CommonResponse> {
    try {
      const res = await fetch("/api/artistas/vincular", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome, telegramId }),
      });
      const json = await res.json();
      return { ok: !!json.ok, erro: json.erro };
    } catch {
      return { ok: false, erro: "Erro na conexão." };
    }
  },
  async criarArtista(payload: {
    nome: string;
    foto: string;
    gravadora: string;
    telegram_id: string;
  }): Promise<CommonResponse> {
    try {
      const res = await fetch("/api/artistas/criar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nome: payload.nome,
          foto: payload.foto,
          gravadora: payload.gravadora,
          telegramId: payload.telegram_id,
        }),
      });
      const json = await res.json();
      return { ok: !!json.ok, erro: json.erro };
    } catch {
      return { ok: false, erro: "Erro na conexão." };
    }
  },
  async topCharts(): Promise<Record<string, ChartData>> {
    const data = await call<Record<string, ChartData>>({ acao: "top_charts" }, { cache: true });
    return data || {};
  },

  // ---- Social (migrado do Apps Script pro Worker — muito mais rápido) ----
  async listarPostsSocial(): Promise<any[]> {
    const res = await fetch("/api/social/posts");
    const data = await res.json().catch(() => null);
    return Array.isArray(data) ? data : [];
  },
  async salvarPostSocial(payload: any, tgId: string): Promise<CommonResponse> {
    const res = await fetch("/api/social/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payload: JSON.stringify(payload), tgId }),
    });
    return res.json();
  },
  async authHeartbeat(telegramId: string, usuario: string): Promise<void> {
    try {
      await fetch("/api/auth/heartbeat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ telegramId, usuario }),
      });
    } catch {
      // Silencioso — não é crítico pro app abrir mesmo se isso falhar.
    }
  },
  async editarPostSocial(postId: string, texto: string, mediaUrl: string, tgId: string): Promise<CommonResponse> {
    const res = await fetch("/api/social/posts/editar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ postId, texto, media_url: mediaUrl, tgId }),
    });
    return res.json();
  },
  async listarPerfisSocial(): Promise<any[]> {
    const res = await fetch("/api/social/perfis");
    const data = await res.json().catch(() => null);
    return Array.isArray(data) ? data : [];
  },
  async salvarPerfilSocial(payload: any, tgId: string): Promise<CommonResponse> {
    const res = await fetch("/api/social/perfis", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payload: JSON.stringify(payload), tgId }),
    });
    return res.json();
  },
  async curtirPostSocial(postId: string, tgId: string): Promise<any> {
    const res = await fetch("/api/social/curtir", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ postId, tgId }),
    });
    return res.json();
  },
  async comentarPostSocial(payload: any, tgId: string): Promise<any> {
    const res = await fetch("/api/social/comentar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payload: JSON.stringify(payload), tgId }),
    });
    return res.json();
  },
  async listarComentariosSocial(postId: string): Promise<any[]> {
    const res = await fetch(`/api/social/comentarios?postId=${encodeURIComponent(postId)}`);
    const data = await res.json().catch(() => null);
    return Array.isArray(data) ? data : [];
  },
  async editarComentarioSocial(rowIndex: number, texto: string, tgId: string): Promise<CommonResponse> {
    const res = await fetch("/api/social/comentario/editar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rowIndex, texto, tgId }),
    });
    return res.json();
  },
  async salvarNewsSocial(payload: any, tgId: string): Promise<any> {
    const res = await fetch("/api/social/news", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payload: JSON.stringify(payload), tgId }),
    });
    return res.json();
  },
  async listarNewsSocial(): Promise<any[]> {
    const res = await fetch("/api/social/news");
    const data = await res.json().catch(() => null);
    return Array.isArray(data) ? data : [];
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
  letra?: string;
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

// Badges de nível são SVG com fundo transparente — o proxy de thumbnail
// lh3.googleusercontent.com (usado em driveImg) rasteriza pra PNG e acaba
// preenchendo a transparência com branco, e o link público direto do Drive
// (uc?export=view) não é hotlinkável (o Drive devolve uma página de
// confirmação em vez do arquivo). Por isso usamos o mesmo proxy autenticado
// já usado pra áudio/vídeo (/api/media/*) — bytes crus do arquivo, com o
// content-type original (preserva SVG/transparência de verdade).
export function driveRawImg(url: string | undefined | null): string | undefined {
  if (!url) return undefined;
  const m = String(url).match(/[-\w]{25,}/);
  if (!m) return undefined;
  return `/api/media/image?id=${m[0]}`;
}

// Resolve qualquer campo de imagem vindo da planilha: link do Drive (via
// proxy autenticado, funciona independente de permissão pública do
// arquivo) ou link direto de imagem que o usuário colou em vez de subir um
// arquivo (.png/.jpg/.jpeg/.webp/.gif) — nesse caso usa a URL como está.
export function resolveImg(url: string | undefined | null): string | undefined {
  if (!url) return undefined;
  const trimmed = String(url).trim();
  if (!trimmed) return undefined;
  const isDriveLink = trimmed.includes("drive.google.com") || trimmed.includes("docs.google.com");
  if (!isDriveLink && /\.(png|jpe?g|webp|gif)(\?.*)?$/i.test(trimmed)) {
    return trimmed;
  }
  return driveRawImg(trimmed) || trimmed;
}

// Valida se um link colado é aceitável como imagem direta (sem upload):
// precisa terminar em .png/.jpg/.jpeg/.webp e não pode ser um link do Drive
// (esses continuam exigindo upload, pra passar pelo proxy autenticado).
export function isDirectImageUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed) return false;
  if (trimmed.includes("drive.google.com") || trimmed.includes("docs.google.com")) return false;
  return /^https?:\/\/.+\.(png|jpe?g|webp)(\?.*)?$/i.test(trimmed);
}

export function driveAudioSrc(url: string | undefined | null): string | undefined {
  if (!url) return undefined;
  const m = String(url).match(/[-\w]{25,}/);
  if (!m) return undefined;
  return `https://drive.google.com/file/d/${m[0]}/preview`;
}

export function isYoutubeUrl(url: string | undefined | null): boolean {
  return /(?:youtube\.com|youtu\.be)/i.test(String(url || ""));
}

export function youtubeEmbedSrc(url: string | undefined | null): string | undefined {
  if (!url) return undefined;
  const m = String(url).match(/(?:v=|youtu\.be\/|embed\/)([-\w]{11})/);
  if (!m) return undefined;
  return `https://www.youtube.com/embed/${m[1]}?autoplay=1`;
}

export function driveDirectAudio(url: string | undefined | null): string | undefined {
  if (!url) return undefined;
  const m = String(url).match(/[-\w]{25,}/);
  if (!m) return undefined;
  return `https://drive.google.com/uc?export=download&id=${m[0]}`;
}
