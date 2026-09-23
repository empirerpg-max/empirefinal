import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, Loader2, Target, Sparkles, Zap, Mic2 } from "lucide-react";
import { api } from "@/lib/api";

export const Route = createFileRoute("/ponto/valores")({
  component: PontoValoresPage,
});

type ValorPonto = { tipo: string; descricao: string; valor: string; categoria: string };

const TIPO_META: Record<string, { label: string; icon: typeof Sparkles; color: string; bg: string }> = {
  GERAL: { label: "Geral", icon: Sparkles, color: "text-emerald-400", bg: "bg-emerald-500/15" },
  EXTRA: { label: "Extra", icon: Zap, color: "text-amber-400", bg: "bg-amber-500/15" },
  FEATURING: { label: "Featuring", icon: Mic2, color: "text-fuchsia-400", bg: "bg-fuchsia-500/15" },
};
const ORDEM_TIPOS = ["GERAL", "EXTRA", "FEATURING"];

function PontoValoresPage() {
  const navigate = useNavigate();
  const [valores, setValores] = useState<ValorPonto[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    api
      .listarValoresPonto()
      .then((r) => setValores(r.valores))
      .catch(() => setErro("Não foi possível carregar os valores."));
  }, []);

  const grupos = useMemo(() => {
    if (!valores) return [];
    const porTipo = new Map<string, ValorPonto[]>();
    for (const v of valores) {
      if (!porTipo.has(v.tipo)) porTipo.set(v.tipo, []);
      porTipo.get(v.tipo)!.push(v);
    }
    return ORDEM_TIPOS.filter((t) => porTipo.has(t)).map((tipo) => ({ tipo, itens: porTipo.get(tipo)! }));
  }, [valores]);

  return (
    <div className="pb-24 px-4 pt-6 max-w-2xl mx-auto min-h-screen">
      <header className="flex items-center gap-3 mb-6">
        <button
          onClick={() => navigate({ to: "/ponto" })}
          className="size-9 rounded-full bg-white/5 border border-white/10 grid place-items-center shrink-0"
        >
          <ChevronLeft className="size-5" />
        </button>
        <div className="min-w-0">
          <p className="text-[10px] font-black uppercase tracking-widest text-emerald-500">Ponto</p>
          <h1 className="text-xl font-black uppercase tracking-tight">O que vale ponto</h1>
        </div>
      </header>

      {!valores && !erro && (
        <div className="flex justify-center py-16">
          <Loader2 className="size-6 animate-spin text-emerald-500" />
        </div>
      )}

      {erro && <p className="text-center text-sm text-muted-foreground py-16">{erro}</p>}

      {valores && valores.length === 0 && (
        <div className="p-6 rounded-2xl bg-white/[0.03] border border-white/10 text-center text-xs text-muted-foreground backdrop-blur-md">
          Nenhum valor cadastrado no momento.
        </div>
      )}

      <div className="space-y-7">
        {grupos.map(({ tipo, itens }) => {
          const meta = TIPO_META[tipo] || TIPO_META.GERAL;
          const Icon = meta.icon;
          return (
            <section key={tipo}>
              <div className="flex items-center gap-2 mb-3">
                <span className={`size-7 rounded-lg ${meta.bg} ${meta.color} grid place-items-center shrink-0`}>
                  <Icon className="size-3.5" />
                </span>
                <h2 className="text-xs font-black uppercase tracking-widest text-muted-foreground">
                  {meta.label}
                </h2>
                <span className="text-[10px] font-bold text-muted-foreground/50">
                  {itens.length} {itens.length === 1 ? "item" : "itens"}
                </span>
              </div>

              <div className="grid sm:grid-cols-2 gap-2.5">
                {itens.map((v, i) => (
                  <div
                    key={`${tipo}-${i}`}
                    className="flex items-center gap-3 p-3.5 rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-md"
                  >
                    <Target className={`size-4 shrink-0 ${meta.color}`} aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-bold leading-snug">{v.descricao}</p>
                      {v.categoria && v.categoria !== tipo && (
                        <p className="text-[10px] text-muted-foreground/70 uppercase tracking-wide mt-0.5">
                          {v.categoria}
                        </p>
                      )}
                    </div>
                    {v.valor && (
                      <span
                        className={`shrink-0 px-2.5 py-1 rounded-full text-[11px] font-black whitespace-nowrap ${meta.bg} ${meta.color}`}
                      >
                        {v.valor} pts
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
