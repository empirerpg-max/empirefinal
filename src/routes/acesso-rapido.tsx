import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ChevronLeft,
  Send,
  Newspaper,
  MessageCircle,
  Video,
  Disc3,
  Music2,
  Calendar,
  Bell,
  LifeBuoy,
} from "lucide-react";
import { openExternal, haptic } from "@/lib/telegram";

export const Route = createFileRoute("/acesso-rapido")({
  head: () => ({
    meta: [
      { title: "Acesso Rápido — Empire Hub" },
      { name: "description", content: "Atalhos para os canais oficiais do Empire no Telegram." },
    ],
  }),
  component: AcessoRapido,
});

const LINKS = [
  { label: "News", url: "https://t.me/empirenews1", icon: Newspaper, desc: "Notícias do Empire" },
  { label: "Social", url: "https://t.me/empiresocial1", icon: MessageCircle, desc: "Bate-papo da galera" },
  { label: "Vídeos", url: "https://t.me/+abAEzgGvI5E5MjA5", icon: Video, desc: "Clipes & lives" },
  { label: "Álbuns", url: "https://t.me/+g3oxVuzryNkwYzVh", icon: Disc3, desc: "Lançamentos LP" },
  { label: "Singles", url: "https://t.me/+b92qIsQP4BU3YjUx", icon: Music2, desc: "Lançamentos singles" },
  { label: "Eventos", url: "https://t.me/empireeventos", icon: Calendar, desc: "Agenda imperial" },
  { label: "Avisos", url: "https://t.me/empireinfos1", icon: Bell, desc: "Comunicados oficiais" },
  { label: "Central de Ajuda", url: "https://t.me/+LRE37LcEnOdmMWQx", icon: LifeBuoy, desc: "Suporte" },
];

function AcessoRapido() {
  return (
    <main className="flex-1 mx-auto w-full max-w-2xl px-4 pt-6 pb-32">
      <Link
        to="/"
        className="inline-flex items-center gap-1 text-muted-foreground mb-6 font-black uppercase text-[11px] hover:text-primary transition-colors"
      >
        <ChevronLeft className="size-4" /> Painel Geral
      </Link>

      <header className="mb-8">
        <div className="size-14 rounded-2xl bg-primary/15 text-primary grid place-items-center mb-4">
          <Send className="size-7" />
        </div>
        <h1 className="text-3xl font-black italic uppercase tracking-tighter">
          Acesso <span className="text-primary">Rápido</span>
        </h1>
        <p className="text-muted-foreground text-[11px] font-bold mt-1 uppercase tracking-widest">
          Canais oficiais no Telegram
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3">
        {LINKS.map((l) => {
          const Icon = l.icon;
          return (
            <button
              key={l.url}
              onClick={() => {
                haptic.selection();
                openExternal(l.url);
              }}
              aria-label={`Abrir canal ${l.label} no Telegram`}
              className="group flex flex-col items-start gap-3 p-5 rounded-3xl bg-card border border-white/5 hover:bg-white/[0.04] active:scale-[0.98] transition-all text-left"
            >
              <div className="size-12 rounded-2xl bg-primary/15 text-primary grid place-items-center group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                <Icon className="size-6" />
              </div>
              <div className="min-w-0 w-full">
                <h2 className="text-sm font-black uppercase tracking-tight truncate">{l.label}</h2>
                <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest truncate">
                  {l.desc}
                </p>
              </div>
            </button>
          );
        })}
      </div>
    </main>
  );
}
