import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  TrendingUp,
  TrendingDown,
  Building2,
  Mic2,
  Loader2,
  ArrowUpRight,
  ArrowDownRight,
  Activity,
  ChevronLeft,
} from "lucide-react";
import { api, fmtEC, type EmpresaBolsa, type BolsaLogItem } from "@/lib/api";

export const Route = createFileRoute("/bolsa")({
  component: BolsaPage,
});

type AssetRow = {
  key: string;
  tipo: "EMPRESA" | "TOUR";
  nome: string;
  dono: string;
  segmento?: string;
  valor: number;
  variacao24h: number;
  variacaoPct: number;
  ativa: boolean;
  spark: number[];
};

const SEG_COLOR: Record<string, string> = {
  tech: "text-sky-400 bg-sky-500/10",
  beauty: "text-pink-400 bg-pink-500/10",
  food: "text-orange-400 bg-orange-500/10",
};

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function buildAssets(
  empresas: EmpresaBolsa[],
  tours: any[],
  log: BolsaLogItem[],
): AssetRow[] {
  const today = todayKey();
  const byRef: Record<string, BolsaLogItem[]> = {};
  for (const l of log) {
    const k = `${l.tipo}|${l.ref_id}`;
    (byRef[k] ||= []).push(l);
  }

  const rows: AssetRow[] = [];

  for (const e of empresas) {
    const k = `EMPRESA|${e.id}`;
    const series = (byRef[k] || []).slice(-12);
    const todayEntries = (byRef[k] || []).filter(
      (l) => String(l.data).slice(0, 10) === today,
    );
    const var24 = todayEntries.reduce((s, l) => s + l.resultado_dia, 0);
    const pct = e.valor_atual > 0 ? (var24 / e.valor_atual) * 100 : 0;
    rows.push({
      key: k,
      tipo: "EMPRESA",
      nome: e.nome,
      dono: e.dono,
      segmento: e.segmento,
      valor: e.valor_atual,
      variacao24h: var24,
      variacaoPct: pct,
      ativa: e.ativa,
      spark: series.map((s) => s.valor_apos),
    });
  }

  for (const t of tours) {
    if (!t || !t.artista) continue;
    const k = `TOUR|${t.titulo || t.artista}`;
    const series = (byRef[k] || []).slice(-12);
    const todayEntries = (byRef[k] || []).filter(
      (l) => String(l.data).slice(0, 10) === today,
    );
    const var24 = todayEntries.reduce((s, l) => s + l.resultado_dia, 0);
    const valor = Number(t.arrecadacao_total || 0);
    rows.push({
      key: k,
      tipo: "TOUR",
      nome: t.titulo || "The Empire Tour",
      dono: t.artista,
      valor,
      variacao24h: var24,
      variacaoPct: valor > 0 ? (var24 / valor) * 100 : 0,
      ativa: String(t.status || "") !== "Concluída",
      spark: series.map((s) => s.valor_apos),
    });
  }

  return rows.sort((a, b) => b.valor - a.valor);
}

function Sparkline({ data, positive }: { data: number[]; positive: boolean }) {
  if (!data || data.length < 2) {
    return <div className="h-8 w-20 opacity-20 text-[10px] flex items-center justify-end italic">—</div>;
  }
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pts = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * 80;
      const y = 28 - ((v - min) / range) * 26;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg width="80" height="32" className="overflow-visible">
      <polyline
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={positive ? "text-emerald-400" : "text-rose-400"}
        points={pts}
      />
    </svg>
  );
}

function BolsaPage() {
  const [empresas, setEmpresas] = useState<EmpresaBolsa[]>([]);
  const [tours, setTours] = useState<any[]>([]);
  const [log, setLog] = useState<BolsaLogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"all" | "empresas" | "tours">("all");

  useEffect(() => {
    Promise.all([api.listarEmpresas(), api.listTours(), api.historicoBolsa({ limit: 300 })])
      .then(([e, t, l]) => {
        setEmpresas(e);
        setTours(Array.isArray(t) ? t : []);
        setLog(l);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const assets = useMemo(() => buildAssets(empresas, tours, log), [empresas, tours, log]);
  const filtered = useMemo(() => {
    if (tab === "empresas") return assets.filter((a) => a.tipo === "EMPRESA");
    if (tab === "tours") return assets.filter((a) => a.tipo === "TOUR");
    return assets;
  }, [assets, tab]);

  const indiceDia = useMemo(() => {
    const today = todayKey();
    return log
      .filter((l) => String(l.data).slice(0, 10) === today)
      .reduce((s, l) => s + l.resultado_dia, 0);
  }, [log]);

  const totalCap = useMemo(() => assets.reduce((s, a) => s + a.valor, 0), [assets]);
  const indicePct = totalCap > 0 ? (indiceDia / totalCap) * 100 : 0;
  const positive = indiceDia >= 0;

  return (
    <main className="flex-1 mx-auto w-full max-w-2xl px-4 pt-6 pb-24">
      <button
        onClick={() => window.history.back()}
        className="inline-flex items-center gap-1 text-muted-foreground mb-4 text-xs"
      >
        <ChevronLeft className="size-4" /> Voltar
      </button>

      {/* Header / Índice */}
      <header className="mb-6">
        <div className="flex items-center gap-2 mb-1">
          <Activity className="size-4 text-primary" />
          <span className="text-[10px] font-black uppercase tracking-[0.3em] text-muted-foreground">
            Empire Stock Exchange
          </span>
        </div>
        <h1 className="text-3xl font-black italic tracking-tighter">Bolsa de Valores</h1>
        <p className="text-xs text-muted-foreground mt-1">
          Empresas e turnês listadas — pró-labore diário automático.
        </p>
      </header>

      {/* Card índice */}
      <div
        className={`relative overflow-hidden rounded-3xl border p-5 mb-6 ${
          positive
            ? "bg-emerald-500/5 border-emerald-500/20"
            : "bg-rose-500/5 border-rose-500/20"
        }`}
      >
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
              Índice EMP — Hoje
            </p>
            <p
              className={`text-3xl font-black italic mt-1 tracking-tight ${
                positive ? "text-emerald-400" : "text-rose-400"
              }`}
            >
              {positive ? "+" : ""}
              {fmtEC(indiceDia)}
            </p>
            <p
              className={`text-xs font-bold ${
                positive ? "text-emerald-400/70" : "text-rose-400/70"
              }`}
            >
              {positive ? "▲" : "▼"} {indicePct.toFixed(2)}% · capitalização {fmtEC(totalCap)}
            </p>
          </div>
          <div
            className={`size-14 rounded-2xl grid place-items-center ${
              positive ? "bg-emerald-500/15 text-emerald-400" : "bg-rose-500/15 text-rose-400"
            }`}
          >
            {positive ? <TrendingUp className="size-7" /> : <TrendingDown className="size-7" />}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 p-1 bg-card rounded-2xl border border-white/5 mb-4">
        {[
          { id: "all", label: "Todos" },
          { id: "empresas", label: "Empresas" },
          { id: "tours", label: "Turnês" },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id as any)}
            className={`flex-1 py-2 rounded-xl text-[11px] font-black uppercase tracking-widest transition-all ${
              tab === t.id ? "bg-primary text-primary-foreground" : "text-muted-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Lista */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3 opacity-50">
          <Loader2 className="size-8 animate-spin" />
          <p className="text-xs font-bold uppercase tracking-widest">Carregando ativos...</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-3xl bg-white/[0.03] border border-dashed border-white/10 p-12 text-center">
          <Building2 className="size-10 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">Nenhum ativo listado ainda.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((a) => (
            <AssetCard key={a.key} asset={a} />
          ))}
        </div>
      )}
    </main>
  );
}

function AssetCard({ asset }: { asset: AssetRow }) {
  const positive = asset.variacao24h >= 0;
  const Icon = asset.tipo === "EMPRESA" ? Building2 : Mic2;
  const segColor =
    asset.tipo === "EMPRESA"
      ? SEG_COLOR[asset.segmento || ""] || "text-muted-foreground bg-white/5"
      : "text-emerald-400 bg-emerald-500/10";

  return (
    <div className="relative overflow-hidden rounded-2xl bg-card border border-white/5 p-4 hover:bg-white/[0.04] transition-colors">
      <div className="flex items-center gap-3">
        <div className={`size-11 rounded-xl grid place-items-center shrink-0 ${segColor}`}>
          <Icon className="size-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <h3 className="font-black text-sm truncate">{asset.nome}</h3>
            {!asset.ativa && (
              <span className="text-[9px] font-black uppercase tracking-widest text-rose-400 bg-rose-500/15 px-1.5 py-0.5 rounded">
                Falida
              </span>
            )}
          </div>
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest truncate">
            {asset.dono}
            {asset.segmento ? ` · ${asset.segmento}` : ""}
            {asset.tipo === "TOUR" ? " · Turnê" : ""}
          </p>
        </div>

        <div className="hidden xs:block sm:block">
          <Sparkline data={asset.spark} positive={positive} />
        </div>

        <div className="text-right shrink-0">
          <p className="text-sm font-black tracking-tight">{fmtEC(asset.valor)}</p>
          <p
            className={`text-[11px] font-bold flex items-center justify-end gap-0.5 ${
              positive ? "text-emerald-400" : "text-rose-400"
            }`}
          >
            {positive ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
            {positive ? "+" : ""}
            {fmtEC(asset.variacao24h)}
            <span className="opacity-70">({asset.variacaoPct.toFixed(1)}%)</span>
          </p>
        </div>
      </div>
    </div>
  );
}
