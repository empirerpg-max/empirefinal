import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Mic2,
  Film,
  Disc3,
  Wallet,
  Trophy,
  Zap,
  Briefcase,
  Flame,
  HandHeart,
  X,
  Loader2,
  Building2,
  Gavel,
  Radio,
  FileX,
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
} from "lucide-react";
import { useTelegramUser } from "@/lib/telegram";
import { api, fmtEC, fmtMoney, driveImg, type Artist, type AlbumPayload, type Projeto, type BemItem, type NivelJogador } from "@/lib/api";
import { getHOFProfile, type HOFProfile } from "@/lib/charts";
import { notify } from "@/lib/notify";
import { useEmpirePlayer } from "@/components/EmpirePlay/PlayerContext";
import { toPlayableTrack, toPlayableVideo } from "@/components/EmpirePlay/mappers";

export const Route = createFileRoute("/artistas/$nome/")({
  component: ArtistDashboard,
});

type TabId = "geral" | "discografia" | "charts" | "tours" | "social" | "bens" | "gestao";

function ArtistDashboard() {
  const { nome } = Route.useParams();
  const { user, ready } = useTelegramUser();
  const [artist, setArtist] = useState<Artist | null>(null);
  const [isOwner, setIsOwner] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabId>("geral");
  const [modal, setModal] = useState<
    null | "viral" | "filantropia" | "payola" | "leilao" | "rescisao" | "composicao" | "imovel" | "foto"
  >(null);
  const [albuns, setAlbuns] = useState<AlbumPayload[]>([]);
  const [tourData, setTourData] = useState<any>(null);
  const [responsavelNivel, setResponsavelNivel] = useState<NivelJogador | null>(null);

  useEffect(() => {
    if (!ready) return;
    setLoading(true);

    const safeNome = decodeURIComponent(nome || "")
      .trim()
      .toLowerCase();

    Promise.all([
      // Carrega TODOS os artistas para permitir visualizar qualquer perfil
      api.listarTodos().catch(() => []),
      api.listarAlbuns(nome).catch(() => []),
      api.listTours().catch(() => []),
      // Carrega artistas do usuário para verificar propriedade
      user && user.id !== "guest" ? api.meusArtistas(user.id).catch(() => []) : Promise.resolve([]),
    ]).then(([allArtists, albunsList, toursList, myArtists]) => {
      // Encontra o artista na lista completa
      const art = (allArtists as Artist[]).find((a) => a.nome?.trim().toLowerCase() === safeNome) || null;
      setArtist(art);
      setAlbuns(albunsList);

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
    });
  }, [ready, user, nome]);

  const TABS = useMemo(() => {
    const base: { id: TabId; label: string }[] = [
      { id: "geral", label: "Visão Geral" },
      { id: "discografia", label: "Discografia" },
      { id: "charts", label: "Charts" },
      { id: "tours", label: "Turnês & Projetos" },
      { id: "social", label: "Social" },
    ];
    if (isOwner) {
      base.push({ id: "bens", label: "Bens" }, { id: "gestao", label: "Gestão" });
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
    <main className="flex-1 pb-24 bg-background">
      {/* Visual Header */}
      <div className="relative h-[30vh] min-h-[240px] overflow-hidden">
        <img
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          src={driveImg(artist.foto, 1200) || artist.foto}
          onError={(e) => {
            const img = e.currentTarget;
            if (img.src !== artist.foto) img.src = artist.foto;
          }}
          className="w-full h-full object-cover object-top scale-105 opacity-60 transition-opacity duration-700"
          alt=""
        />
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/60 to-transparent" />

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
        {/* ── Core Stats: Empire Coin + Fortuna + Fadiga (sem prestígio — isso é do jogador, ver card do Responsável) ── */}
        <div className="grid grid-cols-2 gap-2">
          <StatCardV2
            label="Empire Coin (E$C)"
            value={fmtEC(artist.saldo)}
            icon={<Wallet className="size-3.5" />}
            accent
          />
          <StatCardV2
            label="Fortuna Total"
            value={fmtMoney(artist.fortuna_total)}
            icon={<Briefcase className="size-3.5" />}
          />
          <StatCompact
            label="Fadiga Vocal"
            value={artist.fadiga}
            max={100}
            icon={<Zap className="size-3.5" />}
            color="text-rose-400"
            reverse
          />
          <StatCardV2
            label="Fortuna em Caixa"
            value={fmtMoney(artist.fortuna_real)}
            icon={<Wallet className="size-3.5" />}
          />
          <StatCardV2
            label="Fortuna em Bens"
            value={fmtMoney(artist.fortuna_bens)}
            icon={<Building2 className="size-3.5" />}
          />
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
            <QuickAction icon={<Mic2 className="size-6 text-emerald-400" />} label="Turnê" id="btn-tour" to="/acoes/tour" params={{ nome: artist.nome }} />
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
            {activeTab === "geral" && <GeralTab artist={artist} albuns={albuns} tourData={tourData} />}
            {activeTab === "discografia" && <DiscografiaTab nome={artist.nome} albuns={albuns} isOwner={isOwner} />}
            {activeTab === "charts" && <ChartsTab nome={artist.nome} />}
            {activeTab === "tours" && <ToursProjetosTab nome={artist.nome} tourData={tourData} isOwner={isOwner} />}
            {activeTab === "social" && <SocialTab nome={artist.nome} />}
            {isOwner && activeTab === "bens" && <BensTab nome={artist.nome} onComprar={() => setModal("imovel")} />}
            {isOwner && activeTab === "gestao" && <GestaoTab onAction={setModal} />}
          </div>
        </section>
      </div>

      {isOwner && modal === "viral" && <ViralModal nome={artist.nome} onClose={() => setModal(null)} />}
      {isOwner && modal === "filantropia" && <FilantropiaModal nome={artist.nome} onClose={() => setModal(null)} />}
      {isOwner && modal === "payola" && <PayolaModal nome={artist.nome} onClose={() => setModal(null)} />}
      {isOwner && modal === "leilao" && <LeilaoModal nome={artist.nome} onClose={() => setModal(null)} />}
      {isOwner && modal === "rescisao" && <RescisaoModal nome={artist.nome} onClose={() => setModal(null)} />}
      {isOwner && modal === "composicao" && <ComposicaoModal nome={artist.nome} onClose={() => setModal(null)} />}
      {isOwner && modal === "imovel" && <ImovelModal nome={artist.nome} onClose={() => setModal(null)} />}
      {isOwner && modal === "foto" && (
        <FotoModal nome={artist.nome} onClose={() => setModal(null)} onDone={() => window.location.reload()} />
      )}
    </main>
  );
}

// ---------- Aba: Visão Geral ----------
function GeralTab({ artist, albuns, tourData }: { artist: Artist; albuns: AlbumPayload[]; tourData: any }) {
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
          <p className="text-sm text-muted-foreground leading-relaxed">{biografia}</p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <MiniStat icon={<Disc3 className="size-4" />} label="Álbuns" value={String(albuns.length)} />
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

// ---------- Aba: Discografia ----------
function DiscografiaTab({ nome, albuns, isOwner }: { nome: string; albuns: AlbumPayload[]; isOwner: boolean }) {
  const { playSong, playVideo } = useEmpirePlayer();
  const [musicas, setMusicas] = useState<any[] | null>(null);
  const [videos, setVideos] = useState<any[] | null>(null);
  const [albunsCatalogo, setAlbunsCatalogo] = useState<any[] | null>(null);

  useEffect(() => {
    let alive = true;
    const normNome = nome.trim().toLowerCase();
    Promise.all([
      fetch(`/api/empire-play/musicas?artist=${encodeURIComponent(nome)}`).then((r) => r.json()).catch(() => null),
      fetch(`/api/empire-play/videos?artist=${encodeURIComponent(nome)}`).then((r) => r.json()).catch(() => null),
      fetch(`/api/empire-play/albuns`).then((r) => r.json()).catch(() => null),
    ]).then(([m, v, alb]) => {
      if (!alive) return;
      setMusicas(Array.isArray(m?.data) ? m.data : []);
      setVideos(Array.isArray(v?.data) ? v.data : []);
      const albunsList = Array.isArray(alb?.data) ? alb.data : [];
      setAlbunsCatalogo(
        albunsList.filter((a: any) => (a.artist || a.artista || "").trim().toLowerCase() === normNome),
      );
    });
    return () => { alive = false; };
  }, [nome]);

  return (
    <div className="space-y-8">
      <section>
        <div className="flex items-center justify-between mb-4 px-1">
          <h2 className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground">Discografia Oficial</h2>
          {isOwner && (
            <Link to="/acoes/album" search={{ nome }} className="size-9 rounded-xl bg-primary/10 text-primary grid place-items-center active:scale-90 transition-transform">
              <Disc3 className="size-4" />
            </Link>
          )}
        </div>
        {albuns.length === 0 ? (
          <div className="p-8 rounded-[2.5rem] border border-dashed border-white/5 text-center">
            <p className="text-[10px] text-muted-foreground font-black uppercase tracking-widest italic opacity-40">Nenhum álbum registrado ainda</p>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-4">
            {albuns.map((a) => (
              <Link key={a.id} to="/album/$id" params={{ id: a.id! }} className="group">
                <div className="aspect-square rounded-[2rem] overflow-hidden bg-secondary shadow-lg border border-white/5">
                  {a.capa_url && (
                    <img src={driveImg(a.capa_url, 300)} alt={a.titulo} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700 grayscale group-hover:grayscale-0" loading="lazy" decoding="async" referrerPolicy="no-referrer" />
                  )}
                </div>
                <p className="mt-2 text-[10px] font-black uppercase tracking-tight text-center truncate">{a.titulo}</p>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground mb-4 px-1 flex items-center gap-1.5">
          <Disc3 className="size-3.5" /> Álbuns no catálogo (Empire Play)
        </h2>
        {albunsCatalogo === null ? (
          <div className="h-24 rounded-2xl bg-card animate-pulse" />
        ) : albunsCatalogo.length === 0 ? (
          <p className="text-[10px] text-muted-foreground italic px-1">Nenhum álbum publicado no catálogo ainda.</p>
        ) : (
          <div className="grid grid-cols-3 gap-4">
            {albunsCatalogo.map((a) => {
              const cover = driveImg(a.coverUrl || a.cover || a.capa_url || a.capa_do_album || a.capa);
              return (
                <Link key={a.id} to="/empire-play/forum" search={{ tab: "albuns", id: a.id }} className="group">
                  <div className="aspect-square rounded-[2rem] overflow-hidden bg-secondary shadow-lg border border-white/5 grid place-items-center">
                    {cover ? (
                      <img src={cover} alt={a.title || a.titulo} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700" loading="lazy" referrerPolicy="no-referrer" />
                    ) : (
                      <Disc3 className="size-8 text-muted-foreground" />
                    )}
                  </div>
                  <p className="mt-2 text-[10px] font-black uppercase tracking-tight text-center truncate">{a.title || a.titulo}</p>
                </Link>
              );
            })}
          </div>
        )}
      </section>

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
            {musicas.slice(0, 10).map((m, i) => {
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
                  <span className="text-sm font-medium truncate flex-1">{m.title || m.titulo || "—"}</span>
                  <Play className="size-3.5 text-muted-foreground shrink-0" />
                </button>
              );
            })}
          </div>
        )}
      </section>

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
            {videos.slice(0, 10).map((v, i) => {
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
                  <span className="text-sm font-medium truncate flex-1">{v.title || v.titulo || "—"}</span>
                  <Play className="size-3.5 text-muted-foreground shrink-0" />
                </button>
              );
            })}
          </div>
        )}
      </section>
    </div>
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

// ---------- Aba: Bens (dono) ----------
function BensTab({ nome, onComprar }: { nome: string; onComprar: () => void }) {
  const [bens, setBens] = useState<BemItem[] | null>(null);
  const [selling, setSelling] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const load = () => api.meusBens(nome).then(setBens);
  useEffect(() => { load(); }, [nome]);

  async function vender(id: string) {
    setSelling(id);
    const r = await api.venderBem({ nome, id });
    notify(r, { successFallback: "Bem vendido." });
    setSelling(null);
    setConfirmId(null);
    load();
  }

  const total = bens?.reduce((s, b) => s + (b.status === "Vendido" ? 0 : b.valor), 0) || 0;
  const CAT_ICON: Record<string, React.ReactNode> = {
    IMOVEIS: <Building2 className="size-5" />,
    MARKET: <Sparkles className="size-5" />,
    CARREIRA: <Briefcase className="size-5" />,
  };

  return (
    <div>
      <div className="flex items-center justify-between px-1 mb-4">
        <div>
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">Patrimônio total</p>
          <p className="text-lg font-black text-primary">{fmtMoney(total)}</p>
        </div>
        <button onClick={onComprar} className="text-[10px] font-black text-primary uppercase">+ Comprar</button>
      </div>

      <div className="space-y-3">
        {bens === null ? (
          <div className="rounded-xl bg-card animate-pulse h-32" />
        ) : bens.length === 0 ? (
          <div className="p-8 rounded-2xl bg-card text-center">
            <Building2 className="size-8 text-primary/40 mx-auto mb-3" />
            <p className="font-extrabold text-sm mb-1">Nenhum bem ainda</p>
            <p className="text-xs text-muted-foreground">Imóveis, mansões e itens duráveis aparecem aqui como patrimônio.</p>
          </div>
        ) : (
          bens.map((b, i) => {
            const id = b.id || String(i);
            const ativo = b.status !== "Vendido";
            return (
              <div key={id} className={`p-4 rounded-xl bg-card flex items-center gap-3 ${!ativo ? "opacity-50" : ""}`}>
                <div className="size-12 rounded-lg bg-primary/15 text-primary grid place-items-center shrink-0">
                  {CAT_ICON[b.categoria] || <Sparkles className="size-5" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-extrabold text-sm truncate">{b.item}</p>
                  <p className="text-xs text-muted-foreground">{b.categoria} • {b.data?.split("T")[0] || ""}</p>
                  <p className="text-sm font-bold text-primary">{fmtEC(b.valor)}</p>
                </div>
                {ativo && b.id && (
                  <button onClick={() => setConfirmId(b.id!)} disabled={selling === b.id} className="px-3 py-2 rounded-full bg-secondary text-xs font-bold inline-flex items-center gap-1.5 disabled:opacity-50">
                    {selling === b.id ? <Loader2 className="size-3 animate-spin" /> : null} Vender
                  </button>
                )}
                {!ativo && <span className="text-[10px] uppercase font-bold text-muted-foreground">Vendido</span>}
              </div>
            );
          })
        )}
      </div>

      {confirmId && (
        <ConfirmSell
          item={bens?.find((b) => b.id === confirmId)}
          onCancel={() => setConfirmId(null)}
          onConfirm={() => vender(confirmId)}
          loading={selling === confirmId}
        />
      )}
    </div>
  );
}

function ConfirmSell({ item, onCancel, onConfirm, loading }: { item?: BemItem; onCancel: () => void; onConfirm: () => void; loading: boolean }) {
  if (!item) return null;
  const retorno = Math.floor(item.valor * 0.7);
  return (
    <div onClick={onCancel} className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm grid place-items-end sm:place-items-center p-0 sm:p-4">
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md bg-card rounded-t-2xl sm:rounded-2xl p-5 border border-border">
        <h3 className="text-lg font-extrabold mb-1">Vender este bem?</h3>
        <p className="text-sm text-muted-foreground mb-4">{item.item}</p>
        <div className="rounded-xl bg-background p-4 mb-4 space-y-1">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Pagou</span>
            <span className="font-bold">{fmtEC(item.valor)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Você recebe (70%)</span>
            <span className="font-black text-primary">{fmtEC(retorno)}</span>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button onClick={onCancel} className="py-3 rounded-full bg-secondary font-bold text-sm uppercase tracking-wider">Cancelar</button>
          <button onClick={onConfirm} disabled={loading} className="py-3 rounded-full bg-primary text-primary-foreground font-extrabold text-sm uppercase tracking-wider disabled:opacity-50 inline-flex items-center justify-center gap-2">
            {loading && <Loader2 className="size-4 animate-spin" />} Vender
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- Aba: Gestão (dono) ----------
function GestaoTab({ onAction }: { onAction: (m: "viral" | "filantropia" | "payola" | "leilao" | "rescisao" | "composicao" | "foto") => void }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <MiniAction label="Trocar Foto" icon={<User />} onClick={() => onAction("foto")} color="text-sky-400" />
      <MiniAction label="Viral" icon={<Flame />} onClick={() => onAction("viral")} color="text-rose-500" />
      <MiniAction label="Payola" icon={<Radio />} onClick={() => onAction("payola")} color="text-primary" />
      <MiniAction label="Filantropia" icon={<HandHeart />} onClick={() => onAction("filantropia")} color="text-emerald-500" />
      <MiniAction label="Leilão" icon={<Gavel />} onClick={() => onAction("leilao")} color="text-amber-500" />
      <MiniAction label="Vender Comp." icon={<Disc3 />} onClick={() => onAction("composicao")} color="text-purple-500" />
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
    <button onClick={onClick} className={`shrink-0 px-4 py-3 rounded-[1.3rem] text-[10px] font-black uppercase tracking-[0.15em] transition-all duration-500 ${active ? "bg-primary text-primary-foreground shadow-lg shadow-primary/20" : "text-muted-foreground hover:bg-white/5 hover:text-white/60"}`}>
      {children}
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

function ViralModal({ nome, onClose }: { nome: string; onClose: () => void }) {
  const [musica, setMusica] = useState("");
  const [s, setS] = useState(false);
  async function go() { if (!musica) return; setS(true); const r = await api.viral(nome, musica); const { ok } = notify(r, { successFallback: "Boost ativado!" }); setS(false); if (ok) onClose(); }
  return (
    <Modal title="Viralizar música" onClose={onClose}>
      <input value={musica} onChange={(e) => setMusica(e.target.value)} placeholder="Nome exato da música" className={inputCls()} />
      <button onClick={go} disabled={s || !musica} className={btnCls()}>{s && <Loader2 className="size-4 animate-spin" />} Confirmar</button>
    </Modal>
  );
}

function FilantropiaModal({ nome, onClose }: { nome: string; onClose: () => void }) {
  const [causa, setCausa] = useState(""); const [valor, setValor] = useState(""); const [s, setS] = useState(false);
  async function go() { if (!causa || !valor) return; setS(true); const r = await api.filantropia(nome, causa, valor); const { ok } = notify(r, { successFallback: "Doação enviada!" }); setS(false); if (ok) onClose(); }
  return (
    <Modal title="Filantropia" onClose={onClose}>
      <input value={causa} onChange={(e) => setCausa(e.target.value)} placeholder="Causa" className={inputCls()} />
      <input value={valor} onChange={(e) => setValor(e.target.value)} placeholder="Valor em $" className={inputCls()} />
      <button onClick={go} disabled={s || !causa || !valor} className={btnCls()}>{s && <Loader2 className="size-4 animate-spin" />} Doar</button>
    </Modal>
  );
}

function PayolaModal({ nome, onClose }: { nome: string; onClose: () => void }) {
  const [musica, setMusica] = useState(""); const [valor, setValor] = useState(""); const [s, setS] = useState(false);
  async function go() { setS(true); const r = await api.payola({ nome, musica, valor: Number(valor) }); const { ok } = notify(r, { successFallback: "Payola ativada!" }); setS(false); if (ok) onClose(); }
  return (
    <Modal title="Payola" onClose={onClose}>
      <input value={musica} onChange={(e) => setMusica(e.target.value)} placeholder="Nome da música" className={inputCls()} />
      <input value={valor} onChange={(e) => setValor(e.target.value)} placeholder="Valor em $EC" className={inputCls()} type="number" />
      <button onClick={go} disabled={s || !musica || !valor} className={btnCls()}>{s && <Loader2 className="size-4 animate-spin" />} Confirmar</button>
    </Modal>
  );
}

function LeilaoModal({ nome, onClose }: { nome: string; onClose: () => void }) {
  const [descricao, setDescricao] = useState(""); const [lance, setLance] = useState(""); const [s, setS] = useState(false);
  async function go() { setS(true); const r = await api.publicarLeilao({ nome, descricao, lanceMini: Number(lance) }); const { ok } = notify(r, { successFallback: "Leilão publicado!" }); setS(false); if (ok) onClose(); }
  return (
    <Modal title="Publicar Leilão" onClose={onClose}>
      <input value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="O que está vendendo" className={inputCls()} />
      <input value={lance} onChange={(e) => setLance(e.target.value)} placeholder="Lance mínimo $EC" className={inputCls()} type="number" />
      <button onClick={go} disabled={s || !descricao || !lance} className={btnCls()}>{s && <Loader2 className="size-4 animate-spin" />} Publicar</button>
    </Modal>
  );
}

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

function ComposicaoModal({ nome, onClose }: { nome: string; onClose: () => void }) {
  const [titulo, setTitulo] = useState(""); const [preco, setPreco] = useState(""); const [s, setS] = useState(false);
  async function go() { setS(true); const r = await api.venderComposicao({ nome, titulo, preco: Number(preco) }); const { ok } = notify(r, { successFallback: "Publicado no Mural!" }); setS(false); if (ok) onClose(); }
  return (
    <Modal title="Vender Composição" onClose={onClose}>
      <input value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Título" className={inputCls()} />
      <input value={preco} onChange={(e) => setPreco(e.target.value)} placeholder="Preço $EC" className={inputCls()} type="number" />
      <button onClick={go} disabled={s || !titulo || !preco} className={btnCls()}>{s && <Loader2 className="size-4 animate-spin" />} Publicar</button>
    </Modal>
  );
}

function ImovelModal({ nome, onClose }: { nome: string; onClose: () => void }) {
  const [tipo, setTipo] = useState("Mansao"); const [cidade, setCidade] = useState(""); const [s, setS] = useState(false);
  async function go() { setS(true); const r = await api.comprarImovel({ nome, tipo, cidade }); const { ok } = notify(r, { successFallback: "Imóvel adquirido!" }); setS(false); if (ok) onClose(); }
  return (
    <Modal title="Comprar Imóvel" onClose={onClose}>
      <select value={tipo} onChange={(e) => setTipo(e.target.value)} className={inputCls()}>
        <option value="Casa">Casa — $500k</option>
        <option value="Apartamento">Apartamento — $1M</option>
        <option value="Mansao">Mansão — $5M</option>
        <option value="Penthouse">Penthouse — $10M</option>
      </select>
      <input value={cidade} onChange={(e) => setCidade(e.target.value)} placeholder="Cidade" className={inputCls()} />
      <button onClick={go} disabled={s || !cidade} className={btnCls()}>{s && <Loader2 className="size-4 animate-spin" />} Comprar</button>
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
        Isso envia uma foto nova pra revisão — não substitui a foto oficial na hora. Pra biografia e foto definitiva,
        edite direto na planilha INFOS ACTS.
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
