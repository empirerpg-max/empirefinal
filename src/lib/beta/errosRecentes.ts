// Últimos erros de JavaScript da página (para os dados técnicos do reporte).
// Guarda só mensagem + 1ª linha da pilha, cortadas; nada de conteúdo de usuário.

export type ErroRecente = { msg: string; em: number };

const MAX_ERROS = 5;
const MAX_MSG = 300;
const erros: ErroRecente[] = [];
let instalado = false;

function guardar(msg: string, pilha?: string): void {
  try {
    const primeiraLinha = pilha ? (pilha.split("\n").find((l) => /^\s*at\s/.test(l)) ?? "") : "";
    const texto = (primeiraLinha ? `${msg} | ${primeiraLinha.trim()}` : msg).slice(0, MAX_MSG);
    erros.push({ msg: texto, em: Date.now() });
    if (erros.length > MAX_ERROS) erros.splice(0, erros.length - MAX_ERROS);
  } catch {
    // ignora
  }
}

/** Cópia dos últimos erros (do mais antigo ao mais novo). */
export function errosRecentes(): ErroRecente[] {
  return erros.map((e) => ({ ...e }));
}

/** Instala os ouvintes uma única vez; chamar de novo não faz nada. */
export function instalarErrosRecentes(): void {
  if (instalado || typeof window === "undefined") return;
  instalado = true;
  window.addEventListener("error", (ev) => {
    const e = ev.error as { stack?: string } | undefined;
    guardar(String(ev.message ?? "erro"), e?.stack);
  });
  window.addEventListener("unhandledrejection", (ev) => {
    const r = ev.reason as { message?: unknown; stack?: string } | string | undefined;
    if (typeof r === "string") guardar(r);
    else guardar(String(r?.message ?? "promessa rejeitada"), r?.stack);
  });
}

/** Só para testes. */
export function _zerarErrosRecentes(): void {
  erros.length = 0;
}
