import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  ChevronLeft,
  ShoppingBag,
  Info,
  CalendarOff,
  Music,
  Disc3,
  MessageSquareHeart,
  Loader2,
  Check,
  Coins,
} from "lucide-react";
import { useTelegramUser, haptic } from "@/lib/telegram";
import { api } from "@/lib/api";
import { toast } from "sonner";

export const Route = createFileRoute("/market")({
  head: () => ({ meta: [{ title: "Empire Market — Empire Hub" }] }),
  component: MarketPage,
});

type Produto = {
  id: string;
  nome: string;
  descricao: string;
  preco: number;
  icone: string;
  pedeDetalhe: boolean;
  detalhePlaceholder?: string;
};

const ICONES: Record<string, React.ReactNode> = {
  week_off: <CalendarOff className="size-6" />,
  music_boost: <Music className="size-6" />,
  album_boost: <Disc3 className="size-6" />,
  double_week: <MessageSquareHeart className="size-6" />,
};

function MarketPage() {
  const { user } = useTelegramUser();
  const tgId = user?.id || "";

  const [produtos, setProdutos] = useState<Produto[] | null>(null);
  const [saldo, setSaldo] = useState(0);
  const [comprando, setComprando] = useState<Produto | null>(null);
  const [detalhe, setDetalhe] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = () => {
    if (!tgId || tgId === "guest") return;
    api.listarMarketProdutos(tgId).then((d) => {
      setProdutos(d.produtos);
      setSaldo(d.saldo);
    });
  };

  useEffect(load, [tgId]);

  const abrirCompra = (p: Produto) => {
    haptic.selection();
    setDetalhe("");
    setComprando(p);
  };

  const confirmarCompra = async () => {
    if (!comprando || submitting) return;
    if (comprando.pedeDetalhe && !detalhe.trim()) return;
    if (saldo < comprando.preco) {
      toast.error("Prestígio insuficiente.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await api.comprarMarketProduto({
        produtoId: comprando.id,
        telegramId: tgId,
        usuario: user?.name || "",
        detalhe: detalhe.trim(),
      });
      if (res.success) {
        haptic.success();
        toast.success(`${comprando.nome} resgatado!`);
        setSaldo(res.data?.saldo ?? saldo - comprando.preco);
        setComprando(null);
      } else {
        toast.error(res.error || "Não foi possível comprar.");
      }
    } catch {
      toast.error("Erro de conexão.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="pb-24 px-4 pt-6 max-w-md mx-auto min-h-screen">
      <header className="flex items-center gap-3 mb-6">
        <Link to="/" className="size-9 rounded-full bg-white/5 border border-white/10 grid place-items-center">
          <ChevronLeft className="size-5" />
        </Link>
        <div className="flex-1">
          <h1 className="text-lg font-black uppercase tracking-tight flex items-center gap-2">
            <ShoppingBag className="size-5 text-primary" /> Empire Market
          </h1>
          <p className="text-[11px] text-muted-foreground">Troque prestígio por vantagens.</p>
        </div>
      </header>

      <div className="mb-4 p-4 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Coins className="size-5 text-primary" />
          <div>
            <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">
              Seu prestígio
            </p>
            <p className="text-lg font-black text-primary">{saldo}</p>
          </div>
        </div>
        <Link
          to="/market/regras"
          onClick={() => haptic.selection()}
          className="flex items-center gap-1.5 px-3 py-2 rounded-full bg-white/5 border border-white/10 text-[10px] font-black uppercase tracking-wider hover:bg-white/10 transition"
        >
          <Info className="size-3.5" /> Entenda os prestígios
        </Link>
      </div>

      <div className="space-y-3">
        {produtos === null ? (
          [1, 2, 3, 4].map((i) => <div key={i} className="h-24 rounded-2xl bg-white/5 animate-pulse" />)
        ) : (
          produtos.map((p) => (
            <button
              key={p.id}
              onClick={() => abrirCompra(p)}
              className="w-full flex items-center gap-4 p-4 rounded-2xl bg-white/[0.03] border border-white/10 hover:bg-white/[0.06] transition-all text-left"
            >
              <div className="size-12 rounded-xl bg-primary/15 text-primary grid place-items-center shrink-0">
                {ICONES[p.icone]}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-black uppercase tracking-tight">{p.nome}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{p.descricao}</p>
              </div>
              <div className="shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-full bg-primary/15 text-primary text-xs font-black">
                <Coins className="size-3.5" /> {p.preco}
              </div>
            </button>
          ))
        )}
      </div>

      {comprando && (
        <div
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm grid place-items-end sm:place-items-center p-0 sm:p-4"
          onClick={() => !submitting && setComprando(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md bg-card rounded-t-3xl sm:rounded-3xl p-6 border border-white/10"
          >
            <div className="size-12 rounded-xl bg-primary/15 text-primary grid place-items-center mb-3">
              {ICONES[comprando.icone]}
            </div>
            <h3 className="text-lg font-black uppercase tracking-tight mb-1">{comprando.nome}</h3>
            <p className="text-sm text-muted-foreground mb-4">{comprando.descricao}</p>

            {comprando.pedeDetalhe && (
              <input
                type="text"
                value={detalhe}
                onChange={(e) => setDetalhe(e.target.value)}
                placeholder={comprando.detalhePlaceholder}
                className="w-full mb-4 px-4 py-3 bg-white/5 border border-white/10 rounded-2xl text-sm outline-none focus:border-primary/50 transition"
              />
            )}

            <div className="flex items-center justify-between mb-4 p-3 rounded-xl bg-white/5">
              <span className="text-xs font-bold text-muted-foreground">Custo</span>
              <span className="flex items-center gap-1 text-sm font-black text-primary">
                <Coins className="size-4" /> {comprando.preco}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setComprando(null)}
                disabled={submitting}
                className="py-3 rounded-full bg-white/5 border border-white/10 font-black text-xs uppercase tracking-wider disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={confirmarCompra}
                disabled={submitting || (comprando.pedeDetalhe && !detalhe.trim()) || saldo < comprando.preco}
                className="py-3 rounded-full bg-primary text-primary-foreground font-black text-xs uppercase tracking-wider disabled:opacity-40 flex items-center justify-center gap-1.5"
              >
                {submitting ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                Resgatar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
