import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  ChevronLeft,
  MapPin,
  Ticket,
  Users,
  TrendingUp,
  Calendar,
  Star,
  CheckCircle2,
  Mic2,
  Globe,
  Loader2,
  Trophy,
  Crown,
} from "lucide-react";
import { api, type Artist, fmtEC, driveImg } from "@/lib/api";

export const Route = createFileRoute("/tours/$nome")({
  component: TourDetails,
});

function TourDetails() {
  const { nome } = Route.useParams();
  const [artist, setArtist] = useState<Artist | null>(null);
  const [tourDetails, setTourDetails] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setLoading(true);

    // 💡 Ajuste Crítico: Decodifica o nome (remove %20) e ignora maiúsculas/minúsculas
    const safeNome = decodeURIComponent(nome || "")
      .trim()
      .toLowerCase();

    // Adicionado .catch para não quebrar tudo se uma das rotas da API oscilar
    Promise.all([
      api.listarTodos().catch(() => []),
      api.listTours().catch(() => []),
      api.getAgendaTour(nome).catch(() => []),
    ]).then(([artists, toursList, agendaData]) => {
      const art = (Array.isArray(artists) ? artists : []).find((a) => a.nome?.trim().toLowerCase() === safeNome);
      setArtist(art || null);

      const tFromList = (Array.isArray(toursList) ? toursList : []).find(
        (t) => t.artista?.trim().toLowerCase() === safeNome,
      );

      // 💡 Ajuste Crítico 2: Restaurando a prioridade da API que puxa o Histórico real (agendaData)
      let agenda: any[] = [];
      if (Array.isArray(agendaData) && agendaData.length > 0) {
        agenda = agendaData;
      } else if (tFromList) {
        if (typeof tFromList.agenda === "string") {
          try {
            agenda = JSON.parse(tFromList.agenda);
          } catch (e) {
            agenda = [];
          }
        } else if (Array.isArray(tFromList.agenda)) {
          agenda = tFromList.agenda;
        }
      }

      if (tFromList) {
        setTourDetails({
          titulo: tFromList.titulo || "The Empire Tour",
          tipo: tFromList.porte || "Arena",
          status: tFromList.status || "Em andamento",
          qtd: Number(tFromList.total_shows || 0),
          shows_realizados: Number(tFromList.show_atual || 0),
          local_atual: tFromList.local_atual || "Mundial",
          arrecadacao_total: Number(tFromList.arrecadacao_total || 0),
          agenda: agenda, // ✅ Histórico volta a funcionar!
          foto: tFromList.foto || "",
        });
      } else if (art && art.tour_info) {
        let info: any = art.tour_info;
        if (typeof info === "string") {
          try {
            const cleanJson = info
              .trim()
              .replace(/^"+|"+$/g, "")
              .replace(/\\"/g, '"');
            info = JSON.parse(cleanJson);
          } catch {
            try {
              info = JSON.parse(info);
            } catch {
              info = {};
            }
          }
        }

        const agendaFallback = agenda.length > 0 ? agenda : Array.isArray(info.agenda) ? info.agenda : [];

        setTourDetails({
          titulo: info.titulo || "The Empire Tour",
          tipo: info.tipo || "Arena",
          status: info.status || "Em andamento",
          qtd: Number(info.qtd || info.shows || 10),
          shows_realizados: Number(info.shows_realizados || info.realizados || 0),
          local_atual: info.continente || "Mundial",
          arrecadacao_total: Number(info.arrecadacao_total || 0),
          agenda: agendaFallback,
        });
      } else {
        setTourDetails(null);
      }
      setLoading(false);
    });
  }, [nome]);

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

  if (!artist || !tourDetails) {
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

  const info = tourDetails;
  const progress = info.qtd > 0 ? (info.shows_realizados / info.qtd) * 100 : 0;

  const publicoTotal = Array.isArray(info.agenda)
    ? info.agenda.reduce((acc: number, s: any) => acc + (Number(s.vendidos) || 0), 0)
    : 0;

  const soldOutsCount = Array.isArray(info.agenda)
    ? info.agenda.filter((s: any) => Number(s.vendidos) >= Number(s.capacidade) * 0.98).length
    : 0;

  const handleEditPhoto = async () => {
    const url = prompt("Insira o link direto da imagem (Google Drive):", info.foto || "");
    if (url === null) return;

    setSaving(true);
    try {
      const res = await api.vincularImagemTour(nome, url);
      if (res.ok) {
        setTourDetails((prev: any) => ({ ...prev, foto: url }));
        alert(res.message);
      } else {
        alert("Erro: " + res.erro);
      }
    } catch (e) {
      alert("Erro ao salvar imagem.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="flex-1 pb-24 bg-background">
      <div className="relative h-[45vh] min-h-[360px] overflow-hidden">
        {info.foto ? (
          <img
            src={driveImg(info.foto, 800)}
            className="w-full h-full object-cover object-top scale-105 blur-[2px] opacity-40 bg-black"
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

        <div className="absolute inset-x-6 bottom-12 z-20">
          <div className="flex flex-col items-center text-center">
            <button
              onClick={handleEditPhoto}
              disabled={saving}
              className="size-20 rounded-[2.5rem] overflow-hidden border-2 border-primary/30 shadow-2xl mb-4 rotate-[-3deg] active:scale-95 transition-transform bg-black relative group"
            >
              {info.foto ? (
                <img
                  src={driveImg(info.foto, 400)}
                  className="w-full h-full object-cover object-top"
                  alt={artist.nome}
                  loading="lazy"
                  decoding="async"
                />
              ) : (
                <Crown className="size-10 m-auto text-primary" />
              )}
              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                <span className="text-[11px] font-black uppercase text-white tabular-nums">Editar</span>
              </div>
            </button>
            <div className="flex items-center gap-2 mb-2">
              <span className="px-3 py-1 rounded-full bg-primary/20 text-primary text-[11px] font-black uppercase tracking-widest border border-primary/20">
                {info.tipo}
              </span>
              <span className="text-[10px] font-black text-white/40 uppercase tracking-widest italic">
                {artist.nome}
              </span>
            </div>
            <h1 className="text-4xl font-black italic uppercase tracking-tighter leading-none mb-2 drop-shadow-[0_4px_12px_rgba(0,0,0,0.5)]">
              {info.titulo}
            </h1>

            <div className="mt-4 px-6 py-3 rounded-3xl bg-emerald-500/10 border border-emerald-500/20 backdrop-blur-xl flex flex-col items-center">
              <span className="text-[11px] font-black uppercase tracking-[0.2em] text-emerald-500/60 mb-1">
                Arrecadação Total
              </span>
              <span className="text-2xl font-black italic tracking-tighter text-emerald-400">
                {fmtEC(info.arrecadacao_total)}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="px-6 -mt-6 relative z-30 space-y-6">
        <div className="grid grid-cols-3 gap-3">
          <StatMini icon={<Users className="size-4" />} value={publicoTotal.toLocaleString()} label="Fans" />
          <StatMini icon={<Star className="size-4" />} value={soldOutsCount} label="Sold Outs" />
          <StatMini
            icon={<Calendar className="size-4" />}
            value={`${info.shows_realizados}/${info.qtd}`}
            label="Shows"
          />
        </div>

        <div className="p-6 rounded-[2.5rem] bg-card border border-white/5 relative overflow-hidden group">
          <div className="flex justify-between items-end mb-4 relative z-10">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-1">
                Progresso Executado
              </p>
              <h4 className="text-2xl font-black italic tracking-tighter uppercase">{info.status}</h4>
            </div>
            <span className="text-3xl font-black italic text-primary">{Math.round(progress)}%</span>
          </div>
          <div className="h-4 bg-white/5 rounded-full overflow-hidden p-1 border border-white/5 relative z-10">
            <div
              className="h-full bg-gradient-to-r from-primary/60 to-primary rounded-full transition-all duration-1000 shadow-[0_0_15px_rgba(var(--primary),0.3)]"
              style={{ width: `${progress}%` }}
            />
          </div>
          <Crown className="absolute -right-4 -bottom-4 size-32 opacity-5 rotate-12 group-hover:scale-110 transition-transform duration-700" />
        </div>

        <section>
          <div className="flex items-center justify-between mb-5 px-1">
            <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground">
              Itinerário de Shows
            </h3>
            <div className="flex items-center gap-1.5 text-[11px] font-black text-primary uppercase">
              <Globe className="size-3" /> {info.local_atual || "EM ROTA MUNDIAL"}
            </div>
          </div>

          <div className="space-y-3">
            {Array.isArray(info.agenda) && info.agenda.length > 0 ? (
              (() => {
                const meses = ["JAN","FEV","MAR","ABR","MAI","JUN","JUL","AGO","SET","OUT","NOV","DEZ"];
                let acumulado = 0;
                return info.agenda.map((s: any, i: number) => {
                  const isPast = i < info.shows_realizados;
                  const isCurrent = i === info.shows_realizados;
                  const vendidos = Number(s.vendidos) || 0;
                  const capacidade = Number(s.capacidade) || 1;
                  const pct = Math.min(100, Math.round((vendidos / capacidade) * 100));
                  const fatur = Number(s.faturamento) || vendidos * 50;
                  if (isPast || isCurrent) acumulado += fatur;
                  const soldOut = pct >= 98;

                  let dia = String(i + 1).padStart(2, "0");
                  let mes = meses[new Date().getMonth()];
                  if (s.data) {
                    const d = new Date(s.data);
                    if (!isNaN(d.getTime())) {
                      dia = String(d.getDate()).padStart(2, "0");
                      mes = meses[d.getMonth()];
                    } else if (typeof s.data === "string" && s.data.includes("/")) {
                      const [dStr, mStr] = s.data.split("/");
                      dia = String(dStr).padStart(2, "0");
                      const mIdx = Number(mStr) - 1;
                      if (mIdx >= 0 && mIdx < 12) mes = meses[mIdx];
                    }
                  }

                  return (
                    <div
                      key={i}
                      className={`p-4 rounded-3xl border transition-all ${
                        isCurrent
                          ? "bg-primary/10 border-primary/30 ring-1 ring-primary/10"
                          : isPast
                            ? "bg-white/[0.01] border-white/5 opacity-70"
                            : "bg-card border-white/5"
                      }`}
                    >
                      <div className="flex items-center gap-4">
                        <div
                          className={`size-14 rounded-2xl flex flex-col items-center justify-center shrink-0 border ${
                            isCurrent
                              ? "bg-primary border-primary text-primary-foreground"
                              : isPast
                                ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-500"
                                : "bg-white/5 border-white/5 text-muted-foreground"
                          }`}
                        >
                          <span className="text-[10px] font-black uppercase opacity-70">{mes}</span>
                          <span className="text-lg font-black tracking-tighter leading-none">{dia}</span>
                        </div>

                        <div className="flex-1 min-w-0">
                          <h5 className="font-black text-sm uppercase tracking-tight truncate">
                            {s.local || "Cidade do Império"}
                          </h5>
                          <div className="flex items-center gap-2 mt-1 text-[10px] font-bold text-muted-foreground uppercase">
                            <MapPin className="size-2.5 text-primary" /> The Empire {info.tipo}
                          </div>
                        </div>

                        <div className="text-right shrink-0">
                          {soldOut ? (
                            <div className="px-2 py-1 bg-amber-500/10 border border-amber-500/20 text-amber-500 text-[10px] font-black uppercase rounded-lg">
                              SOLD OUT
                            </div>
                          ) : isPast ? (
                            <CheckCircle2 className="size-5 text-emerald-500" />
                          ) : (
                            <span className="text-[10px] font-black text-muted-foreground/40 uppercase">
                              Em vendas
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="mt-3 space-y-1.5">
                        <div className="flex justify-between text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                          <span>{vendidos.toLocaleString("pt-BR")} / {capacidade.toLocaleString("pt-BR")} fãs</span>
                          <span>{pct}%</span>
                        </div>
                        <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${
                              soldOut ? "bg-amber-500" : "bg-gradient-to-r from-primary/60 to-primary"
                            }`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <div className="flex justify-between text-[10px] font-black uppercase tracking-wider pt-1">
                          <span className="text-muted-foreground">Show: <span className="text-emerald-400">{fmtEC(fatur)}</span></span>
                          {(isPast || isCurrent) && (
                            <span className="text-muted-foreground">Acumulado: <span className="text-emerald-400">{fmtEC(acumulado)}</span></span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                });
              })()
            ) : (
              <div className="py-20 text-center bg-card rounded-[2.5rem] border border-dashed border-white/5">
                <Mic2 className="size-10 text-muted-foreground/10 mx-auto mb-3" />
                <p className="text-xs text-muted-foreground italic">Carregando agenda detalhada...</p>
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

function StatMini({ icon, value, label }: any) {
  return (
    <div className="flex-1 p-3 rounded-2xl bg-card border border-white/5 flex flex-col items-center text-center">
      <div className="size-7 rounded-lg bg-white/5 grid place-items-center mb-1.5 text-primary">{icon}</div>
      <span className="text-base font-black tracking-tight leading-none mb-0.5">{value}</span>
      <span className="text-[11px] font-black uppercase tracking-widest text-muted-foreground/40">{label}</span>
    </div>
  );
}
