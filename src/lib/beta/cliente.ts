// Cliente do Beta no navegador: estado guardado e dados técnicos do reporte.
// Parte pura (tipos e regras) fica em regras.ts; aqui há localStorage/navigator.
import { aparelhoPelaLargura } from "@/lib/uso/coletor";
import { ESTADO_SEGURO, type EstadoBeta, type ModoBeta, type Versao } from "./regras";
import { errosRecentes } from "./errosRecentes";

export { ESTADO_SEGURO, type EstadoBeta };

const CHAVE = "empireBetaEstado";
const MAX_TECNICO = 4000;
const MODOS: readonly string[] = ["desligado", "convidados", "todos", "obrigatorio"];

/** Confere o formato de um estado vindo do armazenamento ou do servidor. */
export function estadoValido(o: unknown): EstadoBeta | null {
  if (!o || typeof o !== "object") return null;
  const e = o as Record<string, unknown>;
  if (typeof e.modo !== "string" || !MODOS.includes(e.modo)) return null;
  if (e.versao !== "beta" && e.versao !== "anterior") return null;
  return {
    modo: e.modo as ModoBeta,
    podeVer: e.podeVer === true,
    podeVoltar: e.podeVoltar === true,
    versao: e.versao as Versao,
    boasVindasVistas: e.boasVindasVistas !== false,
  };
}

/** Estado a usar: o do servidor, senão o guardado, senão o seguro (erro de rede/500 cai aqui). */
export function estadoFinal(servidor: EstadoBeta | null, guardado: EstadoBeta | null): EstadoBeta {
  return servidor ?? guardado ?? ESTADO_SEGURO;
}

export function lerEstadoGuardado(): EstadoBeta | null {
  try {
    const bruto = localStorage.getItem(CHAVE);
    return bruto ? estadoValido(JSON.parse(bruto)) : null;
  } catch {
    return null;
  }
}

export function guardarEstado(e: EstadoBeta): void {
  try {
    localStorage.setItem(CHAVE, JSON.stringify(e));
  } catch {
    // ignora: sem armazenamento, só perde o 1º desenho rápido
  }
}

/** Id do build; no teste (sem o define do Vite) cai em "dev". */
function buildId(): string {
  return typeof __BUILD_ID__ !== "undefined" ? __BUILD_ID__ : "dev";
}

/** Dados técnicos do reporte, em JSON de até 4.000 caracteres (sem query string). */
export function dadosTecnicos(i: { versao: Versao; rota: string }): string {
  const largura = typeof window !== "undefined" ? window.innerWidth : 0;
  const ua = typeof navigator !== "undefined" ? String(navigator.userAgent ?? "") : "";
  const base = {
    versao: i.versao,
    rota: i.rota.split(/[?#]/)[0].slice(0, 300),
    aparelho: aparelhoPelaLargura(largura),
    largura,
    navegador: ua.slice(0, 300),
    build: buildId(),
    erros: errosRecentes(),
  };
  let json = JSON.stringify(base);
  // Corta os erros mais antigos até caber; no limite, sem erros.
  while (json.length > MAX_TECNICO && base.erros.length > 0) {
    base.erros.shift();
    json = JSON.stringify(base);
  }
  return json.length > MAX_TECNICO ? json.slice(0, MAX_TECNICO) : json;
}
