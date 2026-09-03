import { Crown } from "lucide-react";

// Contorno estrelado (12 pontas) — mesmo estilo do selo de referência
// (coroa dentro de uma estrela), calculado geometricamente em vez de path
// desenhado à mão, pra ficar simétrico de verdade.
const STAR_PATH =
  "M12.00,0.50 L14.23,3.69 L17.75,2.04 L18.08,5.92 L21.96,6.25 L20.31,9.77 L23.50,12.00 L20.31,14.23 " +
  "L21.96,17.75 L18.08,18.08 L17.75,21.96 L14.23,20.31 L12.00,23.50 L9.77,20.31 L6.25,21.96 L5.92,18.08 " +
  "L2.04,17.75 L3.69,14.23 L0.50,12.00 L3.69,9.77 L2.04,6.25 L5.92,5.92 L6.25,2.04 L9.77,3.69 Z";

/**
 * Selo "oficial" do Empire Hub — coroa dentro de uma estrela, no lugar do
 * check genérico de "verificado" de outros apps. Usado ao lado de QUALQUER
 * nome exibido no app (artista ou jogador comum) — aqui todo mundo é oficial.
 */
export function VerifiedBadge({ className = "size-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`shrink-0 ${className}`} aria-label="Verificado" role="img">
      <path d={STAR_PATH} fill="var(--primary)" />
      <Crown
        x="7"
        y="7.5"
        width="10"
        height="10"
        strokeWidth={2.5}
        className="text-primary-foreground"
      />
    </svg>
  );
}
