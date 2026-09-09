import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Archive,
  BookOpen,
  MessageSquareText,
  Plus,
  X,
  Loader2,
  ChevronLeft,
  ChevronRight,
  ImageIcon,
  Trash2,
  BookOpenText,
  Crown,
  Award,
  ListOrdered,
  Sparkle,
  Tags,
  CalendarDays,
  Users,
  Search,
} from "lucide-react";
import { api, resolveImg, driveImg, fmtMoney, type Artist } from "@/lib/api";
import { useTelegramUser, haptic } from "@/lib/telegram";
import { getStoredLogin } from "@/components/LoginScreen";

// Transição de "capa vira detalhe" (mesmo mecanismo do card de notícia no
// Social — layoutId + AnimatePresence) e o stagger de entrada do conteúdo
// (título, meta, texto, botão) inspirados no CodePen de referência do
// usuário, adaptados ao tema escuro do app.
const STAGGER_DELAYS = [0, 0.08, 0.16, 0.24];

export const Route = createFileRoute("/acervo")({
  component: AcervoPage,
});

type Revista = {
  id: string;
  artista: string;
  titulo: string;
  capa?: string;
  paginas: string[];
  data: string;
  telegram_id?: string;
  musicas?: string[];
};

type MetacriticItem = {
  id: string;
  tipo: "musicas" | "albuns";
  titulo: string;
  artista: string;
  artistaPrincipal: string;
  artistaFotoUrl: string | null;
  capaUrl: string | null;
  nota: number;
  genero: string | null;
  releaseDateIso: string | null;
};

type Pergunta = { pergunta: string; resposta: string };

type Entrevista = {
  id: string;
  artista: string;
  titulo: string;
  capa?: string;
  perguntas: Pergunta[];
  data: string;
  telegram_id?: string;
  musicas?: string[];
};

async function uploadToDrive(file: File): Promise<string | null> {
  try {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("fileName", file.name);
    formData.append("folderType", "acervo");
    const res = await fetch("/api/gestao/upload", { method: "POST", body: formData });
    const data = await res.json().catch(() => null);
    if (res.ok && data?.success && data?.data?.fileUrl) return data.data.fileUrl as string;
  } catch (err) {
    console.error("Erro no upload:", err);
  }
  return null;
}

function AcervoPage() {
  const { user } = useTelegramUser();
  // Login via usuário/senha (fora do Telegram) guarda o telegram_id
  // histórico em localStorage — sem isso, quem entra pelo navegador (não
  // pelo Telegram) nunca tinha user?.id preenchido, e a tela achava que o
  // jogador não tinha nenhum artista vinculado mesmo tendo (mesmo padrão já
  // usado em /perfil).
  const tgId = (typeof window !== "undefined" ? localStorage.getItem("empire_tg_id") : null) || user?.id || "";
  const [tab, setTab] = useState<"revistas" | "entrevistas" | "forbes" | "metacritic">("revistas");
  const [revistas, setRevistas] = useState<Revista[]>([]);
  const [entrevistas, setEntrevistas] = useState<Entrevista[]>([]);
  const [forbes, setForbes] = useState<Artist[] | null>(null);
  const [metacritic, setMetacritic] = useState<{ semanaId: string | null; itens: MetacriticItem[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [myArtists, setMyArtists] = useState<any[]>([]);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedRevista, setSelectedRevista] = useState<Revista | null>(null);
  const [selectedEntrevista, setSelectedEntrevista] = useState<Entrevista | null>(null);

  const card = "rounded-[1.75rem] bg-white/5 border border-white/10 transition-all";
  const inputCls =
    "w-full bg-white/5 border border-white/10 rounded-2xl p-3.5 text-base font-medium focus:outline-none focus:border-primary/50 transition-colors placeholder:text-muted-foreground/60";

  async function loadAll() {
    setLoading(true);
    const [r, e] = await Promise.all([api.listarRevistasAcervo(), api.listarEntrevistasAcervo()]);
    setRevistas(r);
    setEntrevistas(e);
    setLoading(false);
  }

  useEffect(() => {
    loadAll();
  }, []);

  useEffect(() => {
    if (tab !== "forbes" || forbes !== null) return;
    api.listarTodos().then((artists) => {
      const ranked = artists
        .filter((a) => a.fortuna_total !== null)
        .sort((a, b) => (b.fortuna_total || 0) - (a.fortuna_total || 0));
      setForbes(ranked);
    });
  }, [tab, forbes]);

  useEffect(() => {
    if (tab !== "metacritic" || metacritic !== null) return;
    api.listarMetacriticAcervo().then((r) => setMetacritic({ semanaId: r.semanaId, itens: r.itens }));
  }, [tab, metacritic]);

  useEffect(() => {
    if (!tgId || tgId === "guest") return;
    api.meusArtistas(tgId).then(setMyArtists).catch(() => setMyArtists([]));
  }, [tgId]);

  return (
    <div className="flex-1 bg-background min-h-dvh pb-32">
      {/* max-w trava o conteudo em telas largas (desktop) — sem isso o grid
          de 2 colunas esticava a ponto da capa da revista ocupar quase a
          tela inteira, porque nada limitava a largura do container. */}
      <div className="max-w-3xl mx-auto">
      <div className="px-4 pt-6 pb-4">
        <div className="flex items-center gap-2 mb-1">
          <Archive className="size-5 text-primary" />
          <h1 className="text-xl font-black uppercase tracking-tight">Acervo</h1>
        </div>
        <p className="text-xs text-muted-foreground font-medium">
          Entrevistas e edições de revista dos artistas do Empire.
        </p>
      </div>

      <div className="px-4 flex gap-2 mb-5">
        <button
          onClick={() => {
            haptic.selection();
            setTab("revistas");
          }}
          className={`relative flex-1 py-2.5 rounded-2xl font-black text-xs uppercase flex items-center justify-center gap-1.5 transition-all active:scale-95 ${
            tab === "revistas"
              ? "text-primary-foreground shadow-[0_4px_18px_-4px_var(--primary)]"
              : "text-muted-foreground border border-white/10 bg-white/[0.03] backdrop-blur-md hover:bg-white/[0.06]"
          }`}
        >
          {tab === "revistas" && <span className="absolute inset-0 rounded-2xl bg-gradient-to-br from-primary via-primary to-fuchsia-500/80" aria-hidden="true" />}
          <BookOpen className="relative z-10 size-3.5" /> <span className="relative z-10">Revistas</span>
        </button>
        <button
          onClick={() => {
            haptic.selection();
            setTab("entrevistas");
          }}
          className={`relative flex-1 py-2.5 rounded-2xl font-black text-xs uppercase flex items-center justify-center gap-1.5 transition-all active:scale-95 ${
            tab === "entrevistas"
              ? "text-primary-foreground shadow-[0_4px_18px_-4px_var(--primary)]"
              : "text-muted-foreground border border-white/10 bg-white/[0.03] backdrop-blur-md hover:bg-white/[0.06]"
          }`}
        >
          {tab === "entrevistas" && <span className="absolute inset-0 rounded-2xl bg-gradient-to-br from-primary via-primary to-fuchsia-500/80" aria-hidden="true" />}
          <MessageSquareText className="relative z-10 size-3.5" /> <span className="relative z-10">Entrevistas</span>
        </button>
        <button
          onClick={() => {
            haptic.selection();
            setTab("forbes");
          }}
          className={`relative flex-1 py-2.5 rounded-2xl font-black text-xs uppercase flex items-center justify-center gap-1.5 transition-all active:scale-95 ${
            tab === "forbes"
              ? "text-primary-foreground shadow-[0_4px_18px_-4px_var(--primary)]"
              : "text-muted-foreground border border-white/10 bg-white/[0.03] backdrop-blur-md hover:bg-white/[0.06]"
          }`}
        >
          {tab === "forbes" && <span className="absolute inset-0 rounded-2xl bg-gradient-to-br from-primary via-primary to-fuchsia-500/80" aria-hidden="true" />}
          <Crown className="relative z-10 size-3.5" /> <span className="relative z-10">Forbes</span>
        </button>
        <button
          onClick={() => {
            haptic.selection();
            setTab("metacritic");
          }}
          className={`relative flex-1 py-2.5 rounded-2xl font-black text-xs uppercase flex items-center justify-center gap-1.5 transition-all active:scale-95 ${
            tab === "metacritic"
              ? "text-primary-foreground shadow-[0_4px_18px_-4px_var(--primary)]"
              : "text-muted-foreground border border-white/10 bg-white/[0.03] backdrop-blur-md hover:bg-white/[0.06]"
          }`}
        >
          {tab === "metacritic" && <span className="absolute inset-0 rounded-2xl bg-gradient-to-br from-primary via-primary to-fuchsia-500/80" aria-hidden="true" />}
          <Award className="relative z-10 size-3.5" /> <span className="relative z-10">Metacritic</span>
        </button>
      </div>

      <div className="px-4">
        {tab === "forbes" ? (
          forbes === null ? (
            <div className="flex flex-col items-center justify-center p-20 gap-4">
              <Loader2 className="size-8 text-primary animate-spin" />
            </div>
          ) : forbes.length === 0 ? (
            <EmptyState text="Nenhum artista com Fortuna Total preenchida ainda." />
          ) : (
            <div className="grid gap-2">
              {forbes.map((a, idx) => (
                <div key={a.nome} className={`${card} p-3.5 flex items-center gap-3`}>
                  <span
                    className={`w-7 shrink-0 text-center text-sm font-black ${
                      idx === 0 ? "text-amber-400" : idx === 1 ? "text-slate-300" : idx === 2 ? "text-amber-700" : "text-muted-foreground"
                    }`}
                  >
                    {idx + 1}
                  </span>
                  <div className="size-11 shrink-0 rounded-xl overflow-hidden bg-secondary">
                    {a.foto && (
                      <img src={driveImg(a.foto, 150)} className="w-full h-full object-cover" referrerPolicy="no-referrer" loading="lazy" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold leading-snug truncate">{a.nome}</p>
                    <p className="text-[10px] text-muted-foreground font-medium">{a.gravadora}</p>
                  </div>
                  <p className="text-sm font-black text-primary shrink-0">{fmtMoney(a.fortuna_total || 0)}</p>
                </div>
              ))}
            </div>
          )
        ) : tab === "metacritic" ? (
          <MetacriticTab metacritic={metacritic} card={card} />
        ) : loading ? (
          <div className="flex flex-col items-center justify-center p-20 gap-4">
            <Loader2 className="size-8 text-primary animate-spin" />
          </div>
        ) : tab === "revistas" ? (
          revistas.length === 0 ? (
            <EmptyState text="Nenhuma revista publicada ainda." />
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {revistas.map((r) => (
                <motion.button
                  key={r.id}
                  layoutId={`revista-card-${r.id}`}
                  onClick={() => {
                    haptic.selection();
                    setSelectedRevista(r);
                  }}
                  className={`${card} overflow-hidden text-left active:scale-95`}
                >
                  <motion.div layoutId={`revista-cover-${r.id}`} className="aspect-[3/4] bg-secondary">
                    {r.capa && (
                      <img
                        src={resolveImg(r.capa)}
                        className="w-full h-full object-cover"
                        referrerPolicy="no-referrer"
                        loading="lazy"
                      />
                    )}
                  </motion.div>
                  <div className="p-2.5">
                    <p className="text-[10px] font-black uppercase text-primary truncate">{r.artista}</p>
                    <p className="text-xs font-bold leading-snug line-clamp-2">{r.titulo}</p>
                    <p className="text-[10px] text-muted-foreground font-medium mt-1">{r.paginas.length} páginas</p>
                  </div>
                </motion.button>
              ))}
            </div>
          )
        ) : entrevistas.length === 0 ? (
          <EmptyState text="Nenhuma entrevista publicada ainda." />
        ) : (
          <div className="grid gap-3">
            {entrevistas.map((e) => (
              <motion.button
                key={e.id}
                layoutId={`entrevista-card-${e.id}`}
                onClick={() => {
                  haptic.selection();
                  setSelectedEntrevista(e);
                }}
                className={`${card} p-3.5 flex items-center gap-3 text-left active:scale-95`}
              >
                <motion.div layoutId={`entrevista-cover-${e.id}`} className="size-14 shrink-0 rounded-xl overflow-hidden bg-secondary">
                  {e.capa && (
                    <img src={resolveImg(e.capa)} className="w-full h-full object-cover" referrerPolicy="no-referrer" loading="lazy" />
                  )}
                </motion.div>
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-black uppercase text-primary truncate">{e.artista}</p>
                  <p className="text-sm font-bold leading-snug line-clamp-2">{e.titulo}</p>
                  <p className="text-[10px] text-muted-foreground font-medium mt-0.5">
                    {e.perguntas.length} pergunta{e.perguntas.length === 1 ? "" : "s"}
                  </p>
                </div>
              </motion.button>
            ))}
          </div>
        )}
      </div>
      </div>

      {tab !== "forbes" && tab !== "metacritic" && (
        <button
          onClick={() => {
            haptic.light();
            setIsCreateOpen(true);
          }}
          className="fixed bottom-24 right-5 size-14 rounded-full bg-primary text-primary-foreground grid place-items-center shadow-2xl active:scale-90 transition-transform z-40"
        >
          <Plus className="size-6" />
        </button>
      )}

      {selectedRevista && (
        <RevistaViewer revista={selectedRevista} onClose={() => setSelectedRevista(null)} />
      )}
      {selectedEntrevista && (
        <EntrevistaViewer entrevista={selectedEntrevista} onClose={() => setSelectedEntrevista(null)} />
      )}
      {isCreateOpen && tab !== "forbes" && tab !== "metacritic" && (
        <CreateModal
          tab={tab}
          myArtists={myArtists}
          inputCls={inputCls}
          tgId={tgId}
          onClose={() => setIsCreateOpen(false)}
          onCreated={() => {
            setIsCreateOpen(false);
            loadAll();
          }}
        />
      )}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="w-full p-8 rounded-[1.75rem] bg-card/50 border-2 border-dashed border-primary/20 flex flex-col items-center text-center min-h-40 gap-2 mt-6">
      <Archive className="size-8 text-primary/60" />
      <p className="text-sm font-black uppercase tracking-tight">Vazio por aqui</p>
      <p className="text-[11px] font-medium text-muted-foreground leading-snug max-w-[16rem]">{text}</p>
    </div>
  );
}

// Cor da nota — mesma escala semântica já usada em ScoreBadge (≥75 verde,
// ≥50 amarelo, <50 vermelho), só que aqui vira o "quadrado colorido plano"
// que é a assinatura visual do Metacritic de verdade, adaptado pro tema
// escuro do app (fundo sólido + texto preto, igual a referência, em vez de
// pill translúcida).
function metacriticScoreColor(nota: number): string {
  if (nota >= 75) return "bg-emerald-400";
  if (nota >= 50) return "bg-amber-400";
  return "bg-rose-500";
}

function metacriticAno(iso: string | null): string | null {
  if (!iso) return null;
  const ano = iso.slice(0, 4);
  return /^\d{4}$/.test(ano) ? ano : null;
}

// Card usado nas 3 visões em grade (Recentes / Por Estilo / Por Ano) —
// capa + faixa colorida no topo (força/fraqueza da nota, tipo o destaque
// das capas de "New and Notable" do Metacritic real) + selo de nota no
// canto, quadrado e chapado (não pill), + tag Música/Álbum sempre visível
// (pedido explícito: álbum também precisa aparecer, não só música).
function MetacriticGridCard({ item }: { item: MetacriticItem }) {
  const ano = metacriticAno(item.releaseDateIso);
  return (
    <Link
      to="/empire-play/forum"
      search={{ tab: item.tipo, id: item.id }}
      onClick={() => haptic.selection()}
      className="group block rounded-2xl overflow-hidden bg-white/5 border border-white/10 active:scale-[0.97] transition-transform"
    >
      <div className={`h-1 w-full ${metacriticScoreColor(item.nota)}`} aria-hidden="true" />
      <div className="aspect-square w-full bg-secondary relative">
        {item.capaUrl && (
          <img
            src={resolveImg(item.capaUrl)}
            className="w-full h-full object-cover"
            referrerPolicy="no-referrer"
            loading="lazy"
          />
        )}
        <span
          className={`absolute bottom-2 right-2 min-w-[2.25rem] h-9 px-1.5 rounded-lg grid place-items-center text-black text-sm font-black shadow-lg leading-none ${metacriticScoreColor(item.nota)}`}
        >
          {item.nota.toFixed(0)}
        </span>
      </div>
      <div className="p-2.5 space-y-1">
        <div className="flex items-center gap-1.5">
          <span className="text-[9px] font-black uppercase tracking-wide text-primary px-1.5 py-0.5 rounded bg-primary/15">
            {item.tipo === "albuns" ? "Álbum" : "Música"}
          </span>
          {ano && <span className="text-[9px] font-bold text-muted-foreground">{ano}</span>}
        </div>
        <p className="text-xs font-bold leading-snug truncate">{item.titulo}</p>
        <p className="text-[10px] text-muted-foreground font-medium truncate">{item.artista}</p>
      </div>
    </Link>
  );
}

// Cabeçalho de seção editorial (grande/itálico/black, com régua embaixo) —
// mesma linguagem tipográfica já usada nos títulos do app, inspirado no
// sublinhado do "New and Notable" do Metacritic real.
function MetacriticSectionHeader({ children }: { children: string }) {
  return (
    <div className="pb-2 border-b-2 border-white/10">
      <h3 className="text-lg font-black italic uppercase tracking-tight text-white">{children}</h3>
    </div>
  );
}

function MetacriticTab({
  metacritic,
  card,
}: {
  metacritic: { semanaId: string | null; itens: MetacriticItem[] } | null;
  card: string;
}) {
  const [view, setView] = useState<"destaques" | "ranking" | "recentes" | "estilo" | "ano" | "artistas">(
    "destaques",
  );
  const [rankingTipo, setRankingTipo] = useState<"musicas" | "albuns">("musicas");
  // Filtro por artista — pedido do usuário, separado da guia "Artistas"
  // (aquela é o ranking médio por artista; este filtro só recorta os
  // materiais individuais das guias Ranking/Recentes/Estilo/Ano pra um
  // artista só). Não afeta Destaques (visão geral) nem Artistas.
  const [artistaFiltro, setArtistaFiltro] = useState<string>("");
  const [artistaDropdownAberto, setArtistaDropdownAberto] = useState(false);
  const [buscaArtistaFiltro, setBuscaArtistaFiltro] = useState("");

  if (metacritic === null) {
    return (
      <div className="flex flex-col items-center justify-center p-20 gap-4">
        <Loader2 className="size-8 text-primary animate-spin" />
      </div>
    );
  }
  if (metacritic.itens.length === 0) {
    return <EmptyState text="Nenhuma nota do Metacritic registrada ainda." />;
  }

  // Filtra vazio — algumas linhas antigas de Musicas/Albuns têm nota mas
  // "ACT PRINCIPAL" em branco; sem isso viravam um artista fantasma "" no
  // topo do ranking de Artistas (foto/nome em branco, reportado pelo
  // usuário).
  const artistasDisponiveis = [
    ...new Set(metacritic.itens.map((i) => i.artistaPrincipal).filter((nome) => nome.trim())),
  ].sort((a, b) => a.localeCompare(b));

  const itensFiltrados = artistaFiltro
    ? metacritic.itens.filter((i) => i.artistaPrincipal === artistaFiltro)
    : metacritic.itens;

  // Música e álbum NUNCA se misturam no mesmo ranking (pedido do usuário) —
  // toda visão em lista/grade separa os dois, nunca mostra os dois juntos
  // competindo pela mesma posição.
  const musicasGlobais = metacritic.itens.filter((i) => i.tipo === "musicas");
  const albunsGlobais = metacritic.itens.filter((i) => i.tipo === "albuns");
  const musicas = itensFiltrados.filter((i) => i.tipo === "musicas");
  const albuns = itensFiltrados.filter((i) => i.tipo === "albuns");

  const top3 = (lista: MetacriticItem[]) => [...lista].sort((a, b) => b.nota - a.nota).slice(0, 3);

  const SEIS_MESES_MS = 1000 * 60 * 60 * 24 * 30 * 6;
  const corteRecente = Date.now() - SEIS_MESES_MS;
  const dentroDosUltimosSeisMeses = (i: MetacriticItem) =>
    !!i.releaseDateIso && new Date(i.releaseDateIso).getTime() >= corteRecente;

  const top3Musica = top3(musicasGlobais);
  const top3Album = top3(albunsGlobais);
  const top3RecentesMusica = top3(musicasGlobais.filter(dentroDosUltimosSeisMeses));
  const top3RecentesAlbum = top3(albunsGlobais.filter(dentroDosUltimosSeisMeses));

  const porNota = [...(rankingTipo === "musicas" ? musicas : albuns)].sort((a, b) => b.nota - a.nota);

  const porData = [...itensFiltrados]
    .filter((i) => i.releaseDateIso)
    .sort((a, b) => (b.releaseDateIso || "").localeCompare(a.releaseDateIso || ""));

  const gruposEstilo = new Map<string, MetacriticItem[]>();
  for (const item of itensFiltrados) {
    const chave = item.genero || "Sem estilo definido";
    if (!gruposEstilo.has(chave)) gruposEstilo.set(chave, []);
    gruposEstilo.get(chave)!.push(item);
  }
  const estilosOrdenados = [...gruposEstilo.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([nome, itens]) => [nome, itens.sort((a, b) => b.nota - a.nota)] as const);

  const gruposAno = new Map<string, MetacriticItem[]>();
  for (const item of itensFiltrados) {
    const chave = metacriticAno(item.releaseDateIso) || "Sem data";
    if (!gruposAno.has(chave)) gruposAno.set(chave, []);
    gruposAno.get(chave)!.push(item);
  }
  const anosOrdenados = [...gruposAno.entries()]
    .sort((a, b) => (b[0] === "Sem data" ? -1 : a[0] === "Sem data" ? 1 : b[0].localeCompare(a[0])))
    .map(([nome, itens]) => [nome, itens.sort((a, b) => b.nota - a.nota)] as const);

  // Ranking de ARTISTAS (não de materiais) — média de todas as notas
  // recebidas por cada artista (música + álbum juntos), com a foto de
  // perfil dele. Pedido do usuário.
  const gruposArtista = new Map<string, MetacriticItem[]>();
  for (const item of metacritic.itens) {
    if (!item.artistaPrincipal.trim()) continue;
    if (!gruposArtista.has(item.artistaPrincipal)) gruposArtista.set(item.artistaPrincipal, []);
    gruposArtista.get(item.artistaPrincipal)!.push(item);
  }
  const artistasRankeados = [...gruposArtista.entries()]
    .map(([nome, itens]) => ({
      nome,
      fotoUrl: itens.find((i) => i.artistaFotoUrl)?.artistaFotoUrl || null,
      media: itens.reduce((soma, i) => soma + i.nota, 0) / itens.length,
      total: itens.length,
    }))
    .sort((a, b) => b.media - a.media);

  const views: { key: typeof view; label: string; icon: typeof ListOrdered }[] = [
    { key: "destaques", label: "Destaques", icon: Award },
    { key: "ranking", label: "Ranking", icon: ListOrdered },
    { key: "artistas", label: "Artistas", icon: Users },
    { key: "recentes", label: "Recentes", icon: Sparkle },
    { key: "estilo", label: "Estilo", icon: Tags },
    { key: "ano", label: "Ano", icon: CalendarDays },
  ];

  // Reaproveitada nos 4 blocos de "Destaques" e disponível pro Ranking —
  // fileira horizontal de até 3 cards, mesmo estilo dos outros lugares.
  const TrioGrid = ({ itens }: { itens: MetacriticItem[] }) =>
    itens.length === 0 ? (
      <p className="text-xs text-muted-foreground italic px-1">Nada por aqui ainda.</p>
    ) : (
      <div className="grid grid-cols-3 gap-3">
        {itens.map((item) => (
          <MetacriticGridCard key={item.id} item={item} />
        ))}
      </div>
    );

  return (
    <div className="space-y-5">
      <div>
        {/* Atualização é semanal de propósito (não em tempo real) — pra
            ninguém conseguir inferir "quem deu nota pra quem" vendo o
            ranking mudar assim que um comentário é postado. */}
        <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide px-1 mb-3">
          Ranking atualizado semanalmente · músicas e álbuns
        </p>
        {/* flex-wrap (não mais rolagem escondida) — todo botão fica sempre
            visível, quebrando pra segunda linha em tela estreita, em vez de
            cortar/depender de rolar pra ver o resto. */}
        <div className="flex flex-wrap gap-2">
          {views.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => {
                haptic.selection();
                setView(key);
              }}
              className={`relative px-3 py-2 rounded-xl font-black text-[10px] uppercase flex items-center gap-1.5 whitespace-nowrap transition-all active:scale-95 ${
                view === key
                  ? "text-primary-foreground shadow-[0_4px_14px_-4px_var(--primary)]"
                  : "text-muted-foreground border border-white/10 bg-white/[0.03] backdrop-blur-md hover:bg-white/[0.06]"
              }`}
            >
              {view === key && (
                <span className="absolute inset-0 rounded-xl bg-gradient-to-br from-primary via-primary to-fuchsia-500/80" aria-hidden="true" />
              )}
              <Icon className="relative z-10 size-3.5 shrink-0" /> <span className="relative z-10">{label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Filtro por artista — só faz sentido nas guias de material
          (Ranking/Recentes/Estilo/Ano); Destaques e Artistas são visões
          gerais e ficam de fora dele. Dropdown de botões de verdade (não
          <select> nativo) com busca, mesmo padrão já usado em outras buscas
          do app (ex: participantes em Gestão). */}
      {view !== "destaques" && view !== "artistas" && artistasDisponiveis.length > 0 && (
        <div className="relative">
          <button
            type="button"
            onClick={() => {
              haptic.selection();
              setArtistaDropdownAberto((v) => !v);
              setBuscaArtistaFiltro("");
            }}
            className={`w-full flex items-center gap-2 rounded-xl border px-3.5 py-2.5 text-xs font-bold transition ${
              artistaFiltro
                ? "border-primary/40 bg-primary/10 text-white"
                : "border-white/10 bg-white/[0.03] text-muted-foreground"
            }`}
          >
            <Search className="size-3.5 shrink-0" />
            <span className="flex-1 text-left truncate">{artistaFiltro || "Todos os artistas"}</span>
            {artistaFiltro && (
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  haptic.selection();
                  setArtistaFiltro("");
                }}
                className="shrink-0 rounded-full p-0.5 hover:bg-white/10"
              >
                <X className="size-3.5" />
              </span>
            )}
          </button>

          {artistaDropdownAberto && (
            <div className="absolute z-20 mt-1.5 w-full max-h-72 overflow-y-auto rounded-xl border border-white/10 bg-neutral-900 shadow-2xl">
              <div className="p-2 sticky top-0 bg-neutral-900 border-b border-white/5">
                <input
                  autoFocus
                  value={buscaArtistaFiltro}
                  onChange={(e) => setBuscaArtistaFiltro(e.target.value)}
                  placeholder="Buscar artista..."
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-muted-foreground focus:border-primary focus:outline-none"
                />
              </div>
              <button
                type="button"
                onClick={() => {
                  haptic.selection();
                  setArtistaFiltro("");
                  setArtistaDropdownAberto(false);
                }}
                className={`w-full text-left px-3.5 py-2.5 text-xs font-bold hover:bg-white/5 transition ${
                  !artistaFiltro ? "text-primary" : "text-white"
                }`}
              >
                Todos os artistas
              </button>
              {artistasDisponiveis
                .filter((nome) => nome.toLowerCase().includes(buscaArtistaFiltro.trim().toLowerCase()))
                .map((nome) => (
                  <button
                    type="button"
                    key={nome}
                    onClick={() => {
                      haptic.selection();
                      setArtistaFiltro(nome);
                      setArtistaDropdownAberto(false);
                    }}
                    className={`w-full text-left px-3.5 py-2.5 text-xs font-bold hover:bg-white/5 transition border-t border-white/5 ${
                      artistaFiltro === nome ? "text-primary" : "text-white"
                    }`}
                  >
                    {nome}
                  </button>
                ))}
            </div>
          )}
        </div>
      )}

      {view === "destaques" && (
        <div className="space-y-6">
          <div className="space-y-3">
            <MetacriticSectionHeader>Top 3 Música</MetacriticSectionHeader>
            <TrioGrid itens={top3Musica} />
          </div>
          <div className="space-y-3">
            <MetacriticSectionHeader>Top 3 Álbum</MetacriticSectionHeader>
            <TrioGrid itens={top3Album} />
          </div>
          <div className="space-y-3">
            <MetacriticSectionHeader>Top 3 Recentes · Música</MetacriticSectionHeader>
            <p className="text-[10px] text-muted-foreground -mt-2 px-1">Lançamentos dos últimos 6 meses</p>
            <TrioGrid itens={top3RecentesMusica} />
          </div>
          <div className="space-y-3">
            <MetacriticSectionHeader>Top 3 Recentes · Álbum</MetacriticSectionHeader>
            <p className="text-[10px] text-muted-foreground -mt-2 px-1">Lançamentos dos últimos 6 meses</p>
            <TrioGrid itens={top3RecentesAlbum} />
          </div>
        </div>
      )}

      {view === "ranking" && (
        <div className="space-y-3">
          {/* Toggle Música/Álbum — os dois nunca aparecem misturados no
              ranking geral (pedido do usuário). */}
          <div className="flex gap-2">
            {(["musicas", "albuns"] as const).map((t) => (
              <button
                key={t}
                onClick={() => {
                  haptic.selection();
                  setRankingTipo(t);
                }}
                className={`flex-1 py-2 rounded-xl font-black text-[11px] uppercase transition-all active:scale-95 ${
                  rankingTipo === t
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground border border-white/10 bg-white/[0.03]"
                }`}
              >
                {t === "musicas" ? "Música" : "Álbum"}
              </button>
            ))}
          </div>
          <div className="grid gap-2">
          {porNota.map((item, idx) => (
            <Link
              key={item.id}
              to="/empire-play/forum"
              search={{ tab: item.tipo, id: item.id }}
              onClick={() => haptic.selection()}
              className={`${card} p-3.5 flex items-center gap-3 active:scale-95`}
            >
              <span
                className={`w-7 shrink-0 text-center text-sm font-black ${
                  idx === 0
                    ? "text-amber-400"
                    : idx === 1
                      ? "text-slate-300"
                      : idx === 2
                        ? "text-amber-700"
                        : "text-muted-foreground"
                }`}
              >
                {idx + 1}
              </span>
              <div className="size-11 shrink-0 rounded-xl overflow-hidden bg-secondary">
                {item.capaUrl && (
                  <img
                    src={resolveImg(item.capaUrl)}
                    className="w-full h-full object-cover"
                    referrerPolicy="no-referrer"
                    loading="lazy"
                  />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-[9px] font-black uppercase tracking-wide text-primary px-1.5 py-0.5 rounded bg-primary/15 shrink-0">
                    {item.tipo === "albuns" ? "Álbum" : "Música"}
                  </span>
                  <p className="text-sm font-bold leading-snug truncate">{item.titulo}</p>
                </div>
                <p className="text-[10px] text-muted-foreground font-medium truncate">{item.artista}</p>
              </div>
              <span
                className={`shrink-0 min-w-[2rem] h-8 px-1.5 rounded-lg grid place-items-center text-black text-sm font-black leading-none ${metacriticScoreColor(item.nota)}`}
              >
                {item.nota.toFixed(0)}
              </span>
            </Link>
          ))}
          </div>
        </div>
      )}

      {view === "recentes" && (
        <div className="space-y-3">
          {porData.length === 0 ? (
            <EmptyState text="Nenhum item com data de lançamento cadastrada ainda." />
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {porData.map((item) => (
                <MetacriticGridCard key={item.id} item={item} />
              ))}
            </div>
          )}
        </div>
      )}

      {view === "estilo" && (
        <div className="space-y-6">
          {estilosOrdenados.map(([estilo, itens]) => (
            <div key={estilo} className="space-y-3">
              <MetacriticSectionHeader>{estilo}</MetacriticSectionHeader>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {itens.map((item) => (
                  <MetacriticGridCard key={item.id} item={item} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {view === "ano" && (
        <div className="space-y-6">
          {anosOrdenados.map(([ano, itens]) => (
            <div key={ano} className="space-y-3">
              <MetacriticSectionHeader>{ano}</MetacriticSectionHeader>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {itens.map((item) => (
                  <MetacriticGridCard key={item.id} item={item} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {view === "artistas" && (
        <div className="space-y-2">
          <p className="text-[10px] text-muted-foreground font-medium px-1">
            Média de todas as notas recebidas (música + álbum). Toque num artista pra ver só os materiais dele no Ranking.
          </p>
          {artistasRankeados.map(({ nome, fotoUrl, media, total }, idx) => (
            <button
              key={nome}
              onClick={() => {
                haptic.selection();
                setArtistaFiltro(nome);
                setView("ranking");
              }}
              className={`${card} w-full p-3.5 flex items-center gap-3 text-left active:scale-95`}
            >
              <span
                className={`w-7 shrink-0 text-center text-sm font-black ${
                  idx === 0
                    ? "text-amber-400"
                    : idx === 1
                      ? "text-slate-300"
                      : idx === 2
                        ? "text-amber-700"
                        : "text-muted-foreground"
                }`}
              >
                {idx + 1}
              </span>
              <div className="size-11 shrink-0 rounded-full overflow-hidden bg-secondary">
                {fotoUrl && (
                  <img
                    src={driveImg(fotoUrl, 150)}
                    className="w-full h-full object-cover"
                    referrerPolicy="no-referrer"
                    loading="lazy"
                  />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold leading-snug truncate">{nome}</p>
                <p className="text-[10px] text-muted-foreground font-medium">
                  {total} material{total === 1 ? "" : "is"} avaliado{total === 1 ? "" : "s"}
                </p>
              </div>
              <span
                className={`shrink-0 min-w-[2rem] h-8 px-1.5 rounded-lg grid place-items-center text-black text-sm font-black leading-none ${metacriticScoreColor(media)}`}
              >
                {media.toFixed(0)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Abre em duas etapas, igual o CodePen de referência (grid → detalhe com
// capa grande + botão "play" → só aí o conteúdo de verdade): capa expande
// (layoutId compartilhado com o card do grid) numa hero com título/artista
// por cima e um botão "Ler revista"; ao tocar nele entra no leitor
// página-a-página.
function RevistaViewer({ revista, onClose }: { revista: Revista; onClose: () => void }) {
  const [lendo, setLendo] = useState(false);
  const [page, setPage] = useState(0);
  const total = revista.paginas.length;

  return (
    <motion.div
      layoutId={`revista-card-${revista.id}`}
      className="fixed inset-0 z-[100] bg-black flex flex-col overflow-hidden"
    >
      <button
        onClick={lendo ? () => setLendo(false) : onClose}
        className="absolute top-4 right-4 z-20 size-9 rounded-full bg-black/50 border border-white/10 grid place-items-center active:scale-90"
      >
        <X className="size-4 text-white" />
      </button>

      {!lendo ? (
        <>
          <motion.div layoutId={`revista-cover-${revista.id}`} className="relative flex-1 bg-secondary">
            {revista.capa && (
              <img src={resolveImg(revista.capa)} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent" />
            {/* selo editorial no topo — mesma linguagem "número da edição" de capa de revista */}
            <div className="absolute top-4 left-4 px-3 py-1 rounded-full bg-black/50 border border-white/10 backdrop-blur-md">
              <span className="text-[9px] font-black uppercase tracking-[0.2em] text-white/70">Edição Empire</span>
            </div>
          </motion.div>
          <motion.div
            initial="hidden"
            animate="visible"
            className="absolute inset-x-0 bottom-0 p-6 max-w-xl mx-auto sm:pb-10"
          >
            {[
              <p key="a" className="text-[11px] font-black uppercase text-primary tracking-[0.2em]">{revista.artista}</p>,
              <h2 key="b" className="text-3xl sm:text-4xl font-black leading-[0.95] tracking-tight text-white mb-1.5">{revista.titulo}</h2>,
              <p key="c" className="text-xs text-white/60 font-medium mb-5">
                {total} páginas{revista.musicas?.length ? ` · Sobre: ${revista.musicas.join(", ")}` : ""}
              </p>,
              <button
                key="d"
                onClick={() => {
                  haptic.light();
                  setLendo(true);
                  setPage(0);
                }}
                className="inline-flex items-center gap-2 px-5 py-3 rounded-full bg-gradient-to-r from-primary to-fuchsia-600 text-primary-foreground text-xs font-black uppercase tracking-wide shadow-lg active:scale-95 transition-transform"
              >
                <BookOpenText className="size-4" /> Ler revista
              </button>,
            ].map((el, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: STAGGER_DELAYS[i] + 0.1, duration: 0.4 }}
              >
                {el}
              </motion.div>
            ))}
          </motion.div>
        </>
      ) : (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex-1 flex flex-col overflow-hidden"
        >
          <div className="flex-1 relative overflow-hidden mx-auto w-full max-w-2xl">
            <img
              src={resolveImg(revista.paginas[page])}
              className="w-full h-full object-contain"
              referrerPolicy="no-referrer"
            />
            {page > 0 && (
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                className="absolute left-2 top-1/2 -translate-y-1/2 size-10 rounded-full bg-black/50 grid place-items-center active:scale-90"
              >
                <ChevronLeft className="size-5 text-white" />
              </button>
            )}
            {page < total - 1 && (
              <button
                onClick={() => setPage((p) => Math.min(total - 1, p + 1))}
                className="absolute right-2 top-1/2 -translate-y-1/2 size-10 rounded-full bg-black/50 grid place-items-center active:scale-90"
              >
                <ChevronRight className="size-5 text-white" />
              </button>
            )}
          </div>
          <div className="p-4 shrink-0 flex justify-center">
            <span className="px-4 py-1.5 rounded-full bg-white/[0.06] border border-white/10 backdrop-blur-md text-[11px] font-black uppercase tracking-widest text-white/80">
              Página <span className="text-primary">{page + 1}</span> / {total}
            </span>
          </div>
        </motion.div>
      )}
    </motion.div>
  );
}

function EntrevistaViewer({ entrevista, onClose }: { entrevista: Entrevista; onClose: () => void }) {
  const blocos = [
    <div key="head" className="min-w-0">
      <p className="text-[10px] font-black uppercase text-primary truncate">{entrevista.artista}</p>
      <h2 className="text-lg font-black leading-tight">{entrevista.titulo}</h2>
      {entrevista.musicas?.length ? (
        <p className="text-[10px] text-muted-foreground font-medium mt-1">Sobre: {entrevista.musicas.join(", ")}</p>
      ) : null}
    </div>,
    ...entrevista.perguntas.map((p, i) => (
      <div key={`p-${i}`}>
        <p className="text-sm font-black text-primary mb-1">{p.pergunta}</p>
        <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-line">{p.resposta}</p>
      </div>
    )),
  ];

  return (
    <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-6">
      <motion.div
        layoutId={`entrevista-card-${entrevista.id}`}
        className="bg-card border-t sm:border border-white/10 rounded-t-[1.75rem] sm:rounded-[1.75rem] max-w-lg w-full max-h-[90dvh] overflow-y-auto"
      >
        {entrevista.capa && (
          <motion.img
            layoutId={`entrevista-cover-${entrevista.id}`}
            src={resolveImg(entrevista.capa)}
            className="w-full aspect-video object-cover"
            referrerPolicy="no-referrer"
          />
        )}
        <div className="p-6">
          <div className="flex justify-between items-start mb-4 gap-3">
            {blocos[0]}
            <button onClick={onClose} className="size-9 shrink-0 rounded-full bg-white/5 border border-white/10 grid place-items-center active:scale-90">
              <X className="size-4" />
            </button>
          </div>
          <div className="space-y-5">
            {blocos.slice(1).map((el, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.1 + Math.min(i, 3) * 0.08, duration: 0.4 }}
              >
                {el}
              </motion.div>
            ))}
          </div>
        </div>
      </motion.div>
    </div>
  );
}

function CreateModal({
  tab,
  myArtists,
  inputCls,
  tgId,
  onClose,
  onCreated,
}: {
  tab: "revistas" | "entrevistas";
  myArtists: any[];
  inputCls: string;
  tgId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [artista, setArtista] = useState(myArtists[0]?.nome || "");
  const [titulo, setTitulo] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Revista: páginas (a primeira também vira a capa da listagem)
  const [paginas, setPaginas] = useState<string[]>([]);
  const [uploadingPagina, setUploadingPagina] = useState(false);

  // Entrevista: capa opcional + perguntas/respostas
  const [capa, setCapa] = useState("");
  const [uploadingCapa, setUploadingCapa] = useState(false);
  const [perguntas, setPerguntas] = useState<Pergunta[]>([{ pergunta: "", resposta: "" }]);

  // Toda publicação (revista ou entrevista) precisa estar vinculada a pelo
  // menos 1 música do chart do artista — vira registro em REGISTRO ao
  // publicar. Mesma fonte já usada em Editar Lançamentos (aba Pontos).
  const [musicasChart, setMusicasChart] = useState<{ label: string; artist: string }[]>([]);
  const [loadingMusicas, setLoadingMusicas] = useState(true);
  const [musicasSelecionadas, setMusicasSelecionadas] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch("/api/gestao/musicas-em-chart")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.success && Array.isArray(data.data)) setMusicasChart(data.data);
      })
      .catch(() => {})
      .finally(() => setLoadingMusicas(false));
  }, []);

  const musicasDoArtista = musicasChart.filter(
    (m) => m.artist.trim().toLowerCase() === artista.trim().toLowerCase(),
  );

  // Troca de artista invalida a seleção anterior (era de outro artista).
  useEffect(() => {
    setMusicasSelecionadas(new Set());
  }, [artista]);

  function toggleMusica(label: string) {
    setMusicasSelecionadas((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }

  async function handleSubmit() {
    if (!artista || !titulo.trim() || submitting) return;
    setErrorMsg(null);

    if (musicasSelecionadas.size === 0) {
      setErrorMsg("Selecione ao menos 1 música do chart pra essa publicação.");
      return;
    }
    const musicas = Array.from(musicasSelecionadas);

    if (tab === "revistas") {
      if (paginas.length === 0) {
        setErrorMsg("Envie pelo menos 1 página.");
        return;
      }
      setSubmitting(true);
      const res = await api.criarRevistaAcervo({ artista, titulo: titulo.trim(), paginas, musicas }, tgId);
      setSubmitting(false);
      if (res.ok) {
        haptic.success();
        onCreated();
      } else {
        setErrorMsg(res.error || "Erro ao publicar a revista.");
      }
      return;
    }

    const perguntasValidas = perguntas.filter((p) => p.pergunta.trim() && p.resposta.trim());
    if (perguntasValidas.length === 0) {
      setErrorMsg("Preencha pelo menos 1 pergunta e resposta.");
      return;
    }
    setSubmitting(true);
    const res = await api.criarEntrevistaAcervo(
      { artista, titulo: titulo.trim(), capa, perguntas: perguntasValidas, musicas },
      tgId,
    );
    setSubmitting(false);
    if (res.ok) {
      haptic.success();
      onCreated();
    } else {
      setErrorMsg(res.error || "Erro ao publicar a entrevista.");
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-6 bg-black/70 backdrop-blur-sm">
      <div className="bg-card border-t sm:border border-white/10 rounded-t-[1.75rem] sm:rounded-[1.75rem] p-5 sm:p-6 max-w-md w-full shadow-2xl max-h-[90dvh] overflow-y-auto">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-black uppercase">
            Nova {tab === "revistas" ? "revista" : "entrevista"}
          </h2>
          <button onClick={onClose} className="size-9 shrink-0 rounded-full bg-white/5 border border-white/10 grid place-items-center active:scale-90">
            <X className="size-4" />
          </button>
        </div>

        <div className="grid gap-4">
          <div className="space-y-1.5">
            <p className="text-[10px] font-black uppercase text-muted-foreground">Artista</p>
            {myArtists.length > 0 ? (
              <select value={artista} onChange={(e) => setArtista(e.target.value)} className={inputCls}>
                {myArtists.map((a) => (
                  <option key={a.nome} value={a.nome}>
                    {a.nome}
                  </option>
                ))}
              </select>
            ) : (
              <p className="text-xs text-muted-foreground">Você precisa ter um artista pra publicar.</p>
            )}
          </div>

          <div className="space-y-1.5">
            <p className="text-[10px] font-black uppercase text-muted-foreground">
              Sobre qual música (ou músicas) do chart?
            </p>
            <p className="text-[10px] text-muted-foreground/70 font-medium -mt-1 mb-1">
              Obrigatório — vira registro no chart pra cada música marcada.
            </p>
            {loadingMusicas ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                <Loader2 className="size-3.5 animate-spin" /> Carregando músicas do chart...
              </div>
            ) : musicasDoArtista.length === 0 ? (
              <p className="text-xs text-muted-foreground italic py-2">
                Nenhuma música de {artista || "seu artista"} no chart ainda.
              </p>
            ) : (
              <div className="max-h-40 overflow-y-auto rounded-2xl border border-white/10 bg-white/5 divide-y divide-white/5">
                {musicasDoArtista.map((m) => {
                  const checked = musicasSelecionadas.has(m.label);
                  return (
                    <label
                      key={m.label}
                      className="flex items-center gap-2.5 px-3.5 py-2.5 cursor-pointer active:bg-white/5"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleMusica(m.label)}
                        className="size-4 accent-primary shrink-0"
                      />
                      <span className="text-sm font-medium truncate">{m.label}</span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <p className="text-[10px] font-black uppercase text-muted-foreground">Título</p>
            <input value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Título da edição" className={inputCls} />
          </div>

          {tab === "revistas" ? (
            <div className="space-y-1.5">
              <p className="text-[10px] font-black uppercase text-muted-foreground">
                Páginas ({paginas.length})
              </p>
              {paginas.length > 0 && (
                <div className="grid grid-cols-4 gap-2">
                  {paginas.map((url, i) => (
                    <div key={i} className="relative aspect-[3/4] rounded-lg overflow-hidden bg-secondary">
                      <img src={resolveImg(url)} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                      <button
                        onClick={() => setPaginas((prev) => prev.filter((_, idx) => idx !== i))}
                        className="absolute top-1 right-1 size-5 rounded-full bg-black/70 grid place-items-center"
                      >
                        <X className="size-3 text-white" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <label
                className={
                  inputCls +
                  " flex items-center justify-center gap-2 cursor-pointer text-center " +
                  (uploadingPagina ? "opacity-60 pointer-events-none" : "")
                }
              >
                <ImageIcon className="size-4" />
                {uploadingPagina ? "Enviando..." : "Adicionar página"}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    setUploadingPagina(true);
                    const url = await uploadToDrive(file);
                    if (url) setPaginas((prev) => [...prev, url]);
                    setUploadingPagina(false);
                  }}
                />
              </label>
            </div>
          ) : (
            <>
              <div className="space-y-1.5">
                <p className="text-[10px] font-black uppercase text-muted-foreground">Capa (opcional)</p>
                {capa && (
                  <div className="w-full aspect-video rounded-xl overflow-hidden bg-secondary">
                    <img src={resolveImg(capa)} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                  </div>
                )}
                <label
                  className={
                    inputCls +
                    " flex items-center justify-center gap-2 cursor-pointer text-center " +
                    (uploadingCapa ? "opacity-60 pointer-events-none" : "")
                  }
                >
                  <ImageIcon className="size-4" />
                  {uploadingCapa ? "Enviando..." : capa ? "Trocar capa" : "Selecionar capa"}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      setUploadingCapa(true);
                      const url = await uploadToDrive(file);
                      if (url) setCapa(url);
                      setUploadingCapa(false);
                    }}
                  />
                </label>
              </div>

              <div className="space-y-3">
                <p className="text-[10px] font-black uppercase text-muted-foreground">Perguntas e respostas</p>
                {perguntas.map((p, i) => (
                  <div key={i} className="space-y-2 p-3 rounded-2xl bg-white/5 border border-white/10">
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] font-black uppercase text-muted-foreground">#{i + 1}</p>
                      {perguntas.length > 1 && (
                        <button
                          onClick={() => setPerguntas((prev) => prev.filter((_, idx) => idx !== i))}
                          className="text-muted-foreground active:scale-90"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      )}
                    </div>
                    <input
                      value={p.pergunta}
                      onChange={(e) =>
                        setPerguntas((prev) => prev.map((x, idx) => (idx === i ? { ...x, pergunta: e.target.value } : x)))
                      }
                      placeholder="Pergunta"
                      className={inputCls}
                    />
                    <textarea
                      value={p.resposta}
                      onChange={(e) =>
                        setPerguntas((prev) => prev.map((x, idx) => (idx === i ? { ...x, resposta: e.target.value } : x)))
                      }
                      placeholder="Resposta"
                      className={inputCls + " h-20 resize-none"}
                    />
                  </div>
                ))}
                <button
                  onClick={() => setPerguntas((prev) => [...prev, { pergunta: "", resposta: "" }])}
                  className="w-full py-3 rounded-2xl border border-dashed border-white/15 text-xs font-black uppercase text-muted-foreground active:scale-95"
                >
                  + Adicionar pergunta
                </button>
              </div>
            </>
          )}

          {errorMsg && <p className="text-xs font-bold text-red-400">{errorMsg}</p>}

          <button
            onClick={handleSubmit}
            disabled={submitting || !artista || !titulo.trim() || musicasSelecionadas.size === 0}
            className="mt-2 p-4 min-h-14 bg-primary text-primary-foreground rounded-2xl font-black uppercase tracking-wide flex items-center justify-center gap-3 active:scale-95 transition-transform disabled:opacity-50"
          >
            {submitting ? "Publicando..." : "Publicar"}
          </button>
        </div>
      </div>
    </div>
  );
}
