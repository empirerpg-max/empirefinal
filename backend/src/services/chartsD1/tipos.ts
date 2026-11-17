// Tipos base dos charts semanais no D1 (espelho da aba DADOS da planilha EMPIRE - CHARTS).
export type ChartId = "BILLBOARD HOT 100" | "SPOTIFY" | "APPLE MUSIC" | "DIGITAL SALES" | "YOUTUBE";

export const CHARTS: ChartId[] = ["BILLBOARD HOT 100", "SPOTIFY", "APPLE MUSIC", "DIGITAL SALES", "YOUTUBE"];

/** Charts que têm recorte por país. */
export const CHARTS_COM_PAIS: ChartId[] = ["SPOTIFY", "APPLE MUSIC", "YOUTUBE"];

export interface LinhaDados {
  chart: string;
  dataIso: string;
  pos: number;
  titulo: string;
  valor: number;
  valorTotal: number | null;
  artistasPlanilha: string[];
}
