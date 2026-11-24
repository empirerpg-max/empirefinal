// Formatação de saída de /api/charts compartilhada entre a leitura da
// planilha (chartsController) e a leitura do D1 (chartsD1/repo).

// Mesma lógica do fmt() original: "-"/vazio → "0", senão número formatado
// pt-BR (separador de milhar).
export function fmt(v: unknown): string {
  const s = String(v ?? "");
  if (!s || s === "-") return "0";
  const n = Number(s.replace(/[^\d]/g, ""));
  return n.toLocaleString("pt-BR");
}

// Mesma lógica do fixImg() original: extrai o ID do Drive de dentro de
// qualquer formato de link (uc?id=, /file/d/.../view, thumbnail?id=, etc)
// e devolve um link de thumbnail padronizado. O frontend já sabe rotear
// qualquer link drive.google.com pelo proxy autenticado (resolveImg).
export function fixImg(u: unknown): string {
  const s = String(u ?? "");
  // "" vazio faz o frontend usar o próprio fallback visual (ícone/estrela)
  // — devolver uma URL fixa aqui (como era antes, "via.placeholder.com",
  // serviço desativado há tempos) faz o <img> tentar carregar um link morto
  // e sempre falhar, mesmo quando a capa é legitimamente vazia.
  if (!s || s === "-") return "";
  const m = s.match(/[-\w]{25,}/);
  return m ? `https://drive.google.com/thumbnail?id=${m[0]}&sz=s1000` : s;
}
