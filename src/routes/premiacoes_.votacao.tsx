import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Trophy, Loader2, Check, Star, ExternalLink, Send, Save } from "lucide-react";
import { useTelegramUser, haptic } from "@/lib/telegram";
import { api, resolveImg } from "@/lib/api";
import { toast } from "sonner";

export const Route = createFileRoute("/premiacoes_/votacao")({
  component: PremiacoesVotacaoPage,
});

type AwardResumo = Awaited<ReturnType<typeof api.listarPremiacoesVotacao>>[number];
type Categoria = { categoria: string; descritivo: string; tipo: "nota" | "voto" };
type Indicado = Awaited<ReturnType<typeof api.listarIndicadosVotacao>>["indicados"][number];

const NOTA_MIN = 5;
const NOTA_MAX = 10;
const NOTA_PADRAO = "7.5";
const VOTO_MIN = 2;

function PremiacoesVotacaoPage() {
  const navigate = useNavigate();
  const { user } = useTelegramUser();
  const telegramId = user?.id ? String(user.id) : (typeof window !== "undefined" ? localStorage.getItem("empire_tg_id") : null) || "";

  const [awards, setAwards] = useState<AwardResumo[] | null>(null);
  const [awardId, setAwardId] = useState<string | null>(null);
  const [detalhes, setDetalhes] = useState<AwardResumo | null>(null);
  const [categorias, setCategorias] = useState<Categoria[] | null>(null);
  const [catIndex, setCatIndex] = useState<number | null>(null);

  const [indicados, setIndicados] = useState<Indicado[] | null>(null);
  const [tipoAtual, setTipoAtual] = useState<"nota" | "voto">("voto");
  const [valores, setValores] = useState<Record<string, string>>({});
  const [originais, setOriginais] = useState<Record<string, string>>({});
  const [salvando, setSalvando] = useState(false);

  const [confirmSair, setConfirmSair] = useState<{ topicId: string; tab: string } | null>(null);
  const [notaAtivo, setNotaAtivo] = useState<string | null>(null);

  useEffect(() => {
    api.listarPremiacoesVotacao().then(setAwards);
  }, []);

  const abrirAward = (a: AwardResumo) => {
    haptic.selection();
    setAwardId(a.id);
    setCategorias(null);
    api.listarCategoriasVotacao(a.id).then((data) => {
      if (!data) return;
      setDetalhes(data.detalhes as AwardResumo);
      setCategorias(data.categorias);
    });
  };

  const carregarCategoria = (idx: number) => {
    if (!awardId || !categorias || !categorias[idx] || !telegramId) return;
    setCatIndex(idx);
    setIndicados(null);
    setNotaAtivo(null);
    api.listarIndicadosVotacao(awardId, categorias[idx].categoria, telegramId).then((data) => {
      setTipoAtual(data.tipo);
      setIndicados(data.indicados);
      const base: Record<string, string> = {};
      data.indicados.forEach((i) => {
        base[i.titulo] = i.meuValor || "";
      });
      setValores(base);
      setOriginais(base);
    });
  };

  const sujo = useMemo(() => {
    const chaves = new Set([...Object.keys(valores), ...Object.keys(originais)]);
    for (const k of chaves) {
      if ((valores[k] || "") !== (originais[k] || "")) return true;
    }
    return false;
  }, [valores, originais]);

  const selecionadosVoto = useMemo(
    () => (indicados || []).filter((i) => !!valores[i.titulo]).map((i) => i.titulo),
    [indicados, valores],
  );

  const salvarCategoriaAtual = async (): Promise<boolean> => {
    if (!awardId || !categorias || catIndex === null || !indicados || !telegramId) return true;
    if (!sujo) return true;
    const categoria = categorias[catIndex].categoria;
    setSalvando(true);
    try {
      if (tipoAtual === "nota") {
        const alterados = indicados.filter((i) => (valores[i.titulo] || "") !== (originais[i.titulo] || ""));
        for (const ind of alterados) {
          const res = await api.registrarNotaVotacao({
            awardId,
            categoria,
            titulo: ind.titulo,
            nota: valores[ind.titulo] || "",
            telegramId,
          });
          if (!res.success) {
            toast.error(res.error || `Erro ao salvar nota de "${ind.titulo}".`);
            setSalvando(false);
            return false;
          }
        }
      } else {
        if (selecionadosVoto.length > 0 && selecionadosVoto.length < VOTO_MIN) {
          toast.error(`Escolha pelo menos ${VOTO_MIN} indicados, ou nenhum.`);
          setSalvando(false);
          return false;
        }
        if (selecionadosVoto.length >= indicados.length) {
          toast.error("Não dá pra votar em todos os indicados dessa categoria.");
          setSalvando(false);
          return false;
        }
        const res = await api.registrarVotoVotacao({ awardId, categoria, selecoes: selecionadosVoto, telegramId });
        if (!res.success) {
          toast.error(res.error || "Erro ao salvar voto.");
          setSalvando(false);
          return false;
        }
      }
      setOriginais(valores);
      setSalvando(false);
      return true;
    } catch {
      toast.error("Erro de conexão.");
      setSalvando(false);
      return false;
    }
  };

  const enviarEAvancar = async () => {
    const ok = await salvarCategoriaAtual();
    if (!ok) return;
    haptic.success();
    if (categorias && catIndex !== null && catIndex < categorias.length - 1) {
      carregarCategoria(catIndex + 1);
    } else {
      toast.success("Votação registrada! Você pode voltar e ajustar até a votação fechar.");
      setCatIndex(null);
      setIndicados(null);
    }
  };

  const continuarDepois = async () => {
    const ok = await salvarCategoriaAtual();
    if (!ok) return;
    haptic.selection();
    setCatIndex(null);
    setIndicados(null);
  };

  const pedirVisitarForum = (ind: Indicado) => {
    if (!ind.topicId) return;
    haptic.selection();
    if (sujo) {
      setConfirmSair({ topicId: ind.topicId, tab: ind.tab });
    } else {
      navigate({ to: "/empire-play/forum", search: { tab: ind.tab, id: ind.topicId } });
    }
  };

  // === VIEW 3: categoria ativa (ballot paginado, estilo MTV) ===
  if (awardId && categorias && catIndex !== null) {
    const categoriaAtiva = categorias[catIndex];
    const ultima = catIndex === categorias.length - 1;
    return (
      <div className="pb-28 px-4 pt-6 max-w-md mx-auto min-h-screen">
        <header className="flex items-center gap-3 mb-2">
          <button
            onClick={() => {
              setCatIndex(null);
              setIndicados(null);
            }}
            className="size-9 rounded-full bg-white/5 border border-white/10 grid place-items-center shrink-0"
          >
            <ChevronLeft className="size-5" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-black uppercase tracking-widest text-primary">
              Categoria {catIndex + 1} de {categorias.length}
            </p>
            <h1 className="text-base font-black uppercase tracking-tight truncate">{categoriaAtiva.categoria}</h1>
          </div>
        </header>
        <p className="text-xs text-muted-foreground mb-4">{categoriaAtiva.descritivo}</p>

        <div className="flex gap-1 mb-5">
          {categorias.map((_, i) => (
            <div
              key={i}
              className={`h-1 flex-1 rounded-full ${i < catIndex ? "bg-primary" : i === catIndex ? "bg-primary/60" : "bg-white/10"}`}
            />
          ))}
        </div>

        {tipoAtual === "voto" && indicados && (
          <p className="text-[11px] font-bold text-muted-foreground mb-3">
            {selecionadosVoto.length === 0
              ? `Escolha pelo menos ${VOTO_MIN} indicados`
              : `${selecionadosVoto.length} selecionado${selecionadosVoto.length === 1 ? "" : "s"}`}
          </p>
        )}

        {indicados === null ? (
          <div className="flex justify-center py-16">
            <Loader2 className="size-6 animate-spin text-primary" />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2">
              {indicados.map((ind) => {
                const img = resolveImg(ind.imagem);
                const notaValor = valores[ind.titulo] || "";
                const marcado = !!valores[ind.titulo];
                const selecionadoNota = tipoAtual === "nota" && notaAtivo === ind.titulo;
                return (
                  <div
                    key={ind.titulo}
                    className={`relative rounded-xl border overflow-hidden transition-all ${
                      marcado || selecionadoNota ? "bg-primary/10 border-primary/50" : "bg-white/[0.03] border-white/10"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        haptic.selection();
                        if (tipoAtual === "voto") {
                          setValores((v) => ({ ...v, [ind.titulo]: v[ind.titulo] ? "" : "X" }));
                        } else {
                          setNotaAtivo((cur) => (cur === ind.titulo ? null : ind.titulo));
                        }
                      }}
                      className="block w-full text-left"
                    >
                      <div className="relative w-full aspect-square bg-white/5 flex items-center justify-center">
                        {img ? (
                          <img src={img} alt="" className="absolute inset-0 w-full h-full object-cover" />
                        ) : (
                          <Trophy className="size-5 text-muted-foreground" />
                        )}
                        {tipoAtual === "voto" && marcado && (
                          <div className="absolute top-1 right-1 size-4 rounded-full bg-primary border border-primary grid place-items-center">
                            <Check className="size-2.5 text-primary-foreground" />
                          </div>
                        )}
                        {tipoAtual === "nota" && notaValor && (
                          <div className="absolute bottom-1 left-1 flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-black/60 text-[9px] font-black text-primary">
                            <Star className="size-2.5 fill-primary" /> {notaValor}
                          </div>
                        )}
                      </div>
                      <div className="p-1.5">
                        <p className="text-[10px] font-bold leading-tight line-clamp-2">{ind.titulo}</p>
                        <p className="text-[9px] text-muted-foreground truncate">{ind.artista}</p>
                      </div>
                    </button>
                    {tipoAtual === "voto" && ind.topicId && (
                      <button
                        type="button"
                        onClick={() => pedirVisitarForum(ind)}
                        aria-label="Visitar fórum"
                        className="absolute top-1 left-1 size-4 rounded-full bg-black/55 grid place-items-center"
                      >
                        <ExternalLink className="size-2.5 text-white" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            {tipoAtual === "nota" &&
              notaAtivo &&
              (() => {
                const ind = indicados.find((i) => i.titulo === notaAtivo);
                if (!ind) return null;
                const notaValor = valores[ind.titulo] || "";
                return (
                  <div className="sticky bottom-20 mt-3 p-3.5 rounded-2xl bg-card border border-primary/30 shadow-xl shadow-black/40">
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <div className="min-w-0">
                        <p className="text-xs font-bold truncate">{ind.titulo}</p>
                        <p className="text-[10px] text-muted-foreground truncate">{ind.artista}</p>
                      </div>
                      {ind.topicId && (
                        <button
                          type="button"
                          onClick={() => pedirVisitarForum(ind)}
                          className="shrink-0 size-7 rounded-full bg-white/5 border border-white/10 grid place-items-center"
                          aria-label="Visitar fórum"
                        >
                          <ExternalLink className="size-3.5 text-muted-foreground" />
                        </button>
                      )}
                    </div>
                    {notaValor ? (
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="flex items-center gap-1 text-base font-black text-primary">
                            <Star className="size-4 fill-primary" /> {notaValor}
                          </span>
                          <button
                            type="button"
                            onClick={() => setValores((v) => ({ ...v, [ind.titulo]: "" }))}
                            className="text-[10px] font-bold text-muted-foreground"
                          >
                            Remover nota
                          </button>
                        </div>
                        <input
                          type="range"
                          min={NOTA_MIN}
                          max={NOTA_MAX}
                          step={0.1}
                          value={notaValor}
                          onChange={(e) => setValores((v) => ({ ...v, [ind.titulo]: e.target.value }))}
                          className="w-full accent-primary"
                        />
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          haptic.selection();
                          setValores((v) => ({ ...v, [ind.titulo]: NOTA_PADRAO }));
                        }}
                        className="w-full py-2.5 rounded-xl bg-primary text-primary-foreground text-[11px] font-black uppercase tracking-wide"
                      >
                        Dar nota
                      </button>
                    )}
                  </div>
                );
              })()}
          </>
        )}

        <div className="fixed bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-background via-background to-transparent">
          <div className="max-w-md mx-auto grid grid-cols-2 gap-2">
            <button
              onClick={continuarDepois}
              disabled={salvando}
              className="py-3.5 rounded-full bg-white/5 border border-white/10 font-black text-xs uppercase tracking-wider disabled:opacity-50 flex items-center justify-center gap-1.5"
            >
              <Save className="size-4" /> Continuar depois
            </button>
            <button
              onClick={enviarEAvancar}
              disabled={salvando}
              className="py-3.5 rounded-full bg-primary text-primary-foreground font-black text-xs uppercase tracking-wider disabled:opacity-40 flex items-center justify-center gap-1.5"
            >
              {salvando ? (
                <Loader2 className="size-4 animate-spin" />
              ) : ultima ? (
                <Send className="size-4" />
              ) : (
                <ChevronRight className="size-4" />
              )}
              {ultima ? "Enviar" : "Próxima"}
            </button>
          </div>
        </div>

        {confirmSair && (
          <div
            className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm grid place-items-end sm:place-items-center p-0 sm:p-4"
            onClick={() => setConfirmSair(null)}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md bg-card rounded-t-3xl sm:rounded-3xl p-6 border border-white/10"
            >
              <h3 className="text-base font-black uppercase tracking-tight mb-1">Salvar antes de sair?</h3>
              <p className="text-sm text-muted-foreground mb-5">
                Você tem alterações nessa categoria que ainda não foram salvas.
              </p>
              <div className="space-y-2">
                <button
                  onClick={async () => {
                    const destino = confirmSair;
                    setConfirmSair(null);
                    const ok = await salvarCategoriaAtual();
                    if (ok && destino) navigate({ to: "/empire-play/forum", search: { tab: destino.tab, id: destino.topicId } });
                  }}
                  className="w-full py-3 rounded-full bg-primary text-primary-foreground font-black text-xs uppercase tracking-wider"
                >
                  Salvar e visitar
                </button>
                <button
                  onClick={() => {
                    const destino = confirmSair;
                    setConfirmSair(null);
                    if (destino) navigate({ to: "/empire-play/forum", search: { tab: destino.tab, id: destino.topicId } });
                  }}
                  className="w-full py-3 rounded-full bg-white/5 border border-white/10 font-black text-xs uppercase tracking-wider"
                >
                  Visitar sem salvar
                </button>
                <button
                  onClick={() => setConfirmSair(null)}
                  className="w-full py-3 rounded-full text-muted-foreground font-black text-xs uppercase tracking-wider"
                >
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // === VIEW 2: categorias do award ===
  if (awardId) {
    return (
      <div className="pb-24 px-4 pt-6 max-w-md mx-auto min-h-screen">
        <header className="flex items-center gap-3 mb-6">
          <button
            onClick={() => {
              setAwardId(null);
              setDetalhes(null);
              setCategorias(null);
            }}
            className="size-9 rounded-full bg-white/5 border border-white/10 grid place-items-center"
          >
            <ChevronLeft className="size-5" />
          </button>
          <h1 className="text-lg font-black uppercase tracking-tight truncate">{detalhes?.premiacao || "Votação"}</h1>
        </header>

        {detalhes?.status !== "aberto" && (
          <div className="mb-4 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-300">
            {detalhes?.status === "agendado" ? `Votação abre em ${detalhes.abertura}.` : "Período de votação encerrado."}
          </div>
        )}

        {categorias === null ? (
          <div className="flex justify-center py-10">
            <Loader2 className="size-6 animate-spin text-primary" />
          </div>
        ) : (
          <div className="space-y-2">
            {categorias.map((c, i) => (
              <button
                key={c.categoria}
                onClick={() => carregarCategoria(i)}
                className="w-full flex items-center gap-3 p-3.5 rounded-2xl bg-white/[0.03] border border-white/10 hover:bg-white/[0.06] transition-all text-left"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold">{c.categoria}</p>
                  <p className="text-[10px] text-muted-foreground truncate">
                    {c.tipo === "nota" ? "Avalie com nota de 5 a 10" : "Escolha múltiplos indicados"}
                  </p>
                </div>
                <ChevronRight className="size-4 text-muted-foreground shrink-0" />
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // === VIEW 1: lista de premiações com votação ===
  return (
    <div className="pb-24 px-4 pt-6 max-w-md mx-auto min-h-screen">
      <header className="flex items-center gap-3 mb-6">
        <button
          onClick={() => navigate({ to: "/perfil" })}
          className="size-9 rounded-full bg-white/5 border border-white/10 grid place-items-center"
        >
          <ChevronLeft className="size-5" />
        </button>
        <h1 className="text-lg font-black uppercase tracking-tight">Votação</h1>
      </header>

      {awards === null ? (
        <div className="flex justify-center py-10">
          <Loader2 className="size-6 animate-spin text-primary" />
        </div>
      ) : awards.length === 0 ? (
        <div className="p-6 rounded-2xl bg-white/[0.03] border border-white/10 text-center text-xs text-muted-foreground">
          Nenhuma votação disponível no momento.
        </div>
      ) : (
        <div className="space-y-3">
          {awards.map((a) => (
            <button
              key={a.id}
              onClick={() => abrirAward(a)}
              className="w-full flex items-center gap-4 p-4 rounded-2xl bg-white/[0.03] border border-white/10 hover:bg-white/[0.06] transition-all text-left overflow-hidden"
            >
              {resolveImg(a.capaUrl) ? (
                <img src={resolveImg(a.capaUrl)} alt="" className="size-14 rounded-xl object-cover shrink-0" />
              ) : (
                <div className="size-14 rounded-xl bg-primary/15 text-primary grid place-items-center shrink-0">
                  <Trophy className="size-6" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-black uppercase tracking-tight truncate">{a.premiacao}</p>
                <p className="text-[11px] text-muted-foreground">
                  {a.status === "aberto"
                    ? `Votação aberta até ${a.encerramento}`
                    : a.status === "agendado"
                      ? `Abre em ${a.abertura}`
                      : "Votação encerrada"}
                </p>
              </div>
              <ChevronRight className="size-4 text-muted-foreground shrink-0" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
