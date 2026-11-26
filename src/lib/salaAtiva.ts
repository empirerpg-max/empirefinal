// "Sala ativa" da Empire TV: a sala está aberta em TELA CHEIA na rota /tv
// (o mini player sozinho em outra tela NÃO conta: lá uma tela quebrada por
// chunk desatualizado é pior que perder a miniatura, e a presença pendente
// fica guardada no sessionStorage). Enquanto isso, nada recarrega sozinho —
// nem chunk desatualizado (staleChunk.ts) nem troca de service worker
// (pwa.ts). Relato real: no meio da transmissão a tela ficava cinza/preta e
// a pessoa caía no menu da Empire TV, tendo que entrar de novo na sala.
//
// Sem dependências (nem React, nem toast): o TvPage (routes/tv.tsx) marca o
// estado e quem quer recarregar injeta o próprio `toastFn`.

type ToastFn = (
  title: string,
  opts?: {
    description?: string;
    duration?: number;
    action?: { label: string; onClick: () => void };
  },
) => void;

let ativa = false;
const ouvintes = new Set<() => void>();

export function marcarSalaAtiva(v: boolean): void {
  const saiu = ativa && !v;
  ativa = v;
  if (saiu) for (const fn of Array.from(ouvintes)) fn();
}

export function salaAtiva(): boolean {
  return ativa;
}

/** Chamado toda vez que a sala passa de ativa para inativa. Devolve o "desinscrever". */
export function aoSairDaSala(fn: () => void): () => void {
  ouvintes.add(fn);
  return () => {
    ouvintes.delete(fn);
  };
}

export function deveAdiarRecarga(digitando: boolean, sala: boolean): boolean {
  return digitando || sala;
}

// Uma recarga pendente por vez (deploys seguidos não empilham avisos).
let pendente: { recarregar: () => void; sair: () => void } | null = null;

function executarPendente() {
  const p = pendente;
  if (!p) return;
  pendente = null;
  p.sair();
  p.recarregar();
}

/**
 * Não recarrega agora: mostra UM aviso com "Atualizar agora" e recarrega
 * sozinho quando a pessoa sair da sala (salaAtiva() volta a false).
 */
export function adiarAteSairDaSala(recarregar: () => void, toastFn?: ToastFn): void {
  if (pendente) return;
  pendente = { recarregar, sair: aoSairDaSala(executarPendente) };
  toastFn?.("Nova versão disponível — atualiza quando você sair da sala", {
    duration: 15000,
    action: { label: "Atualizar agora", onClick: executarPendente },
  });
}

/** Id da sala no endereço (`?sala=`), ou null. Aceita o formato JSON do roteador (`"123"`). */
export function salaDaUrl(search: string): string | null {
  const bruto = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search).get("sala");
  if (bruto == null) return null;
  let v = bruto.trim();
  if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1).trim();
  return v ? v : null;
}
