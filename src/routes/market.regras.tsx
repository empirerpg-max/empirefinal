import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ChevronLeft, Info, Trophy, Sparkles } from "lucide-react";
import { api } from "@/lib/api";

export const Route = createFileRoute("/market/regras")({
  head: () => ({ meta: [{ title: "Entenda os prestígios — Empire Hub" }] }),
  component: MarketRegrasPage,
});

const LEGENDAS: Record<string, string> = {
  login_diario: "Login diário",
  post_social: "Postar em redes sociais",
  comentario: "Comentar em uma faixa/vídeo",
  curtida: "Curtir uma faixa/vídeo",
  assistir_tv: "Assistir Empire TV",
  chat_tv: "Comentar no chat da Empire TV",
  publicar_lancamento: "Publicar um lançamento",
  playlist: "Criar uma playlist",
  turne_acao_dia: "Fazer a ação do dia numa turnê",
  turne_sold_out: "Show com Sold Out",
  comentario_turne: "Comentar na Central de Notícias de uma turnê",
};

function MarketRegrasPage() {
  const [dados, setDados] = useState<Awaited<ReturnType<typeof api.listarMarketRegras>> | null>(null);

  useEffect(() => {
    api.listarMarketRegras().then(setDados);
  }, []);

  return (
    <div className="pb-24 px-4 pt-6 max-w-md mx-auto min-h-screen">
      <header className="flex items-center gap-3 mb-6">
        <Link to="/market" className="size-9 rounded-full bg-white/5 border border-white/10 grid place-items-center">
          <ChevronLeft className="size-5" />
        </Link>
        <div>
          <h1 className="text-lg font-black uppercase tracking-tight flex items-center gap-2">
            <Info className="size-5 text-primary" /> Entenda os prestígios
          </h1>
        </div>
      </header>

      <section className="mb-8">
        <h2 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-1.5">
          <Sparkles className="size-3.5" /> Como ganhar prestígio
        </h2>
        {dados === null ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-12 rounded-xl bg-white/5 animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            {dados.regras.map((r) => (
              <div
                key={r.chave}
                className="flex items-center justify-between p-3 rounded-xl bg-white/[0.03] border border-white/5"
              >
                <span className="text-sm">{LEGENDAS[r.chave] || r.acao || r.chave}</span>
                <span className="text-xs font-black text-primary">+{r.valor}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-1.5">
          <Trophy className="size-3.5" /> Escada de níveis
        </h2>
        {dados === null ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-12 rounded-xl bg-white/5 animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="space-y-1">
            {dados.niveis.map((n, i) => {
              const novaFase = i === 0 || dados.niveis[i - 1].fase !== n.fase;
              return (
                <div key={n.nivel}>
                  {novaFase && (
                    <p className="text-[9px] font-black uppercase tracking-widest text-primary/70 mt-4 mb-1.5 px-1">
                      {n.fase}
                    </p>
                  )}
                  <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-white/[0.02]">
                    <span className="text-xs">
                      <span className="text-muted-foreground font-mono mr-2">{n.nivel}.</span>
                      {n.nome}
                    </span>
                    <span className="text-[11px] font-bold text-muted-foreground">{n.prestigio}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
