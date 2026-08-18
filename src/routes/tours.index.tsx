import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Mic2, Globe, Users, ChevronRight, Loader2, Crown, Plus } from "lucide-react";
import { api, fmtMoney, driveImg } from "@/lib/api";
import { useTelegramUser } from "@/lib/telegram";
import { CreateTourSheet } from "@/components/Tours/CreateTourSheet";

export const Route = createFileRoute("/tours/")({
  component: ToursIndex,
});

interface TourShowLite {
  numero: number;
  data: string;
  soldOut: boolean;
}

interface TourCard {
  idUnico: string;
  artista: string;
  nomeTurne: string;
  porte: string;
  capaUrl: string;
  status: string;
  totalShows: number;
  arrecadacaoTempoReal: number;
  metaLucro: number;
  sistemaNovo: boolean;
  agenda: TourShowLite[];
}

function parseDataBR(value: string): Date | null {
  const m = (value || "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const [, d, mo, y] = m;
  return new Date(Number(y), Number(mo) - 1, Number(d));
}

function realizados(t: TourCard) {
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  return t.agenda.filter((s) => {
    if (s.soldOut) return true;
    const data = parseDataBR(s.data);
    return !!data && data < hoje;
  }).length;
}

function ToursIndex() {
  const { user } = useTelegramUser();
  const telegramId = user?.id || "";

  const [minhasTurnes, setMinhasTurnes] = useState<TourCard[] | null>(null);
  const [meusArtistas, setMeusArtistas] = useState<string[]>([]);
  const [publicas, setPublicas] = useState<TourCard[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  function loadMinhas() {
    if (!telegramId) return;
    fetch(`/api/turnes?telegramId=${encodeURIComponent(telegramId)}`)
      .then((r) => r.json())
      .then((res) => {
        if (res?.success) setMinhasTurnes(res.data || []);
      });
  }

  useEffect(() => {
    if (!telegramId) return;
    api.meusArtistas(telegramId).then((artists) => {
      setMeusArtistas(artists.map((a: any) => a.nome).filter(Boolean));
    });
    loadMinhas();
  }, [telegramId]);

  useEffect(() => {
    fetch("/api/turnes")
      .then((r) => r.json())
      .then((res) => {
        if (res?.success) setPublicas(res.data || []);
      })
      .finally(() => setLoading(false));
  }, []);

  const minhasIds = new Set((minhasTurnes || []).map((t) => t.idUnico));
  const turnesDoImperio = (publicas || []).filter((t) => !minhasIds.has(t.idUnico));

  return (
    <main className="flex-1 mx-auto w-full max-w-2xl px-4 pt-6 pb-20">
      <header className="mb-6 flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <div className="size-10 rounded-xl bg-primary/15 text-primary grid place-items-center">
              <Globe className="size-6" />
            </div>
            <h1 className="text-2xl font-black italic tracking-tight">Empire Tours</h1>
          </div>
          <p className="text-xs text-muted-foreground font-medium pl-1">
            Gerencie sua turnê e acompanhe as maiores do Império
          </p>
        </div>
        {meusArtistas.length > 0 && (
          <button
            onClick={() => setCreating(true)}
            className="shrink-0 flex items-center gap-1.5 px-4 py-2.5 rounded-2xl bg-primary text-primary-foreground font-black text-xs uppercase tracking-wider transition active:scale-95"
          >
            <Plus className="size-4" />
            Criar
          </button>
        )}
      </header>

      {telegramId && meusArtistas.length > 0 && (
        <section className="mb-8">
          <h2 className="text-[11px] font-black uppercase text-neutral-400 mb-3 pl-1">Minhas Turnês</h2>
          {!minhasTurnes ? (
            <div className="flex justify-center py-8 opacity-50">
              <Loader2 className="size-6 animate-spin" />
            </div>
          ) : minhasTurnes.length === 0 ? (
            <div className="rounded-2xl bg-white/[0.03] border border-dashed border-white/10 p-6 text-center">
              <p className="text-sm text-muted-foreground">
                Você ainda não tem nenhuma turnê. Que tal criar a primeira?
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {minhasTurnes.map((t) => (
                <TourCardItem key={t.idUnico} t={t} />
              ))}
            </div>
          )}
        </section>
      )}

      <section>
        <h2 className="text-[11px] font-black uppercase text-neutral-400 mb-3 pl-1">Turnês do Império</h2>
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3 opacity-50">
            <Loader2 className="size-8 animate-spin" />
            <p className="text-xs font-bold uppercase tracking-widest">Carregando turnês...</p>
          </div>
        ) : turnesDoImperio.length === 0 ? (
          <div className="rounded-3xl bg-white/[0.03] border border-dashed border-white/10 p-12 text-center">
            <div className="size-16 rounded-full bg-muted/20 text-muted-foreground grid place-items-center mx-auto mb-4">
              <Mic2 className="size-8" />
            </div>
            <h2 className="text-lg font-bold mb-1">Silêncio nos Estádios</h2>
            <p className="text-sm text-muted-foreground max-w-[240px] mx-auto text-balance">
              Nenhuma outra turnê em andamento no momento.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {turnesDoImperio.map((t) => (
              <TourCardItem key={t.idUnico} t={t} />
            ))}
          </div>
        )}
      </section>

      {creating && (
        <CreateTourSheet
          telegramId={telegramId}
          artistas={meusArtistas}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            loadMinhas();
          }}
        />
      )}
    </main>
  );
}

function TourCardItem({ t }: { t: TourCard }) {
  const total = t.totalShows || t.agenda.length || 1;
  const feitos = realizados(t);
  const soldOuts = t.agenda.filter((s) => s.soldOut).length;

  return (
    <Link to="/tours/$nome" params={{ nome: t.artista }} className="block group">
      <div className="relative overflow-hidden rounded-3xl bg-card border border-white/5 p-4 transition-all hover:bg-white/[0.06] hover:scale-[1.01] active:scale-[0.98] shadow-2xl shadow-black/20">
        <div className="absolute -right-20 -bottom-20 size-48 bg-primary/10 blur-[60px] rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

        <div className="flex gap-4 items-center relative z-10">
          <div className="relative size-20 shrink-0 rounded-2xl overflow-hidden border-2 border-white/10 bg-slate-900 shadow-lg flex items-center justify-center">
            {t.capaUrl ? (
              <img
                src={driveImg(t.capaUrl, 400)}
                alt={t.artista}
                className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                loading="lazy"
                decoding="async"
              />
            ) : (
              <Crown className="size-10 text-primary/40 group-hover:scale-110 group-hover:text-primary transition-all duration-500" />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[11px] font-black uppercase tracking-widest text-primary/80">
                {t.artista}
              </span>
              {t.status === "Em andamento" && (
                <div className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
              )}
            </div>

            <h3 className="text-xl font-black italic uppercase tracking-tighter leading-tight truncate mb-2">
              {t.nomeTurne}
            </h3>

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1 text-[11px] text-muted-foreground font-black uppercase bg-white/5 px-2 py-0.5 rounded-md border border-white/5">
                <Users className="size-3 text-primary" /> {t.porte || "Turnê"}
              </div>
            </div>
          </div>

          <div className="size-10 rounded-full bg-white/5 flex items-center justify-center group-hover:bg-primary group-hover:text-primary-foreground transition-all">
            <ChevronRight className="size-5" />
          </div>
        </div>

        <div className="mt-5 relative z-10">
          <div className="flex justify-between items-end mb-2 px-1">
            <div>
              <p className="text-muted-foreground text-[11px] uppercase font-black tracking-widest mb-0.5">
                Execução
              </p>
              <p className="text-xs font-black tracking-tight">
                {feitos} <span className="text-muted-foreground/40 font-bold">/ {total} SHOWS</span>
              </p>
            </div>
            <div className="text-right">
              <p className="text-muted-foreground text-[11px] uppercase font-black tracking-widest mb-0.5">
                Arrecadado
              </p>
              <p className="text-xs font-black text-amber-500 tracking-tight">
                {fmtMoney(t.arrecadacaoTempoReal)}
                {soldOuts > 0 && <span className="text-emerald-400"> · {soldOuts} sold out</span>}
              </p>
            </div>
          </div>

          <div className="h-1.5 bg-white/10 rounded-full overflow-hidden p-[1px]">
            <div
              className="h-full bg-gradient-to-r from-primary/80 to-primary rounded-full transition-all duration-700"
              style={{ width: `${Math.min(100, (feitos / total) * 100)}%` }}
            />
          </div>
        </div>
      </div>
    </Link>
  );
}
