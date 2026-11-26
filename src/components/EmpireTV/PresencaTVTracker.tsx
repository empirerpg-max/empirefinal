import { useEffect } from "react";
import { api } from "@/lib/api";
import {
  ColetorMinutos,
  chavePendente,
  entradasParaEnviar,
  gravarPendentesGuardados,
  lerPendentesGuardados,
  type LoteMinutos,
  type PendenteGuardado,
} from "@/lib/tvPresencaCliente";
import { getStoredLogin } from "@/components/LoginScreen";

/** Marca a cada 30 s — o coletor guarda no máximo 1 por minuto, então nenhum minuto de relógio fica sem marca. */
const MARCAR_A_CADA_MS = 30_000;
const ENVIAR_A_CADA_MS = 5 * 60_000;
/** Prazo do envio comum — requisição pendurada não trava os próximos envios. */
const PRAZO_ENVIO_MS = 15_000;
const CHAVE_STORAGE = "empire-tv-presenca-pendentes";

// ---------- Marcas pendentes por jogador + programa (vivem além da sala/mini player) ----------
// Fechar a transmissão, trocar de programa ou recarregar não perde o que
// ainda não foi confirmado pelo servidor: fica aqui (e no sessionStorage) e
// vai de novo no próximo envio. Cada entrada tem DONO (login.id de quando
// marcou) e só é enviada com esse mesmo login — outra conta na mesma aba
// nunca recebe os minutos de quem saiu.
let pendentes = new Map<string, PendenteGuardado>();
/** Entradas com envio comum em andamento (envio de saída não espera). */
const emEnvio = new Set<string>();
let carregado = false;

const donoAtual = (): string | null => {
  const id = getStoredLogin()?.id;
  return id ? String(id) : null;
};

function carregar() {
  if (carregado) return;
  carregado = true;
  try {
    const raw = sessionStorage.getItem(CHAVE_STORAGE);
    // Entradas de outro jogador (ou sem dono) caem aqui.
    pendentes = lerPendentesGuardados(raw ? JSON.parse(raw) : null, donoAtual());
  } catch {
    /* sem sessionStorage: segue só em memória */
  }
  salvar();
}

function salvar() {
  try {
    const obj = gravarPendentesGuardados(pendentes);
    if (Object.keys(obj).length === 0) sessionStorage.removeItem(CHAVE_STORAGE);
    else sessionStorage.setItem(CHAVE_STORAGE, JSON.stringify(obj));
  } catch {
    /* ignora */
  }
}

function coletorDe(dono: string, programaId: string): ColetorMinutos {
  const chave = chavePendente(dono, programaId);
  let e = pendentes.get(chave);
  if (!e) {
    e = { dono, programaId, coletor: new ColetorMinutos() };
    pendentes.set(chave, e);
  }
  return e.coletor;
}

/** `saindo`: página/programa indo embora — manda já (keepalive, sem prazo), mesmo com outro envio em andamento. */
function enviarEntrada(e: PendenteGuardado, saindo: boolean) {
  // Confere de novo: só o próprio dono, logado agora, envia.
  if (e.dono !== donoAtual()) return;
  const chave = chavePendente(e.dono, e.programaId);
  if (!saindo && emEnvio.has(chave)) return;
  const c = e.coletor;
  const lote: LoteMinutos = c.pendentes(Date.now());
  if (lote.idades.length === 0) {
    if (c.vazio() && pendentes.get(chave) === e) {
      pendentes.delete(chave);
      salvar();
    }
    return;
  }
  const nome = getStoredLogin()?.nome || "Anônimo";
  if (!saindo) emEnvio.add(chave);
  api
    .enviarMinutosPresenca(e.programaId, lote.idades, nome, saindo ? {} : { timeoutMs: PRAZO_ENVIO_MS })
    .then((ok) => {
      if (!ok) return; // fica pendente para o próximo envio
      c.confirmar(lote); // só os minutos deste lote
      if (c.vazio() && pendentes.get(chave) === e) pendentes.delete(chave);
      salvar();
    })
    .finally(() => {
      if (!saindo) emEnvio.delete(chave);
    });
}

function enviarTodos(saindo: boolean, programaId?: string) {
  for (const e of entradasParaEnviar(pendentes, donoAtual())) {
    if (programaId === undefined || e.programaId === programaId) enviarEntrada(e, saindo);
  }
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
      const dono = donoAtual();
      if (document.hidden || !dono) return;
      coletorDe(dono, programaId).marcar(Date.now());
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
      enviarTodos(true, programaId);
    };
  }, [programaId]);

  return null;
}
