import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Mic2,
  Film,
  Disc3,
  Wallet,
  Trophy,
  Briefcase,
  X,
  Loader2,
  Building2,
  FileX,
  FileText,
  TrendingUp,
  Lock,
  User,
  Music,
  Video,
  Users2,
  Instagram,
  Star,
  Sparkles,
  Play,
  Image as ImageIcon,
} from "lucide-react";
import { useTelegramUser } from "@/lib/telegram";
import { api, fmtEC, fmtMoney, driveImg, type Artist, type AlbumPayload, type Projeto, type NivelJogador } from "@/lib/api";
import { getHOFProfile, type HOFProfile } from "@/lib/charts";
import { notify } from "@/lib/notify";
import { useEmpirePlayer } from "@/components/EmpirePlay/PlayerContext";
import { toPlayableTrack, toPlayableVideo } from "@/components/EmpirePlay/mappers";
import { renderRichText } from "@/lib/richText";
import { RichTextToolbar } from "@/components/EmpirePlay/RichTextToolbar";

export const Route = createFileRoute("/artistas/$nome/")({
  component: ArtistDashboard,
});

type TabId = "geral" | "discografia" | "musicas" | "videos" | "charts" | "tours" | "social" | "gestao";

// Um único item de discografia, seja qual for a fonte (álbum próprio via
// Gestao, publicado no catálogo Empire Play, ou legado/antigo) — mostrados
// juntos, sem separação por origem, e contados como um só total.
interface DiscoItem {
  key: string;
  titulo: string;
  capa_url?: string;
  kind: "catalogo" | "legado";
  id: string;
  // ISO (yyyy-mm-dd) quando dá pra resolver a data de lançamento — usado só
  // pra ordenar a lista (mais recente primeiro). Ausente quando o dado de
  // origem não tem data confiável.
  dataIso?: string;
}

// Aceita tanto "dd/mm/yyyy" (álbuns antigos/legados) quanto um ISO já pronto
// (yyyy-mm-dd, vindo de /api/empire-play/albuns) — devolve sempre ISO pra
// comparação direta por string.
function paraDataIso(value: string | undefined | null): string | undefined {
  if (!value) return undefined;
  const v = value.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  const m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const [, d, mo, y] = m;
    return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  return undefined;
}

function ArtistDashboard() {
  const { nome } = Route.useParams();
  const { user, ready } = useTelegramUser();
  const [artist, setArtist] = useState<Artist | null>(null);
  const [isOwner, setIsOwner] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabId>("geral");
  const [modal, setModal] = useState<null | "rescisao" | "foto" | "biografia" | "capa">(null);
  const [discografia, setDiscografia] = useState<DiscoItem[]>([]);
  const [tourData, setTourData] = useState<any>(null);
  const [responsavelNivel, setResponsavelNivel] = useState<NivelJogador | null>(null);
  // Capa (banner) do topo do perfil — separada da foto do artista, editável
  // só pelo dono (ver CapaModal). Cai pra artist.foto quando nenhuma das
  // duas foi definida, pra não ficar sem imagem nenhuma no header. Duas
  // versões porque a área do topo é bem mais larga (~banner) no desktop do
  // que no celular — uma imagem só ficava cortada/esticada numa das duas.
  const [capaPerfilDesktop, setCapaPerfilDesktop] = useState<string>("");
  const [capaPerfilMobile, setCapaPerfilMobile] = useState<string>("");

  // Discografia unificada — junta álbuns próprios (Gestao), catálogo Empire
  // Play e álbuns legados numa lista só, deduplicada por título, pra contar
  // e exibir tudo junto sem separação de origem.
  useEffect(() => {
    let alive = true;
    const normNome = decodeURIComponent(nome || "").trim().toLowerCase();
    const chave = (t: string) => t.trim().toLowerCase();

    Promise.all([
      fetch(`/api/empire-play/albuns`).then((r) => r.json()).catch(() => null),
      api.listarAlbunsAntigos().catch(() => []),
    ]).then(([catalogoRes, legados]) => {
      if (!alive) return;
      const catalogo = Array.isArray(catalogoRes?.data) ? catalogoRes.data : [];
      const catalogoDoArtista = catalogo.filter(
        (a: any) => (a.artist || a.artista || "").trim().toLowerCase() === normNome,
      );
      const legadosDoArtista = legados.filter((a) => a.artista.trim().toLowerCase() === normNome);

      const vistos = new Set<string>();
      const items: DiscoItem[] = [];

      for (const a of catalogoDoArtista) {
        const titulo = a.title || a.titulo || "";
        const k = chave(titulo);
        if (!titulo || vistos.has(k)) continue;
        vistos.add(k);
        items.push({
          key: `c-${a.id}`,
          titulo,
          capa_url: a.coverUrl || a.cover || a.capa_url || a.capa_do_album || a.capa,
          kind: "catalogo",
          id: a.id,
          dataIso: paraDataIso(a.releaseDateIso || a.releaseDate),
        });
      }
      for (const a of legadosDoArtista) {
        const k = chave(a.titulo);
        if (vistos.has(k)) continue;
        vistos.add(k);
        items.push({
          key: `l-${a.id}`,
          titulo: a.titulo,
          capa_url: a.capa_url,
          kind: "legado",
          id: a.id,
          dataIso: paraDataIso(a.data),
        });
      }
      // Antes ficava na ordem crua de chegada (catálogo inteiro, depois
      // todos os legados no final, sem meio-termo) — agora tudo entra numa
      // única ordem por data de lançamento, mais recente primeiro; sem data
      // confiável vai pro final, na ordem em que chegou.
      items.sort((a, b) => {
        if (a.dataIso && b.dataIso) return b.dataIso.localeCompare(a.dataIso);
        if (a.dataIso) return -1;
        if (b.dataIso) return 1;
        return 0;
      });
      setDiscografia(items);
    });
    return () => {
      alive = false;
    };
  }, [nome]);

  useEffect(() => {
    if (!ready) return;
    setLoading(true);

    const safeNome = decodeURIComponent(nome || "")
      .trim()
      .toLowerCase();

    Promise.all([
      // Carrega TODOS os artistas para permitir visualizar qualquer perfil
      api.listarTodos().catch(() => []),
      api.listTours(safeNome).catch(() => []),
      // Carrega artistas do usuário para verificar propriedade
      user && user.id !== "guest" ? api.meusArtistas(user.id).catch(() => []) : Promise.resolve([]),
    ]).then(([allArtists, toursList, myArtists]) => {
      // Encontra o artista na lista completa
      const art = (allArtists as Artist[]).find((a) => a.nome?.trim().toLowerCase() === safeNome) || null;
      setArtist(art);

      // Verifica se o artista pertence ao usuário logado
      const mine = (myArtists as Artist[]).some((a) => a.nome?.trim().toLowerCase() === safeNome);
      setIsOwner(mine);

      // Nível/prestígio fica associado ao jogador responsável, não ao
      // artista — busca o nível de quem é dono, se tiver telegram_id salvo.
      if (art?.telegram_id) {
        api.meuNivel({ telegramId: art.telegram_id }).then(setResponsavelNivel).catch(() => setResponsavelNivel(null));
      }

      // Busca dados de turnê
      const tList = (toursList as any[]).find((t) => t.artista?.trim().toLowerCase() === safeNome);
      if (tList) {
        setTourData({
          titulo: tList.titulo || "The Empire Tour",
          realizados: Number(tList.show_atual || 0),
          total: Number(tList.total_shows || 0),
          status: tList.status || "Em andamento",
        });
      } else if (art && art.tour_info) {
        let info: any = art.tour_info;
        if (typeof info === "string") {
          try {
            info = JSON.parse(
              info
                .trim()
                .replace(/^"+|"+$/g, "")
                .replace(/\\"/g, '"'),
            );
          } catch {
            info = {};
          }
        }
        if (info.titulo) {
          setTourData({
            titulo: info.titulo,
            realizados: Number(info.shows_realizados || info.realizados || 0),
            total: Number(info.qtd || info.shows || 0),
            status: info.status || "Em andamento",
          });
        }
      }

      setLoading(false);

      if (art?.nome) {
        api.getArtistInfo(art.nome).then((info) => {
          if (info?.capa) setCapaPerfilDesktop(info.capa);
          if (info?.capaMobile) setCapaPerfilMobile(info.capaMobile);
        });
      }
    });
  }, [ready, user, nome]);

  const TABS = useMemo(() => {
    const base: { id: TabId; label: string }[] = [
      { id: "geral", label: "Visão Geral" },
      { id: "discografia", label: "Discografia" },
      { id: "musicas", label: "Músicas" },
      { id: "videos", label: "Vídeos" },
      { id: "charts", label: "Charts" },
      { id: "tours", label: "Turnês & Projetos" },
      { id: "social", label: "Social" },
    ];
    if (isOwner) {
      base.push({ id: "gestao", label: "Gestão" });
    }
    return base;
  }, [isOwner]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-[80vh]">
        <Loader2 className="size-10 animate-spin text-primary" />
        <p className="mt-4 text-[10px] font-black uppercase tracking-widest text-muted-foreground">
          Sincronizando Artista...
        </p>
      </div>
    );
  }

  if (!artist) {
    return (
      <main className="flex-1 mx-auto w-full max-w-2xl px-4 pt-6">
        <button
          onClick={() => window.history.back()}
          className="inline-flex items-center gap-1 text-muted-foreground mb-4"
        >
          <ChevronLeft className="size-4" /> Voltar
        </button>
        <div className="py-20 text-center">
          <FileX className="size-12 text-muted-foreground/20 mx-auto mb-4" />
          <p className="font-black uppercase italic tracking-tighter">Artista não encontrado no império.</p>
        </div>
      </main>
    );
  }

  return (
    // Sem isso, em telas largas de desktop o perfil ocupava a largura toda
    // da viewport (sem o max-w-5xl mx-auto que o resto do app usa, ex.
    // empire-play.tsx) — tudo esticado além da resolução buscada, deixando
    // header, avatar e capas de álbum borrados mesmo com driveImg já
    // pedindo alta resolução.
    <main className="flex-1 pb-24 bg-background max-w-5xl mx-auto">
      {/* Visual Header */}
      <div className="relative h-[30vh] min-h-[240px] overflow-hidden">
        {capaPerfilDesktop || capaPerfilMobile ? (
          <>
            {/* Capa própria do artista — técnica de "letterbox" (igual
                Spotify/Apple Music no artwork): fundo desfocado da própria
                imagem preenche a área toda, e a imagem inteira aparece por
                cima sem cortar nada. Sem isso, um object-cover puro cortava
                a composição inteira quando a imagem enviada não batia
                exatamente com a proporção (bem mais larga que alta) da
                área do topo — cortava até o motivo principal da arte. */}
            <img
              aria-hidden
              loading="lazy"
              decoding="async"
              referrerPolicy="no-referrer"
              src={driveImg(capaPerfilDesktop || capaPerfilMobile, 800) || capaPerfilDesktop || capaPerfilMobile}
              className="hidden sm:block absolute inset-0 w-full h-full object-cover scale-110 blur-2xl opacity-70"
              alt=""
            />
            <img
              loading="lazy"
              decoding="async"
              referrerPolicy="no-referrer"
              src={driveImg(capaPerfilDesktop || capaPerfilMobile, 1600) || capaPerfilDesktop || capaPerfilMobile}
              className="hidden sm:block relative w-full h-full object-contain"
              alt=""
            />
            <img
              aria-hidden
              loading="lazy"
              decoding="async"
              referrerPolicy="no-referrer"
              src={driveImg(capaPerfilMobile || capaPerfilDesktop, 800) || capaPerfilMobile || capaPerfilDesktop}
              className="sm:hidden absolute inset-0 w-full h-full object-cover scale-110 blur-2xl opacity-70"
              alt=""
            />
            <img
              loading="lazy"
              decoding="async"
              referrerPolicy="no-referrer"
              src={driveImg(capaPerfilMobile || capaPerfilDesktop, 1200) || capaPerfilMobile || capaPerfilDesktop}
              className="sm:hidden relative w-full h-full object-contain"
              alt=""
            />
            {/* Faixa escura só embaixo, o suficiente pra manter nome/badges
                legíveis por cima de qualquer imagem — sem escurecer a capa
                inteira como no fallback com a foto do artista. */}
            <div className="absolute inset-x-0 bottom-0 h-[45%] bg-gradient-to-t from-background to-transparent" />
          </>
        ) : (
          <>
            <img
              loading="lazy"
              decoding="async"
              referrerPolicy="no-referrer"
              src={driveImg(artist.foto, 1600) || artist.foto}
              onError={(e) => {
                const img = e.currentTarget;
                if (img.src !== artist.foto) img.src = artist.foto;
              }}
              className="w-full h-full object-cover object-top scale-105 opacity-60 transition-opacity duration-700"
              alt=""
            />
            <div className="absolute inset-0 bg-gradient-to-t from-background via-background/60 to-transparent" />
          </>
        )}
        {isOwner && (
          <button
            onClick={() => setModal("capa")}
            className="absolute top-6 right-6 z-30 size-12 rounded-2xl bg-black/40 backdrop-blur-xl border border-white/10 flex items-center justify-center shadow-2xl active:scale-90 transition-transform"
            title="Trocar capa do perfil"
          >
            <ImageIcon className="size-5 text-white" />
          </button>
        )}

        <button
          onClick={() => window.history.back()}
          className="absolute top-6 left-6 z-30 size-12 rounded-2xl bg-black/40 backdrop-blur-xl border border-white/10 flex items-center justify-center shadow-2xl active:scale-90 transition-transform"
        >
          <ChevronLeft className="size-6 text-white" />
        </button>

        {/* Badge: artista de outro jogador */}
        {!isOwner && (
          <div className="absolute top-6 right-6 z-30 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-black/50 backdrop-blur-xl border border-white/10">
            <Lock className="size-3 text-white/50" />
            <span className="text-[10px] font-black uppercase tracking-widest text-white/50">Visualização</span>
          </div>
        )}

        {/* Info Overlay */}
        <div className="absolute inset-x-6 bottom-6 z-20">
          <div className="flex items-end gap-4">
            <div className="size-24 rounded-[2rem] overflow-hidden border-2 border-primary/30 shadow-2xl shrink-0 bg-secondary">
              <img
                loading="lazy"
                decoding="async"
                referrerPolicy="no-referrer"
                src={driveImg(artist.foto, 400) || artist.foto}
                onError={(e) => {
                  const img = e.currentTarget;
                  if (img.src !== artist.foto) img.src = artist.foto;
                }}
                className="w-full h-full object-cover object-top"
                alt={artist.nome}
              />
            </div>
            <div className="flex-1 min-w-0 pb-1">
              <div className="flex items-center gap-2 mb-1">
                <span className="px-1.5 py-0.5 rounded-full bg-primary/20 text-primary text-[10px] font-black uppercase tracking-widest border border-primary/20 leading-none">
                  {artist.gravadora}
                </span>
                {artist.genero &&
                  !/GMT|\d{4}.*\d{2}:\d{2}|^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)/i.test(String(artist.genero)) && (
                    <span className="text-[11px] font-black text-white/50 uppercase tracking-widest italic">
                      {artist.genero}
                    </span>
                  )}
              </div>
              <h1 className="text-xl sm:text-2xl font-black italic uppercase tracking-tighter leading-tight mb-1 drop-shadow-xl break-words">
                {artist.nome}
              </h1>
              <div className="flex items-center gap-2">
                <div
                  className={`size-1.5 rounded-full ${
                    artist.status === "Livre" ? "bg-primary animate-pulse" : "bg-yellow-500"
                  }`}
                />
                <span className="text-[10px] font-black text-white/70 uppercase tracking-widest">{artist.status}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="px-6 space-y-6 relative z-20 -mt-2">
        {/* ── Core Stats: Fortuna + Fadiga (sem prestígio — isso é do jogador, ver card do Responsável) ── */}
        {/* Empire Coin (E$C) removido daqui por enquanto, a pedido do usuário. */}
        <div className="grid grid-cols-2 gap-2">
          {artist.fortuna_total !== null && (
            <StatCardV2
              label="Fortuna Total"
              value={fmtMoney(artist.fortuna_total)}
              icon={<Briefcase className="size-3.5" />}
            />
          )}
          {artist.fortuna_vendas !== null && (
            <StatCardV2
              label="Fortuna Vendas"
              value={fmtMoney(artist.fortuna_vendas)}
              icon={<Wallet className="size-3.5" />}
            />
          )}
          {artist.fortuna_turnes !== null && (
            <StatCardV2
              label="Fortuna Turnês"
              value={fmtMoney(artist.fortuna_turnes)}
              icon={<Building2 className="size-3.5" />}
            />
          )}
        </div>

        {/* ── Responsável: prestígio/nível do JOGADOR dono, não do artista ── */}
        {responsavelNivel?.nivelAtual && (
          <div className="p-4 rounded-[1.8rem] bg-white/5 backdrop-blur-md border border-white/10 flex items-center gap-4">
            <div className="size-11 rounded-xl bg-amber-500/15 text-amber-400 grid place-items-center shrink-0">
              <Trophy className="size-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/60">
                Responsável — Nível {responsavelNivel.nivelAtual.nivel}
              </div>
              <div className="text-sm font-black truncate">{responsavelNivel.nivelAtual.nome}</div>
            </div>
            <div className="text-xs font-black text-amber-400 shrink-0">{responsavelNivel.prestigioAtual} pts</div>
          </div>
        )}

        {/* ── Ações rápidas — apenas para o dono do artista ── */}
        {isOwner && (
          <div className="grid grid-cols-3 gap-3">
            <QuickAction icon={<Disc3 className="size-6 text-purple-400" />} label="Álbum" id="btn-album" to="/empire-play/gestao" params={{ tab: "album", nome: artist.nome }} />
            <QuickAction icon={<Mic2 className="size-6 text-emerald-400" />} label="Turnê" id="btn-tour" to="/tours" />
            <QuickAction icon={<Film className="size-6 text-blue-400" />} label="Cinema" id="btn-cinema" to="/acoes/cinema" params={{ nome: artist.nome }} />
          </div>
        )}

        {/* ── Abas do mega perfil ── */}
        <section>
          <div className="relative mb-6">
            <div className="flex gap-1 p-1 bg-card rounded-[1.5rem] border border-white/5 overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
              {TABS.map((t) => (
                <TabButton key={t.id} active={activeTab === t.id} onClick={() => setActiveTab(t.id)}>
                  {t.label}
                </TabButton>
              ))}
            </div>
            {/* Sinaliza que há mais abas pra rolar — sem isso não fica óbvio
                que existe mais conteúdo além do que já está visível. */}
            <div className="pointer-events-none absolute right-0 top-0 bottom-0 w-8 rounded-r-[1.5rem] bg-gradient-to-l from-card to-transparent" />
            <ChevronRight className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 size-4 text-muted-foreground/60" />
          </div>
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
            {activeTab === "geral" && <GeralTab artist={artist} discografia={discografia} tourData={tourData} />}
            {activeTab === "discografia" && (
              <DiscografiaTab nome={artist.nome} discografia={discografia} isOwner={isOwner} />
            )}
            {activeTab === "musicas" && <MusicasTab nome={artist.nome} />}
            {activeTab === "videos" && <VideosTab nome={artist.nome} />}
            {activeTab === "charts" && <ChartsTab nome={artist.nome} />}
            {activeTab === "tours" && <ToursProjetosTab nome={artist.nome} tourData={tourData} isOwner={isOwner} />}
            {activeTab === "social" && <SocialTab nome={artist.nome} />}
            {isOwner && activeTab === "gestao" && <GestaoTab onAction={setModal} />}
          </div>
        </section>
      </div>

      {isOwner && modal === "rescisao" && <RescisaoModal nome={artist.nome} onClose={() => setModal(null)} />}
      {isOwner && modal === "foto" && (
        <FotoModal nome={artist.nome} onClose={() => setModal(null)} onDone={() => window.location.reload()} />
      )}
      {isOwner && modal === "biografia" && (
        <BiografiaModal nome={artist.nome} onClose={() => setModal(null)} />
      )}
      {isOwner && modal === "capa" && (
        <CapaModal
          nome={artist.nome}
          onClose={() => setModal(null)}
          onDone={(urls) => {
            if (urls.capaUrl) setCapaPerfilDesktop(urls.capaUrl);
            if (urls.capaMobileUrl) setCapaPerfilMobile(urls.capaMobileUrl);
          }}
        />
      )}
    </main>
  );
}

// ---------- Aba: Visão Geral ----------
function GeralTab({ artist, discografia, tourData }: { artist: Artist; discografia: DiscoItem[]; tourData: any }) {
  const [hof, setHof] = useState<HOFProfile | null | undefined>(undefined);
  const [biografia, setBiografia] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getHOFProfile(artist.nome).then((d) => alive && setHof(d));
    api.getArtistInfo(artist.nome).then((info) => alive && setBiografia(info?.biografia || null));
    return () => { alive = false; };
  }, [artist.nome]);

  const n1Total = hof
    ? [hof.n1_hot100, hof.n1_spotify, hof.n1_youtube, hof.n1_bb200]
        .map((v) => Number(v) || 0)
        .reduce((a, b) => a + b, 0)
    : 0;

  return (
    <div className="space-y-4">
      {biografia && (
        <div className="p-4 rounded-2xl bg-white/[0.02] border border-white/5">
          <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap break-words">
            {renderRichText(biografia)}
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <MiniStat icon={<Disc3 className="size-4" />} label="Álbuns" value={String(discografia.length)} />
        <MiniStat icon={<Users2 className="size-4" />} label="Seguidores" value={String(artist.seguidores || 0)} />
      </div>

      {hof === undefined ? (
        <div className="h-16 rounded-2xl bg-card animate-pulse" />
      ) : hof && n1Total > 0 ? (
        <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center gap-3">
          <Trophy className="size-6 text-amber-400 shrink-0" />
          <div>
            <div className="text-sm font-black">{n1Total} #1{n1Total > 1 ? "s" : ""} no Hall of Fame</div>
            <div className="text-xs text-muted-foreground">Veja o detalhe na aba Charts</div>
          </div>
        </div>
      ) : null}

      {tourData ? (
        <div className="p-4 rounded-2xl bg-white/[0.02] border border-white/5">
          <div className="flex items-center gap-2 mb-1">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
            </span>
            <span className="text-[10px] font-black uppercase tracking-widest text-primary">Turnê em andamento</span>
          </div>
          <p className="text-sm font-bold">{tourData.titulo}</p>
          <p className="text-xs text-muted-foreground">{tourData.realizados}/{tourData.total} shows — {tourData.status}</p>
        </div>
      ) : null}
    </div>
  );
}

function MiniStat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="p-3 rounded-2xl bg-white/[0.02] border border-white/5 flex items-center gap-2.5">
      <div className="size-8 rounded-lg bg-white/5 text-muted-foreground grid place-items-center shrink-0">{icon}</div>
      <div className="min-w-0">
        <div className="text-sm font-black truncate">{value}</div>
        <div className="text-[9px] uppercase tracking-widest text-muted-foreground/60 truncate">{label}</div>
      </div>
    </div>
  );
}

// ---------- Aba: Discografia (só álbuns) ----------
function DiscografiaTab({
  nome,
  discografia,
  isOwner,
}: {
  nome: string;
  discografia: DiscoItem[];
  isOwner: boolean;
}) {
  return (
    <section>
      <div className="flex items-center justify-between mb-4 px-1">
        <h2 className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground">Discografia</h2>
        {isOwner && (
          <Link to="/empire-play/gestao" search={{ nome }} className="size-9 rounded-xl bg-primary/10 text-primary grid place-items-center active:scale-90 transition-transform">
            <Disc3 className="size-4" />
          </Link>
        )}
      </div>
      {discografia.length === 0 ? (
        <div className="p-8 rounded-[2.5rem] border border-dashed border-white/5 text-center">
          <p className="text-[10px] text-muted-foreground font-black uppercase tracking-widest italic opacity-40">Nenhum álbum registrado ainda</p>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-4">
          {discografia.map((a) => {
            const inner = (
              <>
                <div className="aspect-square rounded-[2rem] overflow-hidden bg-secondary shadow-lg border border-white/5 grid place-items-center">
                  {a.capa_url ? (
                    <img src={driveImg(a.capa_url, 300)} alt={a.titulo} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700" loading="lazy" decoding="async" referrerPolicy="no-referrer" />
                  ) : (
                    <Disc3 className="size-8 text-muted-foreground" />
                  )}
                </div>
                <p className="mt-2 text-[10px] font-black uppercase tracking-tight text-center truncate">{a.titulo}</p>
              </>
            );
            if (a.kind === "legado") {
              return (
                <Link key={a.key} to="/empire-play/albuns-antigos/$id" params={{ id: a.id }} className="group">
                  {inner}
                </Link>
              );
            }
            return (
              <Link key={a.key} to="/empire-play/forum" search={{ tab: "albuns", id: a.id }} className="group">
                {inner}
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}

// ---------- Aba: Músicas ----------
function MusicasTab({ nome }: { nome: string }) {
  const { playSong } = useEmpirePlayer();
  const [musicas, setMusicas] = useState<any[] | null>(null);

  useEffect(() => {
    let alive = true;
    setMusicas(null);
    fetch(`/api/empire-play/musicas?artist=${encodeURIComponent(nome)}`)
      .then((r) => r.json())
      .catch(() => null)
      .then((m) => alive && setMusicas(Array.isArray(m?.data) ? m.data : []));
    return () => { alive = false; };
  }, [nome]);

  return (
    <section>
      <h2 className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground mb-4 px-1 flex items-center gap-1.5">
        <Music className="size-3.5" /> Músicas no catálogo
      </h2>
      {musicas === null ? (
        <div className="h-14 rounded-2xl bg-card animate-pulse" />
      ) : musicas.length === 0 ? (
        <p className="text-[10px] text-muted-foreground italic px-1">Nenhuma música no catálogo ainda.</p>
      ) : (
        <div className="space-y-1.5">
          {musicas.map((m, i) => {
            const cover = driveImg(m.coverUrl);
            return (
              <button
                key={i}
                onClick={() => playSong(toPlayableTrack(m), musicas.map(toPlayableTrack))}
                className="w-full flex items-center gap-3 p-2.5 rounded-xl bg-white/[0.02] border border-white/5 hover:bg-white/[0.05] transition-colors text-left"
              >
                <div className="size-9 rounded-lg overflow-hidden bg-secondary shrink-0 grid place-items-center">
                  {cover ? <img src={cover} alt="" className="w-full h-full object-cover" loading="lazy" referrerPolicy="no-referrer" /> : <Music className="size-4 text-muted-foreground" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium break-words leading-tight">{m.title || m.titulo || "—"}</p>
                  {m.displayArtists && (
                    <p className="text-[11px] text-muted-foreground break-words mt-0.5">{m.displayArtists}</p>
                  )}
                </div>
                <Play className="size-3.5 text-muted-foreground shrink-0" />
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

// ---------- Aba: Vídeos ----------
function VideosTab({ nome }: { nome: string }) {
  const { playVideo } = useEmpirePlayer();
  const [videos, setVideos] = useState<any[] | null>(null);

  useEffect(() => {
    let alive = true;
    setVideos(null);
    fetch(`/api/empire-play/videos?artist=${encodeURIComponent(nome)}`)
      .then((r) => r.json())
      .catch(() => null)
      .then((v) => alive && setVideos(Array.isArray(v?.data) ? v.data : []));
    return () => { alive = false; };
  }, [nome]);

  return (
    <section>
      <h2 className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground mb-4 px-1 flex items-center gap-1.5">
        <Video className="size-3.5" /> Vídeos no catálogo
      </h2>
      {videos === null ? (
        <div className="h-14 rounded-2xl bg-card animate-pulse" />
      ) : videos.length === 0 ? (
        <p className="text-[10px] text-muted-foreground italic px-1">Nenhum vídeo no catálogo ainda.</p>
      ) : (
        <div className="space-y-1.5">
          {videos.map((v, i) => {
            const cover = driveImg(v.coverUrl);
            return (
              <button
                key={i}
                onClick={() => playVideo(toPlayableVideo(v))}
                className="w-full flex items-center gap-3 p-2.5 rounded-xl bg-white/[0.02] border border-white/5 hover:bg-white/[0.05] transition-colors text-left"
              >
                <div className="size-9 rounded-lg overflow-hidden bg-secondary shrink-0 grid place-items-center">
                  {cover ? <img src={cover} alt="" className="w-full h-full object-cover" loading="lazy" referrerPolicy="no-referrer" /> : <Video className="size-4 text-muted-foreground" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium break-words leading-tight">{v.title || v.titulo || "—"}</p>
                  {v.displayArtists && (
                    <p className="text-[11px] text-muted-foreground break-words mt-0.5">{v.displayArtists}</p>
                  )}
                </div>
                <Play className="size-3.5 text-muted-foreground shrink-0" />
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

// ---------- Aba: Charts (Hall of Fame) ----------
function ChartsTab({ nome }: { nome: string }) {
  const [hof, setHof] = useState<HOFProfile | null | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    setHof(undefined);
    getHOFProfile(nome).then((d) => alive && setHof(d));
    return () => { alive = false; };
  }, [nome]);

  if (hof === undefined) {
    return <div className="h-32 rounded-2xl bg-card animate-pulse" />;
  }
  if (!hof) {
    return (
      <div className="p-8 rounded-[2.5rem] border border-dashed border-white/5 text-center">
        <Trophy className="size-8 text-muted-foreground/20 mx-auto mb-3" />
        <p className="text-[10px] text-muted-foreground font-black uppercase tracking-widest italic opacity-40">
          Sem posições registradas nos charts ainda
        </p>
      </div>
    );
  }

  const n1s = [
    { label: "Hot 100", val: hof.n1_hot100, color: "text-red-400" },
    { label: "Spotify", val: hof.n1_spotify, color: "text-emerald-400" },
    { label: "YouTube", val: hof.n1_youtube, color: "text-red-500" },
    { label: "BB 200", val: hof.n1_bb200, color: "text-amber-400" },
  ].filter((x) => x.val && Number(x.val) !== 0);

  const runs = (hof.runs || [])
    .map((r) => {
      const positions = String(r.v).split("-").map((s) => Number(s.trim())).filter((n) => !isNaN(n) && n > 0);
      const peak = positions.length ? Math.min(...positions) : 999;
      return { title: r.t, peak, weeks: positions.length };
    })
    .sort((a, b) => (a.peak !== b.peak ? a.peak - b.peak : b.weeks - a.weeks));

  const platformSection = (title: string, color: string, items?: { t: string; v: string }[]) => {
    if (!items || !items.length) return null;
    return (
      <div>
        <h3 className={`text-[10px] font-black uppercase tracking-widest mb-2 ${color}`}>{title}</h3>
        <div className="space-y-1.5">
          {items.slice(0, 5).map((it, i) => (
            <div key={i} className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground w-4 text-right shrink-0">{i + 1}</span>
              <span className="flex-1 truncate">{it.t}</span>
              <span className={`text-xs font-bold shrink-0 ${color}`}>{it.v}</span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {(hof.country || hof.style) && (
        <p className="text-[10px] uppercase tracking-widest text-muted-foreground px-1">
          {[hof.country, hof.style].filter(Boolean).join(" • ")}
        </p>
      )}

      {n1s.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          {n1s.map((x, i) => (
            <div key={i} className="p-3 rounded-2xl bg-white/[0.02] border border-white/5 text-center">
              <div className={`text-xl font-black ${x.color}`}>{x.val}</div>
              <div className="text-[9px] uppercase tracking-widest text-muted-foreground/60 mt-0.5">{x.label} #1s</div>
            </div>
          ))}
        </div>
      )}

      {runs.length > 0 && (
        <div>
          <h3 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-2 px-1">Chart Runs</h3>
          <div className="space-y-1.5">
            {runs.slice(0, 10).map((r, i) => (
              <div key={i} className="flex items-center gap-3 p-2.5 rounded-xl bg-white/[0.02] border border-white/5">
                <span className={`text-sm font-black shrink-0 w-8 text-center ${r.peak === 1 ? "text-amber-400" : "text-muted-foreground"}`}>
                  #{r.peak}
                </span>
                <span className="text-sm flex-1 truncate">{r.title}</span>
                <span className="text-xs text-muted-foreground shrink-0">{r.weeks} sem.</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid gap-5 sm:grid-cols-2">
        {platformSection("Spotify", "text-emerald-400", hof.sp)}
        {platformSection("Apple Music", "text-rose-400", hof.am)}
        {platformSection("YouTube", "text-red-500", hof.yt)}
        {platformSection("Álbuns", "text-amber-400", hof.alb)}
      </div>
    </div>
  );
}

// ---------- Aba: Turnês & Projetos ----------
function ToursProjetosTab({ nome, tourData, isOwner }: { nome: string; tourData: any; isOwner: boolean }) {
  const [projetos, setProjetos] = useState<Projeto[] | null>(null);

  useEffect(() => {
    let alive = true;
    api.projetos(nome).then((p) => alive && setProjetos(p)).catch(() => alive && setProjetos([]));
    return () => { alive = false; };
  }, [nome]);

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center justify-between px-1 mb-3">
          <h3 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Turnê</h3>
          <Link to="/tours" className="text-[10px] font-black text-primary uppercase">Todas Turnês</Link>
        </div>
        {tourData ? (
          <Link to="/tours/$nome" params={{ nome }} className="block p-5 rounded-[2rem] bg-white/[0.03] border border-white/5 hover:bg-white/[0.06] transition-all">
            <p className="text-sm font-black uppercase tracking-tight mb-1">{tourData.titulo}</p>
            <p className="text-xs text-muted-foreground">{tourData.realizados}/{tourData.total} shows — {tourData.status}</p>
          </Link>
        ) : (
          <div className="p-8 rounded-[2rem] bg-card/40 border border-dashed border-white/10 text-center">
            <Mic2 className="size-7 text-muted-foreground/10 mx-auto mb-2" />
            <p className="text-[10px] text-muted-foreground uppercase font-black tracking-widest">Sem turnês ativas</p>
          </div>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between px-1 mb-3">
          <h3 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Cinema & TV</h3>
          {isOwner && (
            <Link to="/acoes/cinema" search={{ nome }} className="text-[10px] font-black text-primary uppercase">+ Lançar</Link>
          )}
        </div>
        {projetos === null ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-14 rounded-xl bg-card animate-pulse" />)}
          </div>
        ) : projetos.length === 0 ? (
          <div className="p-8 rounded-[2rem] bg-card/40 border border-dashed border-white/10 text-center">
            <Briefcase className="size-7 text-muted-foreground/10 mx-auto mb-2" />
            <p className="text-[10px] text-muted-foreground uppercase font-black tracking-widest">Nenhum projeto ainda</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {projetos.map((p, i) => (
              <li key={i} className="p-3 rounded-xl bg-card">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground">{p.tipo}</p>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${p.status === "Em andamento" ? "bg-primary/15 text-primary" : "bg-secondary text-muted-foreground"}`}>
                    {p.status || "—"}
                  </span>
                </div>
                <p className="font-bold mt-1 text-sm">{p.titulo}</p>
                {p.detalhe && <p className="text-xs text-muted-foreground mt-1">{p.detalhe}</p>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ---------- Aba: Social ----------
function SocialTab({ nome }: { nome: string }) {
  const [perfis, setPerfis] = useState<any[] | null>(null);

  useEffect(() => {
    let alive = true;
    api.listarPerfisSocial().then((list) => {
      if (!alive) return;
      const mine = (list || []).filter((p: any) => (p.artista || "").trim().toLowerCase() === nome.trim().toLowerCase());
      setPerfis(mine);
    }).catch(() => alive && setPerfis([]));
    return () => { alive = false; };
  }, [nome]);

  if (perfis === null) {
    return <div className="h-20 rounded-2xl bg-card animate-pulse" />;
  }
  if (perfis.length === 0) {
    return (
      <div className="p-8 rounded-[2.5rem] border border-dashed border-white/5 text-center">
        <Instagram className="size-8 text-muted-foreground/20 mx-auto mb-3" />
        <p className="text-[10px] text-muted-foreground font-black uppercase tracking-widest italic opacity-40">
          Nenhum perfil social vinculado ainda
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {perfis.map((p, i) => {
        const handle = String(p.handle || "").replace(/^@+/, "");
        const avatarSrc = driveImg(p.avatar_url);
        return (
          <Link
            key={i}
            to="/social"
            search={{ artist: nome }}
            className="p-4 rounded-2xl bg-white/[0.02] border border-white/5 flex items-center gap-3 hover:bg-white/[0.05] transition-colors"
          >
          <div className="size-11 rounded-full overflow-hidden bg-secondary shrink-0 grid place-items-center">
            {avatarSrc ? <img src={avatarSrc} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" /> : <User className="size-5 text-muted-foreground" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-black truncate">{p.rede} — @{handle}</div>
            {p.bio && <div className="text-xs text-muted-foreground truncate">{p.bio}</div>}
          </div>
          <div className="text-right shrink-0">
            <div className="text-sm font-black">{p.seguidores || 0}</div>
            <div className="text-[9px] text-muted-foreground uppercase tracking-widest">seguidores</div>
          </div>
          </Link>
        );
      })}
    </div>
  );
}

// ---------- Aba: Gestão (dono) ----------
function GestaoTab({ onAction }: { onAction: (m: "rescisao" | "foto" | "biografia" | "capa") => void }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <MiniAction label="Trocar Foto" icon={<User />} onClick={() => onAction("foto")} color="text-sky-400" />
      <MiniAction label="Editar Biografia" icon={<FileText />} onClick={() => onAction("biografia")} color="text-emerald-400" />
      <MiniAction label="Capa do Perfil" icon={<ImageIcon />} onClick={() => onAction("capa")} color="text-fuchsia-400" />
      <div className="col-span-2 mt-4 space-y-3">
        <h4 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/30 px-1">Administrativo</h4>
        <div className="grid grid-cols-2 gap-3">
          <MiniAction label="Rescindir" icon={<FileX />} onClick={() => onAction("rescisao")} color="text-destructive font-black" />
        </div>
      </div>
    </div>
  );
}

function StatCardV2({ label, value, icon, accent }: any) {
  return (
    <div className={`p-4 rounded-[1.5rem] border transition-all duration-300 shadow-lg ${accent ? "bg-primary/10 border-primary/30 shadow-primary/5" : "bg-white/5 backdrop-blur-xl border-white/10"}`}>
      <div className="flex items-center gap-2 mb-2 text-muted-foreground/70">
        <div className={`size-7 rounded-lg grid place-items-center ${accent ? "bg-primary/20 text-primary" : "bg-white/10 text-white/50"}`}>{icon}</div>
        <span className="text-[9px] font-black uppercase tracking-[0.15em] truncate">{label}</span>
      </div>
      <p className={`text-base font-black italic tracking-tighter truncate ${accent ? "text-primary" : "text-foreground"}`}>{value}</p>
    </div>
  );
}

function StatCompact({ label, value, max, icon, color, reverse }: any) {
  const percent = Math.min(100, (value / max) * 100);
  return (
    <div className="col-span-2 p-4 rounded-[1.8rem] bg-white/5 backdrop-blur-md border border-white/10 flex items-center gap-4">
      <div className={`size-10 rounded-xl bg-white/5 grid place-items-center shadow-inner shrink-0 ${color}`}>{icon}</div>
      <div className="flex-1 min-w-0">
        <div className="flex justify-between items-end mb-2">
          <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/60 truncate mr-1">{label}</span>
          <span className="text-xs font-black tracking-tighter shrink-0">{value} <span className="opacity-30">/ {max}</span></span>
        </div>
        <div className="h-2 bg-white/10 rounded-full overflow-hidden p-[1px]">
          <div className={`h-full rounded-full transition-all duration-1000 ${reverse ? (percent > 80 ? "bg-rose-500" : "bg-primary") : "bg-primary"}`} style={{ width: `${percent}%` }} />
        </div>
      </div>
    </div>
  );
}

function QuickAction({ icon, label, to, params, id }: any) {
  return (
    <Link id={id} to={to} search={params} className="flex flex-col items-center justify-center gap-3 p-5 rounded-[2rem] bg-white/5 backdrop-blur-xl border border-white/10 transition-all hover:bg-primary/10 hover:border-primary/30 active:scale-95 group shadow-lg">
      <div className="size-14 rounded-[1.5rem] bg-white/5 grid place-items-center group-hover:bg-primary/20 transition-all shadow-inner text-muted-foreground group-hover:text-primary group-hover:rotate-12">{icon}</div>
      <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground group-hover:text-foreground text-center leading-none">{label}</span>
    </Link>
  );
}

function TabButton({ active, onClick, children }: any) {
  return (
    <button
      onClick={onClick}
      className={`relative shrink-0 px-4 py-3 rounded-[1.3rem] text-[10px] font-black uppercase tracking-[0.15em] transition-all duration-300 active:scale-95 ${
        active
          ? "text-primary-foreground shadow-[0_4px_18px_-4px_var(--primary)] scale-[1.03]"
          : "text-muted-foreground border border-white/10 bg-white/[0.03] backdrop-blur-md hover:bg-white/[0.06] hover:text-white/60"
      }`}
    >
      {active && <span className="absolute inset-0 rounded-[1.3rem] bg-gradient-to-br from-primary via-primary to-fuchsia-500/80" aria-hidden="true" />}
      <span className="relative z-10">{children}</span>
    </button>
  );
}

function MiniAction({ label, icon, onClick, to, color }: any) {
  const Content = (
    <>
      <div className={`size-10 rounded-xl bg-white/5 grid place-items-center ${color}`}>{icon}</div>
      <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex-1 text-center">{label}</span>
    </>
  );
  const cls = "flex items-center gap-3 p-3 rounded-2xl bg-white/[0.02] border border-white/5 hover:bg-white/[0.05] transition-all active:scale-[0.98]";
  if (to) return <Link to={to} className={cls}>{Content}</Link>;
  return <button onClick={onClick} className={cls}>{Content}</button>;
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div onClick={onClose} className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm grid place-items-end sm:place-items-center p-0 sm:p-4">
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md bg-card rounded-t-2xl sm:rounded-2xl p-5 border border-border">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-extrabold">{title}</h3>
          <button onClick={onClose} className="size-8 rounded-full bg-secondary grid place-items-center"><X className="size-4" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function inputCls() { return "w-full bg-background border border-border rounded-xl px-3 py-3 text-sm mb-2"; }
function btnCls() { return "w-full py-3 rounded-full bg-primary text-primary-foreground font-extrabold uppercase tracking-wider text-sm disabled:opacity-50 inline-flex items-center justify-center gap-2 mt-2"; }

function RescisaoModal({ nome, onClose }: { nome: string; onClose: () => void }) {
  const [destino, setDestino] = useState("Independent"); const [s, setS] = useState(false);
  async function go() { setS(true); const r = await api.rescisao({ nome, destino }); const { ok } = notify(r, { successFallback: "Rescisão processada!" }); setS(false); if (ok) onClose(); }
  return (
    <Modal title="Rescindir Contrato" onClose={onClose}>
      <input value={destino} onChange={(e) => setDestino(e.target.value)} placeholder="Destino" className={inputCls()} />
      <button onClick={go} disabled={s || !destino} className={btnCls()}>{s && <Loader2 className="size-4 animate-spin" />} Confirmar</button>
    </Modal>
  );
}

function FotoModal({ nome, onClose, onDone }: { nome: string; onClose: () => void; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [s, setS] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  function pick(f: File | undefined) {
    if (!f) return;
    setFile(f);
    setPreview(URL.createObjectURL(f));
    setErrorMsg(null);
  }

  async function go() {
    if (!file) return;
    setS(true);
    setErrorMsg(null);
    try {
      const base64Data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const res = await fetch("/api/gestao/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName: file.name,
          mimeType: file.type || "image/jpeg",
          base64Data,
          folderType: "artistPhotos",
        }),
      });
      const json = await res.json().catch(() => null);
      const fileUrl = json?.data?.fileUrl;
      if (!fileUrl) throw new Error("Falha ao subir a foto.");
      await api.setArtistFoto(nome, fileUrl);
      onDone();
      onClose();
    } catch (err: any) {
      setErrorMsg(err?.message || "Não deu pra trocar a foto agora.");
    } finally {
      setS(false);
    }
  }

  return (
    <Modal title="Trocar foto do artista" onClose={onClose}>
      <p className="text-xs text-muted-foreground mb-3">
        Isso envia uma foto nova pra revisão — não substitui a foto oficial na hora. Pra foto definitiva, edite
        direto na planilha INFOS ACTS.
      </p>
      <label className="block mb-3">
        <div className="aspect-square w-32 mx-auto rounded-2xl overflow-hidden bg-secondary border border-white/10 grid place-items-center">
          {preview ? (
            <img src={preview} alt="" className="w-full h-full object-cover" />
          ) : (
            <User className="size-8 text-muted-foreground" />
          )}
        </div>
        <input
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => pick(e.target.files?.[0])}
        />
        <span className="block text-center text-xs font-bold text-primary mt-2 underline">Escolher arquivo</span>
      </label>
      {errorMsg && <p className="text-xs text-destructive mb-2">{errorMsg}</p>}
      <button onClick={go} disabled={s || !file} className={btnCls()}>
        {s && <Loader2 className="size-4 animate-spin" />} Enviar
      </button>
    </Modal>
  );
}

function BiografiaModal({ nome, onClose }: { nome: string; onClose: () => void }) {
  const [texto, setTexto] = useState("");
  const [loading, setLoading] = useState(true);
  const [s, setS] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    let alive = true;
    api.getArtistInfo(nome).then((info) => {
      if (alive) {
        setTexto(info?.biografia || "");
        setLoading(false);
      }
    });
    return () => {
      alive = false;
    };
  }, [nome]);

  async function go() {
    setS(true);
    setErrorMsg(null);
    try {
      const res = await api.setArtistBiografia(nome, texto.trim());
      if (!res.success) throw new Error(res.error || "Falha ao salvar biografia.");
      onClose();
      window.location.reload();
    } catch (err: any) {
      setErrorMsg(err?.message || "Não deu pra salvar a biografia agora.");
    } finally {
      setS(false);
    }
  }

  return (
    <Modal title="Editar biografia" onClose={onClose}>
      {loading ? (
        <div className="h-28 rounded-xl bg-secondary animate-pulse" />
      ) : (
        <>
          <RichTextToolbar textareaRef={textareaRef} value={texto} onChange={setTexto} />
          <textarea
            ref={textareaRef}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="Conte a história desse artista... (dá pra usar **negrito**, *itálico* e quebras de parágrafo)"
            className="w-full h-40 bg-background border border-border rounded-xl p-3 text-sm resize-none mb-2 focus:outline-none focus:border-primary/50"
          />
        </>
      )}
      {errorMsg && <p className="text-xs text-destructive mb-2">{errorMsg}</p>}
      <button onClick={go} disabled={s || loading} className={btnCls()}>
        {s && <Loader2 className="size-4 animate-spin" />} Salvar
      </button>
    </Modal>
  );
}

// Um slot de upload (desktop OU mobile) dentro do CapaModal — o topo do
// perfil é bem mais largo no desktop do que no celular, então uma imagem só
// não encaixa direito nos dois; cada slot mostra o tamanho ideal exato da
// própria versão.
function CapaUploadSlot({
  label,
  dimensions,
  aspectClass,
  preview,
  onPick,
}: {
  label: string;
  dimensions: string;
  aspectClass: string;
  preview: string | null;
  onPick: (f: File | undefined) => void;
}) {
  return (
    <label className="block">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-bold text-foreground">{label}</span>
        <span className="text-[10px] text-muted-foreground">Ideal: {dimensions}</span>
      </div>
      <div className={`w-full ${aspectClass} rounded-2xl overflow-hidden bg-secondary border border-white/10 grid place-items-center`}>
        {preview ? (
          <img src={preview} alt="" className="w-full h-full object-cover" />
        ) : (
          <ImageIcon className="size-6 text-muted-foreground" />
        )}
      </div>
      <input type="file" accept="image/*" className="hidden" onChange={(e) => onPick(e.target.files?.[0])} />
      <span className="block text-center text-xs font-bold text-primary mt-2 underline">Escolher arquivo</span>
    </label>
  );
}

function CapaModal({
  nome,
  onClose,
  onDone,
}: {
  nome: string;
  onClose: () => void;
  onDone: (urls: { capaUrl?: string; capaMobileUrl?: string }) => void;
}) {
  const [desktopFile, setDesktopFile] = useState<File | null>(null);
  const [desktopPreview, setDesktopPreview] = useState<string | null>(null);
  const [mobileFile, setMobileFile] = useState<File | null>(null);
  const [mobilePreview, setMobilePreview] = useState<string | null>(null);
  const [s, setS] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function uploadOne(file: File): Promise<string> {
    const base64Data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    const res = await fetch("/api/gestao/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fileName: file.name,
        mimeType: file.type || "image/jpeg",
        base64Data,
        folderType: "artistPhotos",
      }),
    });
    const json = await res.json().catch(() => null);
    const fileUrl = json?.data?.fileUrl;
    if (!fileUrl) throw new Error("Falha ao subir a imagem.");
    return fileUrl;
  }

  async function go() {
    if (!desktopFile && !mobileFile) return;
    setS(true);
    setErrorMsg(null);
    try {
      const [capaUrl, capaMobileUrl] = await Promise.all([
        desktopFile ? uploadOne(desktopFile) : Promise.resolve(undefined),
        mobileFile ? uploadOne(mobileFile) : Promise.resolve(undefined),
      ]);
      const salvo = await api.setArtistCapa(nome, capaUrl, capaMobileUrl);
      if (!salvo.success) throw new Error(salvo.error || "Falha ao salvar a capa.");
      onDone({ capaUrl, capaMobileUrl });
      onClose();
    } catch (err: any) {
      setErrorMsg(err?.message || "Não deu pra trocar a capa agora.");
    } finally {
      setS(false);
    }
  }

  return (
    <Modal title="Capa do perfil" onClose={onClose}>
      <p className="text-xs text-muted-foreground mb-4">
        Imagem de fundo no topo do perfil. Manda as duas versões — o celular e o computador mostram essa área com
        proporções bem diferentes — pra ela encaixar certinho nos dois. Sem elas, o topo continua mostrando a foto
        do artista, como hoje.
      </p>
      <div className="space-y-4 mb-4">
        <CapaUploadSlot
          label="Versão celular"
          dimensions="1200×750px"
          aspectClass="aspect-[1200/750]"
          preview={mobilePreview}
          onPick={(f) => {
            if (!f) return;
            setMobileFile(f);
            setMobilePreview(URL.createObjectURL(f));
            setErrorMsg(null);
          }}
        />
        <CapaUploadSlot
          label="Versão computador"
          dimensions="1920×480px"
          aspectClass="aspect-[1920/480]"
          preview={desktopPreview}
          onPick={(f) => {
            if (!f) return;
            setDesktopFile(f);
            setDesktopPreview(URL.createObjectURL(f));
            setErrorMsg(null);
          }}
        />
      </div>
      {errorMsg && <p className="text-xs text-destructive mb-2">{errorMsg}</p>}
      <button onClick={go} disabled={s || (!desktopFile && !mobileFile)} className={btnCls()}>
        {s && <Loader2 className="size-4 animate-spin" />} Enviar
      </button>
    </Modal>
  );
}
