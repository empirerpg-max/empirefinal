import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  ChevronLeft,
  Heart,
  Loader2,
  Send,
  Sparkles,
  Trophy,
  Wallet,
} from "lucide-react";
import { useTelegramUser, haptic } from "@/lib/telegram";
import { api, fmtEC, type Artist } from "@/lib/api";

export const Route = createFileRoute("/games/queridometro")({
  component: QueridometroPage,
});

const ENTRY_COST = 30;

const EMOJIS = [
  { e: "❤️", label: "Amor" },
  { e: "🔥", label: "Fogo" },
  { e: "⭐", label: "Estrela" },
  { e: "👑", label: "Coroa" },
  { e: "💀", label: "Caveira" },
  { e: "🤡", label: "Palhaço" },
  { e: "🐍", label: "Cobra" },
  { e: "🥱", label: "Tédio" },
];

type Recebido = { de?: string; emoji?: string; valor?: number; data?: string };
type ReacaoPublica = { para?: string; fotoPara?: string; emoji?: string; data?: string };
type RankItem = { nome: string; foto?: string; pontos?: number };

function QueridometroPage() {
  const { user, ready } = useTelegramUser();
  const [meusArtistas, setMeusArtistas] = useState<Artist[] | null>(null);
  const [alvos, setAlvos] = useState<Artist[] | null>(null);
  const [ranking, setRanking] = useState<RankItem[]>([]);
  const [mural, setMural] = useState<ReacaoPublica[]>([]);
  const [semana, setSemana] = useState<string>("");
  const [votosRestantes, setVotosRestantes] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"votar" | "ranking" | "mural">("votar");

  const [origem, setOrigem] = useState<string>("");
  const [destino, setDestino] = useState<string>("");
  const [emoji, setEmoji] = useState<string>("");
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<{
    ok: boolean;
    msg: string;
  } | null>(null);
  const [busca, setBusca] = useState("");

  async function refresh() {
    if (!user) return;
    setLoading(true);
    try {
      const [status, todos] = await Promise.all([
        api.getQueridometroStatus(user.id),
        api.listarTodos(),
      ]);
      setSemana(status.semana || "");
      setVotosRestantes(status.votosRestantes ?? 0);
      // reacoesRecebidas (privado por artista) ignorado em favor do mural público
      setMural(Array.isArray(status.reacoesPublicas) ? status.reacoesPublicas : []);
      setRanking(Array.isArray(status.ranking) ? status.ranking : []);

      // Meus artistas: prefere o que vem do backend, senão busca
      const meus =
        (Array.isArray(status.meusArtistas) && status.meusArtistas.length
          ? status.meusArtistas
          : await api.meusArtistas(user.id)) as Artist[];
      setMeusArtistas(meus);
      if (meus.length === 1) setOrigem(meus[0].nome);

      // Alvos = todos os artistas
      setAlvos(todos);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!ready || !user) return;
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, user?.id]);

  const origemArtist = useMemo(
    () => meusArtistas?.find((a) => a.nome === origem) || null,
    [meusArtistas, origem],
  );

  const alvosFiltrados = useMemo(() => {
    if (!alvos) return [];
    const q = busca.trim().toLowerCase();
    return alvos
      .filter((a) => a.nome !== origem)
      .filter((a) => (q ? a.nome.toLowerCase().includes(q) : true))
      .slice(0, 60);
  }, [alvos, busca, origem]);

  const podeEnviar = !!origem && !!destino && !!emoji && !enviando;
  const semSaldo = !!origemArtist && origemArtist.saldo < ENTRY_COST;

  async function enviar() {
    if (!user || !podeEnviar || semSaldo) return;
    setEnviando(true);
    setResultado(null);
    haptic.medium();
    try {
      const r = await api.postQueridometroVoto(user.id, origem, destino, emoji);
      if (r?.ok) {
        haptic.success();
        setResultado({
          ok: true,
          msg: r.msg || "Emoji enviado! O prestígio foi distribuído em segredo.",
        });
        setDestino("");
        setEmoji("");
        // recarrega votos restantes / saldo
        refresh();
      } else {
        haptic.error();
        setResultado({ ok: false, msg: r?.erro || "Falha ao enviar emoji." });
      }
    } catch (e: any) {
      haptic.error();
      setResultado({ ok: false, msg: e?.message || "Erro de rede." });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <main className="flex-1 mx-auto w-full max-w-2xl px-4 pt-6 pb-32">
      <Link
        to="/games"
        className="inline-flex items-center gap-1 text-muted-foreground mb-6 font-black uppercase text-[11px] hover:text-primary transition-colors"
      >
        <ChevronLeft className="size-4" /> Empire Games
      </Link>

      <header className="mb-6">
        <div className="size-14 rounded-2xl bg-pink-500/15 text-pink-400 grid place-items-center mb-4">
          <Heart className="size-7 fill-current" />
        </div>
        <h1 className="text-3xl font-black italic uppercase tracking-tighter">
          Queridô<span className="text-pink-400">metro</span>
        </h1>
        <p className="text-muted-foreground text-[11px] font-bold mt-1 uppercase tracking-widest">
          Mande emojis · Doe (ou tire) prestígio às cegas
        </p>
      </header>

      {/* Bar de status */}
      <section className="grid grid-cols-3 gap-2 mb-5">
        <div className="rounded-2xl border border-white/5 bg-card p-3">
          <p className="text-[9px] uppercase tracking-widest text-muted-foreground font-black">
            Semana
          </p>
          <p className="text-sm font-black truncate">{semana || "—"}</p>
        </div>
        <div className="rounded-2xl border border-white/5 bg-card p-3">
          <p className="text-[9px] uppercase tracking-widest text-muted-foreground font-black">
            Custo
          </p>
          <p className="text-sm font-black text-pink-400">{fmtEC(ENTRY_COST)}</p>
        </div>
        <div className="rounded-2xl border border-white/5 bg-card p-3">
          <p className="text-[9px] uppercase tracking-widest text-muted-foreground font-black">
            Restantes
          </p>
          <p className="text-sm font-black">{votosRestantes}</p>
        </div>
      </section>

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-card rounded-full border border-white/5 mb-5">
        {(["votar", "ranking", "mural"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-2 rounded-full text-[10px] uppercase font-black tracking-widest transition-all ${
              tab === t
                ? "bg-pink-500 text-white"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {loading && !meusArtistas ? (
        <div className="flex items-center gap-2 text-muted-foreground text-xs py-8 justify-center">
          <Loader2 className="size-4 animate-spin" /> Carregando…
        </div>
      ) : tab === "votar" ? (
        <VotarTab
          meus={meusArtistas || []}
          origem={origem}
          setOrigem={setOrigem}
          origemArtist={origemArtist}
          alvos={alvosFiltrados}
          destino={destino}
          setDestino={setDestino}
          busca={busca}
          setBusca={setBusca}
          emoji={emoji}
          setEmoji={setEmoji}
          enviar={enviar}
          enviando={enviando}
          podeEnviar={podeEnviar}
          semSaldo={semSaldo}
          resultado={resultado}
        />
      ) : tab === "ranking" ? (
        <RankingTab items={ranking} />
      ) : (
        <MuralTab items={mural} />
      )}
    </main>
  );
}

function VotarTab(props: {
  meus: Artist[];
  origem: string;
  setOrigem: (n: string) => void;
  origemArtist: Artist | null;
  alvos: Artist[];
  destino: string;
  setDestino: (n: string) => void;
  busca: string;
  setBusca: (s: string) => void;
  emoji: string;
  setEmoji: (e: string) => void;
  enviar: () => void;
  enviando: boolean;
  podeEnviar: boolean;
  semSaldo: boolean;
  resultado: { ok: boolean; msg: string } | null;
}) {
  const {
    meus,
    origem,
    setOrigem,
    origemArtist,
    alvos,
    destino,
    setDestino,
    busca,
    setBusca,
    emoji,
    setEmoji,
    enviar,
    enviando,
    podeEnviar,
    semSaldo,
    resultado,
  } = props;

  return (
    <div className="space-y-4">
      {/* 1. Quem manda */}
      <section className="rounded-3xl border border-white/5 bg-card p-5">
        <p className="text-[10px] uppercase font-black tracking-widest text-muted-foreground mb-3">
          1 · Quem vai mandar
        </p>
        {meus.length === 0 ? (
          <p className="text-xs text-muted-foreground py-2">
            Vincule um artista para participar.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-2">
            {meus.map((a) => {
              const active = origem === a.nome;
              return (
                <button
                  key={a.nome}
                  onClick={() => setOrigem(a.nome)}
                  className={`flex items-center gap-3 p-3 rounded-2xl border transition-all text-left ${
                    active
                      ? "border-pink-400 bg-pink-500/10"
                      : "border-white/10 bg-background hover:bg-white/[0.04]"
                  }`}
                >
                  <div
                    className="size-10 rounded-xl bg-secondary overflow-hidden bg-cover bg-center shrink-0"
                    style={{ backgroundImage: a.foto ? `url(${a.foto})` : undefined }}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-black truncate">{a.nome}</p>
                    <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold flex items-center gap-1">
                      <Wallet className="size-3" /> {fmtEC(a.saldo)}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {/* 2. Alvo */}
      <section className="rounded-3xl border border-white/5 bg-card p-5">
        <p className="text-[10px] uppercase font-black tracking-widest text-muted-foreground mb-3">
          2 · Para qual artista
        </p>
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar artista…"
          className="w-full px-4 py-2.5 rounded-2xl bg-background border border-white/10 text-sm focus:outline-none focus:border-pink-400/50 mb-3"
        />
        <div className="grid grid-cols-2 gap-2 max-h-72 overflow-y-auto pr-1">
          {alvos.map((a) => {
            const active = destino === a.nome;
            return (
              <button
                key={a.nome}
                onClick={() => setDestino(a.nome)}
                className={`flex items-center gap-2 p-2 rounded-2xl border transition-all text-left ${
                  active
                    ? "border-pink-400 bg-pink-500/10"
                    : "border-white/10 bg-background hover:bg-white/[0.04]"
                }`}
              >
                <div
                  className="size-9 rounded-xl bg-secondary overflow-hidden bg-cover bg-center shrink-0"
                  style={{ backgroundImage: a.foto ? `url(${a.foto})` : undefined }}
                />
                <p className="text-xs font-black truncate flex-1">{a.nome}</p>
              </button>
            );
          })}
          {alvos.length === 0 && (
            <p className="col-span-2 text-xs text-muted-foreground py-3 text-center">
              Nenhum artista encontrado.
            </p>
          )}
        </div>
      </section>

      {/* 3. Emoji */}
      <section className="rounded-3xl border border-white/5 bg-card p-5">
        <p className="text-[10px] uppercase font-black tracking-widest text-muted-foreground mb-3">
          3 · Qual emoji enviar
        </p>
        <div className="grid grid-cols-4 gap-2">
          {EMOJIS.map((it) => {
            const active = emoji === it.e;
            return (
              <button
                key={it.e}
                onClick={() => setEmoji(it.e)}
                className={`flex flex-col items-center gap-1 py-3 rounded-2xl border transition-all ${
                  active
                    ? "border-pink-400 bg-pink-500/10 scale-105"
                    : "border-white/10 bg-background hover:bg-white/[0.04]"
                }`}
              >
                <span className="text-2xl">{it.e}</span>
                <span className="text-[9px] uppercase tracking-widest font-bold text-muted-foreground">
                  {it.label}
                </span>
              </button>
            );
          })}
        </div>
        <p className="text-[10px] text-muted-foreground mt-3 italic flex items-center gap-1">
          <Sparkles className="size-3" /> O prestígio entregue é aleatório (de
          -20 a +20). Você não saberá o impacto real.
        </p>
      </section>

      {/* CTA */}
      {semSaldo && origemArtist && (
        <p className="text-xs text-red-400 text-center font-bold">
          {origemArtist.nome} não tem {fmtEC(ENTRY_COST)} em saldo.
        </p>
      )}

      {resultado && (
        <div
          className={`rounded-2xl p-4 text-sm font-bold ${
            resultado.ok
              ? "bg-pink-500/10 border border-pink-400/30 text-pink-100"
              : "bg-red-500/10 border border-red-400/30 text-red-200"
          }`}
        >
          {resultado.msg}
        </div>
      )}

      <button
        disabled={!podeEnviar || semSaldo}
        onClick={enviar}
        className="w-full py-5 rounded-[2rem] bg-gradient-to-r from-pink-500 to-fuchsia-500 text-white font-black uppercase text-xs tracking-widest shadow-xl shadow-pink-500/30 disabled:opacity-30 flex items-center justify-center gap-3 transition-all active:scale-95"
      >
        {enviando ? (
          <>
            <Loader2 className="size-5 animate-spin" /> Enviando…
          </>
        ) : (
          <>
            <Send className="size-5" /> Enviar {emoji || "emoji"} ({fmtEC(ENTRY_COST)})
          </>
        )}
      </button>
    </div>
  );
}

function RankingTab({ items }: { items: RankItem[] }) {
  if (!items.length) {
    return (
      <p className="text-xs text-muted-foreground py-10 text-center">
        Nenhuma reação registrada nesta semana ainda.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      {items.map((r, i) => (
        <div
          key={r.nome + i}
          className="flex items-center gap-3 p-3 rounded-2xl border border-white/5 bg-card"
        >
          <div className="size-8 rounded-full bg-pink-500/15 text-pink-400 grid place-items-center font-black text-xs">
            {i + 1}
          </div>
          <div
            className="size-10 rounded-xl bg-secondary overflow-hidden bg-cover bg-center shrink-0"
            style={{ backgroundImage: r.foto ? `url(${r.foto})` : undefined }}
          />
          <p className="flex-1 text-sm font-black truncate">{r.nome}</p>
          <div className="flex items-center gap-1">
            <Trophy className="size-3 text-yellow-400" />
            <span className="text-sm font-black tabular-nums">
              {r.pontos ?? 0}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

function MuralTab({ items }: { items: ReacaoPublica[] }) {
  if (!items.length) {
    return (
      <p className="text-xs text-muted-foreground py-10 text-center">
        Ainda ninguém mandou emoji essa semana.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold text-center mb-2">
        Mural anônimo · remetentes ocultos
      </p>
      {items.map((r, i) => (
        <div
          key={i}
          className="flex items-center gap-3 p-3 rounded-2xl border border-white/5 bg-card"
        >
          <div
            className="size-10 rounded-xl bg-secondary overflow-hidden bg-cover bg-center shrink-0"
            style={{ backgroundImage: r.fotoPara ? `url(${r.fotoPara})` : undefined }}
          />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-black truncate">
              para <span className="text-pink-400">{r.para || "—"}</span>
            </p>
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">
              {r.data || ""}
            </p>
          </div>
          <span className="text-2xl">{r.emoji || "❓"}</span>
        </div>
      ))}
    </div>
  );
}
