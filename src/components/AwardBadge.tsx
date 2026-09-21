export type AwardBadgeInfo = { award: string; ano: string; status: "vencedor" | "indicado" };

// Os arquivos originais (SVG exportado do Figma/Canva) na verdade embrulham
// uma imagem rasterizada opaca com uma máscara de luminância simulando
// transparência — renderizava com fundo branco sólido em vez de
// transparente (o SVG em si não tem bug, mas depender do Drive/proxy pra
// servir esse formato específico é frágil). Composto localmente uma vez só
// (extraindo a imagem + máscara de dentro do SVG) num PNG de verdade com
// canal alfa, e serve como asset estático do próprio app — sem depender do
// Drive pra esses dois ícones específicos.
const ICON_VENCEDOR = "/badges/vencedor.png";
const ICON_INDICADO = "/badges/indicado.png";

/**
 * Cardzinho "Vencedor do X (ano)" / "Indicado ao X (ano)" com ícone+texto —
 * usado onde NÃO há capa/thumb por perto pra disputar espaço (ex: aba
 * Awards do artista, linha de info abaixo do título no Fórum).
 */
export function AwardBadge({ award, ano, status, className = "" }: AwardBadgeInfo & { className?: string }) {
  const label = status === "vencedor" ? `Vencedor do ${award} ${ano}` : `Indicado ao ${award} ${ano}`;
  const icone = status === "vencedor" ? ICON_VENCEDOR : ICON_INDICADO;
  return (
    <span
      className={`inline-flex items-center gap-1.5 pl-1 pr-2.5 py-1 rounded-full border backdrop-blur-md max-w-full ${
        status === "vencedor"
          ? "bg-amber-500/10 border-amber-400/30 text-amber-300"
          : "bg-white/5 border-white/10 text-muted-foreground"
      } ${className}`}
      title={label}
    >
      <img src={icone} alt="" className="size-4 shrink-0" />
      <span className="text-[10px] font-bold truncate">{label}</span>
    </span>
  );
}

/**
 * Selinho de CANTO, só o ícone — pra sobrepor diretamente em cima de uma
 * capa/thumb (estilo badge de notificação num ícone de app: fica por cima
 * de tudo, na ponta, sem nunca substituir ou empurrar a imagem). O
 * posicionamento (absolute + qual canto) é responsabilidade de quem usa.
 */
export function AwardCornerBadge({ award, ano, status, className = "" }: AwardBadgeInfo & { className?: string }) {
  const label = status === "vencedor" ? `Vencedor do ${award} ${ano}` : `Indicado ao ${award} ${ano}`;
  const icone = status === "vencedor" ? ICON_VENCEDOR : ICON_INDICADO;
  // Sem círculo de fundo por trás: o próprio selo já é um "sticker"
  // fechado (contorno próprio desenhado nele) — colocar outro círculo
  // atrás ficava redundante e, em tamanho pequeno, o contorno do sticker
  // parecia um fundo branco sólido.
  return <img src={icone} alt="" title={label} className={`object-contain drop-shadow-lg ${className}`} />;
}
