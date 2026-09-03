import { ThumbsUp } from "lucide-react";

/**
 * Badge de avaliação — mesma lógica visual usada no Fórum (renderMetacriticBadge):
 * verde ≥75, amarelo ≥50, vermelho <50. Sem nota real, não renderiza nada
 * (nunca inventa um número — antes havia um fallback fixo "80" que fingia
 * ser dado real).
 * `variant="likes"` troca o número colorido pelo selo de curtidas (vídeos),
 * `variant="metacritic"` é o selo numérico oficial (músicas/álbuns).
 */
export function ScoreBadge({
  score,
  variant,
  className = "",
}: {
  score?: string | number | null;
  variant: "metacritic" | "likes";
  className?: string;
}) {
  const num = parseInt(String(score ?? ""), 10);

  if (isNaN(num) || num <= 0) {
    return null;
  }

  if (variant === "likes") {
    // A nota (0-100, dada pelos jogadores) nunca foi pensada como a
    // contagem de likes em si — é só o insumo. A conversão pra uma
    // quantidade "de verdade" (nota 90 → 27.000 likes) sempre devia
    // acontecer aqui na exibição, mas nunca tinha sido implementada: o
    // componente mostrava a nota crua com "Likes" colado atrás. Como é só
    // exibição (não grava nada), corrigir aqui já vale pra tudo que já
    // existe e pro que vier, sem precisar migrar planilha nenhuma.
    // Só multiplica quem ainda está na escala crua (0-100) — um valor acima
    // disso já é uma contagem de likes de verdade (não uma nota), e
    // multiplicar de novo inflaria ele sem sentido.
    const likes = num <= 100 ? Math.round(num * 300) : num;
    return (
      <div
        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-500/20 text-emerald-400 font-black text-xs sm:text-sm border border-emerald-500/30 ${className}`}
      >
        <ThumbsUp className="size-3.5 fill-emerald-400" />
        <span>{likes.toLocaleString("pt-BR")} Likes</span>
      </div>
    );
  }

  let bgColor = "bg-emerald-500 text-black";
  if (num < 50) bgColor = "bg-red-500 text-white";
  else if (num < 75) bgColor = "bg-amber-400 text-black";

  return (
    <div
      className={`inline-flex items-center justify-center font-black text-sm sm:text-base px-3 py-1.5 rounded-xl shadow-md uppercase tracking-wider ${bgColor} ${className}`}
    >
      <span>{num}</span>
    </div>
  );
}
