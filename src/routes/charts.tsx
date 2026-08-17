import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Music, Flame, Youtube, Disc3, DollarSign, Search, X, ChevronLeft, ChevronRight, Loader2,
} from "lucide-react";
import {
  getBannerN1s, getTopArtistCover, getReleases, getChartFilters, getChartData, parseEditorial,
  type ChartRow, type TopArtistCover, type ReleaseItem, type BannerN1s,
} from "@/lib/charts";

export const Route = createFileRoute("/charts")({
  head: () => ({
    meta: [
      { title: "Empire Charts" },
      { name: "description", content: "Charts oficiais do Empire — Hot 100, Spotify, Apple, YouTube e mais." },
    ],
  }),
  component: ChartsPage,
});

type CategoryId = "hot100" | "spotify" | "apple" | "youtube" | "albums" | "sales";
type TabId = "home" | CategoryId;

interface CategoryConfig {
  id: CategoryId;
  label: string;
  tab: string;
  hasStyle?: boolean;
  icon: typeof Music;
  color: string;
}

const CATEGORIES: CategoryConfig[] = [
  { id: "hot100", label: "Hot 100", tab: "BILLBOARD HOT 100", hasStyle: true, icon: Flame, color: "text-red-400" },
  { id: "spotify", label: "Spotify", tab: "SPOTIFY", icon: Music, color: "text-emerald-400" },
  { id: "apple", label: "Apple Music", tab: "APPLE MUSIC", icon: Music, color: "text-rose-400" },
  { id: "youtube", label: "YouTube", tab: "YOUTUBE", icon: Youtube, color: "text-red-500" },
  { id: "albums", label: "Álbuns", tab: "DADOS ÁLBUNS", hasStyle: true, icon: Disc3, color: "text-amber-400" },
  { id: "sales", label: "Sales", tab: "DIGITAL SALES", icon: DollarSign, color: "text-sky-400" },
];

function ChartsPage() {
  const [tab, setTab] = useState<TabId>("home");
  const category = CATEGORIES.find((c) => c.id === tab) || null;

  return (
    <div className="fixed inset-0 top-[calc(4rem+env(safe-area-inset-top))] bottom-[calc(4rem+env(safe-area-inset-bottom))] bg-background text-foreground overflow-hidden flex flex-col">
      <ChartsTabBar active={tab} onChange={setTab} />
      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        {tab === "home" ? <ChartsHome /> : category ? <ChartsCategoryView category={category} /> : null}
      </div>
    </div>
  );
}

function ChartsTabBar({ active, onChange }: { active: TabId; onChange: (t: TabId) => void }) {
  return (
    <div className="shrink-0 h-12 border-b border-border/60 bg-background/95 backdrop-blur flex items-center gap-1.5 px-3 overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
      <button
        onClick={() => onChange("home")}
        className={`shrink-0 h-8 px-3 rounded-full text-xs font-bold transition ${
          active === "home" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted"
        }`}
      >
        Início
      </button>
      {CATEGORIES.map((c) => {
        const Icon = c.icon;
        const isActive = active === c.id;
        return (
          <button
            key={c.id}
            onClick={() => onChange(c.id)}
            className={`shrink-0 h-8 px-3 rounded-full text-xs font-bold flex items-center gap-1.5 transition ${
              isActive ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted"
            }`}
          >
            <Icon className={`size-3.5 ${isActive ? "" : c.color}`} /> {c.label}
          </button>
        );
      })}
    </div>
  );
}

// ---------- Cover com fallback gracioso (sem placeholder externo) ----------
function CoverImg({ src, alt, className }: { src?: string; alt: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <div className={`${className} bg-muted grid place-items-center`}>
        <Music className="size-1/3 text-muted-foreground" />
      </div>
    );
  }
  return (
    <img src={src} alt={alt} loading="lazy" className={className} onError={() => setFailed(true)} />
  );
}

// ---------- Home ----------
function ChartsHome() {
  const [cover, setCover] = useState<TopArtistCover | null>(null);
  const [releases, setReleases] = useState<ReleaseItem[]>([]);
  const [banner, setBanner] = useState<BannerN1s | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setErrorMsg(null);
    Promise.all([
      getTopArtistCover().catch(() => ({} as TopArtistCover)),
      getReleases().catch(() => [] as ReleaseItem[]),
      getBannerN1s().catch(() => null),
    ]).then(([c, r, b]) => {
      if (!alive) return;
      setCover(c);
      setReleases(Array.isArray(r) ? r : []);
      setBanner(b);
      setLoading(false);
    });
    return () => { alive = false; };
  }, []);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-muted-foreground gap-2">
        <Loader2 className="size-4 animate-spin" /> Carregando charts...
      </div>
    );
  }

  if (cover?.error) {
    return (
      <div className="p-10 text-center text-sm text-muted-foreground">
        Erro ao carregar os charts: {cover.error}
      </div>
    );
  }

  const editorial = parseEditorial(cover?.editorial);
  const n1s: { label: string; color: string; item?: { capa?: string; tit?: string; art?: string } }[] = [
    { label: "Hot 100", color: "text-red-400", item: banner?.hot100 },
    { label: "Spotify", color: "text-emerald-400", item: banner?.spotify },
    { label: "Apple Music", color: "text-rose-400", item: banner?.apple },
    { label: "YouTube", color: "text-red-500", item: banner?.youtube },
    { label: "Digital Sales", color: "text-sky-400", item: banner?.sales },
    { label: "Billboard 200", color: "text-amber-400", item: banner?.bb200 },
  ].filter((x) => x.item);

  return (
    <div>
      {cover?.name ? (
        <div className="relative w-full h-[55vh] min-h-[320px] overflow-hidden">
          <CoverImg src={cover.img} alt={cover.name} className="absolute inset-0 w-full h-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-background via-background/70 to-background/20" />
          <div className="absolute inset-0 bg-gradient-to-r from-background/80 to-transparent" />
          <div className="relative h-full flex flex-col justify-end p-6 max-w-2xl">
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-bold w-fit mb-2 bg-primary/20 text-primary">
              TOP ARTIST {cover.month ? `— ${cover.month}` : ""}
            </span>
            <h1 className="text-4xl sm:text-5xl font-black tracking-tight uppercase">{cover.name}</h1>
            {cover.pts && (
              <div className="mt-2 text-sm font-bold text-muted-foreground">{cover.pts} <span className="text-xs">PTS</span></div>
            )}
          </div>
        </div>
      ) : (
        <div className="p-10 text-center text-sm text-muted-foreground italic">
          Artista do topo do mês ainda não disponível.
        </div>
      )}

      {editorial.length > 0 && (
        <div className="px-6 py-5 max-w-2xl space-y-2">
          {cover?.author && (
            <div className="text-[11px] uppercase tracking-wider font-black text-muted-foreground">{cover.author}</div>
          )}
          {editorial.map((line, i) =>
            line.kind === "site" ? (
              <div key={i} className="text-[11px] uppercase tracking-widest text-primary font-bold">{line.text}</div>
            ) : line.kind === "headline" ? (
              <div key={i} className="text-lg font-black">{line.text}</div>
            ) : (
              <p key={i} className="text-sm text-muted-foreground leading-relaxed">{line.text}</p>
            )
          )}
        </div>
      )}

      {n1s.length > 0 && (
        <section className="px-4 pb-6">
          <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-3 px-2">#1s da semana</h2>
          <div className="flex gap-3 overflow-x-auto pb-2 px-2 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
            {n1s.map((x, i) => (
              <div key={i} className="shrink-0 w-56 rounded-xl border border-border/60 bg-card/40 p-3 flex items-center gap-3">
                <CoverImg src={x.item?.capa} alt={x.item?.tit || ""} className="size-12 rounded-md object-cover shrink-0" />
                <div className="min-w-0">
                  <div className={`text-[10px] font-bold uppercase tracking-wider ${x.color}`}>{x.label}</div>
                  <div className="text-sm font-semibold truncate">{x.item?.tit || "—"}</div>
                  {x.item?.art && <div className="text-xs text-muted-foreground truncate">{x.item.art}</div>}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {releases.length > 0 && (
        <section className="px-4 pb-8">
          <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-3 px-2">Lançamentos recentes</h2>
          <div className="flex gap-3 overflow-x-auto pb-2 px-2 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
            {releases.map((r, i) => (
              <div key={i} className="shrink-0 w-44 rounded-xl border border-border/60 bg-card/40 p-3">
                <span className="inline-block px-2 py-0.5 rounded text-[10px] font-bold bg-primary/15 text-primary uppercase mb-2">
                  {r.tipo || "Single"}
                </span>
                <div className="text-sm font-semibold truncate">{r.musica || r.titulo || r.t || "—"}</div>
                {r.data && <div className="text-xs text-muted-foreground mt-1">{r.data}</div>}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

// ---------- Categoria (Hot 100 / Spotify / Apple / YouTube / Álbuns / Sales) ----------
function ChartsCategoryView({ category }: { category: CategoryConfig }) {
  const [dates, setDates] = useState<string[]>([]);
  const [styles, setStyles] = useState<string[]>([]);
  const [date, setDate] = useState<string | null>(null);
  const [style, setStyle] = useState<string>("ALL");
  const [rows, setRows] = useState<ChartRow[] | null>(null);
  const [search, setSearch] = useState("");
  const [loadingFilters, setLoadingFilters] = useState(true);
  const [loadingRows, setLoadingRows] = useState(false);

  // Reset ao trocar de categoria
  useEffect(() => {
    let alive = true;
    setLoadingFilters(true);
    setDate(null);
    setStyle("ALL");
    setSearch("");
    setRows(null);
    getChartFilters(category.tab)
      .then((f) => {
        if (!alive) return;
        setDates(f.dates || []);
        setStyles(f.styles || []);
        setDate((f.dates || [])[0] || null);
      })
      .catch(() => alive && setDates([]))
      .finally(() => alive && setLoadingFilters(false));
    return () => { alive = false; };
  }, [category.tab]);

  useEffect(() => {
    if (!date) return;
    let alive = true;
    setLoadingRows(true);
    getChartData(category.tab, date)
      .then((r) => alive && setRows(Array.isArray(r) ? r : []))
      .catch(() => alive && setRows([]))
      .finally(() => alive && setLoadingRows(false));
    return () => { alive = false; };
  }, [category.tab, date]);

  const derivedStyles = useMemo(() => {
    if (styles.length) return styles;
    if (!category.hasStyle || !rows) return [];
    const set = new Set<string>();
    for (const r of rows) {
      const s = r.estilo || r.style;
      if (s) set.add(s);
    }
    return Array.from(set).sort();
  }, [styles, rows, category.hasStyle]);

  const filteredRows = useMemo(() => {
    if (!rows) return [];
    let list = rows;
    if (category.hasStyle && style !== "ALL") {
      list = list.filter((r) => (r.estilo || r.style) === style);
    }
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((r) => {
        const title = (r.musica || r.titulo || r.album || r.tit || r.t || "").toLowerCase();
        const artist = (r.artista || r.art || r.a || "").toLowerCase();
        return title.includes(q) || artist.includes(q);
      });
    }
    return list;
  }, [rows, style, search, category.hasStyle]);

  const isBB = category.tab.includes("BILLBOARD");
  const isYT = category.tab.includes("YOUTUBE");
  const isAlbum = category.tab.includes("ÁLBUNS");
  const valueLabel = isYT ? "VIEWS" : isBB ? "PTS" : isAlbum ? "UNIDADES" : "";

  if (loadingFilters) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-muted-foreground gap-2">
        <Loader2 className="size-4 animate-spin" /> Carregando...
      </div>
    );
  }

  if (!dates.length) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-muted-foreground italic p-10 text-center">
        Nenhuma data encontrada pra "{category.label}".
      </div>
    );
  }

  return (
    <div className="p-4">
      <h1 className="text-xl font-black uppercase tracking-tight mb-4 flex items-center gap-2">
        <category.icon className={`size-5 ${category.color}`} /> {category.label}
      </h1>

      <PillScroller>
        {dates.map((d) => (
          <button
            key={d}
            onClick={() => setDate(d)}
            className={`shrink-0 h-8 px-3 rounded-full text-xs font-semibold transition ${
              d === date ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/70"
            }`}
          >
            {d}
          </button>
        ))}
      </PillScroller>

      {category.hasStyle && derivedStyles.length > 0 && (
        <div className="mt-2">
          <PillScroller>
            <button
              onClick={() => setStyle("ALL")}
              className={`shrink-0 h-8 px-3 rounded-full text-xs font-semibold transition ${
                style === "ALL" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/70"
              }`}
            >
              Todos os estilos
            </button>
            {derivedStyles.map((s) => (
              <button
                key={s}
                onClick={() => setStyle(s)}
                className={`shrink-0 h-8 px-3 rounded-full text-xs font-semibold transition ${
                  style === s ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/70"
                }`}
              >
                {s}
              </button>
            ))}
          </PillScroller>
        </div>
      )}

      <div className="relative mt-3 mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar artista ou música..."
          className="w-full h-10 pl-9 pr-9 rounded-full bg-muted text-sm outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground"
        />
        {search && (
          <button
            onClick={() => setSearch("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            aria-label="Limpar busca"
          >
            <X className="size-4" />
          </button>
        )}
      </div>

      {loadingRows ? (
        <div className="py-10 flex items-center justify-center text-sm text-muted-foreground gap-2">
          <Loader2 className="size-4 animate-spin" /> Carregando chart...
        </div>
      ) : filteredRows.length === 0 ? (
        <div className="py-10 text-center text-sm text-muted-foreground italic">Nenhum resultado encontrado.</div>
      ) : (
        <div className="space-y-1.5">
          {filteredRows.map((r, i) => {
            const pos = r.posicao || r.pos || r.p || "-";
            const cover = r.capa || r.c;
            const title = r.musica || r.titulo || r.album || r.tit || r.t || "—";
            const artist = r.artista || r.art || r.a || "";
            const val = r.semana || r.streams || r.pontos || r.vendas || r.val || r.s || "0";
            const st = r.status || r.st || "=";
            const stColor = st === "↑" ? "text-emerald-400" : st === "↓" ? "text-red-400" : st === "NEW" ? "text-primary" : "text-muted-foreground";
            const stLabel = st === "↑" ? "▲" : st === "↓" ? "▼" : st === "NEW" ? "NEW" : "=";
            return (
              <div key={i} className="flex items-center gap-3 rounded-xl border border-border/50 bg-card/30 p-2.5">
                <div className="w-9 shrink-0 text-center">
                  <div className="text-base font-black">{pos}</div>
                  <div className={`text-[9px] font-bold ${stColor}`}>{stLabel}</div>
                </div>
                <CoverImg src={cover} alt={title} className="size-11 rounded-md object-cover shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold truncate">{title}</div>
                  {artist && <div className="text-xs text-muted-foreground truncate">{artist}</div>}
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-sm font-black">{val}</div>
                  {valueLabel && <div className="text-[9px] text-muted-foreground font-bold">{valueLabel}</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function PillScroller({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const scrollBy = (dir: 1 | -1) => ref.current?.scrollBy({ left: dir * 160, behavior: "smooth" });
  return (
    <div className="relative flex items-center gap-1">
      <button
        onClick={() => scrollBy(-1)}
        className="hidden sm:grid shrink-0 size-7 place-items-center rounded-full hover:bg-muted text-muted-foreground"
        aria-label="Anterior"
      >
        <ChevronLeft className="size-4" />
      </button>
      <div ref={ref} className="flex gap-1.5 overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
        {children}
      </div>
      <button
        onClick={() => scrollBy(1)}
        className="hidden sm:grid shrink-0 size-7 place-items-center rounded-full hover:bg-muted text-muted-foreground"
        aria-label="Próximo"
      >
        <ChevronRight className="size-4" />
      </button>
    </div>
  );
}
