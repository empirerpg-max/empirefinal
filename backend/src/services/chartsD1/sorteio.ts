// Sorteio determinístico: mesma chave → mesmo número, para todos os jogadores.
// FNV-1a 32 bits sobre o UTF-8 da chave, normalizado para [0, 1).
export function sorteio01(chave: string): number {
  const bytes = new TextEncoder().encode(chave);
  let h = 0x811c9dc5;
  for (const b of bytes) {
    h ^= b;
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 4294967296;
}
