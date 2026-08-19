import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Music, Flame, Youtube, Disc3, DollarSign, Search, X, ChevronLeft, ChevronRight, Loader2, Radio,
} from "lucide-react";
import {
  getBannerN1s, getTopArtistCover, getReleases, getChartFilters, getChartData, parseEditorial,
  getMonthlyYears, getMonthlyDates, getMonthlyArtists, getMonthlyStats, getRealTime,
  type ChartRow, type TopArtistCover, type ReleaseItem, type BannerN1s, type RealTimeData,
} from "@/lib/charts";
import { resolveImg } from "@/lib/api";

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
type TabId = "home" | "live" | CategoryId;

interface CategoryConfig {
  id: CategoryId;
  label: string;
  tab: string;
  hasStyle?: boolean;
  countryTab?: string;
  monthlyPlatform?: string;
  icon: typeof Music;
  color: string;
}

const CATEGORIES: CategoryConfig[] = [
  { id: "hot100", label: "Hot 100", tab: "BILLBOARD HOT 100", hasStyle: true, icon: Flame, color: "text-red-400" },
  {
    id: "spotify", label: "Spotify", tab: "SPOTIFY", icon: Music, color: "text-emerald-400",
    countryTab: "SPOTIFY COUNTRIES", monthlyPlatform: "SPOTIFY",
  },
  {
    id: "apple", label: "Apple Music", tab: "APPLE MUSIC", icon: Music, color: "text-rose-400",
    countryTab: "APPLE MUSIC COUNTRIES", monthlyPlatform: "APPLE MUSIC",
  },
  {
    id: "youtube", label: "YouTube", tab: "YOUTUBE", icon: Youtube, color: "text-red-500",
    countryTab: "YOUTUBE COUNTRIES", monthlyPlatform: "YOUTUBE",
  },
  { id: "albums", label: "Álbuns", tab: "DADOS ÁLBUNS", hasStyle: true, icon: Disc3, color: "text-amber-400" },
  { id: "sales", label: "Sales", tab: "DIGITAL SALES", icon: DollarSign, color: "text-sky-400" },
];

// Bolhas coloridas desfocadas no fundo — mesma linguagem visual do mockup
// de referência (fundo "Discover"), adaptada pro tema escuro do app: em vez
// de bolhas pastel sólidas numa base clara, usam glows translúcidos numa
// base escura. Puramente decorativo, fixo atrás do conteúdo (pointer-events
// none), então nunca atrapalha scroll/toque.
function ChartsBubbleBackdrop() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute -top-24 -right-16 size-72 rounded-full bg-primary/25 blur-3xl" />
      <div className="absolute top-1/3 -left-20 size-64 rounded-full bg-sky-500/15 blur-3xl" />
      <div className="absolute bottom-0 right-1/4 size-48 rounded-full bg-fuchsia-500/10 blur-3xl" />
    </div>
  );
}

function ChartsPage() {
  const [tab, setTab] = useState<TabId>("home");
  const category = CATEGORIES.find((c) => c.id === tab) || null;

  return (
    <div className="fixed inset-0 top-[calc(4rem+env(safe-area-inset-top))] bottom-[calc(4rem+env(safe-area-inset-bottom))] bg-background text-foreground overflow-hidden flex flex-col">
      <ChartsTabBar active={tab} onChange={setTab} />
      <div className="relative flex-1 overflow-y-auto overflow-x-hidden">
        <ChartsBubbleBackdrop />
        <div className="relative">
          {tab === "home" ? (
            <ChartsHome />
          ) : tab === "live" ? (
            <ChartsRealTime />
          ) : category ? (
            <ChartsCategoryView category={category} />
          ) : null}
        </div>
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
          active === "home" ? "bg-primary text-primary-foreground shadow-sm shadow-primary/30" : "text-muted-foreground hover:bg-muted"
        }`}
      >
        Início
      </button>
      <button
        onClick={() => onChange("live")}
        className={`shrink-0 h-8 px-3 rounded-full text-xs font-bold flex items-center gap-1.5 transition ${
          active === "live" ? "bg-primary text-primary-foreground shadow-sm shadow-primary/30" : "text-muted-foreground hover:bg-muted"
        }`}
      >
        <Radio className={`size-3.5 ${active === "live" ? "text-primary-foreground" : "text-red-500"} animate-pulse`} /> Ao vivo
      </button>
      {CATEGORIES.map((c) => {
        const Icon = c.icon;
        const isActive = active === c.id;
        return (
          <button
            key={c.id}
            onClick={() => onChange(c.id)}
            className={`shrink-0 h-8 px-3 rounded-full text-xs font-bold flex items-center gap-1.5 transition ${
              isActive ? "bg-primary text-primary-foreground shadow-sm shadow-primary/30" : "text-muted-foreground hover:bg-muted"
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
    <img src={resolveImg(src)} alt={alt} loading="lazy" className={className} referrerPolicy="no-referrer" onError={() => setFailed(true)} />
  );
}

// ---------- Ao vivo (Real Time) ----------
const REALTIME_COLS: { key: keyof RealTimeData; label: string; color: string }[] = [
  { key: "spotify", label: "Spotify", color: "text-emerald-400" },
  { key: "apple", label: "Apple Music", color: "text-rose-400" },
  { key: "youtube", label: "YouTube", color: "text-red-500" },
];

function ChartsRealTime() {
  const [data, setData] = useState<RealTimeData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    const load = () => {
      getRealTime()
        .then((d) => alive && setData(d))
        .catch(() => alive && setData({}))
        .finally(() => alive && setLoading(false));
    };
    load();
    const id = setInterval(load, 30_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  if (loading) return <LoadingBlock text="Carregando ao vivo..." />;

  return (
    <div className="p-4">
      <h1 className="font-['Fjalla_One'] text-2xl uppercase tracking-tight mb-4 flex items-center gap-2">
        <Radio className="size-5 text-red-500 animate-pulse" /> Ao vivo
      </h1>
      <div className="grid gap-5 sm:grid-cols-3">
        {REALTIME_COLS.map(({ key, label, color }) => {
          const items = data?.[key] || [];
          return (
            <div key={key}>
              <h2 className={`text-sm font-bold uppercase tracking-wider mb-2 ${color}`}>{label}</h2>
              {items.length === 0 ? (
                <div className="text-xs text-muted-foreground italic py-6 text-center">Sem dados agora.</div>
              ) : (
                <div className="space-y-1.5">
                  {items.map((it, i) => {
                    const pos = it.posicao || it.pos || it.p || "-";
                    const cover = it.capa || it.c;
                    const title = it.titulo || it.musica || it.tit || it.t || "—";
                    const val = it.streams || it.semana || it.val || it.s || "-";
                    return (
                      <div key={i} className="flex items-center gap-2.5 rounded-2xl border border-border/50 bg-card/40 p-2 shadow-sm shadow-black/10">
                        <div className="w-6 shrink-0 text-center text-sm font-black text-muted-foreground">{pos}</div>
                        <CoverImg src={cover} alt={title} className="size-9 rounded-xl object-cover shrink-0" />
                        <div className="min-w-0 flex-1 text-xs font-semibold truncate">{title}</div>
                        <div className={`shrink-0 text-xs font-bold ${color}`}>{val}</div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
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
        <div className="relative w-full h-[55vh] min-h-[320px] overflow-hidden rounded-b-3xl">
          <CoverImg src={cover.img} alt={cover.name} className="absolute inset-0 w-full h-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-background via-background/70 to-background/20" />
          <div className="absolute inset-0 bg-gradient-to-r from-background/80 to-transparent" />
          <div className="relative h-full flex flex-col justify-end p-6 max-w-2xl">
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-bold w-fit mb-2 bg-primary/20 text-primary">
              TOP ARTIST {cover.month ? `— ${cover.month}` : ""}
            </span>
            <h1 className="font-['Fjalla_One'] text-4xl sm:text-5xl tracking-tight uppercase">{cover.name}</h1>
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
          <h2 className="font-['Fjalla_One'] text-sm tracking-wider text-muted-foreground mb-3 px-2">#1s DA SEMANA</h2>
          <div className="flex gap-3 overflow-x-auto pb-2 px-2 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
            {n1s.map((x, i) => (
              <div key={i} className="shrink-0 w-56 rounded-2xl border border-border/60 bg-card/40 p-3 flex items-center gap-3 shadow-sm shadow-black/10">
                <CoverImg src={x.item?.capa} alt={x.item?.tit || ""} className="size-12 rounded-xl object-cover shrink-0" />
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
          <h2 className="font-['Fjalla_One'] text-sm tracking-wider text-muted-foreground mb-3 px-2">LANÇAMENTOS RECENTES</h2>
          <div className="flex gap-3 overflow-x-auto pb-2 px-2 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
            {releases.map((r, i) => (
              <div key={i} className="shrink-0 w-44 rounded-2xl border border-border/60 bg-card/40 p-3 shadow-sm shadow-black/10">
                <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold bg-primary/15 text-primary uppercase mb-2">
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

function LoadingBlock({ text = "Carregando..." }: { text?: string }) {
  return (
    <div className="py-10 flex items-center justify-center text-sm text-muted-foreground gap-2">
      <Loader2 className="size-4 animate-spin" /> {text}
    </div>
  );
}

function EmptyBlock({ text }: { text: string }) {
  return <div className="py-10 text-center text-sm text-muted-foreground italic px-6">{text}</div>;
}

function pillClass(active: boolean) {
  return `shrink-0 h-8 px-3 rounded-full text-xs font-semibold transition ${
    active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/70"
  }`;
}

// ---------- Categoria (Hot 100 / Spotify / Apple / YouTube / Álbuns / Sales) ----------
type SubView = "global" | "country" | "monthly";

function ChartsCategoryView({ category }: { category: CategoryConfig }) {
  const [subView, setSubView] = useState<SubView>("global");
  const hasSubTabs = !!category.countryTab || !!category.monthlyPlatform;

  return (
    <div>
      {hasSubTabs && (
        <div className="px-4 pt-3">
          <PillScroller>
            <button onClick={() => setSubView("global")} className={pillClass(subView === "global")}>Global</button>
            {category.countryTab && (
              <button onClick={() => setSubView("country")} className={pillClass(subView === "country")}>Por país</button>
            )}
            {category.monthlyPlatform && (
              <button onClick={() => setSubView("monthly")} className={pillClass(subView === "monthly")}>Artistas do mês</button>
            )}
          </PillScroller>
        </div>
      )}
      {subView === "global" && <ChartsGlobalView category={category} />}
      {subView === "country" && category.countryTab && <ChartsCountryView tab={category.countryTab} />}
      {subView === "monthly" && category.monthlyPlatform && (
        <ChartsMonthlyView platform={category.monthlyPlatform} color={category.color} />
      )}
    </div>
  );
}

function ChartsGlobalView({ category }: { category: CategoryConfig }) {
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
      <h1 className="font-['Fjalla_One'] text-2xl uppercase tracking-tight mb-4 flex items-center gap-2">
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
              <div key={i} className="flex items-center gap-3 rounded-2xl border border-border/50 bg-card/40 p-2.5 shadow-sm shadow-black/10">
                <div className="w-9 shrink-0 text-center">
                  <div className="text-base font-black">{pos}</div>
                  <div className={`text-[9px] font-bold ${stColor}`}>{stLabel}</div>
                </div>
                <CoverImg src={cover} alt={title} className="size-11 rounded-xl object-cover shrink-0" />
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

// ---------- Charts por país ----------
function ChartsCountryView({ tab }: { tab: string }) {
  const [dates, setDates] = useState<string[]>([]);
  const [date, setDate] = useState<string | null>(null);
  const [rows, setRows] = useState<ChartRow[] | null>(null);
  const [country, setCountry] = useState("");
  const [search, setSearch] = useState("");
  const [loadingFilters, setLoadingFilters] = useState(true);
  const [loadingRows, setLoadingRows] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoadingFilters(true);
    setDate(null);
    setCountry("");
    setSearch("");
    setRows(null);
    getChartFilters(tab)
      .then((f) => {
        if (!alive) return;
        setDates(f.dates || []);
        setDate((f.dates || [])[0] || null);
      })
      .catch(() => alive && setDates([]))
      .finally(() => alive && setLoadingFilters(false));
    return () => { alive = false; };
  }, [tab]);

  useEffect(() => {
    if (!date) return;
    let alive = true;
    setLoadingRows(true);
    getChartData(tab, date)
      .then((r) => alive && setRows(Array.isArray(r) ? r : []))
      .catch(() => alive && setRows([]))
      .finally(() => alive && setLoadingRows(false));
    return () => { alive = false; };
  }, [tab, date]);

  const countries = useMemo(() => {
    if (!rows) return [];
    return Array.from(new Set(rows.map((r) => r.pais).filter(Boolean))).sort();
  }, [rows]);

  const filtered = useMemo(() => {
    if (!rows) return [];
    let list = rows;
    if (country) list = list.filter((r) => r.pais === country);
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (r) =>
          (r.tit || "").toLowerCase().includes(q) ||
          (r.art || "").toLowerCase().includes(q) ||
          (r.pais || "").toLowerCase().includes(q),
      );
    }
    return list;
  }, [rows, country, search]);

  if (loadingFilters) return <LoadingBlock />;
  if (!dates.length) return <EmptyBlock text={`Nenhuma data encontrada pra "${tab}".`} />;

  return (
    <div className="p-4">
      <PillScroller>
        {dates.map((d) => (
          <button key={d} onClick={() => setDate(d)} className={pillClass(d === date)}>{d}</button>
        ))}
      </PillScroller>

      <div className="flex flex-col sm:flex-row gap-2 mt-3 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="País, artista ou música..."
            className="w-full h-10 pl-9 pr-9 rounded-full bg-muted text-sm outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground"
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" aria-label="Limpar busca">
              <X className="size-4" />
            </button>
          )}
        </div>
        <select
          value={country}
          onChange={(e) => setCountry(e.target.value)}
          className="h-10 px-3 rounded-full bg-muted text-sm outline-none focus:ring-1 focus:ring-primary shrink-0"
        >
          <option value="">Todos os países</option>
          {countries.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>

      {loadingRows ? (
        <LoadingBlock text="Carregando chart..." />
      ) : filtered.length === 0 ? (
        <EmptyBlock text="Nenhum resultado encontrado." />
      ) : (
        <div className="space-y-1.5">
          {filtered.map((r, i) => (
            <div key={i} className="flex items-center gap-3 rounded-2xl border border-border/50 bg-card/40 p-2.5 shadow-sm shadow-black/10">
              <div className="w-9 shrink-0 text-center text-base font-black">{r.pos || "-"}</div>
              <CoverImg src={r.capa} alt={r.tit || ""} className="size-11 rounded-xl object-cover shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold truncate">{r.tit || "—"}</div>
                {r.art && <div className="text-xs text-muted-foreground truncate">{r.art}</div>}
              </div>
              <div className="shrink-0 text-right">
                <div className="text-sm font-black">{r.val || "0"}</div>
                {r.pais && <div className="text-[9px] text-muted-foreground font-bold uppercase">{r.pais}</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- Artistas do mês ----------
function ChartsMonthlyView({ platform, color }: { platform: string; color: string }) {
  const [years, setYears] = useState<string[]>([]);
  const [year, setYear] = useState<string | null>(null);
  const [months, setMonths] = useState<string[]>([]);
  const [month, setMonth] = useState<string | null>(null);
  const [artists, setArtists] = useState<string[]>([]);
  const [artist, setArtist] = useState("");
  const [stats, setStats] = useState<ChartRow | null>(null);
  const [loadingYears, setLoadingYears] = useState(true);
  const [loadingMonths, setLoadingMonths] = useState(false);
  const [loadingArtists, setLoadingArtists] = useState(false);
  const [loadingStats, setLoadingStats] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoadingYears(true);
    setYear(null);
    setMonths([]);
    setMonth(null);
    setArtists([]);
    setArtist("");
    setStats(null);
    getMonthlyYears()
      .then((y) => alive && setYears(Array.isArray(y) ? y : []))
      .catch(() => alive && setYears([]))
      .finally(() => alive && setLoadingYears(false));
    return () => { alive = false; };
  }, [platform]);

  const pickYear = (y: string) => {
    setYear(y);
    setMonth(null);
    setArtists([]);
    setArtist("");
    setStats(null);
    setLoadingMonths(true);
    getMonthlyDates(y)
      .then((m) => setMonths(Array.isArray(m) ? m : []))
      .catch(() => setMonths([]))
      .finally(() => setLoadingMonths(false));
  };

  const pickMonth = (m: string) => {
    if (!year) return;
    setMonth(m);
    setArtist("");
    setStats(null);
    setLoadingArtists(true);
    getMonthlyArtists(platform, m, year)
      .then((a) => setArtists(Array.isArray(a) ? a : []))
      .catch(() => setArtists([]))
      .finally(() => setLoadingArtists(false));
  };

  const pickArtist = (a: string) => {
    setArtist(a);
    if (!a || !year || !month) { setStats(null); return; }
    setLoadingStats(true);
    getMonthlyStats(platform, month, year, a)
      .then((d) => setStats(Array.isArray(d) && d[0] ? d[0] : null))
      .catch(() => setStats(null))
      .finally(() => setLoadingStats(false));
  };

  if (loadingYears) return <LoadingBlock />;
  if (!years.length) return <EmptyBlock text="Nenhum dado mensal encontrado." />;

  return (
    <div className="p-4 space-y-3">
      <PillScroller>
        {years.map((y) => (
          <button key={y} onClick={() => pickYear(y)} className={pillClass(y === year)}>{y}</button>
        ))}
      </PillScroller>

      {loadingMonths ? (
        <LoadingBlock text="Carregando meses..." />
      ) : months.length > 0 ? (
        <PillScroller>
          {months.map((m) => (
            <button key={m} onClick={() => pickMonth(m)} className={pillClass(m === month)}>{m}</button>
          ))}
        </PillScroller>
      ) : null}

      {loadingArtists ? (
        <LoadingBlock text="Carregando artistas..." />
      ) : artists.length > 0 ? (
        <select
          value={artist}
          onChange={(e) => pickArtist(e.target.value)}
          className="w-full h-10 px-3 rounded-full bg-muted text-sm outline-none focus:ring-1 focus:ring-primary"
        >
          <option value="">Selecionar artista</option>
          {artists.map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
      ) : null}

      {loadingStats ? (
        <LoadingBlock text="Carregando perfil..." />
      ) : stats && month && year ? (
        <MonthlyArtistProfile platform={platform} artist={artist} data={stats} month={month} year={year} color={color} />
      ) : null}
    </div>
  );
}

function MonthlyArtistProfile({
  platform, artist, data, month, year, color,
}: {
  platform: string; artist: string; data: ChartRow; month: string; year: string; color: string;
}) {
  const cover = data.capaArtista || data.capa;
  const listeners = data.totalOuvintes || data.ov;
  const rank = data.rank && data.rank !== "-" ? data.rank : null;
  const songs: ChartRow[] = data.musicas || data.m || [];
  const bio = data.sobre || data.bio;
  const isYT = platform.includes("YOUTUBE");
  const listenerLabel = isYT ? "visualizações mensais" : "ouvintes mensais";

  return (
    <div className="rounded-2xl overflow-hidden border border-border/50">
      <div className="relative h-48 bg-muted">
        <CoverImg src={cover} alt={artist} className="absolute inset-0 w-full h-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-transparent" />
        <div className="absolute bottom-3 left-4 right-4">
          <h2 className="font-['Fjalla_One'] text-2xl text-white uppercase tracking-tight">{artist}</h2>
          {listeners && <div className={`text-sm font-semibold ${color}`}>{listeners} {listenerLabel}</div>}
          {rank && (
            <span className="inline-block mt-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-white/15 text-white">
              #{rank} em {month} {year}
            </span>
          )}
        </div>
      </div>
      <div className="p-4 grid gap-5 sm:grid-cols-[2fr,1fr]">
        {songs.length > 0 && (
          <div>
            <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-2">
              {isYT ? "Vídeos populares" : "Populares"}
            </h3>
            <div className="space-y-2">
              {songs.slice(0, 5).map((s, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground w-4 text-right shrink-0">{i + 1}</span>
                  <CoverImg src={s.capaMusica || s.c} alt={s.titulo || s.t || ""} className="size-10 rounded-md object-cover shrink-0" />
                  <span className="text-sm font-medium flex-1 truncate">{s.titulo || s.t}</span>
                  <span className={`text-xs font-bold shrink-0 ${color}`}>{s.streams || s.s}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {bio && (
          <div>
            <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-2">Sobre</h3>
            <div className="text-sm text-muted-foreground leading-relaxed bg-muted/40 rounded-xl p-3">{bio}</div>
          </div>
        )}
      </div>
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
