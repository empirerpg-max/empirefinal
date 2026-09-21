import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, Trophy, Loader2, Star } from "lucide-react";
import { api } from "@/lib/api";
import { SmartImg } from "@/components/SmartImg";

export const Route = createFileRoute("/awards/$nome")({
  component: AwardDetalhePage,
});

type Categoria = {
  ano: string;
  segmento?: string;
  categoria: string;
  status: "vencedor" | "indicado";
  titulo?: string;
  artista?: string;
  capa?: string;
};
type Edicao = { ano: string; categorias: Categoria[] };
type AwardData = { nome: string; foto?: string; edicoes: Edicao[] };

function AwardDetalhePage() {
  const navigate = useNavigate();
  const { nome } = Route.useParams();
  const [data, setData] = useState<AwardData | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [anoSelecionado, setAnoSelecionado] = useState<string | null>(null);

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

  // Agrupa por segmento pra manter as categorias do mesmo bloco juntas
  // (ex: "General Field", "Pop", "Rock"...) dentro do ano selecionado.
  const gruposPorSegmento = useMemo(() => {
    if (!edicaoAtual) return [];
    const map = new Map<string, Categoria[]>();
    for (const cat of edicaoAtual.categorias) {
      const chave = cat.segmento || "Geral";
      if (!map.has(chave)) map.set(chave, []);
      map.get(chave)!.push(cat);
    }
    return Array.from(map.entries());
  }, [edicaoAtual]);

  return (
    <div className="pb-24 min-h-screen bg-black">
      <div className="relative h-56 overflow-hidden">
        {data?.foto && (
          <img
            src={data.foto}
            alt=""
            referrerPolicy="no-referrer"
            className="absolute inset-0 w-full h-full object-cover opacity-50"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-black/40 to-black" />
        <button
          onClick={() => navigate({ to: "/awards" })}
          className="absolute top-4 left-4 size-9 rounded-full bg-black/40 border border-white/15 backdrop-blur grid place-items-center"
        >
          <ChevronLeft className="size-5 text-white" />
        </button>
        <div className="absolute inset-x-0 bottom-0 px-5 pb-5">
          <h1 className="text-2xl font-black uppercase tracking-tight text-white drop-shadow flex items-center gap-2">
            <Trophy className="size-5 text-primary shrink-0" />
            {data?.nome || nome}
          </h1>
        </div>
      </div>

      <div className="relative -mt-5 rounded-t-[28px] bg-background min-h-[60vh] px-4 pt-5">
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
            <div className="flex gap-2 overflow-x-auto pb-3 -mx-4 px-4 scrollbar-none">
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

            <div className="space-y-6 mt-2">
              {gruposPorSegmento.map(([segmento, categorias]) => (
                <div key={segmento}>
                  <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-2">
                    {segmento}
                  </p>
                  <div className="space-y-3">
                    {categorias.map((cat, i) => (
                      <div key={`${cat.categoria}-${i}`} className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                        <p className="text-[11px] font-bold text-muted-foreground mb-2">{cat.categoria}</p>
                        <div className="flex items-center gap-3">
                          <div className="size-11 shrink-0 rounded-xl overflow-hidden bg-secondary grid place-items-center">
                            {cat.capa ? (
                              <SmartImg src={cat.capa} size={150} alt="" className="w-full h-full object-cover" />
                            ) : (
                              <Trophy className="size-4 text-muted-foreground/40" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            {cat.titulo && (
                              <p className="text-sm font-bold leading-snug truncate">{cat.titulo}</p>
                            )}
                            {cat.artista && (
                              <p className="text-xs text-muted-foreground truncate">{cat.artista}</p>
                            )}
                          </div>
                          {cat.status === "vencedor" ? (
                            <span className="shrink-0 flex items-center gap-1 px-2 py-1 rounded-full bg-amber-500/15 text-amber-400 text-[10px] font-black uppercase">
                              <Trophy className="size-3" /> Vencedor
                            </span>
                          ) : (
                            <span className="shrink-0 flex items-center gap-1 px-2 py-1 rounded-full bg-white/5 text-muted-foreground text-[10px] font-black uppercase">
                              <Star className="size-3" /> Indicado
                            </span>
                          )}
                        </div>
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
