// Coletor de uso (puro): sem React, DOM, fetch nem localStorage.
// Acumula contagens em memória; quem usa (Task 4) decide quando enviar.
// Tipos espelham o servidor (backend/src/services/usoService.ts), que revalida.

export type EventoUso = { evento: "tela" | "acao" | "caminho"; alvo: string; n: number };
export type LoteUso = {
  versao: "anterior" | "beta";
  aparelho: "celular" | "tablet" | "computador";
  eventos: EventoUso[];
  telas?: string[];
};

// Mesmos tetos do servidor, para nada ser descartado lá.
const MAX_EVENTOS = 200;
const MAX_TELAS = 50;
const MAX_ALVO = 120;
const MAX_N = 1000;
const INTERVALO_BUSCA_MS = 10_000;

// Além do próprio envio e de chamadas internas, ignora POSTs automáticos em
// segundo plano (não são ações do jogador): check-in diário ao abrir o app,
// presença da Empire TV (a cada 5 min) e reinscrição automática do push.
const IGNORADOS = [
  "/api/uso",
  "/api/log-error",
  "/api/flags",
  "/api/auth/heartbeat",
  "/api/tv/presenca",
  "/api/notificacoes/push/inscrever",
];
// Lista de permissão: só segmentos que são palavras de rota (minúsculas ASCII, até 4
// partes ligadas por hífen, até 32 caracteres) são mantidos; o resto vira `:id`.
// Risco residual aceito: um slug todo minúsculo com até 4 palavras (ex.: `joao-silva`)
// passa; valores de usuário no app vão na query string, que é descartada.
const SEGMENTO_DE_ROTA = /^[a-z]+(-[a-z]+){0,3}$/;
const VALOR_DE_ABA = /^[\p{L}\p{N} ._›-]{1,30}$/u;

/** Só `/api/...`, sem query, com ids trocados por `:id`; `null` se não deve ser medido. */
export function normalizarCaminhoApi(url: string): string | null {
  let caminho = url;
  if (/^https?:\/\//i.test(caminho)) {
    const m = caminho.match(/^https?:\/\/[^/?#]+(\/[^?#]*)?/i);
    caminho = m?.[1] ?? "";
  }
  caminho = caminho.split(/[?#]/)[0];
  if (caminho !== "/api" && !caminho.startsWith("/api/")) return null;
  if (IGNORADOS.some((p) => caminho === p || caminho.startsWith(p + "/"))) return null;
  return caminho
    .split("/")
    .map((seg) => (seg === "" || (seg.length <= 32 && SEGMENTO_DE_ROTA.test(seg)) ? seg : ":id"))
    .join("/");
}

/** Ação medida de uma requisição; `null` quando não conta. (Limite da busca fica no coletor.) */
export function acaoDaRequisicao(metodo: string, url: string, ok: boolean): string | null {
  const m = metodo.toUpperCase();
  const caminho = normalizarCaminhoApi(url);
  if (!caminho) return null;
  if (m === "GET") return caminho === "/api/busca" ? "buscar" : null;
  if (["POST", "PUT", "PATCH", "DELETE"].includes(m)) return ok ? caminho : null;
  return null;
}

/** Nome da tela: id da rota do TanStack + valor curto de aba/tab/view. */
export function telaDaRota(routeId: string, search: Record<string, unknown>): string {
  for (const chave of ["aba", "tab", "view"]) {
    const v = search?.[chave];
    if (typeof v === "string" && VALOR_DE_ABA.test(v) && !/\d{4,}/.test(v)) {
      return `${routeId} › ${v}`;
    }
  }
  return routeId;
}

export function aparelhoPelaLargura(px: number): "celular" | "tablet" | "computador" {
  return px < 768 ? "celular" : px < 1024 ? "tablet" : "computador";
}

export class ColetorUso {
  private contagens = new Map<string, EventoUso>();
  private telas = new Set<string>();
  private ultimaBusca: number | null = null;

  constructor(private agora: () => number = Date.now) {}

  private somar(evento: EventoUso["evento"], alvo: string): void {
    if (!alvo) return;
    const a = alvo.slice(0, MAX_ALVO);
    const chave = `${evento}\u0000${a}`;
    const atual = this.contagens.get(chave);
    if (atual) atual.n += 1;
    else this.contagens.set(chave, { evento, alvo: a, n: 1 });
  }

  tela(alvo: string): void {
    if (!alvo) return;
    this.somar("tela", alvo);
    this.telas.add(alvo.slice(0, MAX_ALVO));
  }

  acao(alvo: string, telaAtual: string | null): void {
    if (!alvo) return;
    if (alvo === "buscar") {
      const t = this.agora();
      if (this.ultimaBusca !== null && t < this.ultimaBusca) this.ultimaBusca = null; // relógio voltou
      if (this.ultimaBusca !== null && t - this.ultimaBusca < INTERVALO_BUSCA_MS) return;
      this.ultimaBusca = t;
    }
    this.somar("acao", alvo);
    if (telaAtual) this.somar("caminho", `${alvo} ← ${telaAtual}`);
  }

  /** Telas distintas registradas desde a última retirada (ou criação). */
  telasDoDia(): string[] {
    return [...this.telas];
  }

  /** Tira o lote acumulado (e zera); `null` se não há nada. */
  retirarLote(versao: LoteUso["versao"], aparelho: LoteUso["aparelho"]): LoteUso | null {
    if (this.contagens.size === 0) return null;
    const eventos = [...this.contagens.values()]
      .sort((a, b) => b.n - a.n)
      .slice(0, MAX_EVENTOS)
      .map((e) => ({ ...e, n: Math.min(e.n, MAX_N) }));
    const telas = [...this.telas].slice(0, MAX_TELAS);
    this.contagens.clear();
    this.telas.clear();
    const lote: LoteUso = { versao, aparelho, eventos };
    if (telas.length) lote.telas = telas;
    return lote;
  }
}
