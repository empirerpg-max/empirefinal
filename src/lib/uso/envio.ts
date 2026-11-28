// Envio da medição de uso (Task 4): liga o coletor puro ao navegador.
// - Um lote a cada 5 min enquanto a página está visível (fetch keepalive).
// - Um lote ao esconder/fechar a página (`visibilitychange→hidden`/`pagehide`)
//   via `navigator.sendBeacon` — não passa pelo wrapper de `window.fetch`.
// - Resposta `{ ativo: false }` → para tudo até a página ser recarregada.
// Nada aqui pode quebrar o app: todo acesso a navegador/armazenamento é
// protegido e erros são engolidos. Seguro no SSR (só age com `window`).

import { ColetorUso, aparelhoPelaLargura, telasDoLote, type LoteUso } from "./coletor";
import type { Versao } from "@/lib/beta/regras";
import { getStoredSessionToken } from "@/components/LoginScreen";

export type MedicaoUso = {
  tela(alvo: string): void;
  acao(alvo: string): void;
  parar(): void;
};

const INTERVALO_ENVIO_MS = 5 * 60 * 1000;
const ROTA_ENVIO = "/api/uso";
const PREFIXO_TELAS = "uso-telas-";

let instancia: MedicaoUso | null = null;
// Versão do app que o jogador está usando (Beta ou anterior); vai em cada lote.
let versaoUso: Versao = "anterior";

/** Define a versão que os próximos lotes de uso carregam. */
export function definirVersaoUso(v: Versao): void {
  versaoUso = v === "beta" ? "beta" : "anterior";
}

const SEM_EFEITO: MedicaoUso = { tela() {}, acao() {}, parar() {} };

/** Instância já iniciada (ou `null`), para quem não tem o objeto em mãos. */
export function usoGlobal(): MedicaoUso | null {
  return instancia;
}

/** Dia em UTC, no formato AAAA-MM-DD. */
function diaUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Telas já mandadas hoje (lidas do localStorage); `null` se o armazenamento falhar. */
function telasJaEnviadas(dia: string): Set<string> | null {
  try {
    const chaveHoje = PREFIXO_TELAS + dia;
    // Apaga os dias velhos.
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PREFIXO_TELAS) && k !== chaveHoje) localStorage.removeItem(k);
    }
    const bruto = localStorage.getItem(chaveHoje);
    const lista: unknown = bruto ? JSON.parse(bruto) : [];
    return new Set(Array.isArray(lista) ? lista.filter((t) => typeof t === "string") : []);
  } catch {
    return null;
  }
}

function lembrarTelasEnviadas(dia: string, telas: Set<string>): void {
  try {
    localStorage.setItem(PREFIXO_TELAS + dia, JSON.stringify([...telas]));
  } catch {
    // ignora: o servidor deduplica por dia
  }
}

export function iniciarMedicaoUso(): MedicaoUso {
  if (instancia) return instancia;
  if (typeof window === "undefined" || typeof document === "undefined") return SEM_EFEITO;

  const coletor = new ColetorUso();
  let telaAtual: string | null = null;
  let parado = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  /**
   * Tira o lote do coletor, deixando em `telas` só as telas novas do dia.
   * `confirmar()` grava essas telas como enviadas — só depois de o envio ser
   * aceito (beacon enfileirado / resposta ok), para não perder telas, e só se
   * o lote foi com token (sem token o servidor não grava telas).
   */
  const montarLote = (): {
    lote: LoteUso & { token?: string };
    confirmar: () => void;
  } | null => {
    const lote = coletor.retirarLote(versaoUso, aparelhoPelaLargura(window.innerWidth));
    if (!lote) return null;
    const token = getStoredSessionToken();
    const dia = diaUtc();
    const enviadas = token && lote.telas?.length ? telasJaEnviadas(dia) : null;
    const { telas, aConfirmar } = telasDoLote(lote.telas, enviadas, !!token);
    if (telas) lote.telas = telas;
    else delete lote.telas;
    const confirmar = () => {
      if (!aConfirmar.length) return;
      // Relê o armazenamento: outro envio pode ter gravado no meio tempo.
      const atuais = telasJaEnviadas(dia) ?? new Set(enviadas);
      for (const t of aConfirmar) atuais.add(t);
      lembrarTelasEnviadas(dia, atuais);
    };
    return { lote: token ? { ...lote, token } : lote, confirmar };
  };

  const enviarComBeacon = () => {
    if (parado) return;
    try {
      const pronto = montarLote();
      if (!pronto) return;
      const corpo = JSON.stringify(pronto.lote);
      if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
        const aceito = navigator.sendBeacon(ROTA_ENVIO, new Blob([corpo], { type: "text/plain" }));
        if (aceito) pronto.confirmar();
      }
    } catch {
      // ignora
    }
  };

  const enviarComFetch = () => {
    if (parado) return;
    try {
      const pronto = montarLote();
      if (!pronto) return;
      window
        .fetch(ROTA_ENVIO, {
          method: "POST",
          keepalive: true,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(pronto.lote),
        })
        .then((res) => {
          if (res.ok) pronto.confirmar();
          return res.json();
        })
        .then((dados: unknown) => {
          if (dados && typeof dados === "object" && (dados as { ativo?: unknown }).ativo === false) {
            medicao.parar();
          }
        })
        .catch(() => {});
    } catch {
      // ignora
    }
  };

  const ligarTimer = () => {
    if (parado || timer !== null) return;
    timer = setInterval(enviarComFetch, INTERVALO_ENVIO_MS);
  };
  const desligarTimer = () => {
    if (timer !== null) clearInterval(timer);
    timer = null;
  };

  const aoMudarVisibilidade = () => {
    if (document.visibilityState === "visible") {
      ligarTimer();
    } else {
      desligarTimer();
      if (document.visibilityState === "hidden") enviarComBeacon();
    }
  };
  const aoSairDaPagina = () => enviarComBeacon();

  const medicao: MedicaoUso = {
    tela(alvo) {
      if (parado || !alvo) return;
      try {
        telaAtual = alvo;
        coletor.tela(alvo);
      } catch {
        // ignora
      }
    },
    acao(alvo) {
      if (parado || !alvo) return;
      try {
        coletor.acao(alvo, telaAtual);
      } catch {
        // ignora
      }
    },
    parar() {
      parado = true;
      desligarTimer();
      document.removeEventListener("visibilitychange", aoMudarVisibilidade);
      window.removeEventListener("pagehide", aoSairDaPagina);
    },
  };

  document.addEventListener("visibilitychange", aoMudarVisibilidade);
  window.addEventListener("pagehide", aoSairDaPagina);
  if (document.visibilityState === "visible") ligarTimer();

  instancia = medicao;
  return medicao;
}
