import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, Gavel, Trophy, Loader2, ChevronDown, Coins } from "lucide-react";
import { useTelegramUser, haptic } from "@/lib/telegram";
import { api } from "@/lib/api";
import { toast } from "sonner";

export const Route = createFileRoute("/market/leilao")({
  head: () => ({ meta: [{ title: "Leilão — Empire Hub" }] }),
  component: LeilaoPage,
});

function formatMoeda(valor: number): string {
  return valor.toLocaleString("pt-BR");
}

function ArtistaSelect({
  artistas,
  value,
  onChange,
}: {
  artistas: { nome: string; saldoEcoin: number }[];
  value: string;
  onChange: (nome: string) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const selecionado = artistas.find((a) => a.nome === value);

  if (artistas.length <= 1) return null;

  return (
    <div className="relative mb-3">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        className="w-full flex items-center gap-2.5 px-3 py-2.5 bg-white/5 border border-white/10 rounded-2xl text-sm outline-none focus:border-primary/50 transition"
      >
        <span className="flex-1 min-w-0 text-left truncate">
          {selecionado ? `${selecionado.nome} — R$ ${formatMoeda(selecionado.saldoEcoin)}` : "Selecione o artista"}
        </span>
        <ChevronDown className={`size-4 text-muted-foreground shrink-0 transition-transform ${aberto ? "rotate-180" : ""}`} />
      </button>
      {aberto && (
        <div className="absolute z-10 top-full left-0 right-0 mt-1.5 max-h-56 overflow-y-auto rounded-2xl border border-white/10 bg-[#11141c] shadow-xl shadow-black/40 py-1.5">
          {artistas.map((a) => (
            <button
              key={a.nome}
              type="button"
              onClick={() => {
                onChange(a.nome);
                setAberto(false);
              }}
              className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-white/5 transition ${
                a.nome === value ? "bg-primary/10" : ""
              }`}
            >
              <span className="truncate">{a.nome}</span>
              <span className="shrink-0 text-xs text-muted-foreground">R$ {formatMoeda(a.saldoEcoin)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function LeilaoPage() {
  const { user } = useTelegramUser();
  const tgId = user?.id || "";

  const [dados, setDados] = useState<Awaited<ReturnType<typeof api.getLeilaoAtual>> | null | "loading">("loading");
  const [artistaSelecionado, setArtistaSelecionado] = useState("");
  const [valorInput, setValorInput] = useState("");
  const [enviando, setEnviando] = useState(false);

  const carregar = () => {
    if (!tgId || tgId === "guest") return;
    api.getLeilaoAtual(tgId).then((d) => {
      setDados(d);
      if (d && d.artistas.length > 0) {
        setArtistaSelecionado((atual) => atual || d.artistas[0].nome);
      }
    });
  };

  useEffect(carregar, [tgId]);

  const saldoArtista = useMemo(() => {
    if (!dados || dados === "loading") return 0;
    return dados.artistas.find((a) => a.nome === artistaSelecionado)?.saldoEcoin ?? 0;
  }, [dados, artistaSelecionado]);

  const meuLanceAtual = useMemo(() => {
    if (!dados || dados === "loading") return 0;
    const meus = dados.lances.filter((l) => l.artista === artistaSelecionado);
    return meus.length ? Math.max(...meus.map((l) => l.valor)) : 0;
  }, [dados, artistaSelecionado]);

  const liderAtual = useMemo(() => {
    if (!dados || dados === "loading" || dados.lances.length === 0) return null;
    return dados.lances[0];
  }, [dados]);

  if (dados === "loading") {
    return (
      <div className="pb-24 px-4 pt-6 max-w-md mx-auto min-h-screen">
        <div className="h-48 rounded-3xl bg-white/5 animate-pulse mb-4" />
        <div className="h-16 rounded-2xl bg-white/5 animate-pulse mb-2" />
        <div className="h-16 rounded-2xl bg-white/5 animate-pulse" />
      </div>
    );
  }

  if (!dados) {
    return (
      <div className="pb-24 px-4 pt-6 max-w-md mx-auto min-h-screen">
        <header className="flex items-center gap-3 mb-6">
          <Link to="/market" className="size-9 rounded-full bg-white/5 border border-white/10 grid place-items-center">
            <ChevronLeft className="size-5" />
          </Link>
          <h1 className="text-lg font-black uppercase tracking-tight">Leilão</h1>
        </header>
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-center text-sm text-muted-foreground">
          Nenhum leilão em andamento no momento.
        </div>
      </div>
    );
  }

  const enviarLance = async () => {
    if (enviando || dados.encerrado) return;
    const valor = parseInt(valorInput.replace(/\D/g, "") || "0", 10);
    if (!artistaSelecionado) {
      toast.error("Selecione o artista.");
      return;
    }
    if (!valor) {
      toast.error("Digite um valor de lance.");
      return;
    }
    if (liderAtual && liderAtual.artista !== artistaSelecionado && valor <= liderAtual.valor) {
      toast.error(`Seu lance precisa ser maior que R$ ${formatMoeda(liderAtual.valor)}.`);
      return;
    }
    if (valor > saldoArtista) {
      toast.error("Esse valor passa do seu saldo de ECoin disponível.");
      return;
    }
    setEnviando(true);
    try {
      const res = await api.enviarLanceLeilao({ telegramId: tgId, artista: artistaSelecionado, valor });
      if (res.success) {
        haptic.success();
        toast.success(meuLanceAtual > 0 ? "Lance substituído!" : "Lance enviado!");
        setValorInput("");
        carregar();
      } else {
        toast.error(res.error || "Não foi possível enviar o lance.");
      }
    } finally {
      setEnviando(false);
    }
  };

  const valorDigitado = parseInt(valorInput.replace(/\D/g, "") || "0", 10);
  const botaoDesabilitado =
    enviando || dados.encerrado || !artistaSelecionado || !valorDigitado || valorDigitado > saldoArtista;

  return (
    <div className="pb-32 px-4 pt-6 max-w-md mx-auto min-h-screen">
      <header className="flex items-center gap-3 mb-5">
        <Link to="/market" className="size-9 rounded-full bg-white/5 border border-white/10 grid place-items-center">
          <ChevronLeft className="size-5" />
        </Link>
        <h1 className="text-lg font-black uppercase tracking-tight">Leilão</h1>
      </header>

      <div
        className="relative rounded-3xl overflow-hidden border border-white/10 min-h-[190px] flex flex-col justify-end p-5 mb-4"
        style={{
          background: dados.imagem
            ? `linear-gradient(180deg, rgba(0,0,0,0.15), rgba(0,0,0,0.75)), url(${dados.imagem}) center/cover`
            : "radial-gradient(120% 140% at 15% -10%, rgba(242,181,68,0.25), transparent 60%), linear-gradient(160deg, #1c1710, #0d0c10 70%)",
        }}
      >
        <div
          className={`absolute top-3.5 right-3.5 flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wide ${
            dados.encerrado ? "bg-red-500/20 text-red-300 border border-red-400/30" : "bg-emerald-500/20 text-emerald-300 border border-emerald-400/30"
          }`}
        >
          <span className={`size-1.5 rounded-full ${dados.encerrado ? "bg-red-300" : "bg-emerald-300"}`} />
          {dados.encerrado ? "Encerrado" : "Em andamento"}
        </div>
        <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-amber-300 mb-1.5">
          <Gavel className="size-3.5" /> Performance Especial
        </div>
        <h2 className="text-xl font-black leading-tight mb-3 text-white">{dados.nome}</h2>
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-[10px] font-black uppercase tracking-wide text-white/55">
              {dados.encerrado ? "Lance vencedor" : "Maior lance"}
            </p>
            <p className="text-xl font-black text-amber-300 tabular-nums">
              {liderAtual ? `R$ ${formatMoeda(liderAtual.valor)}` : "—"}
            </p>
            <p className="text-[11px] text-white/60">{liderAtual ? liderAtual.artista : "Nenhum lance ainda"}</p>
          </div>
          <div className="text-right">
            <p className="text-[10px] font-black uppercase tracking-wide text-white/55">Lances</p>
            <p className="text-xl font-black text-white tabular-nums">{dados.lances.length}</p>
          </div>
        </div>
      </div>

      {dados.encerrado && liderAtual && (
        <div className="space-y-2.5 mb-4">
          <div className="flex items-center gap-3 p-4 rounded-2xl border border-amber-400/30 bg-gradient-to-br from-amber-400/10 to-transparent">
            <div className="size-10 rounded-xl bg-amber-400 text-black grid place-items-center shrink-0">
              <Trophy className="size-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-black text-sm truncate">{liderAtual.artista}</p>
              <p className="text-xs text-muted-foreground">Venceu o leilão</p>
            </div>
            <p className="font-black text-amber-300 tabular-nums shrink-0">R$ {formatMoeda(liderAtual.valor)}</p>
          </div>
          <div className="text-xs leading-relaxed text-muted-foreground bg-white/[0.03] border border-dashed border-white/10 rounded-2xl p-3">
            O valor foi descontado só do ECoin do vencedor. Os demais artistas que deram lance não tiveram nada
            debitado.
          </div>
        </div>
      )}

      <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-2 px-1 flex items-center justify-between">
        <span>Histórico de lances</span>
        <span>{dados.lances.length === 1 ? "1 lance" : `${dados.lances.length} lances`}</span>
      </p>
      <div className="rounded-2xl border border-white/10 bg-card p-3 space-y-1.5 mb-4">
        {dados.lances.length === 0 && (
          <p className="text-center text-xs text-muted-foreground py-4">Nenhum lance enviado ainda.</p>
        )}
        {dados.lances.map((l, i) => (
          <div
            key={l.artista}
            className={`flex items-center gap-2.5 rounded-xl px-3 py-2.5 border ${
              i === 0 ? "border-amber-400/40 bg-amber-400/10" : "border-white/10 bg-white/[0.02]"
            }`}
          >
            <div
              className={`size-6 rounded-full grid place-items-center text-[11px] font-black shrink-0 tabular-nums ${
                i === 0 ? "bg-amber-400 text-black" : "bg-white/10 text-muted-foreground"
              }`}
            >
              {i + 1}º
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold truncate">{l.artista}</p>
            </div>
            {l.artista === artistaSelecionado && (
              <span className="text-[9px] font-black uppercase text-amber-300 border border-amber-400/40 rounded-full px-1.5 py-0.5 shrink-0">
                Você
              </span>
            )}
            <p className={`font-black text-sm tabular-nums shrink-0 ${i === 0 ? "text-amber-300" : ""}`}>
              R$ {formatMoeda(l.valor)}
            </p>
          </div>
        ))}
      </div>

      {!dados.encerrado && (
        <div className="fixed left-0 right-0 bottom-0 p-4 bg-gradient-to-t from-background via-background to-transparent">
          <div className="max-w-md mx-auto bg-card border border-white/10 rounded-3xl p-4 shadow-xl shadow-black/40">
            <ArtistaSelect artistas={dados.artistas} value={artistaSelecionado} onChange={setArtistaSelecionado} />
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] text-muted-foreground">
                Saldo disponível: <b className="text-foreground tabular-nums">R$ {formatMoeda(saldoArtista)}</b>
              </span>
              {meuLanceAtual > 0 && (
                <span className="text-[11px] font-bold text-amber-400">Travado: R$ {formatMoeda(meuLanceAtual)}</span>
              )}
            </div>
            <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-2xl px-3 py-2.5 mb-3">
              <span className="font-black text-muted-foreground text-sm">R$</span>
              <input
                type="text"
                inputMode="numeric"
                value={valorInput}
                onChange={(e) => setValorInput(e.target.value.replace(/\D/g, ""))}
                placeholder="0"
                className="flex-1 min-w-0 bg-transparent outline-none text-lg font-black tabular-nums"
              />
            </div>
            <button
              onClick={enviarLance}
              disabled={botaoDesabilitado}
              className="w-full py-3.5 rounded-full bg-amber-400 text-black font-black text-xs uppercase tracking-wider disabled:opacity-40 flex items-center justify-center gap-1.5"
            >
              {enviando ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Coins className="size-4" />
              )}
              {meuLanceAtual > 0 ? "Substituir lance" : "Enviar lance"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
