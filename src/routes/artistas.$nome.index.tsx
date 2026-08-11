import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
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
} from "lucide-react";
import { useTelegramUser } from "@/lib/telegram";
import { api, fmtEC, fmtMoney, driveImg, type Artist, type AlbumPayload } from "@/lib/api";
import { notify } from "@/lib/notify";

export const Route = createFileRoute("/artistas/$nome/")({
  component: ArtistDashboard,
});

function ArtistDashboard() {
  const { nome } = Route.useParams();
  const { user, ready } = useTelegramUser();
  const [artist, setArtist] = useState<Artist | null>(null);
  const [isOwner, setIsOwner] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"bens" | "entretenimento" | "tours">("entretenimento");
  const [modal, setModal] = useState<
    null | "viral" | "filantropia" | "payola" | "leilao" | "rescisao" | "composicao" | "imovel"
  >(null);
  const [albuns, setAlbuns] = useState<AlbumPayload[]>([]);
  const [tourData, setTourData] = useState<any>(null);

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

      <div className="px-6 space-y-8 relative z-20 -mt-2">
        {/* ── Core Stats: Empire Coin + Fortuna + Prestígio + Fadiga ── */}
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
          <div className="col-span-2 grid grid-cols-2 gap-2">
            <StatCompact
              label="Prestígio Imperial"
              value={artist.prestigio}
              max={1000}
              icon={<Trophy className="size-3.5" />}
              color="text-amber-400"
            />
            <StatCompact
              label="Fadiga Vocal"
              value={artist.fadiga}
              max={100}
              icon={<Zap className="size-3.5" />}
              color="text-rose-400"
              reverse
            />
          </div>
          {/* Fortuna detalhada: real + bens */}
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

        {/* ── Ações rápidas — apenas para o dono do artista ── */}
        {isOwner && (
          <div className="grid grid-cols-3 gap-3">
            <QuickAction icon={<Disc3 className="size-6 text-purple-400" />} label="Álbum" id="btn-album" to="/acoes/album" params={{ nome: artist.nome }} />
            <QuickAction icon={<Mic2 className="size-6 text-emerald-400" />} label="Turnê" id="btn-tour" to="/acoes/tour" params={{ nome: artist.nome }} />
            <QuickAction icon={<Film className="size-6 text-blue-400" />} label="Cinema" id="btn-cinema" to="/acoes/cinema" params={{ nome: artist.nome }} />
          </div>
        )}

        {isOwner && (
          <section>
            <div className="flex gap-2 p-1 bg-card rounded-[2rem] border border-white/5 mb-6">
              <TabButton active={activeTab === "entretenimento"} onClick={() => setActiveTab("entretenimento")}>Gestão</TabButton>
              <TabButton active={activeTab === "bens"} onClick={() => setActiveTab("bens")}>Bens</TabButton>
              <TabButton active={activeTab === "tours"} onClick={() => setActiveTab("tours")}>Histórico</TabButton>
            </div>
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
              {activeTab === "entretenimento" && (
                <div className="grid grid-cols-2 gap-3">
                  <MiniAction label="Viral" icon={<Flame />} onClick={() => setModal("viral")} color="text-rose-500" />
                  <MiniAction label="Payola" icon={<Radio />} onClick={() => setModal("payola")} color="text-primary" />
                  <MiniAction label="Filantropia" icon={<HandHeart />} onClick={() => setModal("filantropia")} color="text-emerald-500" />
                  <MiniAction label="Leilão" icon={<Gavel />} onClick={() => setModal("leilao")} color="text-amber-500" />
                  <MiniAction label="Vender Comp." icon={<Disc3 />} onClick={() => setModal("composicao")} color="text-purple-500" />
                  <div className="col-span-2 mt-4 space-y-3">
                    <h4 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/30 px-1">Administrativo</h4>
                    <div className="grid grid-cols-2 gap-3">
                      <MiniAction label="Rescindir" icon={<FileX />} onClick={() => setModal("rescisao")} color="text-destructive font-black" />
                    </div>
                  </div>
                </div>
              )}
              {activeTab === "bens" && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between px-1">
                    <h4 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/50 text-emerald-500">Patrimônio Adquirido</h4>
                    <button onClick={() => setModal("imovel")} className="text-[10px] font-black text-primary uppercase">+ Comprar</button>
                  </div>
                  <Link to="/artistas/$nome/bens" params={{ nome: artist.nome }} className="block p-8 rounded-[2.5rem] bg-card border border-white/5 text-center transition-all hover:bg-white/[0.04]">
                    <Building2 className="size-10 text-muted-foreground/20 mx-auto mb-4" />
                    <p className="text-xs text-muted-foreground italic">Clique para ver inventário de imóveis e empresas.</p>
                  </Link>
                </div>
              )}
              {activeTab === "tours" && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between px-1">
                    <h4 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/50">Histórico de Atividades</h4>
                    <Link to="/tours" className="text-[10px] font-black text-primary uppercase">Todas Turnês</Link>
                  </div>
                  {tourData ? (
                    <div className="p-6 rounded-[2.5rem] bg-card border border-white/5">
                      <p className="text-xs font-black uppercase tracking-widest mb-2">{tourData.titulo}</p>
                      <p className="text-[10px] text-muted-foreground">{tourData.realizados}/{tourData.total} shows — {tourData.status}</p>
                    </div>
                  ) : (
                    <div className="p-12 rounded-[2.5rem] bg-card/40 border border-dashed border-white/10 text-center">
                      <Mic2 className="size-8 text-muted-foreground/10 mx-auto mb-3" />
                      <p className="text-[10px] text-muted-foreground uppercase font-black tracking-widest">Sem turnês recentes</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>
        )}

        <section className="pt-4 border-t border-white/5">
          <div className="flex items-center justify-between mb-5 px-1">
            <h2 className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground">Discografia Oficial</h2>
            {isOwner && (
              <Link to="/acoes/album" search={{ nome: artist.nome }} className="size-10 rounded-xl bg-primary/10 text-primary grid place-items-center active:scale-90 transition-transform">
                <Disc3 className="size-5" />
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
                      <img src={driveImg(a.capa_url, 300)} alt={a.titulo} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700 grayscale group-hover:grayscale-0" loading="lazy" decoding="async" />
                    )}
                  </div>
                  <p className="mt-2 text-[10px] font-black uppercase tracking-tight text-center truncate">{a.titulo}</p>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>

      {isOwner && modal === "viral" && <ViralModal nome={artist.nome} onClose={() => setModal(null)} />}
      {isOwner && modal === "filantropia" && <FilantropiaModal nome={artist.nome} onClose={() => setModal(null)} />}
      {isOwner && modal === "payola" && <PayolaModal nome={artist.nome} onClose={() => setModal(null)} />}
      {isOwner && modal === "leilao" && <LeilaoModal nome={artist.nome} onClose={() => setModal(null)} />}
      {isOwner && modal === "rescisao" && <RescisaoModal nome={artist.nome} onClose={() => setModal(null)} />}
      {isOwner && modal === "composicao" && <ComposicaoModal nome={artist.nome} onClose={() => setModal(null)} />}
      {isOwner && modal === "imovel" && <ImovelModal nome={artist.nome} onClose={() => setModal(null)} />}
    </main>
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
    <div className="p-4 rounded-[1.8rem] bg-white/5 backdrop-blur-md border border-white/10 flex items-center gap-4">
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
    <button onClick={onClick} className={`flex-1 py-4 rounded-[1.5rem] text-[10px] font-black uppercase tracking-[0.2em] transition-all duration-500 ${active ? "bg-primary text-primary-foreground shadow-2xl shadow-primary/30 scale-[1.02] z-10" : "text-muted-foreground hover:bg-white/5 hover:text-white/60"}`}>
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