import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Activity,
  CalendarDays,
  Monitor,
  MousePointerClick,
  Route as RouteIcon,
  Smartphone,
  Tablet,
  Eye,
  Users,
} from "lucide-react";
import { BackButton } from "@/components/BackButton";
import { LoadErrorState } from "@/components/LoadErrorState";
import { getStoredLogin, isAdminLogin } from "@/components/LoginScreen";
import { StickyScrollArrowLeft, StickyScrollArrowRight } from "@/components/StickyScrollArrows";
import { useDragScroll } from "@/hooks/useDragScroll";
import { api, type ResumoUso } from "@/lib/api";
import { useTelegramUser } from "@/lib/telegram";
import { intervaloDoPeriodo, nomeDaAcao, nomeDaTela, nomeDoCaminho, type PeriodoUso } from "@/lib/uso/nomes";

// Tela só do admin: lê o resumo da medição de uso (GET /api/uso/resumo).
// Não aparece para o jogador; quem não é admin vê "Página não encontrada.".
export const Route = createFileRoute("/uso-do-app")({
  head: () => ({ meta: [{ title: "Uso do app — Empire Hub" }] }),
  component: UsoDoAppPage,
});

const PERIODOS: { id: PeriodoUso; label: string }[] = [
  { id: "semana", label: "Esta semana" },
  { id: "anterior", label: "Semana anterior" },
  { id: "30dias", label: "Últimos 30 dias" },
];

const NOME_APARELHO: Record<string, { label: string; icon: typeof Smartphone }> = {
  celular: { label: "Celular", icon: Smartphone },
  tablet: { label: "Tablet", icon: Tablet },
  computador: { label: "Computador", icon: Monitor },
};

const fmt = (n: number) => n.toLocaleString("pt-BR");
const diaCurto = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

type Estado = { tipo: "carregando" } | { tipo: "erro" } | { tipo: "ok"; resumo: ResumoUso };

function UsoDoAppPage() {
  const { user } = useTelegramUser();
  const login = getStoredLogin();
  const tgId = user?.id?.toString() || login?.id || "";
  const isAdmin = isAdminLogin(login, tgId);

  const [periodo, setPeriodo] = useState<PeriodoUso>("semana");
  const [tentativa, setTentativa] = useState(0);
  const [estado, setEstado] = useState<Estado>({ tipo: "carregando" });
  const periodosScroll = useDragScroll<HTMLDivElement>();
  const intervalo = useMemo(() => intervaloDoPeriodo(periodo), [periodo]);

  // Resultado de cada período já buscado, enquanto a tela está aberta: trocar
  // de pílula e voltar não busca de novo (cada busca lê o D1; ver o manual).
  const cache = useRef(new Map<string, ResumoUso>());

  useEffect(() => {
    if (!isAdmin) return;
    const chave = `${intervalo.de}|${intervalo.ate}`;
    const guardado = cache.current.get(chave);
    if (guardado) {
      setEstado({ tipo: "ok", resumo: guardado });
      return;
    }
    let vivo = true;
    setEstado({ tipo: "carregando" });
    api.resumoUso(intervalo.de, intervalo.ate).then((r) => {
      if (r) cache.current.set(chave, r);
      // Ignora resposta de um período que já foi trocado.
      if (!vivo) return;
      setEstado(r ? { tipo: "ok", resumo: r } : { tipo: "erro" });
    });
    return () => {
      vivo = false;
    };
  }, [isAdmin, intervalo, tentativa]);

  if (!isAdmin) {
    return (
      <main className="flex-1 mx-auto w-full max-w-2xl px-4 pt-6 pb-20">
        <BackButton />
        <p className="text-muted-foreground mt-6">Página não encontrada.</p>
      </main>
    );
  }

  return (
    <main className="flex-1 mx-auto w-full max-w-2xl px-4 pt-6 pb-32">
      <BackButton className="font-black uppercase text-[11px] hover:text-primary transition-colors" />

      <header className="mb-5">
        <div className="size-14 rounded-2xl bg-primary/15 text-primary grid place-items-center mb-4">
          <Activity className="size-7" />
        </div>
        <h1 className="text-3xl font-black italic uppercase tracking-tighter">
          Uso do <span className="text-primary">app</span>
        </h1>
        <p className="text-muted-foreground text-[11px] font-bold mt-1 uppercase tracking-widest">
          O que os jogadores mais abrem e fazem
        </p>
      </header>

      {/* Fileira rolável de período (padrão da barra de tabs do Empire Social;
          setas dentro da própria fileira, como pede StickyScrollArrows):
          cada pill tem a largura do próprio texto e nunca é cortada. */}
      <div className="mb-2">
        <div
          ref={periodosScroll.ref}
          className="flex gap-1.5 overflow-x-auto scrollbar-hide bg-white/5 border border-white/10 rounded-2xl p-1 w-full cursor-grab active:cursor-grabbing select-none"
        >
          <StickyScrollArrowLeft show={periodosScroll.canScrollLeft} onClick={() => periodosScroll.scrollByAmount(-1)} />
          <StickyScrollArrowRight show={periodosScroll.canScrollRight} onClick={() => periodosScroll.scrollByAmount(1)} />
          {PERIODOS.map((p) => {
            const ativo = periodo === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={(e) => {
                  setPeriodo(p.id);
                  e.currentTarget.scrollIntoView({ inline: "nearest", block: "nearest", behavior: "smooth" });
                }}
                aria-pressed={ativo}
                className={`relative isolate shrink-0 px-3 py-1.5 min-h-8 font-black text-[10px] uppercase rounded-xl transition-all flex flex-row items-center justify-center gap-1.5 active:scale-95 whitespace-nowrap ${
                  ativo
                    ? "text-primary-foreground shadow-[0_4px_18px_-4px_var(--primary)]"
                    : "text-muted-foreground border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] hover:text-foreground"
                }`}
              >
                {ativo && (
                  <span className="absolute inset-0 rounded-xl bg-gradient-to-br from-primary via-primary to-fuchsia-500/80" aria-hidden="true" />
                )}
                <CalendarDays className="relative z-10 size-3 shrink-0" />
                <span className="relative z-10">{p.label}</span>
              </button>
            );
          })}
        </div>
      </div>
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-5 px-1">
        {diaCurto(intervalo.de)} a {diaCurto(intervalo.ate)} · dias em UTC
      </p>

      {estado.tipo === "carregando" ? (
        <Esqueleto />
      ) : estado.tipo === "erro" ? (
        <LoadErrorState onRetry={() => setTentativa((t) => t + 1)} />
      ) : (
        <Resumo resumo={estado.resumo} />
      )}
    </main>
  );
}

function Esqueleto() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Carregando">
      <div className="grid grid-cols-3 gap-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-[76px] rounded-2xl bg-white/[0.04] border border-white/5 animate-pulse" />
        ))}
      </div>
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-44 rounded-2xl bg-white/[0.03] border border-white/5 animate-pulse" />
      ))}
    </div>
  );
}

function Resumo({ resumo }: { resumo: ResumoUso }) {
  const totalTelas = resumo.telas.reduce((s, t) => s + t.n, 0);
  const totalAcoes = resumo.acoes.reduce((s, a) => s + a.n, 0);
  const vazio =
    resumo.jogadores === 0 &&
    resumo.telas.length === 0 &&
    resumo.acoes.length === 0 &&
    resumo.porAparelho.length === 0;

  if (vazio) {
    return (
      <div className="p-6 rounded-2xl bg-white/[0.02] border border-white/5 text-center">
        <Activity className="size-8 text-primary/70 mx-auto mb-3" />
        <p className="text-sm font-bold">Ainda sem dados: a medição começa a contar a partir de hoje.</p>
      </div>
    );
  }

  const maxTela = Math.max(1, ...resumo.telas.map((t) => t.n));
  const maxAcao = Math.max(1, ...resumo.acoes.map((a) => a.n));
  const totalAparelho = resumo.porAparelho.reduce((s, a) => s + a.n, 0) || 1;
  const caminhos = resumo.caminhos.slice(0, 10);
  const maxCaminho = Math.max(1, ...caminhos.map((c) => c.n));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        <Numero icon={Users} valor={resumo.jogadores} label="Jogadores" />
        <Numero icon={Eye} valor={totalTelas} label="Telas abertas" />
        <Numero icon={MousePointerClick} valor={totalAcoes} label="Ações" />
      </div>

      <Secao titulo="Telas mais abertas" icon={Eye}>
        {resumo.telas.length === 0 ? (
          <Nada />
        ) : (
          resumo.telas.map((t) => (
            <Linha
              key={t.alvo}
              rotulo={nomeDaTela(t.alvo)}
              valor={t.n}
              pct={(t.n / maxTela) * 100}
              extra={`${fmt(t.jogadores)} ${t.jogadores === 1 ? "jogador" : "jogadores"}`}
            />
          ))
        )}
      </Secao>

      <Secao titulo="Ações principais" icon={MousePointerClick}>
        {resumo.acoes.length === 0 ? (
          <Nada />
        ) : (
          resumo.acoes.map((a) => {
            const nome = nomeDaAcao(a.alvo);
            return (
              <Linha
                key={a.alvo}
                rotulo={nome}
                mono={nome === a.alvo && a.alvo.startsWith("/")}
                valor={a.n}
                pct={(a.n / maxAcao) * 100}
              />
            );
          })
        )}
      </Secao>

      {/* `porAparelho` soma tudo (telas + ações + caminhos), por isso "Atividade". */}
      <Secao titulo="Atividade por aparelho" icon={Smartphone}>
        {resumo.porAparelho.length === 0 ? (
          <Nada />
        ) : (
          resumo.porAparelho.map((a) => {
            const info = NOME_APARELHO[a.aparelho];
            const Icon = info?.icon ?? Monitor;
            const pct = (a.n / totalAparelho) * 100;
            return (
              <div key={a.aparelho} className="min-w-0">
                <div className="flex items-center gap-2 min-w-0">
                  <Icon className="size-4 text-primary shrink-0" />
                  <span className="flex-1 min-w-0 text-xs font-bold truncate">{info?.label ?? a.aparelho}</span>
                  <span className="shrink-0 text-xs font-black tabular-nums">{fmt(a.n)}</span>
                  <span className="shrink-0 w-10 text-right text-[11px] font-bold text-muted-foreground tabular-nums">
                    {Math.round(pct)}%
                  </span>
                </div>
                <Barra pct={pct} />
              </div>
            );
          })
        )}
      </Secao>

      <Secao titulo="De onde vêm as ações" icon={RouteIcon} nota="Top 10: ação ← tela onde ela aconteceu">
        {caminhos.length === 0 ? (
          <Nada />
        ) : (
          caminhos.map((c) => {
            const [acao, tela] = nomeDoCaminho(c.alvo).split(" ← ");
            return (
              <Linha
                key={c.alvo}
                rotulo={
                  <>
                    {acao}
                    {tela !== undefined && (
                      <>
                        <span className="text-muted-foreground"> ← </span>
                        <span className="text-muted-foreground">{tela}</span>
                      </>
                    )}
                  </>
                }
                valor={c.n}
                pct={(c.n / maxCaminho) * 100}
              />
            );
          })
        )}
      </Secao>
    </div>
  );
}

function Numero({ icon: Icon, valor, label }: { icon: typeof Users; valor: number; label: string }) {
  return (
    <div className="min-w-0 p-3 rounded-2xl bg-white/[0.02] border border-white/5">
      <Icon className="size-4 text-primary shrink-0 mb-1.5" />
      {/* Em tela bem estreita a fonte diminui para o número caber inteiro (nunca "…"). */}
      <p className="text-base min-[380px]:text-xl font-black tabular-nums leading-none [overflow-wrap:anywhere]">{fmt(valor)}</p>
      <p className="mt-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground leading-tight">{label}</p>
    </div>
  );
}

function Secao({
  titulo,
  icon: Icon,
  nota,
  children,
}: {
  titulo: string;
  icon: typeof Users;
  nota?: string;
  children: ReactNode;
}) {
  return (
    <section className="p-4 rounded-2xl bg-white/[0.02] border border-white/5">
      <h2 className="flex items-center gap-2 min-w-0 text-[11px] font-black uppercase tracking-widest">
        <Icon className="size-4 text-primary shrink-0" />
        <span className="min-w-0">{titulo}</span>
      </h2>
      {nota && <p className="mt-1 text-[10px] text-muted-foreground font-bold">{nota}</p>}
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

function Linha({
  rotulo,
  valor,
  pct,
  extra,
  mono,
}: {
  rotulo: ReactNode;
  valor: number;
  pct: number;
  extra?: string;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0">
      <div className="flex items-baseline gap-2 min-w-0">
        {/* Quebra em qualquer ponto (caminhos longos) em vez de esconder texto. */}
        <span className={`flex-1 min-w-0 text-xs font-bold [overflow-wrap:anywhere] ${mono ? "font-mono text-[11px]" : ""}`}>
          {rotulo}
        </span>
        <span className="shrink-0 text-xs font-black tabular-nums">{fmt(valor)}</span>
      </div>
      <Barra pct={pct} />
      {extra && <p className="mt-1 text-[10px] font-bold text-muted-foreground">{extra}</p>}
    </div>
  );
}

function Barra({ pct }: { pct: number }) {
  return (
    <div className="mt-1.5 h-1.5 rounded-full bg-white/5 overflow-hidden">
      <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(2, Math.min(100, pct))}%` }} />
    </div>
  );
}

function Nada() {
  return <p className="text-xs text-muted-foreground">Nada neste período.</p>;
}
