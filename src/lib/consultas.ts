/** Tempos de cache do React Query por tipo de dado (spec 5.11). Charts não usa isto: mantém o comportamento de hoje. */
export const TEMPOS_CACHE = {
  aoVivo: 30_000,
  catalogo: 300_000,
  social: 30_000,
} as const;

export function opcoesConsulta(tipo: keyof typeof TEMPOS_CACHE): {
  staleTime: number;
  refetchOnWindowFocus: boolean;
} {
  return {
    staleTime: TEMPOS_CACHE[tipo],
    refetchOnWindowFocus: tipo !== "catalogo",
  };
}
