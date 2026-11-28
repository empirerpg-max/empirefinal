// Regras puras da versão do Beta test (sem DOM, fetch nem backend):
// usadas pelo app e pelo Worker.
export type ModoBeta = "desligado" | "convidados" | "todos" | "obrigatorio";
export type Versao = "beta" | "anterior";
export type ConfigBeta = { modo: ModoBeta; convidados: string[] };

export const CONFIG_BETA_PADRAO: ConfigBeta = { modo: "desligado", convidados: [] };

const MODOS: readonly string[] = ["desligado", "convidados", "todos", "obrigatorio"];
const MAX_CONVIDADOS = 500;

/** Lê a config salva (JSON); qualquer coisa fora do formato vira o padrão. */
export function lerConfigBeta(raw: string | null): ConfigBeta {
  if (!raw) return { ...CONFIG_BETA_PADRAO, convidados: [] };
  let o: unknown;
  try {
    o = JSON.parse(raw);
  } catch {
    return { ...CONFIG_BETA_PADRAO, convidados: [] };
  }
  if (!o || typeof o !== "object") return { ...CONFIG_BETA_PADRAO, convidados: [] };
  const { modo, convidados } = o as { modo?: unknown; convidados?: unknown };
  if (typeof modo !== "string" || !MODOS.includes(modo)) return { ...CONFIG_BETA_PADRAO, convidados: [] };
  const lista: string[] = [];
  if (Array.isArray(convidados)) {
    for (const c of convidados) {
      if (typeof c !== "string") continue;
      const t = c.trim();
      if (t && !lista.includes(t)) lista.push(t);
      if (lista.length >= MAX_CONVIDADOS) break;
    }
  }
  return { modo: modo as ModoBeta, convidados: lista };
}

/** Quem vê o Beta, se pode voltar à versão anterior e qual versão abre. */
export function estadoBeta(i: {
  modo: ModoBeta;
  convidado: boolean;
  admin: boolean;
  escolha: Versao | null;
}): { podeVer: boolean; podeVoltar: boolean; versao: Versao } {
  const { modo, convidado, admin, escolha } = i;
  if (modo === "obrigatorio") return { podeVer: true, podeVoltar: false, versao: "beta" };
  // Admin vê o Beta em qualquer modo (testa antes de ligar).
  const podeVer = admin || modo === "todos" || (modo === "convidados" && convidado);
  if (!podeVer) return { podeVer: false, podeVoltar: false, versao: "anterior" };
  const padrao: Versao = modo === "desligado" ? "anterior" : "beta";
  return { podeVer: true, podeVoltar: true, versao: escolha ?? padrao };
}

export const MOTIVOS_VOLTA = ["nao_achei", "quebrou", "lento", "visual_antigo", "outro"] as const;
export type MotivoVolta = (typeof MOTIVOS_VOLTA)[number];

export const ROTULO_MOTIVO: Record<MotivoVolta, string> = {
  nao_achei: "Não achei uma função",
  quebrou: "Algo quebrou",
  lento: "Ficou lento",
  visual_antigo: "Prefiro o visual antigo",
  outro: "Outro",
};
