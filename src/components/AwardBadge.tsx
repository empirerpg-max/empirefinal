import { driveImg, AWARD_BADGE_ICON_URL } from "@/lib/api";

export type AwardBadgeInfo = { award: string; ano: string; status: "vencedor" | "indicado" };

/**
 * Selo "Vencedor do X (ano)" / "Indicado ao X (ano)" — usa o símbolo
 * oficial de vencedor criado pelo dono do app pra esse fim. Sempre um
 * elemento à parte da capa/thumb (nunca sobreposto), pra capa continuar
 * sendo sempre a prioridade visual.
 */
export function AwardBadge({ award, ano, status, className = "" }: AwardBadgeInfo & { className?: string }) {
  const label = status === "vencedor" ? `Vencedor do ${award} ${ano}` : `Indicado ao ${award} ${ano}`;
  return (
    <span
      className={`inline-flex items-center gap-1.5 pl-1 pr-2.5 py-1 rounded-full border backdrop-blur-md max-w-full ${
        status === "vencedor"
          ? "bg-amber-500/10 border-amber-400/30 text-amber-300"
          : "bg-white/5 border-white/10 text-muted-foreground"
      } ${className}`}
      title={label}
    >
      <img src={driveImg(AWARD_BADGE_ICON_URL, 40)} alt="" className="size-4 shrink-0" />
      <span className="text-[10px] font-bold truncate">{label}</span>
    </span>
  );
}
