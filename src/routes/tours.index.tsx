import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
  Mic2,
  Globe,
  Users,
  ChevronRight,
  Loader2,
  Crown,
  Plus,
  Camera,
  MessageCircle,
  Mic,
  PartyPopper,
  Radio,
  Users2,
  Ticket,
  Clapperboard,
  Flame,
} from "lucide-react";
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

interface Missao {
  idUnico: string;
  artista: string;
  nomeTurne: string;
  showNumero: number;
  local: string;
  cidade: string;
  data: string;
  diasRestantes: number;
  hoje: boolean;
}

type TipoAcao =
  | "foto"
  | "interacao"
  | "entrevista"
  | "especial"
  | "live"
  | "colab"
  | "sorteio"
  | "bastidores";

interface FeedItem {
  idUnico: string;
  artista: string;
  nomeTurne: string;
  showNumero: number;
  local: string;
  cidade: string;
  data: string;
  soldOut: boolean;
  tipo: TipoAcao;
  texto: string;
  fotoUrl?: string | null;
  vendidosPct: number;
  timestamp: string;
}

const TIPO_INFO: Record<TipoAcao, { label: string; icon: React.ReactNode }> = {
  foto: { label: "Foto + resumo", icon: <Camera className="size-3.5" /> },
  especial: { label: "Evento especial", icon: <PartyPopper className="size-3.5" /> },
  entrevista: { label: "Entrevista rápida", icon: <Mic className="size-3.5" /> },
  interacao: { label: "Interação com fã", icon: <MessageCircle className="size-3.5" /> },
  live: { label: "Live nas redes", icon: <Radio className="size-3.5" /> },
  colab: { label: "Colab surpresa", icon: <Users2 className="size-3.5" /> },
  sorteio: { label: "Sorteio VIP", icon: <Ticket className="size-3.5" /> },
  bastidores: { label: "Bastidores", icon: <Clapperboard className="size-3.5" /> },
};

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
  const [missoes, setMissoes] = useState<Missao[] | null>(null);
  const [aba, setAba] = useState<"central" | "finalizados">("central");
  const [feed, setFeed] = useState<FeedItem[] | null>(null);

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
    fetch(`/api/turnes/missoes?telegramId=${encodeURIComponent(telegramId)}`)
      .then((r) => r.json())
      .then((res) => {
        if (res?.success) setMissoes(res.data || []);
      });
  }, [telegramId]);

  useEffect(() => {
    fetch("/api/turnes")
      .then((r) => r.json())
      .then((res) => {
        if (res?.success) setPublicas(res.data || []);
      })
      .finally(() => setLoading(false));
    fetch("/api/turnes/feed?limit=15")
      .then((r) => r.json())
      .then((res) => {
        if (res?.success) setFeed(res.data || []);
      });
  }, []);

  const minhasIds = new Set((minhasTurnes || []).map((t) => t.idUnico));
  // Turnês em andamento de TODOS os outros jogadores — antes só existia
  // "Minhas Turnês" na Central e a lista pública inteira (misturada com
  // material antigo/finalizado) ficava escondida na aba "Finalizados", sem
  // nenhum jeito de ver o que os outros jogadores estão fazendo agora.
  const outrasEmAndamento = (publicas || []).filter(
    (t) => !minhasIds.has(t.idUnico) && t.status === "Em andamento",
  );
  // A aba "Finalizados" não filtrava por status nenhum — só "não é minha"
  // — então turnês de outros jogadores ainda EM ANDAMENTO apareciam ali
  // misturadas como se já tivessem acabado. Agora só entra quem realmente
  // não está mais em andamento.
  const finalizados = (publicas || []).filter(
    (t) => !minhasIds.has(t.idUnico) && t.status !== "Em andamento",
  );

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
            Gerencie sua turnê e acompanhe o Império
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

      <div className="flex gap-1 p-1 bg-card rounded-2xl border border-white/5 mb-6">
        <button
          onClick={() => setAba("central")}
          className={`flex-1 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-wide transition ${
            aba === "central" ? "bg-primary text-primary-foreground" : "text-muted-foreground"
          }`}
        >
          Central
        </button>
        <button
          onClick={() => setAba("finalizados")}
          className={`flex-1 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-wide transition ${
            aba === "finalizados" ? "bg-primary text-primary-foreground" : "text-muted-foreground"
          }`}
        >
          Finalizados
        </button>
      </div>

      {aba === "central" ? (
        <>
          {telegramId && missoes && missoes.length > 0 && <MissoesCarousel missoes={missoes} />}

          <FeedGlobal feed={feed} />

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

          <section className="mb-8">
            <h2 className="text-[11px] font-black uppercase text-neutral-400 mb-3 pl-1">
              Turnês em Andamento — Império
            </h2>
            {publicas === null ? (
              <div className="flex justify-center py-8 opacity-50">
                <Loader2 className="size-6 animate-spin" />
              </div>
            ) : outrasEmAndamento.length === 0 ? (
              <div className="rounded-2xl bg-white/[0.03] border border-dashed border-white/10 p-6 text-center">
                <p className="text-sm text-muted-foreground">
                  Nenhum outro jogador com turnê em andamento no momento.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {outrasEmAndamento.map((t) => (
                  <TourCardItem key={t.idUnico} t={t} />
                ))}
              </div>
            )}
          </section>
        </>
      ) : (
        <section>
          <p className="text-xs text-muted-foreground mb-4 px-1">
            Turnês do método antigo e outras já concluídas — histórico, só leitura.
          </p>
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3 opacity-50">
              <Loader2 className="size-8 animate-spin" />
              <p className="text-xs font-bold uppercase tracking-widest">Carregando turnês...</p>
            </div>
          ) : finalizados.length === 0 ? (
            <div className="rounded-3xl bg-white/[0.03] border border-dashed border-white/10 p-12 text-center">
              <div className="size-16 rounded-full bg-muted/20 text-muted-foreground grid place-items-center mx-auto mb-4">
                <Mic2 className="size-8" />
              </div>
              <h2 className="text-lg font-bold mb-1">Nada por aqui ainda</h2>
              <p className="text-sm text-muted-foreground max-w-[240px] mx-auto text-balance">
                Nenhuma turnê finalizada no momento.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {finalizados.map((t) => (
                <TourCardItem key={t.idUnico} t={t} />
              ))}
            </div>
          )}
        </section>
      )}

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

function MissoesCarousel({ missoes }: { missoes: Missao[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  return (
    <section className="mb-8">
      <div className="flex items-center justify-between mb-3 px-1">
        <h2 className="text-[11px] font-black uppercase text-neutral-400">Suas próximas missões</h2>
        <span className="text-[10px] font-bold text-muted-foreground/60">
          {missoes.length} {missoes.length === 1 ? "show" : "shows"}
        </span>
      </div>
      <div className="relative">
        <div
          ref={scrollRef}
          className="flex gap-2.5 overflow-x-auto pb-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
        >
          {missoes.map((m) => (
            <Link
              key={`${m.idUnico}-${m.showNumero}`}
              to="/tours/$nome"
              params={{ nome: m.artista }}
              className={`group shrink-0 w-[188px] rounded-3xl border overflow-hidden shadow-xl shadow-black/10 transition hover:scale-[1.02] active:scale-[0.97] ${
                m.hoje ? "bg-amber-500/10 border-amber-500/40" : "bg-card border-white/5 hover:border-white/15"
              }`}
            >
              {/* "Lado da imagem" simplificado — sem capa aqui, então usa uma
                  faixa de gradiente colorida como cabeçalho pra carregar o
                  mesmo peso visual do card de turnê. */}
              <div
                className={`h-2 w-full ${
                  m.hoje ? "bg-gradient-to-r from-amber-400 to-amber-600" : "bg-gradient-to-r from-primary to-fuchsia-600"
                }`}
              />
              <div className="p-3.5">
                <span
                  className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[9.5px] font-black uppercase tracking-wide mb-2.5 ${
                    m.hoje ? "bg-amber-500 text-black" : "bg-white/5 text-muted-foreground border border-white/10"
                  }`}
                >
                  {m.hoje ? "● Hoje" : `Em ${m.diasRestantes} dia${m.diasRestantes === 1 ? "" : "s"}`}
                </span>
                <p className="text-[10px] font-black uppercase text-primary/80 tracking-wide mb-0.5">
                  {m.artista}
                </p>
                <p className="font-black text-sm leading-tight mb-0.5 truncate">{m.local}</p>
                <p className="text-[10px] text-muted-foreground font-medium mb-2.5">
                  {m.cidade} · {m.data}
                </p>
                <div className="rounded-xl bg-white/5 border border-white/5 px-2.5 py-2">
                  <p className="flex items-center gap-1.5 text-[9.5px] font-black uppercase text-emerald-400">
                    <Flame className="size-3" />
                    Qualquer ação = sold out
                  </p>
                  <p className="text-[9px] text-muted-foreground font-medium mt-1">
                    Escolha entre 8 tipos — foto, entrevista, live e mais.
                  </p>
                </div>
              </div>
            </Link>
          ))}
        </div>
        {/* Sinaliza que há mais missões pra rolar — mesmo padrão de fade + seta
            já usado na tela do Artista. */}
        <div className="pointer-events-none absolute right-0 top-0 bottom-1 w-10 bg-gradient-to-l from-background to-transparent" />
        <ChevronRight className="pointer-events-none absolute right-0.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground/60" />
      </div>
    </section>
  );
}


function FeedGlobal({ feed }: { feed: FeedItem[] | null }) {
  if (feed && feed.length === 0) return null;

  return (
    <section className="mb-8">
      <h2 className="text-[11px] font-black uppercase text-neutral-400 mb-3 pl-1">Central de Notícias</h2>
      {!feed ? (
        <div className="flex justify-center py-8 opacity-50">
          <Loader2 className="size-6 animate-spin" />
        </div>
      ) : (
        <div className="space-y-3">
          {feed.map((item) => (
            <Link
              key={`${item.idUnico}-${item.showNumero}`}
              to="/tours/$nome"
              params={{ nome: item.artista }}
              className="block group"
            >
              <div className="rounded-3xl bg-card border border-white/5 overflow-hidden shadow-xl shadow-black/10 transition hover:scale-[1.01] active:scale-[0.98] hover:border-white/15">
                {item.fotoUrl ? (
                  <div className="relative">
                    <img
                      src={driveImg(item.fotoUrl, 800)}
                      alt=""
                      className="w-full aspect-[16/8.5] object-cover"
                      loading="lazy"
                    />
                    <div className="absolute inset-0 bg-gradient-to-br from-primary/15 via-transparent to-fuchsia-600/15" />
                    {item.soldOut && (
                      <span className="absolute top-3 right-3 px-2 py-1 rounded-full bg-amber-500 text-black text-[9.5px] font-black uppercase">
                        Sold Out
                      </span>
                    )}
                    <div className="absolute inset-x-0 bottom-0 p-3 bg-gradient-to-t from-black/90 via-black/40 to-transparent">
                      <p className="text-[10px] font-black uppercase text-primary tracking-wide">
                        {item.artista}
                      </p>
                      <p className="text-xs font-bold text-white/90">
                        {item.local} · {item.cidade}
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="h-2 w-full bg-gradient-to-r from-primary to-fuchsia-600" />
                )}
                <div className="p-4">
                  {!item.fotoUrl && (
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-[10px] font-black uppercase text-primary tracking-wide">
                        {item.artista} · {item.local}
                      </p>
                      {item.soldOut && (
                        <span className="px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-500 text-[9.5px] font-black uppercase shrink-0">
                          Sold Out
                        </span>
                      )}
                    </div>
                  )}
                  <p className="text-sm text-white/90 leading-relaxed line-clamp-3 mb-2.5">{item.texto}</p>
                  <div className="flex items-center justify-between text-[10.5px] font-bold text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                      {TIPO_INFO[item.tipo]?.icon}
                      {TIPO_INFO[item.tipo]?.label}
                    </span>
                    <span className="flex items-center gap-1 text-primary group-hover:text-primary/80">
                      Comentar <ChevronRight className="size-3" />
                    </span>
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

// Cartão de turnê — inspirado num widget de clima (lado da imagem cheio de
// contexto sob um gradiente, lado da info com estatísticas em "pílulas" e
// um botão de ação no rodapé), adaptado ao padrão do app: empilhado
// (imagem em cima, info embaixo) em vez de lado a lado, já que aqui é uma
// lista de uma coluna só.
function TourCardItem({ t }: { t: TourCard }) {
  const total = t.totalShows || t.agenda.length || 1;
  const feitos = realizados(t);
  const soldOuts = t.agenda.filter((s) => s.soldOut).length;
  const progresso = Math.min(100, Math.round((feitos / total) * 100));

  return (
    <Link to="/tours/$nome" params={{ nome: t.artista }} className="block group">
      <div className="relative overflow-hidden rounded-3xl bg-card border border-white/5 transition-all hover:scale-[1.01] active:scale-[0.98] shadow-2xl shadow-black/20">
        {/* Lado da imagem — capa + gradiente, nome da turnê e artista sobrepostos */}
        <div className="relative h-36 overflow-hidden">
          {t.capaUrl ? (
            <img
              src={driveImg(t.capaUrl, 600)}
              alt={t.artista}
              className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
              loading="lazy"
              decoding="async"
            />
          ) : (
            <div className="absolute inset-0 bg-slate-900 grid place-items-center">
              <Crown className="size-12 text-primary/30" />
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-black/10" />
          <div className="absolute inset-0 bg-gradient-to-br from-primary/25 via-transparent to-fuchsia-600/20" />

          <div className="absolute top-3 left-4 right-4 flex items-center gap-2">
            <span className="text-[11px] font-black uppercase tracking-widest text-white/90 drop-shadow">
              {t.artista}
            </span>
            {t.status === "Em andamento" && (
              <span className="flex items-center gap-1 text-[10px] font-black uppercase text-emerald-300">
                <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse" /> Ao vivo
              </span>
            )}
          </div>

          <div className="absolute bottom-3 left-4 right-4">
            <h3 className="text-2xl font-black italic uppercase tracking-tighter leading-tight truncate text-white drop-shadow">
              {t.nomeTurne}
            </h3>
            <div className="mt-1 flex items-center gap-1 text-[11px] text-white/70 font-bold uppercase">
              <Users className="size-3" /> {t.porte || "Turnê"}
            </div>
          </div>
        </div>

        {/* Lado da info — estatísticas em pílulas + botão de ação */}
        <div className="p-4">
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-xl bg-white/5 border border-white/5 px-2 py-2 text-center">
              <p className="text-muted-foreground text-[9px] uppercase font-black tracking-widest mb-1">Execução</p>
              <p className="text-sm font-black tracking-tight">
                {feitos}<span className="text-muted-foreground/40 font-bold">/{total}</span>
              </p>
            </div>
            <div className="rounded-xl bg-white/5 border border-white/5 px-2 py-2 text-center">
              <p className="text-muted-foreground text-[9px] uppercase font-black tracking-widest mb-1">Arrecadado</p>
              <p className="text-sm font-black text-amber-500 tracking-tight truncate">{fmtMoney(t.arrecadacaoTempoReal)}</p>
            </div>
            <div className="rounded-xl bg-white/5 border border-white/5 px-2 py-2 text-center">
              <p className="text-muted-foreground text-[9px] uppercase font-black tracking-widest mb-1">Sold outs</p>
              <p className="text-sm font-black text-emerald-400 tracking-tight">{soldOuts}</p>
            </div>
          </div>

          <div className="mt-3 h-1.5 bg-white/10 rounded-full overflow-hidden p-[1px]">
            <div
              className="h-full bg-gradient-to-r from-primary/80 to-primary rounded-full transition-all duration-700"
              style={{ width: `${progresso}%` }}
            />
          </div>

          <div className="mt-3 flex items-center justify-center gap-1.5 h-9 rounded-full bg-gradient-to-r from-primary to-fuchsia-600 text-primary-foreground text-xs font-black uppercase tracking-wide shadow-md shadow-primary/25 group-active:scale-95 transition-transform">
            Ver turnê <ChevronRight className="size-3.5" />
          </div>
        </div>
      </div>
    </Link>
  );
}
