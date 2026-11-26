import { useEffect } from "react";
import { api } from "@/lib/api";
import { ColetorMinutos, type LoteMinutos } from "@/lib/tvPresencaCliente";
import { getStoredLogin, getStoredSessionToken } from "@/components/LoginScreen";

/** Marca a cada 30 s — o coletor guarda no máximo 1 por minuto, então nenhum minuto de relógio fica sem marca. */
const MARCAR_A_CADA_MS = 30_000;
const ENVIAR_A_CADA_MS = 5 * 60_000;
/** Prazo do envio comum — requisição pendurada não trava os próximos envios. */
const PRAZO_ENVIO_MS = 15_000;
const CHAVE_STORAGE = "empire-tv-presenca-pendentes";

// ---------- Marcas pendentes por programa (vivem além da sala/mini player) ----------
// Fechar a transmissão, trocar de programa ou recarregar não perde o que
// ainda não foi confirmado pelo servidor: fica aqui (e no sessionStorage) e
// vai de novo no próximo envio.
const pendentesPorPrograma = new Map<string, ColetorMinutos>();
/** Programas com envio comum em andamento (envio de saída não espera). */
const emEnvio = new Set<string>();
let carregado = false;

function carregar() {
  if (carregado) return;
  carregado = true;
  try {
    const raw = sessionStorage.getItem(CHAVE_STORAGE);
    const obj = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
    if (obj && typeof obj === "object") {
      for (const [id, instantes] of Object.entries(obj)) {
        const c = ColetorMinutos.de(instantes);
        if (!c.vazio()) pendentesPorPrograma.set(id, c);
      }
    }
  } catch {
    /* sem sessionStorage: segue só em memória */
  }
}

function salvar() {
  try {
    const obj: Record<string, number[]> = {};
    for (const [id, c] of pendentesPorPrograma) if (!c.vazio()) obj[id] = c.exportar();
    if (Object.keys(obj).length === 0) sessionStorage.removeItem(CHAVE_STORAGE);
    else sessionStorage.setItem(CHAVE_STORAGE, JSON.stringify(obj));
  } catch {
    /* ignora */
  }
}

function coletorDe(programaId: string): ColetorMinutos {
  let c = pendentesPorPrograma.get(programaId);
  if (!c) {
    c = new ColetorMinutos();
    pendentesPorPrograma.set(programaId, c);
  }
  return c;
}

const identificado = () => !!(getStoredLogin()?.id || getStoredSessionToken());

/** `saindo`: página/programa indo embora — manda já (keepalive, sem prazo), mesmo com outro envio em andamento. */
function enviarPrograma(programaId: string, saindo: boolean) {
  const c = pendentesPorPrograma.get(programaId);
  if (!c || !identificado()) return;
  if (!saindo && emEnvio.has(programaId)) return;
  const lote: LoteMinutos = c.pendentes(Date.now());
  if (lote.idades.length === 0) {
    if (c.vazio()) {
      pendentesPorPrograma.delete(programaId);
      salvar();
    }
    return;
  }
  const nome = getStoredLogin()?.nome || "Anônimo";
  if (!saindo) emEnvio.add(programaId);
  api
    .enviarMinutosPresenca(programaId, lote.idades, nome, saindo ? {} : { timeoutMs: PRAZO_ENVIO_MS })
    .then((ok) => {
      if (!ok) return; // fica pendente para o próximo envio
      c.confirmar(lote); // só os minutos deste lote
      if (c.vazio() && pendentesPorPrograma.get(programaId) === c) pendentesPorPrograma.delete(programaId);
      salvar();
    })
    .finally(() => {
      if (!saindo) emEnvio.delete(programaId);
    });
}

function enviarTodos(saindo: boolean) {
  for (const id of [...pendentesPorPrograma.keys()]) enviarPrograma(id, saindo);
}

/**
 * Conta a presença na Empire TV enquanto há transmissão aberta — na sala
 * (tela cheia) OU no mini player flutuante, já que os dois vivem dentro do
 * TvPlayerProvider. Logado e com a aba visível, marca a cada 30 s (no máximo
 * 1 marca por minuto); envia a cada 5 min, ao esconder a aba e no pagehide.
 * Trocar de programa/fechar envia o pendente do anterior; o que não for
 * confirmado continua guardado e vai de novo no próximo envio (ou ao abrir o
 * app de novo na mesma aba).
 * Montado pelo próprio TvPlayerProvider, que passa o `watching` atual.
 * Não desenha nada.
 */
export function PresencaTVTracker({ programaId }: { programaId: string | null }) {
  // Reenvio periódico do que sobrou (mesmo sem transmissão aberta).
  useEffect(() => {
    if (typeof document === "undefined") return;
    carregar();
    enviarTodos(false);
    const t = setInterval(() => enviarTodos(false), ENVIAR_A_CADA_MS);
    const onPagehide = () => enviarTodos(true);
    window.addEventListener("pagehide", onPagehide);
    return () => {
      clearInterval(t);
      window.removeEventListener("pagehide", onPagehide);
    };
  }, []);

  useEffect(() => {
    if (!programaId || typeof document === "undefined") return;
    carregar();

    // Deslogado não marca: minutos de antes do login nunca são enviados.
    const marcar = () => {
      if (document.hidden || !identificado()) return;
      coletorDe(programaId).marcar(Date.now());
      salvar();
    };
    const onVisibilidade = () => {
      if (document.hidden) enviarTodos(false);
      else marcar();
    };

    marcar();
    const tMarcar = setInterval(marcar, MARCAR_A_CADA_MS);
    document.addEventListener("visibilitychange", onVisibilidade);

    return () => {
      clearInterval(tMarcar);
      document.removeEventListener("visibilitychange", onVisibilidade);
      // Troca de programa / fechou a transmissão: envia já o pendente deste programa.
      enviarPrograma(programaId, true);
    };
  }, [programaId]);

  return null;
}
