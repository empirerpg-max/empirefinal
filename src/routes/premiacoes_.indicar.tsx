import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ChevronLeft, Trophy, Loader2, Check, X, Sparkles } from "lucide-react";
import { useTelegramUser, haptic } from "@/lib/telegram";
import { api, resolveImg } from "@/lib/api";
import { toast } from "sonner";

export const Route = createFileRoute("/premiacoes_/indicar")({
  component: PremiacoesIndicarPage,
});

type AwardResumo = Awaited<ReturnType<typeof api.listarPremiacoesIndicar>>[number];
type Categoria = { categoria: string; descritivo: string; premia: string };
type Candidato = { titulo: string; artista: string; codigoUnico: string };
type MinhaIndicacao = { linha: number; categoria: string; titulo: string; artista: string };

// Álbuns/eventos "estilo cartaz" (VMA, e outros que a gente adicionar
// depois) ganham um visual mais forte: fundo preto, fonte condensada em
// caixa alta e cores neon alternando — inspirado no cartaz oficial de
// indicados que o usuário trouxe como referência.
function ehEstiloCartaz(premiacao: string): boolean {
  const n = premiacao.toLowerCase();
  return n.includes("vma") || n.includes("mtv");
}

const CORES_NEON = ["text-pink-400", "text-yellow-300", "text-emerald-400"];

function PremiacoesIndicarPage() {
  const navigate = useNavigate();
  const { user } = useTelegramUser();
  const telegramId = user?.id ? String(user.id) : (typeof window !== "undefined" ? localStorage.getItem("empire_tg_id") : null) || "";

  const [awards, setAwards] = useState<AwardResumo[] | null>(null);
  const [awardId, setAwardId] = useState<string | null>(null);
  const [detalhes, setDetalhes] = useState<AwardResumo | null>(null);
  const [categorias, setCategorias] = useState<Categoria[] | null>(null);
  const [categoriaAtiva, setCategoriaAtiva] = useState<Categoria | null>(null);
  const [candidatos, setCandidatos] = useState<Candidato[] | null>(null);
  const [minhas, setMinhas] = useState<MinhaIndicacao[]>([]);
  const [enviando, setEnviando] = useState<string | null>(null);

  useEffect(() => {
    api.listarPremiacoesIndicar().then(setAwards);
  }, []);

  const abrirAward = (a: AwardResumo) => {
    haptic.selection();
    setAwardId(a.id);
    setCategorias(null);
    api.listarCategoriasIndicar(a.id).then((data) => {
      if (!data) return;
      setDetalhes(data.detalhes as AwardResumo);
      setCategorias(data.categorias);
    });
    if (telegramId) api.listarMinhasIndicacoes(a.id, telegramId).then(setMinhas);
  };

  const abrirCategoria = (c: Categoria) => {
    haptic.selection();
    setCategoriaAtiva(c);
    setCandidatos(null);
    if (awardId && telegramId) {
      api.listarCandidatosIndicar(awardId, c.categoria, telegramId).then(setCandidatos);
    }
  };

  const jaIndicado = (titulo: string) =>
    minhas.some((m) => m.categoria === categoriaAtiva?.categoria && m.titulo === titulo);

  const indicar = async (cand: Candidato) => {
    if (!awardId || !categoriaAtiva || !telegramId || enviando) return;
    setEnviando(cand.titulo);
    const res = await api.criarIndicacao({
      awardId,
      categoria: categoriaAtiva.categoria,
      titulo: cand.titulo,
      artista: cand.artista,
      codigoUnico: cand.codigoUnico,
      telegramId,
    });
    setEnviando(null);
    if (res.success) {
      haptic.success();
      toast.success("Indicado!");
      api.listarMinhasIndicacoes(awardId, telegramId).then(setMinhas);
    } else {
      haptic.error();
      toast.error(res.error || "Erro ao indicar.");
    }
  };

  const removerIndicacao = async (m: MinhaIndicacao) => {
    if (!awardId || !telegramId) return;
    const res = await api.removerIndicacao(awardId, m.linha, telegramId);
    if (res.success) {
      haptic.selection();
      setMinhas((prev) => prev.filter((x) => x.linha !== m.linha));
    } else {
      toast.error(res.error || "Erro ao remover.");
    }
  };

  const cartaz = detalhes ? ehEstiloCartaz(detalhes.premiacao) : false;

  // === VIEW 3: candidatos da categoria ===
  if (awardId && categoriaAtiva) {
    const minhasNaCategoria = minhas.filter((m) => m.categoria === categoriaAtiva.categoria);
    return (
      <div className="pb-24 px-4 pt-6 max-w-md mx-auto min-h-screen">
        <header className="flex items-center gap-3 mb-2">
          <button
            onClick={() => setCategoriaAtiva(null)}
            className="size-9 rounded-full bg-white/5 border border-white/10 grid place-items-center"
          >
            <ChevronLeft className="size-5" />
          </button>
          <div className="min-w-0">
            <h1 className="text-base font-black uppercase tracking-tight truncate">{categoriaAtiva.categoria}</h1>
            <p className="text-[11px] text-muted-foreground line-clamp-2">{categoriaAtiva.descritivo}</p>
          </div>
        </header>

        {minhasNaCategoria.length > 0 && (
          <div className="mb-4 space-y-1.5">
            <p className="text-[10px] font-black uppercase tracking-widest text-emerald-400">Suas indicações</p>
            {minhasNaCategoria.map((m) => (
              <div
                key={m.linha}
                className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30"
              >
                <Check className="size-4 text-emerald-400 shrink-0" />
                <span className="flex-1 text-xs font-bold truncate">
                  {m.artista} — {m.titulo}
                </span>
                <button onClick={() => removerIndicacao(m)} className="shrink-0 size-6 rounded-full bg-black/30 grid place-items-center">
                  <X className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        {candidatos === null ? (
          <div className="flex justify-center py-10">
            <Loader2 className="size-6 animate-spin text-primary" />
          </div>
        ) : candidatos.length === 0 ? (
          <div className="p-6 rounded-2xl bg-white/[0.03] border border-white/10 text-center text-xs text-muted-foreground backdrop-blur-md">
            Nenhum material seu elegível pra essa categoria no momento.
          </div>
        ) : (
          <div className="space-y-2">
            {candidatos.map((c) => {
              const marcado = jaIndicado(c.titulo);
              return (
                <button
                  key={`${c.artista}-${c.titulo}`}
                  onClick={() => !marcado && indicar(c)}
                  disabled={marcado || enviando === c.titulo}
                  className={`w-full flex items-center gap-3 p-3.5 rounded-2xl border text-left transition-all backdrop-blur-md ${
                    marcado
                      ? "bg-emerald-500/10 border-emerald-500/30"
                      : "bg-white/[0.03] border-white/10 hover:bg-white/[0.06] active:scale-[0.98]"
                  }`}
                >
                  <div
                    className={`size-5 rounded-md border shrink-0 grid place-items-center ${
                      marcado ? "bg-emerald-500 border-emerald-500" : "border-white/20"
                    }`}
                  >
                    {marcado && <Check className="size-3.5 text-black" />}
                    {enviando === c.titulo && <Loader2 className="size-3.5 animate-spin" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold truncate">{c.titulo}</p>
                    <p className="text-[11px] text-muted-foreground truncate">{c.artista}</p>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // === VIEW 2: categorias do award ===
  if (awardId) {
    return (
      <div className={`pb-24 px-4 pt-6 max-w-md mx-auto min-h-screen ${cartaz ? "bg-black" : ""}`}>
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
          <h1
            className={
              cartaz
                ? "text-xl font-black uppercase italic tracking-tight text-white"
                : "text-lg font-black uppercase tracking-tight"
            }
          >
            {detalhes?.premiacao || "Categorias"}
          </h1>
        </header>

        {detalhes?.status !== "aberto" && (
          <div className="mb-4 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-300">
            {detalhes?.status === "agendado"
              ? `Indicações abrem em ${detalhes.abertura}.`
              : "Período de indicações encerrado."}
          </div>
        )}

        {categorias === null ? (
          <div className="flex justify-center py-10">
            <Loader2 className="size-6 animate-spin text-primary" />
          </div>
        ) : (
          <div className="space-y-2">
            {categorias.map((c, i) => {
              const minhasNaCategoria = minhas.filter((m) => m.categoria === c.categoria).length;
              return (
                <button
                  key={c.categoria}
                  onClick={() => abrirCategoria(c)}
                  className={
                    cartaz
                      ? "w-full text-left p-4 rounded-2xl bg-white/[0.04] border border-white/10 backdrop-blur-md active:scale-[0.98] transition-all"
                      : "w-full text-left p-4 rounded-2xl bg-white/[0.03] border border-white/10 backdrop-blur-md hover:bg-white/[0.06] active:scale-[0.98] transition-all"
                  }
                >
                  <p
                    className={
                      cartaz
                        ? `text-base font-black uppercase italic ${CORES_NEON[i % CORES_NEON.length]}`
                        : "text-sm font-black uppercase"
                    }
                  >
                    {c.categoria}
                  </p>
                  <p className="text-[11px] text-muted-foreground line-clamp-1 mt-0.5">{c.descritivo}</p>
                  {minhasNaCategoria > 0 && (
                    <p className="text-[10px] font-bold text-emerald-400 mt-1">
                      {minhasNaCategoria} indicação(ões) sua(s)
                    </p>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // === VIEW 1: lista de premiações ===
  return (
    <div className="pb-24 px-4 pt-6 max-w-md mx-auto min-h-screen">
      <header className="flex items-center gap-3 mb-6">
        <button
          onClick={() => navigate({ to: "/perfil" })}
          className="size-9 rounded-full bg-white/5 border border-white/10 grid place-items-center"
        >
          <ChevronLeft className="size-5" />
        </button>
        <div>
          <h1 className="text-lg font-black uppercase tracking-tight flex items-center gap-2">
            <Sparkles className="size-5 text-primary" /> Indicar
          </h1>
          <p className="text-[11px] text-muted-foreground">Indique seus materiais pras premiações abertas.</p>
        </div>
      </header>

      {awards === null ? (
        <div className="flex justify-center py-10">
          <Loader2 className="size-6 animate-spin text-primary" />
        </div>
      ) : awards.length === 0 ? (
        <div className="p-6 rounded-2xl bg-white/[0.03] border border-white/10 text-center text-xs text-muted-foreground backdrop-blur-md">
          Nenhuma premiação disponível no momento.
        </div>
      ) : (
        <div className="space-y-3">
          {awards.map((a) => (
            <button
              key={a.id}
              onClick={() => abrirAward(a)}
              className="w-full relative rounded-2xl overflow-hidden border border-white/10 backdrop-blur-md active:scale-[0.98] transition-all text-left"
            >
              {a.capaUrl && (
                <img src={resolveImg(a.capaUrl)} className="absolute inset-0 w-full h-full object-cover" referrerPolicy="no-referrer" />
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-black via-black/60 to-black/20" />
              <div className="relative p-5 min-h-28 flex flex-col justify-end">
                <p className="text-lg font-black uppercase tracking-tight text-white">{a.premiacao}</p>
                <span
                  className={`self-start mt-1.5 px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-widest ${
                    a.status === "aberto"
                      ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                      : a.status === "agendado"
                        ? "bg-amber-500/20 text-amber-300 border border-amber-500/40"
                        : "bg-white/10 text-neutral-400 border border-white/20"
                  }`}
                >
                  {a.status === "aberto" ? "Aberto" : a.status === "agendado" ? "Em breve" : "Encerrado"}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
