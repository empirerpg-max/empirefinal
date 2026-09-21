import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, Trophy, Loader2 } from "lucide-react";
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
  const segmentoRefs = useRef<Map<string, HTMLDivElement>>(new Map());

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

  const edicaoAtual = useMemo(
    () => data?.edicoes.find((e) => e.ano === anoSelecionado) || null,
    [data, anoSelecionado],
  );

  // Agrupa Segmento > Categoria > (vencedor + indicados) — cada categoria
  // vira UM card só, com todos os nomeados dela dentro.
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

  const irParaSegmento = (segmento: string) => {
    segmentoRefs.current.get(segmento)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="pb-24 min-h-screen bg-black">
      {/* Hero: imagem cheia, com título + fileira de ícones SOBRE a imagem
          (não abaixo, no card claro) — mesma estrutura do print de referência. */}
      <div className="relative overflow-hidden">
        <div className="relative h-[26rem]">
          {data?.foto && (
            <img
              src={data.foto}
              alt=""
              referrerPolicy="no-referrer"
              className="absolute inset-0 w-full h-full object-cover"
            />
          )}
          <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-black/20 to-black/95" />

          <button
            onClick={() => navigate({ to: "/awards" })}
            className="absolute top-4 left-4 size-10 rounded-full bg-black/40 border border-white/15 backdrop-blur grid place-items-center"
          >
            <ChevronLeft className="size-5 text-white" />
          </button>

          <div className="absolute inset-x-0 bottom-0 px-5 pb-6">
            <h1 className="text-3xl font-black uppercase tracking-tight leading-none text-white drop-shadow">
              {data?.nome || nome}
            </h1>
            {data && edicaoAtual && (
              <p className="mt-2 text-[12px] text-white/70 font-medium">
                {data.edicoes.length} edições · {totalCategorias} categorias em {anoSelecionado}
              </p>
            )}

            {/* Fileira de ícones (segmentos do ano selecionado), sobre a
                imagem — toque leva direto pro bloco daquele segmento. */}
            {grupos.length > 0 && (
              <div className="flex gap-4 overflow-x-auto pt-5 -mx-5 px-5 scrollbar-none">
                {grupos.map(({ segmento }) => (
                  <button
                    key={segmento}
                    onClick={() => irParaSegmento(segmento)}
                    className="shrink-0 flex flex-col items-center gap-1.5 active:scale-95 transition"
                  >
                    <span className="size-12 rounded-full bg-white/10 border border-white/20 backdrop-blur grid place-items-center">
                      <Trophy className="size-4.5 text-white" />
                    </span>
                    <span className="text-[9px] font-bold text-white/80 uppercase tracking-wide max-w-14 truncate">
                      {segmento}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="relative -mt-6 rounded-t-[32px] bg-background min-h-[40vh] px-5 pt-6 shadow-[0_-20px_40px_-20px_rgba(0,0,0,0.6)]">
        {!data && !erro && (
          <div className="flex items-center justify-center p-20">
            <Loader2 className="size-8 text-primary animate-spin" />
          </div>
        )}

        {erro && <p className="text-center text-sm text-muted-foreground py-16">{erro}</p>}

        {data && data.edicoes.length === 0 && (
          <p className="text-center text-sm text-muted-foreground py-16">
            Nenhum resultado cadastrado ainda pra esse award.
          </p>
        )}

        {data && data.edicoes.length > 0 && (
          <>
            <div className="flex gap-2 overflow-x-auto pb-5 -mx-5 px-5 scrollbar-none">
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

            <div className="space-y-7">
              {grupos.map(({ segmento, categorias }) => (
                <div
                  key={segmento}
                  ref={(el) => {
                    if (el) segmentoRefs.current.set(segmento, el);
                  }}
                  className="scroll-mt-4"
                >
                  <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-3">
                    {segmento}
                  </p>
                  <div className="space-y-4">
                    {categorias.map((grupo) => (
                      <div
                        key={grupo.categoria}
                        className="rounded-3xl border border-white/10 bg-white/[0.03] p-4"
                      >
                        <p className="text-[11px] font-black uppercase tracking-wide text-muted-foreground mb-3">
                          {grupo.categoria}
                        </p>

                        {grupo.vencedor && (
                          <div className="flex items-center gap-4 mb-3">
                            <div className="relative size-20 shrink-0 rounded-2xl overflow-hidden bg-secondary grid place-items-center ring-[3px] ring-amber-400">
                              {grupo.vencedor.capa ? (
                                <SmartImg
                                  src={grupo.vencedor.capa}
                                  size={260}
                                  alt=""
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <Trophy className="size-6 text-muted-foreground/40" />
                              )}
                              <div className="absolute -top-1.5 -right-1.5 size-6 rounded-full bg-amber-400 grid place-items-center shadow">
                                <Trophy className="size-3.5 text-black" strokeWidth={2.5} />
                              </div>
                            </div>
                            <div className="min-w-0 flex-1">
                              <span className="text-[9px] font-black uppercase text-amber-400 tracking-widest">
                                Vencedor
                              </span>
                              <p className="text-base font-bold leading-snug truncate">
                                {nomeExibicao(grupo.vencedor)}
                              </p>
                              {grupo.vencedor.titulo && grupo.vencedor.artista && (
                                <p className="text-xs text-muted-foreground truncate">
                                  {grupo.vencedor.artista}
                                </p>
                              )}
                            </div>
                          </div>
                        )}

                        {grupo.indicados.length > 0 && (
                          <div className="flex items-center gap-2.5 flex-wrap">
                            {grupo.indicados.map((n, i) => (
                              <div
                                key={i}
                                title={`${nomeExibicao(n)}${n.titulo && n.artista ? ` · ${n.artista}` : ""}`}
                                className="size-10 shrink-0 rounded-full overflow-hidden bg-secondary grid place-items-center ring-1 ring-white/10"
                              >
                                {n.capa ? (
                                  <SmartImg src={n.capa} size={120} alt="" className="w-full h-full object-cover" />
                                ) : (
                                  <Trophy className="size-3.5 text-muted-foreground/30" />
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
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
