import { Star, ThumbsUp } from "lucide-react";

/**
 * Badge de avaliação — mesma lógica visual usada no Fórum (renderMetacriticBadge):
 * verde ≥75, amarelo ≥50, vermelho <50, "tbd" sem nota ainda.
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
  const num = parseInt(String(score ?? "0"), 10);

  if (isNaN(num) || num <= 0) {
    return (
      <div
        className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-neutral-800 border border-white/10 text-neutral-400 font-black text-xs ${className}`}
      >
        <Star className="size-3.5" />
        <span>tbd</span>
      </div>
    );
  }

  if (variant === "likes") {
    return (
      <div
        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-500/20 text-emerald-400 font-black text-xs sm:text-sm border border-emerald-500/30 ${className}`}
      >
        <ThumbsUp className="size-3.5 fill-emerald-400" />
        <span>{num} Likes</span>
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
