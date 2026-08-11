import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  ChevronLeft,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Music2,
  TrendingUp,
  Wallet,
  Users,
} from "lucide-react";
import { api } from "@/lib/api";
import { useTelegramUser, haptic } from "@/lib/telegram";

export const Route = createFileRoute("/ponto/distribuir/planilha")({
  component: PontoPlanilha,
});

const OPCOES_PONTOS: Record<string, string[]> = {
  "BILLBOARD HOT 100": ["1,00%", "2,00%", "3,00%", "4,00%", "5,00%", "6,00%", "7,00%", "8,00%", "9,00%", "10,00%"],
  SPOTIFY: ["30,00%", "40,00%", "50,00%", "60,00%", "70,00%"],
  "APPLE MUSIC": ["30,00%", "40,00%", "50,00%", "60,00%", "70,00%"],
  YOUTUBE: ["10,00%", "15,00%", "20,00%", "25,00%", "30,00%", "35,00%", "40,00%", "45,00%", "50,00%", "55,00%", "60,00%", "65,00%", "70,00%"],
  "DIGITAL SALES": ["10,00%", "15,00%", "20,00%", "25,00%", "30,00%", "35,00%", "40,00%", "45,00%", "50,00%", "55,00%", "60,00%", "65,00%", "70,00%"],
  "BILLBOARD 200": ["10,00%", "15,00%", "20,00%", "25,00%", "30,00%", "35,00%", "40,00%", "45,00%", "50,00%", "55,00%", "60,00%", "65,00%", "70,00%"],
};

type PontoMusica = {
  linha: number;
  artista: string;
  musica: string;
  weeks: string;
  pontosDisponiveis: string;
  pontosUtilizados: string;
  categorias: Record<string, string>;
  dataLancamento: string;
};

type PontoGrupo = { artista: string; musicas: PontoMusica[] };

function PontoPlanilha() {
  const { user, ready } = useTelegramUser();
  const tgId = user?.id ? String(user.id) : (typeof window !== "undefined" ? localStorage.getItem("empire_tg_id") : null) || "";

  const [grupos, setGrupos] = useState<PontoGrupo[]>([]);
  const [artistaAtivo, setArtistaAtivo] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [musicaSelecionada, setMusicaSelecionada] = useState<PontoMusica | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ key: string; text: string; ok: boolean } | null>(null);

  useEffect(() => {
    if (!tgId) return;
    setLoading(true);
    api
      .listarPontos(tgId)
      .then((d) => {
        setGrupos(d.grupos);
        if (d.grupos.length > 0) setArtistaAtivo((cur) => cur || d.grupos[0].artista);
      })
      .catch(() => {
        setMsg({ key: "global", text: "Erro ao se conectar com a planilha PONTOS.", ok: false });
      })
      .finally(() => setLoading(false));
  }, [tgId]);

  const grupoAtivo = useMemo(
    () => grupos.find((g) => g.artista === artistaAtivo) || null,
    [grupos, artistaAtivo],
  );

  async function salvarPonto(row: PontoMusica, coluna: string, valor: string) {
    const key = `${row.linha}-${coluna}`;
    setSaving(key);
    setMsg(null);
    const r = await api.salvarPontoCelula(tgId, row.linha, coluna, valor);
    setSaving(null);
    if ((r as any)?.ok) {
      haptic.success();
      setGrupos((prev) =>
        prev.map((g) => ({
          ...g,
          musicas: g.musicas.map((m) =>
            m.linha === row.linha ? { ...m, categorias: { ...m.categorias, [coluna]: valor } } : m,
          ),
        })),
      );
      setMusicaSelecionada((prev) =>
        prev && prev.linha === row.linha ? { ...prev, categorias: { ...prev.categorias, [coluna]: valor } } : prev,
      );
      setMsg({ key, text: "Salvo com sucesso!", ok: true });
    } else {
      setMsg({ key, text: (r as any)?.error || "Erro ao salvar", ok: false });
    }
  }

  if (!ready || loading)
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="animate-spin text-primary w-8 h-8" />
      </div>
    );

  // === VIEW DE DETALHE DA MÚSICA ===
  if (musicaSelecionada) {
    return (
      <main className="flex-1 mx-auto w-full max-w-md px-5 pt-6 pb-24 flex flex-col gap-4">
        <button
          onClick={() => {
            setMusicaSelecionada(null);
            setMsg(null);
          }}
          className="flex items-center gap-1 text-sm text-muted-foreground mb-2 hover:text-primary transition-colors w-fit"
        >
          <ChevronLeft className="w-4 h-4" /> Voltar para músicas
        </button>

        <div className="rounded-2xl border border-white/10 bg-card p-4 flex items-start gap-3 shadow-lg">
          <div className="size-11 rounded-xl bg-primary/15 grid place-items-center shrink-0">
            <Music2 className="size-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] text-primary font-bold uppercase tracking-widest truncate mb-1">
              {musicaSelecionada.artista}
            </p>
            <h2 className="font-black text-lg leading-tight truncate">{musicaSelecionada.musica}</h2>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-2xl bg-card border border-white/10 p-3">
            <div className="flex items-center gap-1.5 mb-1">
              <Wallet className="w-3.5 h-3.5 text-green-400" />
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-bold">Disponível</p>
            </div>
            <p className="text-base font-black text-green-400">{musicaSelecionada.pontosDisponiveis || "0%"}</p>
          </div>
          <div className="rounded-2xl bg-card border border-white/10 p-3">
            <div className="flex items-center gap-1.5 mb-1">
              <TrendingUp className="w-3.5 h-3.5 text-yellow-400" />
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-bold">Utilizado</p>
            </div>
            <p className="text-base font-black text-yellow-400">{musicaSelecionada.pontosUtilizados || "0%"}</p>
          </div>
        </div>

        <div className="flex flex-col gap-3 mt-2">
          {Object.entries(OPCOES_PONTOS).map(([coluna, opcoes]) => {
            const colKey = `${musicaSelecionada.linha}-${coluna}`;
            const salvoVal = musicaSelecionada.categorias?.[coluna] || "";
            const isSaving = saving === colKey;

            return (
              <div key={coluna} className="rounded-2xl bg-card border border-white/10 overflow-hidden">
                <div className="px-4 py-3 bg-white/5 border-b border-white/5 flex items-center justify-between">
                  <p className="text-xs font-black text-gray-200 tracking-wide">{coluna}</p>
                  {salvoVal && (
                    <span className="text-[10px] bg-primary/15 text-primary px-2 py-1 rounded-full flex items-center gap-1 font-bold">
                      <CheckCircle2 className="w-3 h-3" /> {salvoVal}
                    </span>
                  )}
                </div>
                <div className="p-3 grid grid-cols-3 gap-1.5">
                  {opcoes.map((op) => {
                    const sel = salvoVal === op;
                    return (
                      <button
                        key={op}
                        disabled={isSaving}
                        onClick={() => salvarPonto(musicaSelecionada, coluna, op)}
                        className={`px-2 py-2 rounded-lg text-xs font-bold border transition-all active:scale-95 ${
                          sel
                            ? "border-primary bg-primary/20 text-primary shadow-[0_0_10px_rgba(var(--primary),0.25)]"
                            : "border-white/10 bg-black/30 hover:border-primary/50 text-gray-300"
                        } ${isSaving ? "opacity-50 cursor-wait" : ""}`}
                      >
                        {op}
                      </button>
                    );
                  })}
                </div>
                {isSaving && (
                  <div className="px-4 pb-3 flex items-center gap-2 text-xs text-primary">
                    <Loader2 className="w-3 h-3 animate-spin" /> Salvando...
                  </div>
                )}
                {msg?.key === colKey && (
                  <p className={`px-4 pb-3 text-xs font-semibold ${msg.ok ? "text-green-400" : "text-red-400"}`}>
                    {msg.text}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </main>
    );
  }

  // === VIEW DE LISTA DE MÚSICAS (por artista) ===
  return (
    <main className="flex-1 mx-auto w-full max-w-md px-5 pt-6 pb-24 flex flex-col gap-4">
      <Link to="/ponto/distribuir" className="flex items-center gap-1 text-sm text-muted-foreground mb-2 w-fit">
        <ChevronLeft className="w-4 h-4" /> Voltar
      </Link>

      <div className="mb-2">
        <h2 className="text-2xl font-black italic tracking-tighter">Pontos · Manual</h2>
        <p className="text-sm text-muted-foreground mt-1">Escolha o artista e toque numa música pra distribuir.</p>
      </div>

      {msg?.key === "global" && (
        <div className="p-4 bg-red-950/40 border border-red-500/50 rounded-2xl text-red-400 text-sm font-semibold">
          {msg.text}
        </div>
      )}

      {grupos.length === 0 && !msg ? (
        <div className="p-8 text-center bg-white/5 rounded-2xl border border-white/10">
          <AlertCircle className="w-8 h-8 mx-auto text-muted-foreground mb-3 opacity-50" />
          <p className="text-sm text-muted-foreground">
            Nenhuma música encontrada na aba PONTOS para os seus artistas.
          </p>
        </div>
      ) : (
        <>
          <div className="flex overflow-x-auto gap-1.5 hide-scrollbar -mx-1 px-1">
            {grupos.map((g) => (
              <button
                key={g.artista}
                onClick={() => {
                  haptic.selection();
                  setArtistaAtivo(g.artista);
                }}
                className={`whitespace-nowrap px-3 py-1.5 rounded-full text-xs font-bold transition-colors inline-flex items-center gap-1.5 ${
                  artistaAtivo === g.artista
                    ? "bg-primary text-primary-foreground"
                    : "bg-white/5 text-muted-foreground border border-white/10 hover:bg-white/10"
                }`}
              >
                <Users className="w-3 h-3" /> {g.artista}
              </button>
            ))}
          </div>

          <div className="flex flex-col gap-3">
            {(grupoAtivo?.musicas || []).length === 0 ? (
              <div className="p-6 text-center bg-white/5 rounded-2xl border border-white/10">
                <p className="text-sm text-muted-foreground">Nenhuma música de {artistaAtivo} na aba PONTOS.</p>
              </div>
            ) : (
              grupoAtivo!.musicas.map((row) => {
                const disponivelNum = parseFloat(String(row.pontosDisponiveis).replace("%", "").replace(",", ".")) || 0;
                const utilizadoNum = parseFloat(String(row.pontosUtilizados).replace("%", "").replace(",", ".")) || 0;

                return (
                  <button
                    key={row.linha}
                    onClick={() => {
                      haptic.selection();
                      setMusicaSelecionada(row);
                      setMsg(null);
                    }}
                    className="rounded-2xl border border-white/10 bg-card overflow-hidden shadow-lg transition-all hover:border-primary/40 text-left"
                  >
                    <div className="px-4 py-4">
                      <div className="flex justify-between items-start mb-3">
                        <div className="flex-1 pr-4 min-w-0">
                          <p className="text-[10px] text-primary font-bold uppercase tracking-widest mb-1 truncate">
                            {row.artista}
                          </p>
                          <h3 className="font-bold text-base leading-tight truncate">{row.musica}</h3>
                        </div>
                        <div className="size-9 rounded-xl bg-primary/10 grid place-items-center shrink-0">
                          <Music2 className="size-4 text-primary" />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div className="rounded-xl bg-white/5 border border-white/5 px-3 py-2">
                          <div className="flex items-center gap-1.5 mb-0.5">
                            <Wallet className="w-3 h-3 text-green-400" />
                            <p className="text-[9px] text-muted-foreground uppercase tracking-wider font-bold">
                              Disponível
                            </p>
                          </div>
                          <p className="text-sm font-black text-green-400">{row.pontosDisponiveis || "0%"}</p>
                        </div>
                        <div className="rounded-xl bg-white/5 border border-white/5 px-3 py-2">
                          <div className="flex items-center gap-1.5 mb-0.5">
                            <TrendingUp className="w-3 h-3 text-yellow-400" />
                            <p className="text-[9px] text-muted-foreground uppercase tracking-wider font-bold">
                              Utilizado
                            </p>
                          </div>
                          <p className="text-sm font-black text-yellow-400">{row.pontosUtilizados || "0%"}</p>
                        </div>
                      </div>

                      {(disponivelNum > 0 || utilizadoNum > 0) && (
                        <div className="mt-3 h-1.5 rounded-full bg-white/5 overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-yellow-400 to-primary transition-all"
                            style={{
                              width: `${Math.min(100, (utilizadoNum / Math.max(1, utilizadoNum + disponivelNum)) * 100)}%`,
                            }}
                          />
                        </div>
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </>
      )}
    </main>
  );
}
