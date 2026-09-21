import { useEffect, useState } from "react";
import { driveImg, driveImgWide, driveRawImg } from "@/lib/api";

/**
 * <img> com fallback em cascata pra links do Google Drive: tenta o
 * thumbnail público (driveImg, mais rápido) e, se falhar (arquivo não
 * compartilhado como "Qualquer pessoa com o link" — mesmo padrão do caso
 * do jogador Gilson e do material "Wisdom Tooth" compartilhado no Social),
 * cai pro proxy autenticado do próprio backend (driveRawImg), que funciona
 * mesmo com o arquivo privado. Só mostra o placeholder se os dois falharem.
 *
 * Reaproveita o mesmo padrão já usado em TopicThumbImg (Forum.tsx) e
 * AlbumCoverImg (AlbumList.tsx) — centralizado aqui pra não duplicar esse
 * useState/useEffect em cada tela que renderiza uma imagem do Drive.
 */
export function SmartImg({
  src,
  alt,
  className,
  size,
  fallback,
  loading = "lazy",
  wide = false,
}: {
  src?: string | null;
  alt: string;
  className?: string;
  size?: number;
  fallback?: React.ReactNode;
  loading?: "lazy" | "eager";
  /** Imagem que NÃO é quadrada por natureza (ex: página de encarte, pôster,
   * banner) — usa driveImgWide em vez de driveImg, que sempre força um
   * recorte quadrado (bug confirmado: encarte retangular aparecia cortado
   * em quadrado no visualizador). */
  wide?: boolean;
}) {
  const [stage, setStage] = useState<"sized" | "raw" | "falhou">("sized");
  useEffect(() => {
    setStage("sized");
  }, [src]);

  if (!src || stage === "falhou") return fallback ? <>{fallback}</> : null;

  const sizedSrc = wide ? driveImgWide(src, size) : driveImg(src, size);
  const rawSrc = driveRawImg(src);
  const finalSrc = stage === "raw" ? rawSrc : sizedSrc;
  if (!finalSrc) return fallback ? <>{fallback}</> : null;

  return (
    <img
      src={finalSrc}
      alt={alt}
      className={className}
      loading={loading}
      referrerPolicy="no-referrer"
      onError={() => setStage((s) => (s === "sized" ? "raw" : "falhou"))}
    />
  );
}
