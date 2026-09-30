import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  ChevronLeft,
  ShoppingBag,
  Info,
  CalendarOff,
  PartyPopper,
  Music,
  Disc3,
  Gavel,
  Timer,
  Clapperboard,
  Megaphone,
  Tv,
  ListMusic,
  Loader2,
  Check,
  Coins,
  Sparkles,
} from "lucide-react";
import { useTelegramUser, haptic } from "@/lib/telegram";
import { api } from "@/lib/api";
import { toast } from "sonner";

export const Route = createFileRoute("/market")({
  head: () => ({ meta: [{ title: "Empire Market — Empire Hub" }] }),
  component: MarketPage,
});

type MarketItem = {
  id: string;
  nome: string;
  descricao: string;
  moeda: "prestigio" | "ecoin";
  preco: number;
  icone: string;
  pedeDetalhe: boolean;
  detalhePlaceholder: string;
  categoria: string;
  exclusivoGrupo: string;
  tipoEspecial: string;
  plataforma: string;
  destino: string;
};

const ICONES: Record<string, React.ReactNode> = {
  week_off: <CalendarOff className="size-6" />,
  aniversario: <PartyPopper className="size-6" />,
  music_boost: <Music className="size-6" />,
  album_boost: <Disc3 className="size-6" />,
  leilao: <Gavel className="size-6" />,
  award_minuto: <Timer className="size-6" />,
  premiere_clipe: <Clapperboard className="size-6" />,
  comercial: <Megaphone className="size-6" />,
  estreia_hits: <Tv className="size-6" />,
  playlist: <ListMusic className="size-6" />,
};

function formatMoeda(valor: number): string {
  return valor.toLocaleString("pt-BR");
}

function MarketPage() {
  const { user } = useTelegramUser();
  const tgId = user?.id || "";

  const [itens, setItens] = useState<MarketItem[] | null>(null);
  const [saldoPrestigio, setSaldoPrestigio] = useState(0);
  const [artistas, setArtistas] = useState<{ nome: string; saldoEcoin: number }[]>([]);
  const [comprando, setComprando] = useState<MarketItem | null>(null);
  const [detalhe, setDetalhe] = useState("");
  const [artistaSelecionado, setArtistaSelecionado] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = () => {
    if (!tgId || tgId === "guest") return;
    api.listarMarketProdutos(tgId).then((d) => {
      setItens(d.itens);
      setSaldoPrestigio(d.saldoPrestigio);
      setArtistas(d.artistas);
    });
  };

  useEffect(load, [tgId]);

  const grupos = useMemo(() => {
    if (!itens) return [];
    const ordem: string[] = [];
    const porCategoria = new Map<string, MarketItem[]>();
    for (const item of itens) {
      const chave = item.categoria || "Outros";
      if (!porCategoria.has(chave)) {
        porCategoria.set(chave, []);
        ordem.push(chave);
      }
      porCategoria.get(chave)!.push(item);
    }
    return ordem.map((categoria) => ({ categoria, itens: porCategoria.get(categoria)! }));
  }, [itens]);

  const saldoAtivo = comprando?.moeda === "ecoin" ? artistas.find((a) => a.nome === artistaSelecionado)?.saldoEcoin ?? 0 : saldoPrestigio;

  const abrirCompra = (item: MarketItem) => {
    if (item.tipoEspecial === "leilao") {
      haptic.light();
      toast.info("Esse item é por leilão — a tela de lances ainda está sendo construída.");
      return;
    }
    haptic.selection();
    setDetalhe("");
    setArtistaSelecionado(item.moeda === "ecoin" ? artistas[0]?.nome || "" : "");
    setComprando(item);
  };

  const confirmarCompra = async () => {
    if (!comprando || submitting) return;
    if (comprando.pedeDetalhe && !detalhe.trim()) return;
    if (comprando.moeda === "ecoin" && !artistaSelecionado) {
      toast.error("Selecione o artista.");
      return;
    }
    if (saldoAtivo < comprando.preco) {
      toast.error(comprando.moeda === "ecoin" ? "ECoin insuficiente." : "Prestígio insuficiente.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await api.comprarMarketProduto({
        itemId: comprando.id,
        telegramId: tgId,
        usuario: user?.name || "",
        artista: comprando.moeda === "ecoin" ? artistaSelecionado : undefined,
        detalhe: detalhe.trim(),
      });
      if (res.success) {
        haptic.success();
        toast.success(`${comprando.nome} resgatado!`);
        if (comprando.moeda === "prestigio") {
          setSaldoPrestigio(res.data?.saldoPrestigio ?? saldoPrestigio - comprando.preco);
        } else {
          load();
        }
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
          <p className="text-[11px] text-muted-foreground">Troque prestígio e ECoin por vantagens.</p>
        </div>
      </header>

      <div className="mb-4 grid grid-cols-2 gap-2">
        <div className="p-4 rounded-2xl bg-primary/10 border border-primary/20">
          <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-1">
            <Coins className="size-3" /> Prestígio
          </p>
          <p className="text-lg font-black text-primary">{formatMoeda(saldoPrestigio)}</p>
        </div>
        <Link
          to="/market/regras"
          onClick={() => haptic.selection()}
          className="p-4 rounded-2xl bg-white/5 border border-white/10 flex flex-col justify-center items-start hover:bg-white/10 transition"
        >
          <span className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider">
            <Info className="size-3.5" /> Entenda os prestígios
          </span>
        </Link>
      </div>

      {artistas.length > 0 && (
        <div className="mb-6 p-4 rounded-2xl bg-white/[0.03] border border-white/10">
          <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground mb-2 flex items-center gap-1">
            <Sparkles className="size-3" /> ECoin por artista
          </p>
          <div className="flex flex-col gap-1.5">
            {artistas.map((a) => (
              <div key={a.nome} className="flex items-center justify-between text-sm">
                <span className="font-bold truncate">{a.nome}</span>
                <span className="font-black text-primary shrink-0">R$ {formatMoeda(a.saldoEcoin)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-6">
        {itens === null
          ? [1, 2, 3, 4].map((i) => <div key={i} className="h-24 rounded-2xl bg-white/5 animate-pulse" />)
          : grupos.map(({ categoria, itens: itensDaCategoria }) => (
              <div key={categoria}>
                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-2 px-1">
                  {categoria}
                </p>
                <div className="space-y-3">
                  {itensDaCategoria.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => abrirCompra(item)}
                      className="w-full flex items-center gap-4 p-4 rounded-2xl bg-white/[0.03] border border-white/10 hover:bg-white/[0.06] transition-all text-left"
                    >
                      <div className="size-12 rounded-xl bg-primary/15 text-primary grid place-items-center shrink-0">
                        {ICONES[item.icone] || <ShoppingBag className="size-6" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-black uppercase tracking-tight">{item.nome}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{item.descricao}</p>
                      </div>
                      {item.tipoEspecial === "leilao" ? (
                        <div className="shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-full bg-white/10 text-muted-foreground text-[10px] font-black uppercase">
                          Leilão
                        </div>
                      ) : (
                        <div className="shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-full bg-primary/15 text-primary text-xs font-black">
                          <Coins className="size-3.5" /> {formatMoeda(item.preco)}
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            ))}
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
              {ICONES[comprando.icone] || <ShoppingBag className="size-6" />}
            </div>
            <h3 className="text-lg font-black uppercase tracking-tight mb-1">{comprando.nome}</h3>
            <p className="text-sm text-muted-foreground mb-4">{comprando.descricao}</p>

            {comprando.moeda === "ecoin" && (
              <select
                value={artistaSelecionado}
                onChange={(e) => setArtistaSelecionado(e.target.value)}
                className="w-full mb-3 px-4 py-3 bg-white/5 border border-white/10 rounded-2xl text-sm outline-none focus:border-primary/50 transition"
              >
                <option value="" disabled>
                  Selecione o artista
                </option>
                {artistas.map((a) => (
                  <option key={a.nome} value={a.nome}>
                    {a.nome} — R$ {formatMoeda(a.saldoEcoin)}
                  </option>
                ))}
              </select>
            )}

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
                <Coins className="size-4" />
                {comprando.moeda === "ecoin" ? `R$ ${formatMoeda(comprando.preco)}` : formatMoeda(comprando.preco)}
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
                disabled={
                  submitting ||
                  (comprando.pedeDetalhe && !detalhe.trim()) ||
                  (comprando.moeda === "ecoin" && !artistaSelecionado) ||
                  saldoAtivo < comprando.preco
                }
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
