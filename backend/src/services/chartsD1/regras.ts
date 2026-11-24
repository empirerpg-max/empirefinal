// Regras da semana das paradas por país (valores padrão + sobreposição via config).
export interface RegraPaises {
  nac_min: number;
  nac_max: number;
  foco_min: number;
  foco_max: number;
  bonus_teto: number;
  variacao: number;
  top_pais: number;
  fracao_paga_spotify: number;
}

export interface Parada {
  id: string;
  nome: string;
  /** Aliases do país; vale o primeiro que existir em pais_peso. */
  paises: string[];
  tipo: "unidades" | "receita" | "excl";
  top: number;
  ordem: number;
  /** Taxas por fonte (0 = fonte não conta). Em "receita" são preços por unidade (multiplicam). */
  tp: number;
  tga: number;
  tgv: number;
  descricao: string;
  acr?: { semanas: number; quedas: number; tp: number; tga: number; tgv: number } | null;
  max_por_artista?: number | null;
  recorrencia?: { semanas: number; pos: number }[] | null;
}

export interface RegrasSemana {
  versao: 1;
  paises: RegraPaises;
  paradas: Parada[];
}

const recorrenciaEua = () => [{ semanas: 20, pos: 50 }, { semanas: 52, pos: 25 }];

const p = (
  id: string, nome: string, paises: string[], tipo: Parada["tipo"], ordem: number,
  tp: number, tga: number, tgv: number, descricao: string,
  extras: Partial<Parada> = {}, top = 50,
): Parada => ({ id, nome, paises, tipo, top, ordem, tp, tga, tgv, descricao, ...extras });

export const REGRAS_PADRAO: RegrasSemana = {
  versao: 1,
  paises: {
    nac_min: 1.5, nac_max: 4, foco_min: 0.5, foco_max: 1.5,
    bonus_teto: 0.2, variacao: 0.15, top_pais: 50, fracao_paga_spotify: 0.45,
  },
  paradas: [
    p("EUA", "Billboard Hot 100", ["ESTADOS UNIDOS", "EUA", "USA"], "unidades", 1, 100, 300, 300, "Estados Unidos · streaming pago e grátis", { recorrencia: recorrenciaEua() }),
    p("UK", "UK Official Charts", ["REINO UNIDO", "UK", "INGLATERRA"], "unidades", 2, 100, 600, 600, "Reino Unido · streaming pago e grátis", { acr: { semanas: 9, quedas: 3, tp: 200, tga: 1200, tgv: 1200 }, max_por_artista: 3 }),
    p("AU", "ARIA Charts", ["AUSTRÁLIA"], "unidades", 3, 100, 600, 600, "Austrália · streaming de áudio e vídeo"),
    p("JP", "Oricon", ["JAPÃO"], "unidades", 4, 300, 300, 300, "Japão · todos os streams"),
    p("KR", "Circle Chart", ["COREIA DO SUL", "CORÉIA DO SUL"], "unidades", 5, 100, 200, 200, "Coreia do Sul · streaming"),
    p("DE", "Offizielle Deutsche Charts", ["ALEMANHA"], "receita", 6, 0.008, 0.0008, 0.0008, "Alemanha · por receita"),
    p("FR", "SNEP", ["FRANÇA"], "unidades", 7, 150, 0, 0, "França · só streaming pago"),
    p("CA", "Billboard Canadian Hot 100", ["CANADÁ"], "unidades", 8, 100, 300, 300, "Canadá · streaming pago e grátis", { recorrencia: recorrenciaEua() }),
    p("BR", "Billboard Brasil Hot 100", ["BRASIL"], "unidades", 9, 100, 300, 300, "Brasil · streaming pago e grátis"),
    p("AR", "Billboard Argentina Hot 100", ["ARGENTINA"], "unidades", 10, 100, 300, 300, "Argentina · streaming pago e grátis"),
    p("MX", "Billboard México", ["MÉXICO"], "unidades", 11, 100, 300, 300, "México · streaming pago e grátis"),
    p("EXCL_US", "Global Excl. US", ["ESTADOS UNIDOS", "EUA", "USA"], "excl", 0, 100, 300, 300, "Mundo sem os EUA · streaming", {}, 100),
  ],
};

const CHAVES_PAISES = Object.keys(REGRAS_PADRAO.paises) as (keyof RegraPaises)[];

/** Monta as regras a partir da config (chave → texto); valores inválidos caem no padrão. */
export function regrasDeConfig(cfg: Map<string, string>): RegrasSemana {
  const paises = { ...REGRAS_PADRAO.paises };
  for (const k of CHAVES_PAISES) {
    const bruto = cfg.get(k);
    if (bruto === undefined || bruto.trim() === "") continue;
    const n = Number(bruto);
    if (Number.isFinite(n)) paises[k] = n;
  }
  let paradas: Parada[] | null = null;
  const js = cfg.get("paradas");
  if (js) {
    try {
      const v = JSON.parse(js);
      if (Array.isArray(v) && v.length > 0 && v.every((x) => x && typeof x === "object" && typeof x.id === "string")) {
        paradas = v as Parada[];
      }
    } catch { /* mantém o padrão */ }
  }
  return { versao: 1, paises, paradas: paradas ?? structuredClone(REGRAS_PADRAO.paradas) };
}

/** Lê as regras gravadas na semana; null se vazio ou inválido. */
export function parseRegrasSemana(json: string | null | undefined): RegrasSemana | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json);
    if (!v || typeof v !== "object" || v.versao !== 1) return null;
    if (!v.paises || typeof v.paises !== "object" || !Array.isArray(v.paradas)) return null;
    return v as RegrasSemana;
  } catch {
    return null;
  }
}
