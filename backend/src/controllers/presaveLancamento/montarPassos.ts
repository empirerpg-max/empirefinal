// Monta a lista de passos do lançamento de uma campanha de pre-save
// (função pura, sem I/O). Ordem: álbum → subpassos de cada faixa inédita
// (na ordem de `num`) → vínculos das faixas existentes → tracklist →
// material extra → bônus → fechar. Ver o design em
// docs/superpowers/specs/2026-11-23-presave-lancamento-em-passos-design.md.
import type { PreSaveCampanha } from "../preSaveController";
import type { PassoNovo } from "../../services/presaveLancamentoDb";

export const SUBPASSOS_FAIXA = ["musicas", "charts", "codigo", "registro"] as const;

function temExtraAtivo(json: string): boolean {
  if (!json) return false;
  try {
    const e = JSON.parse(json) as { shopAtivo?: boolean; infoAtivo?: boolean; visualAtivo?: boolean };
    return !!(e && (e.shopAtivo || e.infoAtivo || e.visualAtivo));
  } catch {
    return false;
  }
}

export function montarPassosLancamento(
  c: PreSaveCampanha,
  opts: {
    reconciliacao: boolean;
    bonusCongelado: number | null;
    albumExistente?: { linhaAlbuns: number; codigoUnicoAlbum: string; albumTopicId: string } | null;
  },
): PassoNovo[] {
  const procurarAntes = opts.reconciliacao;
  const passos: PassoNovo[] = [];
  let ordem = 0;
  const add = (passo: string, extra: Partial<PassoNovo> = {}) =>
    passos.push({ passo, ordem: ++ordem, procurarAntes, ...extra });

  if (opts.albumExistente) {
    add("album", { estado: "feito", resultado: { ...opts.albumExistente } });
  } else {
    add("album");
  }

  const faixas = [...c.faixas].sort((a, b) => a.num - b.num);
  for (const f of faixas.filter((x) => x.inedita)) {
    for (const sub of SUBPASSOS_FAIXA) add(`faixa:${f.num}:${sub}`);
  }
  for (const f of faixas.filter((x) => !x.inedita)) add(`vinculo:${f.num}`);

  add("tracklist");
  if (temExtraAtivo(c.extraMaterialJson)) add("extra");
  if (c.modo === "missao") add("bonus", { resultado: { valor: opts.bonusCongelado ?? 0 } });
  add("fechar");
  return passos;
}
