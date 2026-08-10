import { Link } from "@tanstack/react-router";
import { Flame, Music, Tv, Disc3, MessageSquare, Upload } from "lucide-react";
import { haptic } from "@/lib/telegram";

const TABS = [
  { to: "/empire-play", label: "Início", icon: Flame, exact: true },
  { to: "/empire-play/musicas", label: "Músicas", icon: Music },
  { to: "/empire-play/videos", label: "Vídeos", icon: Tv },
  { to: "/empire-play/albuns", label: "Álbuns", icon: Disc3 },
  { to: "/empire-play/forum", label: "Fórum", icon: MessageSquare },
  { to: "/empire-play/gestao", label: "Gestão", icon: Upload },
] as const;

export function EmpirePlayTabNav() {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
      <nav className="flex items-center gap-1.5 sm:gap-2 overflow-x-auto pb-2 scrollbar-hide border-b border-white/10 touch-pan-x flex-nowrap flex-1">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <Link
              key={tab.to}
              to={tab.to}
              onClick={() => haptic.selection()}
              activeOptions={{ exact: "exact" in tab ? tab.exact : false }}
              className="flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl sm:rounded-2xl text-[11px] sm:text-xs font-black uppercase tracking-wider whitespace-nowrap transition-all shrink-0 bg-white/5 hover:bg-white/10 text-neutral-400 hover:text-white"
              activeProps={{
                className: "!bg-emerald-500 !text-black shadow-lg shadow-emerald-500/20 scale-102",
              }}
            >
              <Icon className="size-3.5 sm:size-4" />
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
