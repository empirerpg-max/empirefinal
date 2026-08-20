import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  ChevronLeft,
  Users,
  Calendar as CalendarIcon,
  Star,
  Mic2,
  Loader2,
  Crown,
  Camera,
  MessageCircle,
  Mic,
  PartyPopper,
  Send,
  X,
  ImagePlus,
  Radio,
  Users2,
  Ticket,
  Clapperboard,
} from "lucide-react";
import { fmtMoney, driveImg } from "@/lib/api";
import { useTelegramUser, haptic } from "@/lib/telegram";
import { Calendar } from "@/components/ui/calendar";

export const Route = createFileRoute("/tours/$nome")({
  component: TourDetails,
  validateSearch: (search: Record<string, unknown>): { id?: string } => ({
    id: typeof search.id === "string" ? search.id : undefined,
  }),
});

interface TourAcaoDia {
  tipo:
    | "foto"
    | "interacao"
    | "entrevista"
    | "especial"
    | "live"
    | "colab"
    | "sorteio"
    | "bastidores";
  texto: string;
  fotoUrl?: string | null;
  data: string;
  vendidosPct: number;
  automatica?: boolean;
}

interface TourShow {
  numero: number;
  data: string;
  local: string;
  cidade: string;
  categoria: string;
  capacidade: number;
  vendidos: number;
  precoIngresso: number;
  repasseIngresso: number;
  lucroMaximo: number;
  receita: number;
  status: string;
  soldOut: boolean;
  acoes: TourAcaoDia[];
}

interface Tour {
  idUsuario: string;
  artista: string;
  idUnico: string;
  nomeTurne: string;
  porte: string;
  totalShows: number;
  dataInicio: string;
  dataTermino: string;
  agenda: TourShow[];
  arrecadacaoTempoReal: number;
  status: string;
  capaUrl: string;
  metaLucro: number;
  sistemaNovo: boolean;
}

function parseDataBR(value: string): Date | null {
  const m = (value || "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const [, d, mo, y] = m;
  return new Date(Number(y), Number(mo) - 1, Number(d));
}

function formatDataBR(date: Date): string {
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = date.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function TourDetails() {
  const { nome } = Route.useParams();
  const { id: idUnicoDaBusca } = Route.useSearch();
  const { user } = useTelegramUser();
  const telegramId = user?.id || "";
  const usuario = user?.name || "";

  const [tours, setTours] = useState<Tour[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [acaoAberta, setAcaoAberta] = useState<TourShow | null>(null);

  function reload() {
    fetch(`/api/turnes?artista=${encodeURIComponent(nome)}`)
      .then((r) => r.json())
      .then((res) => {
        if (res?.success) setTours(res.data || []);
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    setLoading(true);
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nome]);

  const tour = useMemo(() => {
    if (!tours || tours.length === 0) return null;
    // Um artista pode ter mais de uma turnê (ex: "Home" antiga + a atual) —
    // sem o id específico, a página sempre caía na última do array,
    // ignorando qual card foi realmente clicado na listagem. Quando o
    // link já vem com o idUnico (ver tours/index.tsx), usa ele; senão
    // mantém o fallback antigo (deep link só com o nome do artista).
    if (idUnicoDaBusca) {
      const exata = tours.find((t) => t.idUnico === idUnicoDaBusca);
      if (exata) return exata;
    }
    const novos = tours.filter((t) => t.sistemaNovo);
    return novos[novos.length - 1] || tours[tours.length - 1];
  }, [tours, idUnicoDaBusca]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-[80vh]">
        <Loader2 className="size-10 animate-spin text-primary" />
        <p className="mt-4 text-[10px] font-black uppercase tracking-widest text-muted-foreground">
          Sincronizando Rota...
        </p>
      </div>
    );
  }

  if (!tour) {
    return (
      <div className="flex flex-col items-center justify-center h-[80vh] p-8 text-center">
        <Mic2 className="size-16 text-muted-foreground/20 mb-4" />
        <h2 className="text-xl font-black uppercase italic tracking-tighter">Turnê não encontrada</h2>
        <p className="text-sm text-muted-foreground mt-2 mb-8 max-w-[240px]">
          Este artista não está em turnê no momento.
        </p>
        <Link
          to="/tours"
          className="px-8 py-4 rounded-3xl bg-primary text-primary-foreground font-black uppercase text-xs tracking-widest"
        >
          Ver todas as turnês
        </Link>
      </div>
    );
  }

  const isDono = telegramId && normalizeId(tour.idUsuario) === normalizeId(telegramId);
  const total = tour.totalShows || tour.agenda.length || 1;
  const soldOuts = tour.agenda.filter((s) => s.soldOut).length;
  const publicoTotal = tour.agenda.reduce((acc, s) => acc + s.vendidos, 0);
  const progress = total > 0 ? (tour.agenda.filter((s) => s.vendidos > 0).length / total) * 100 : 0;

  const showDates = tour.agenda.map((s) => parseDataBR(s.data)).filter((d): d is Date => !!d);
  const hoje = formatDataBR(new Date());
  const showDeHoje = tour.agenda.find((s) => s.data === hoje);

  // Feed: shows com ação de verdade do jogador (não os resolvidos sozinhos
  // pelo sistema por falta de ação), mais recentes primeiro.
  const feed = [...tour.agenda]
    .filter((s) => s.acoes.length > 0 && !s.acoes[0].automatica)
    .sort((a, b) => (parseDataBR(b.data)?.getTime() || 0) - (parseDataBR(a.data)?.getTime() || 0));

  return (
    <main className="flex-1 pb-24 bg-background">
      <div className="relative h-[38vh] min-h-[300px] overflow-hidden">
        {tour.capaUrl ? (
          <img
            src={driveImg(tour.capaUrl, 800)}
            className="w-full h-full object-cover scale-105 blur-[2px] opacity-40 bg-black"
            alt=""
            loading="lazy"
            decoding="async"
          />
        ) : (
          <div className="w-full h-full bg-black flex items-center justify-center opacity-30">
            <Crown className="size-40 text-primary" />
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/60 to-transparent" />

        <Link
          to="/tours"
          className="absolute top-6 left-6 z-30 size-12 rounded-2xl bg-black/40 backdrop-blur-xl border border-white/10 flex items-center justify-center shadow-2xl active:scale-90 transition-transform"
        >
          <ChevronLeft className="size-6" />
        </Link>

        <div className="absolute inset-x-6 bottom-8 z-20">
          <div className="flex flex-col items-center text-center">
            <div className="size-20 rounded-[2.5rem] overflow-hidden border-2 border-primary/30 shadow-2xl mb-4 rotate-[-3deg] bg-black">
              {tour.capaUrl ? (
                <img src={driveImg(tour.capaUrl, 400)} className="w-full h-full object-cover" alt={tour.artista} />
              ) : (
                <Crown className="size-10 m-auto text-primary" />
              )}
            </div>
            <div className="flex items-center gap-2 mb-2">
              <span className="px-3 py-1 rounded-full bg-primary/20 text-primary text-[11px] font-black uppercase tracking-widest border border-primary/20">
                {tour.porte}
              </span>
              <span className="text-[10px] font-black text-white/40 uppercase tracking-widest italic">
                {tour.artista}
              </span>
            </div>
            <h1 className="text-3xl font-black italic uppercase tracking-tighter leading-none mb-2 drop-shadow-[0_4px_12px_rgba(0,0,0,0.5)]">
              {tour.nomeTurne}
            </h1>
            <div className="mt-2 px-6 py-3 rounded-3xl bg-emerald-500/10 border border-emerald-500/20 backdrop-blur-xl flex flex-col items-center">
              <span className="text-[11px] font-black uppercase tracking-[0.2em] text-emerald-500/60 mb-1">
                Arrecadação em tempo real
              </span>
              <span className="text-2xl font-black italic tracking-tighter text-emerald-400">
                {fmtMoney(tour.arrecadacaoTempoReal)}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="px-6 -mt-6 relative z-30 space-y-6">
        <div className="grid grid-cols-3 gap-3">
          <StatMini icon={<Users className="size-4" />} value={publicoTotal.toLocaleString("pt-BR")} label="Fãs" />
          <StatMini icon={<Star className="size-4" />} value={soldOuts} label="Sold Outs" />
          <StatMini icon={<CalendarIcon className="size-4" />} value={`${total}`} label="Shows" />
        </div>

        {!tour.sistemaNovo && (
          <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs font-medium">
            Esta é uma turnê do sistema antigo — fica só como histórico, sem novas ações.
          </div>
        )}

        {tour.sistemaNovo && (
          <>
            <section className="p-5 rounded-[2rem] bg-card border border-white/5">
              <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground mb-3">
                Calendário da turnê
              </h3>
              <Calendar
                mode="multiple"
                selected={showDates}
                showOutsideDays
                modifiers={{ show: showDates, today: [new Date()] }}
                modifiersClassNames={{ show: "!bg-primary/20 !text-primary font-black rounded-md" }}
                className="mx-auto"
              />
            </section>

            {isDono && showDeHoje && showDeHoje.acoes.length === 0 && (
              <button
                onClick={() => setAcaoAberta(showDeHoje)}
                className="w-full py-4 rounded-3xl bg-primary text-primary-foreground font-black text-sm uppercase tracking-wider flex items-center justify-center gap-2 active:scale-[0.98] transition"
              >
                <PartyPopper className="size-5" />
                Fazer a ação de hoje ({showDeHoje.cidade})
              </button>
            )}

            <section>
              <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground mb-4 px-1">
                Itinerário
              </h3>
              <div className="space-y-3">
                {tour.agenda.map((s) => (
                  <ShowRow key={s.numero} show={s} />
                ))}
              </div>
            </section>

            <section>
              <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground mb-4 px-1">
                Central de notícias
              </h3>
              {feed.length === 0 ? (
                <div className="py-16 text-center bg-card rounded-[2rem] border border-dashed border-white/5">
                  <Camera className="size-10 text-muted-foreground/10 mx-auto mb-3" />
                  <p className="text-xs text-muted-foreground italic">
                    Nenhuma novidade postada ainda. As ações do dia do show aparecem aqui.
                  </p>
                </div>
              ) : (
                <div className="space-y-5">
                  {feed.map((s) => (
                    <ShowFeedPost
                      key={s.numero}
                      idUnico={tour.idUnico}
                      show={s}
                      telegramId={telegramId}
                      usuario={usuario}
                    />
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>

      {acaoAberta && (
        <TourActionModal
          idUnico={tour.idUnico}
          show={acaoAberta}
          telegramId={telegramId}
          onClose={() => setAcaoAberta(null)}
          onDone={() => {
            setAcaoAberta(null);
            reload();
          }}
        />
      )}
    </main>
  );
}

function normalizeId(v: string) {
  return String(v || "").trim().toLowerCase();
}

function StatMini({ icon, value, label }: { icon: React.ReactNode; value: React.ReactNode; label: string }) {
  return (
    <div className="flex-1 p-3 rounded-2xl bg-card border border-white/5 flex flex-col items-center text-center">
      <div className="size-7 rounded-lg bg-white/5 grid place-items-center mb-1.5 text-primary">{icon}</div>
      <span className="text-base font-black tracking-tight leading-none mb-0.5">{value}</span>
      <span className="text-[11px] font-black uppercase tracking-widest text-muted-foreground/40">{label}</span>
    </div>
  );
}

function ShowRow({ show }: { show: TourShow }) {
  const pct = show.capacidade > 0 ? Math.min(100, Math.round((show.vendidos / show.capacidade) * 100)) : 0;
  return (
    <div
      className={`p-4 rounded-3xl border transition-all ${
        show.soldOut ? "bg-amber-500/5 border-amber-500/20" : "bg-card border-white/5"
      }`}
    >
      <div className="flex items-center gap-4">
        <div className="size-14 rounded-2xl flex flex-col items-center justify-center shrink-0 border bg-white/5 border-white/5 text-muted-foreground">
          <span className="text-[10px] font-black uppercase opacity-70">show</span>
          <span className="text-lg font-black tracking-tighter leading-none">{show.numero}</span>
        </div>
        <div className="flex-1 min-w-0">
          <h5 className="font-black text-sm uppercase tracking-tight truncate">{show.local}</h5>
          <p className="text-[10px] font-bold text-muted-foreground uppercase mt-1">
            {show.cidade} · {show.data}
          </p>
        </div>
        <div className="text-right shrink-0">
          {show.soldOut ? (
            <div className="px-2 py-1 bg-amber-500/10 border border-amber-500/20 text-amber-500 text-[10px] font-black uppercase rounded-lg">
              SOLD OUT
            </div>
          ) : show.acoes.length > 0 ? (
            <span className="text-[10px] font-black text-muted-foreground/60 uppercase">Realizado</span>
          ) : (
            <span className="text-[10px] font-black text-muted-foreground/40 uppercase">Aguardando</span>
          )}
        </div>
      </div>
      <div className="mt-3 space-y-1.5">
        <div className="flex justify-between text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          <span>
            {show.vendidos.toLocaleString("pt-BR")} / {show.capacidade.toLocaleString("pt-BR")} fãs
          </span>
          <span>{pct}%</span>
        </div>
        <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${
              show.soldOut ? "bg-amber-500" : "bg-gradient-to-r from-primary/60 to-primary"
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="flex justify-between text-[10px] font-black uppercase tracking-wider pt-1">
          <span className="text-muted-foreground">
            Receita: <span className="text-emerald-400">{fmtMoney(show.receita)}</span>
          </span>
        </div>
      </div>
    </div>
  );
}

interface Comentario {
  telegramId: string;
  usuario: string;
  texto: string;
  data: string;
}

function ShowFeedPost({
  idUnico,
  show,
  telegramId,
  usuario,
}: {
  idUnico: string;
  show: TourShow;
  telegramId: string;
  usuario: string;
}) {
  const [comentarios, setComentarios] = useState<Comentario[] | null>(null);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const ultimaAcao = show.acoes[show.acoes.length - 1];

  function loadComentarios() {
    fetch(`/api/turnes/comentarios?idUnico=${encodeURIComponent(idUnico)}&showNumero=${show.numero}`)
      .then((r) => r.json())
      .then((res) => {
        if (res?.success) setComentarios(res.data || []);
      });
  }

  useEffect(() => {
    loadComentarios();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function enviar() {
    if (!texto.trim() || (!telegramId && !usuario)) return;
    setEnviando(true);
    try {
      const res = await fetch("/api/turnes/comentar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idUnico, showNumero: show.numero, telegramId, usuario, texto: texto.trim() }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.success) {
        haptic.selection();
        setTexto("");
        loadComentarios();
      }
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="rounded-[2rem] bg-card border border-white/5 overflow-hidden">
      {ultimaAcao?.fotoUrl && (
        <img src={driveImg(ultimaAcao.fotoUrl, 800)} alt="" className="w-full aspect-video object-cover" />
      )}
      <div className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h5 className="font-black text-sm uppercase tracking-tight">{show.local}</h5>
            <p className="text-[10px] font-bold text-muted-foreground uppercase mt-0.5">
              {show.cidade} · {show.data}
            </p>
          </div>
          {show.soldOut && (
            <div className="px-2 py-1 bg-amber-500/10 border border-amber-500/20 text-amber-500 text-[10px] font-black uppercase rounded-lg shrink-0">
              SOLD OUT
            </div>
          )}
        </div>

        {ultimaAcao && <p className="text-sm text-white/90 leading-relaxed">{ultimaAcao.texto}</p>}

        <div className="pt-2 border-t border-white/5 space-y-2">
          {comentarios === null ? (
            <div className="flex justify-center py-2 opacity-40">
              <Loader2 className="size-4 animate-spin" />
            </div>
          ) : (
            comentarios.map((c, i) => (
              <div key={i} className="flex gap-2 text-xs">
                <span className="font-black text-primary shrink-0">{c.usuario || "Fã"}</span>
                <span className="text-white/70 break-words">{c.texto}</span>
              </div>
            ))
          )}
          <div className="flex items-center gap-2 pt-1">
            <input
              type="text"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && enviar()}
              placeholder="Comente e ganhe prestígio..."
              className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder-neutral-600"
            />
            <button
              onClick={enviar}
              disabled={enviando || !texto.trim()}
              className="p-2 rounded-xl bg-primary text-primary-foreground disabled:opacity-40 transition"
            >
              <Send className="size-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Todos os 8 tipos garantem sold out — a diferença entre eles é só o tipo de
// conteúdo/narrativa que fica registrado na Central de Notícias, pra não
// ficar repetitivo postar sempre a mesma coisa show após show.
const TIPOS_ACAO: {
  tipo: TourAcaoDia["tipo"];
  label: string;
  icon: React.ReactNode;
  precisaFoto: boolean;
}[] = [
  { tipo: "foto", label: "Foto + resumo", icon: <Camera className="size-5" />, precisaFoto: true },
  {
    tipo: "especial",
    label: "Evento especial",
    icon: <PartyPopper className="size-5" />,
    precisaFoto: true,
  },
  {
    tipo: "entrevista",
    label: "Entrevista rápida",
    icon: <Mic className="size-5" />,
    precisaFoto: false,
  },
  {
    tipo: "interacao",
    label: "Interação com fã",
    icon: <MessageCircle className="size-5" />,
    precisaFoto: false,
  },
  { tipo: "live", label: "Live nas redes", icon: <Radio className="size-5" />, precisaFoto: false },
  { tipo: "colab", label: "Colab surpresa", icon: <Users2 className="size-5" />, precisaFoto: true },
  {
    tipo: "sorteio",
    label: "Sorteio de ingressos VIP",
    icon: <Ticket className="size-5" />,
    precisaFoto: false,
  },
  {
    tipo: "bastidores",
    label: "Bastidores",
    icon: <Clapperboard className="size-5" />,
    precisaFoto: true,
  },
];

function TourActionModal({
  idUnico,
  show,
  telegramId,
  onClose,
  onDone,
}: {
  idUnico: string;
  show: TourShow;
  telegramId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [tipo, setTipo] = useState<TourAcaoDia["tipo"]>("foto");
  const [texto, setTexto] = useState("");
  const [fotoUrl, setFotoUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");

  const config = TIPOS_ACAO.find((t) => t.tipo === tipo)!;

  async function handleUploadFoto(file: File) {
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("fileName", file.name);
      formData.append("folderType", "turnes");
      const res = await fetch("/api/gestao/upload", { method: "POST", body: formData });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.success && data?.data?.fileUrl) setFotoUrl(data.data.fileUrl);
      else setErro("Não deu pra enviar a foto.");
    } catch {
      setErro("Não deu pra enviar a foto.");
    } finally {
      setUploading(false);
    }
  }

  async function enviar() {
    if (!texto.trim()) return setErro("Escreva um resumo/texto pra ação.");
    if (config.precisaFoto && !fotoUrl) return setErro("Adicione uma foto pra esse tipo de ação.");
    setErro("");
    setEnviando(true);
    try {
      const res = await fetch("/api/turnes/acao", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          telegramId,
          idUnico,
          showNumero: show.numero,
          tipo,
          texto: texto.trim(),
          fotoUrl,
        }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.success) {
        haptic.selection();
        onDone();
      } else {
        setErro(data?.error || "Não deu pra registrar a ação.");
      }
    } catch {
      setErro("Não deu pra registrar a ação.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[150] bg-neutral-950/98 backdrop-blur-3xl flex flex-col animate-in slide-in-from-bottom overflow-hidden">
      <div className="p-4 sm:p-6 border-b border-white/10 flex items-center justify-between bg-neutral-900/90 shrink-0">
        <div>
          <span className="text-[10px] font-mono font-black uppercase text-primary/80 block">
            Ação de hoje
          </span>
          <h2 className="text-lg font-black text-white">
            {show.local} · {show.cidade}
          </h2>
        </div>
        <button
          onClick={onClose}
          className="p-2.5 rounded-full bg-neutral-800 hover:bg-neutral-700 text-neutral-400 hover:text-white transition"
        >
          <X className="size-5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5 pb-32">
        <div>
          <p className="text-[11px] font-black uppercase text-neutral-400 mb-1">
            Escolha A ação de hoje
          </p>
          <p className="text-[11px] text-neutral-500 mb-2">
            Qualquer uma garante sold out — escolha só pelo clima que você quer registrar. Só dá pra fazer
            uma, sem voltar atrás depois.
          </p>
          <div className="grid grid-cols-2 gap-2">
            {TIPOS_ACAO.map((t) => (
              <button
                key={t.tipo}
                onClick={() => setTipo(t.tipo)}
                className={`flex flex-col items-center gap-1.5 p-4 rounded-2xl border transition ${
                  tipo === t.tipo
                    ? "bg-primary/10 border-primary/40 text-primary"
                    : "bg-neutral-900/60 border-white/5 text-neutral-300"
                }`}
              >
                {t.icon}
                <span className="text-[11px] font-black uppercase text-center leading-tight">
                  {t.label}
                </span>
              </button>
            ))}
          </div>
        </div>

        {config.precisaFoto && (
          <div>
            <p className="text-[11px] font-black uppercase text-neutral-400 mb-2">Foto</p>
            <div className="flex items-center gap-3">
              <div className="size-16 rounded-xl bg-neutral-900 border border-white/10 overflow-hidden shrink-0 grid place-items-center">
                {fotoUrl ? (
                  <img src={driveImg(fotoUrl, 200)} alt="" className="size-full object-cover" />
                ) : (
                  <ImagePlus className="size-6 text-neutral-600" />
                )}
              </div>
              <label className="px-4 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-white text-xs font-black uppercase cursor-pointer transition">
                {uploading ? "Enviando..." : "Escolher foto"}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  disabled={uploading}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleUploadFoto(f);
                  }}
                />
              </label>
            </div>
          </div>
        )}

        <div>
          <p className="text-[11px] font-black uppercase text-neutral-400 mb-2">Resumo</p>
          <textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            rows={4}
            placeholder="Conte como foi..."
            className="w-full bg-neutral-900 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-neutral-600 resize-none"
          />
        </div>

        <p className="text-[11px] text-neutral-500">
          Ao publicar como <span className="text-white font-black">{config.label}</span>, esse show vira{" "}
          <span className="text-primary font-black">sold out</span> na hora — não dá pra voltar atrás.
        </p>

        {erro && <p className="text-xs text-red-400 font-bold">{erro}</p>}
      </div>

      <div className="p-4 sm:p-6 border-t border-white/10 bg-neutral-900/90 shrink-0">
        <button
          onClick={enviar}
          disabled={enviando}
          className="w-full py-3.5 rounded-2xl bg-primary hover:bg-primary/90 text-primary-foreground font-black text-sm uppercase tracking-wider transition disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {enviando ? <Loader2 className="size-4 animate-spin" /> : null}
          Publicar
        </button>
      </div>
    </div>
  );
}
