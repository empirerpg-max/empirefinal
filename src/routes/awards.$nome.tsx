import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, Trophy, Loader2, Sparkles } from "lucide-react";
import { api } from "@/lib/api";
import { SmartImg } from "@/components/SmartImg";

export const Route = createFileRoute("/awards/$nome")({
  component: AwardDetalhePage,
});

type Nomeado = {
  ano: string;
  segmento?: string;
  categoria: string;
  status: "vencedor" | "indicado";
  titulo?: string;
  artista?: string;
  capa?: string;
};
type Edicao = { ano: string; categorias: Nomeado[] };
type AwardData = { nome: string; foto?: string; edicoes: Edicao[] };

type CategoriaAgrupada = { categoria: string; vencedor: Nomeado | null; indicados: Nomeado[] };
type SegmentoAgrupado = { segmento: string; categorias: CategoriaAgrupada[] };

function nomeExibicao(n: Nomeado): string {
  return n.titulo || n.artista || "";
}

function AwardDetalhePage() {
  const navigate = useNavigate();
  const { nome } = Route.useParams();
  const [data, setData] = useState<AwardData | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [anoSelecionado, setAnoSelecionado] = useState<string | null>(null);
  const [categoriasAbertas, setCategoriasAbertas] = useState<Set<string>>(new Set());

  useEffect(() => {
    setData(null);
    setErro(null);
    setAnoSelecionado(null);
    api
      .getAwardDetalhe(nome)
      .then((res) => {
        if (res.success && res.data) {
          setData(res.data);
          setAnoSelecionado(res.data.edicoes[0]?.ano ?? null);
        } else {
          setErro(res.error || "Não foi possível carregar esse award.");
        }
      })
      .catch(() => setErro("Erro de conexão."));
  }, [nome]);

  useEffect(() => setCategoriasAbertas(new Set()), [anoSelecionado]);

  const edicaoAtual = useMemo(
    () => data?.edicoes.find((e) => e.ano === anoSelecionado) || null,
    [data, anoSelecionado],
  );

  // Agrupa Segmento > Categoria > (vencedor + indicados) — cada categoria
  // vira UM card só, com todos os nomeados dela dentro, em vez de repetir o
  // nome da categoria a cada linha.
  const grupos = useMemo<SegmentoAgrupado[]>(() => {
    if (!edicaoAtual) return [];
    const porSegmento = new Map<string, Map<string, CategoriaAgrupada>>();
    for (const n of edicaoAtual.categorias) {
      const chaveSeg = n.segmento || "Geral";
      if (!porSegmento.has(chaveSeg)) porSegmento.set(chaveSeg, new Map());
      const porCategoria = porSegmento.get(chaveSeg)!;
      if (!porCategoria.has(n.categoria)) {
        porCategoria.set(n.categoria, { categoria: n.categoria, vencedor: null, indicados: [] });
      }
      const grupo = porCategoria.get(n.categoria)!;
      if (n.status === "vencedor" && !grupo.vencedor) grupo.vencedor = n;
      else grupo.indicados.push(n);
    }
    return Array.from(porSegmento.entries()).map(([segmento, mapa]) => ({
      segmento,
      categorias: Array.from(mapa.values()),
    }));
  }, [edicaoAtual]);

  const totalCategorias = edicaoAtual?.categorias.length
    ? new Set(edicaoAtual.categorias.map((c) => c.categoria)).size
    : 0;

  const toggleCategoria = (chave: string) => {
    setCategoriasAbertas((prev) => {
      const next = new Set(prev);
      if (next.has(chave)) next.delete(chave);
      else next.add(chave);
      return next;
    });
  };

  return (
    <div className="pb-24 min-h-screen bg-black">
      <div className="relative h-72 overflow-hidden">
        {data?.foto && (
          <img
            src={data.foto}
            alt=""
            referrerPolicy="no-referrer"
            className="absolute inset-0 w-full h-full object-cover"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-black/30 to-black" />
        <button
          onClick={() => navigate({ to: "/awards" })}
          className="absolute top-4 left-4 size-10 rounded-full bg-black/40 border border-white/15 backdrop-blur grid place-items-center"
        >
          <ChevronLeft className="size-5 text-white" />
        </button>
      </div>

      <div className="relative -mt-16 rounded-t-[32px] bg-background min-h-[60vh] px-5 pt-6 shadow-[0_-20px_40px_-20px_rgba(0,0,0,0.6)]">
        {!data && !erro && (
          <div className="flex items-center justify-center p-20">
            <Loader2 className="size-8 text-primary animate-spin" />
          </div>
        )}

        {erro && <p className="text-center text-sm text-muted-foreground py-16">{erro}</p>}

        {data && (
          <>
            <h1 className="text-2xl font-black uppercase tracking-tight leading-none flex items-center gap-2">
              <Trophy className="size-5 text-primary shrink-0" />
              {data.nome}
            </h1>
            {edicaoAtual && (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground font-medium">
                <span>{data.edicoes.length} edições</span>
                <span className="opacity-40">·</span>
                <span className="flex items-center gap-1 text-amber-400">
                  <Sparkles className="size-3.5" /> {totalCategorias} categorias em {anoSelecionado}
                </span>
              </p>
            )}
          </>
        )}

        {data && data.edicoes.length === 0 && (
          <p className="text-center text-sm text-muted-foreground py-16">
            Nenhum resultado cadastrado ainda pra esse award.
          </p>
        )}

        {data && data.edicoes.length > 0 && (
          <>
            <div className="flex gap-2 overflow-x-auto py-4 -mx-5 px-5 scrollbar-none">
              {data.edicoes.map((e) => (
                <button
                  key={e.ano}
                  onClick={() => setAnoSelecionado(e.ano)}
                  className={`shrink-0 px-4 py-2 rounded-full text-xs font-black transition-all active:scale-95 ${
                    anoSelecionado === e.ano
                      ? "bg-primary text-primary-foreground"
                      : "bg-white/5 border border-white/10 text-muted-foreground"
                  }`}
                >
                  {e.ano}
                </button>
              ))}
            </div>

            <div className="space-y-7 mt-1">
              {grupos.map(({ segmento, categorias }) => (
                <div key={segmento}>
                  <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-3">
                    {segmento}
                  </p>
                  <div className="space-y-3">
                    {categorias.map((grupo) => {
                      const chave = `${anoSelecionado}-${segmento}-${grupo.categoria}`;
                      const aberto = categoriasAbertas.has(chave);
                      return (
                        <div
                          key={chave}
                          className="rounded-3xl border border-white/10 bg-white/[0.03] overflow-hidden"
                        >
                          <div className="px-4 pt-3.5 pb-1">
                            <p className="text-[11px] font-black uppercase tracking-wide text-muted-foreground">
                              {grupo.categoria}
                            </p>
                          </div>

                          {grupo.vencedor && (
                            <div className="px-4 py-3 flex items-center gap-3">
                              <div className="relative size-14 shrink-0 rounded-2xl overflow-hidden bg-secondary grid place-items-center ring-2 ring-amber-400/60">
                                {grupo.vencedor.capa ? (
                                  <SmartImg
                                    src={grupo.vencedor.capa}
                                    size={200}
                                    alt=""
                                    className="w-full h-full object-cover"
                                  />
                                ) : (
                                  <Trophy className="size-5 text-muted-foreground/40" />
                                )}
                                <div className="absolute -top-1 -right-1 size-5 rounded-full bg-amber-400 grid place-items-center shadow">
                                  <Trophy className="size-3 text-black" strokeWidth={2.5} />
                                </div>
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-bold leading-snug truncate">
                                  {nomeExibicao(grupo.vencedor)}
                                </p>
                                {grupo.vencedor.titulo && grupo.vencedor.artista && (
                                  <p className="text-xs text-muted-foreground truncate">{grupo.vencedor.artista}</p>
                                )}
                              </div>
                              <span className="shrink-0 text-[10px] font-black uppercase text-amber-400">
                                Vencedor
                              </span>
                            </div>
                          )}

                          {grupo.indicados.length > 0 && (
                            <>
                              <button
                                onClick={() => toggleCategoria(chave)}
                                className="w-full px-4 py-2.5 flex items-center justify-between text-[11px] font-bold text-muted-foreground border-t border-white/5 active:bg-white/[0.02] transition"
                              >
                                <span>
                                  {aberto ? "Ocultar" : "Ver"} {grupo.indicados.length}{" "}
                                  {grupo.indicados.length === 1 ? "indicado" : "indicados"}
                                </span>
                                <ChevronLeft
                                  className={`size-3.5 transition-transform ${aberto ? "-rotate-90" : "rotate-180"}`}
                                />
                              </button>
                              {aberto && (
                                <div className="px-4 pb-3.5 space-y-2.5">
                                  {grupo.indicados.map((n, i) => (
                                    <div key={i} className="flex items-center gap-3">
                                      <div className="size-9 shrink-0 rounded-xl overflow-hidden bg-secondary grid place-items-center">
                                        {n.capa ? (
                                          <SmartImg src={n.capa} size={120} alt="" className="w-full h-full object-cover" />
                                        ) : (
                                          <Trophy className="size-3.5 text-muted-foreground/30" />
                                        )}
                                      </div>
                                      <div className="min-w-0 flex-1">
                                        <p className="text-xs font-semibold truncate">{nomeExibicao(n)}</p>
                                        {n.titulo && n.artista && (
                                          <p className="text-[11px] text-muted-foreground truncate">{n.artista}</p>
                                        )}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
