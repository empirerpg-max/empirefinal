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
  Radio,
  ImageIcon,
} from "lucide-react";
import { useTelegramUser, haptic } from "@/lib/telegram";
import { api } from "@/lib/api";
import { useImageCrop } from "@/hooks/use-image-crop";
import { toast } from "sonner";

const PLATAFORMAS_BANNER: { valor: "SPOTIFY" | "APPLE MUSIC" | "YOUTUBE"; label: string; preco: number }[] = [
  { valor: "SPOTIFY", label: "Spotify", preco: 100000 },
  { valor: "APPLE MUSIC", label: "Apple Music", preco: 60000 },
  { valor: "YOUTUBE", label: "YouTube", preco: 200000 },
];

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

  const [bannerModalOpen, setBannerModalOpen] = useState(false);
  const [bannerArtista, setBannerArtista] = useState("");
  const [bannerPlataforma, setBannerPlataforma] = useState<"SPOTIFY" | "APPLE MUSIC" | "YOUTUBE" | "">("");
  const [bannerOpcoes, setBannerOpcoes] = useState<
    { titulo: string; topicoId: string; capa: string | null; tipo: string }[]
  >([]);
  const [bannerOpcaoTopicoId, setBannerOpcaoTopicoId] = useState("");
  const [bannerImageFile, setBannerImageFile] = useState<File | null>(null);
  const [bannerImagePreview, setBannerImagePreview] = useState<string | null>(null);
  const [bannerSubmitting, setBannerSubmitting] = useState(false);
  const { cropModal: bannerCropModal, cropImage: cropBannerImage } = useImageCrop({
    targetW: 1200,
    targetH: 400,
    shape: "square",
    title: "Editar banner",
  });

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

  const abrirBannerModal = () => {
    if (artistas.length === 0) {
      toast.error("Você precisa ter um artista pra divulgar.");
      return;
    }
    haptic.selection();
    setBannerArtista(artistas[0].nome);
    setBannerPlataforma("");
    setBannerOpcaoTopicoId("");
    setBannerOpcoes([]);
    setBannerImageFile(null);
    setBannerImagePreview(null);
    setBannerModalOpen(true);
  };

  useEffect(() => {
    if (!bannerModalOpen || !bannerArtista || !tgId) return;
    api.listarBannerOpcoes(tgId, bannerArtista).then(setBannerOpcoes);
    setBannerOpcaoTopicoId("");
  }, [bannerModalOpen, bannerArtista, tgId]);

  const bannerOpcaoSelecionada = bannerOpcoes.find((o) => o.topicoId === bannerOpcaoTopicoId);
  const bannerPreco = PLATAFORMAS_BANNER.find((p) => p.valor === bannerPlataforma)?.preco ?? 0;
  const bannerSaldoArtista = artistas.find((a) => a.nome === bannerArtista)?.saldoEcoin ?? 0;

  const confirmarCompraBanner = async () => {
    if (bannerSubmitting) return;
    if (!bannerPlataforma || !bannerOpcaoSelecionada || !bannerImageFile) {
      toast.error("Preencha plataforma, música/álbum e a imagem do banner.");
      return;
    }
    if (bannerSaldoArtista < bannerPreco) {
      toast.error("ECoin insuficiente.");
      return;
    }
    setBannerSubmitting(true);
    try {
      const formData = new FormData();
      formData.append("file", bannerImageFile);
      formData.append("fileName", `SPOTLIGHT_${Date.now()}_${bannerImageFile.name}`);
      formData.append("folderType", "socialPosts");
      const uploadRes = await fetch("/api/gestao/upload", { method: "POST", body: formData }).then((r) => r.json());
      if (!uploadRes?.success || !uploadRes?.data?.fileUrl) throw new Error("Falha ao enviar a imagem.");

      const res = await api.comprarBanner({
        telegramId: tgId,
        usuario: user?.name || "",
        artista: bannerArtista,
        plataforma: bannerPlataforma,
        musicaOuAlbum: bannerOpcaoSelecionada.titulo,
        topicoId: bannerOpcaoSelecionada.topicoId,
        imagemUrl: uploadRes.data.fileUrl,
        tab: bannerOpcaoSelecionada.tipo === "albuns" ? "albuns" : "musicas",
      });
      if (res.success) {
        haptic.success();
        toast.success("Spotlight ativado! Seu banner já entrou na fila da home.");
        setBannerModalOpen(false);
        load();
      } else {
        toast.error(res.error || "Não foi possível comprar o banner.");
      }
    } catch (err: any) {
      toast.error(err?.message || "Erro de conexão.");
    } finally {
      setBannerSubmitting(false);
    }
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

      {artistas.length > 0 && (
        <button
          onClick={abrirBannerModal}
          className="w-full flex items-center gap-4 p-4 mb-6 rounded-2xl bg-gradient-to-r from-amber-500/15 to-primary/10 border border-amber-400/25 hover:border-amber-400/40 transition-all text-left"
        >
          <div className="size-12 rounded-xl bg-amber-400/20 text-amber-300 grid place-items-center shrink-0">
            <Radio className="size-6" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-black uppercase tracking-tight">Spotlight Banner</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Banner em destaque na home por 4 dias — comentários vindos dele geram playlist bônus.
            </p>
          </div>
        </button>
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

      {bannerModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm grid place-items-end sm:place-items-center p-0 sm:p-4"
          onClick={() => !bannerSubmitting && setBannerModalOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md bg-card rounded-t-3xl sm:rounded-3xl p-6 border border-white/10 max-h-[90vh] overflow-y-auto"
          >
            <div className="size-12 rounded-xl bg-amber-400/20 text-amber-300 grid place-items-center mb-3">
              <Radio className="size-6" />
            </div>
            <h3 className="text-lg font-black uppercase tracking-tight mb-1">Spotlight Banner</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Fica em destaque na home por 4 dias. Quem comentar no tópico através do clique no banner libera uma
              playlist mínima bônus na plataforma escolhida.
            </p>

            {artistas.length > 1 && (
              <select
                value={bannerArtista}
                onChange={(e) => setBannerArtista(e.target.value)}
                className="w-full mb-3 px-4 py-3 bg-white/5 border border-white/10 rounded-2xl text-sm outline-none focus:border-primary/50 transition"
              >
                {artistas.map((a) => (
                  <option key={a.nome} value={a.nome}>
                    {a.nome} — R$ {formatMoeda(a.saldoEcoin)}
                  </option>
                ))}
              </select>
            )}

            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-1.5">Plataforma</p>
            <div className="grid grid-cols-3 gap-1.5 mb-3">
              {PLATAFORMAS_BANNER.map((p) => (
                <button
                  key={p.valor}
                  onClick={() => setBannerPlataforma(p.valor)}
                  className={`py-2.5 px-2 rounded-xl text-[10px] font-black uppercase tracking-wide text-center transition ${
                    bannerPlataforma === p.valor
                      ? "bg-primary text-primary-foreground"
                      : "bg-white/5 border border-white/10 text-muted-foreground"
                  }`}
                >
                  {p.label}
                  <br />
                  R$ {formatMoeda(p.preco)}
                </button>
              ))}
            </div>

            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-1.5">
              Música ou álbum
            </p>
            <select
              value={bannerOpcaoTopicoId}
              onChange={(e) => setBannerOpcaoTopicoId(e.target.value)}
              className="w-full mb-3 px-4 py-3 bg-white/5 border border-white/10 rounded-2xl text-sm outline-none focus:border-primary/50 transition"
            >
              <option value="" disabled>
                {bannerOpcoes.length === 0 ? "Nenhum lançamento com tópico ainda" : "Selecione"}
              </option>
              {bannerOpcoes.map((o) => (
                <option key={o.topicoId} value={o.topicoId}>
                  {o.titulo} {o.tipo === "albuns" ? "(álbum)" : ""}
                </option>
              ))}
            </select>

            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-1.5">
              Imagem do banner (corte 3:1)
            </p>
            <label className="block border-2 border-dashed border-white/15 rounded-2xl p-4 text-center cursor-pointer hover:border-white/25 transition mb-4">
              {bannerImagePreview ? (
                <img src={bannerImagePreview} alt="" className="w-full aspect-[3/1] object-cover rounded-xl" />
              ) : (
                <div className="flex flex-col items-center gap-1.5 py-3">
                  <ImageIcon className="size-5 text-muted-foreground" />
                  <p className="text-xs font-bold text-muted-foreground">Toque para enviar a imagem</p>
                </div>
              )}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  const cropped = await cropBannerImage(file);
                  if (!cropped) return;
                  setBannerImageFile(cropped);
                  setBannerImagePreview(URL.createObjectURL(cropped));
                }}
              />
            </label>

            <div className="flex items-center justify-between mb-4 p-3 rounded-xl bg-white/5">
              <span className="text-xs font-bold text-muted-foreground">Custo</span>
              <span className="flex items-center gap-1 text-sm font-black text-primary">
                <Coins className="size-4" />
                R$ {formatMoeda(bannerPreco)}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setBannerModalOpen(false)}
                disabled={bannerSubmitting}
                className="py-3 rounded-full bg-white/5 border border-white/10 font-black text-xs uppercase tracking-wider disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={confirmarCompraBanner}
                disabled={
                  bannerSubmitting ||
                  !bannerPlataforma ||
                  !bannerOpcaoSelecionada ||
                  !bannerImageFile ||
                  bannerSaldoArtista < bannerPreco
                }
                className="py-3 rounded-full bg-primary text-primary-foreground font-black text-xs uppercase tracking-wider disabled:opacity-40 flex items-center justify-center gap-1.5"
              >
                {bannerSubmitting ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                Ativar
              </button>
            </div>
          </div>
        </div>
      )}
      {bannerCropModal}
    </div>
  );
}
