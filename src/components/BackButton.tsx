import { ChevronLeft } from "lucide-react";
import { useRouter } from "@tanstack/react-router";
import { haptic } from "@/lib/telegram";

export function BackButton({ className = "" }: { className?: string }) {
  const router = useRouter();
  const onClick = () => {
    haptic.light();
    if (window.history.length > 1) router.history.back();
    else router.navigate({ to: "/" });
  };
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1 text-muted-foreground mb-4 active:scale-95 transition-transform ${className}`}
    >
      <ChevronLeft className="size-4" /> Voltar
    </button>
  );
}
