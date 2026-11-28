import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, Eye, Loader2, MoreHorizontal, RotateCcw, X } from "lucide-react";
import { toast } from "sonner";
import { BackButton } from "@/components/BackButton";
import { ScrollRow } from "@/components/ScrollRow";
import { ActionSheet, type AcaoMenu } from "@/components/ActionSheet";
import { Folha } from "@/components/Beta/Folha";
import { useIsAdmin, useJogador } from "@/hooks/useJogador";
import { api } from "@/lib/api";
import { opcoesConsulta } from "@/lib/consultas";
import { ROTULO_MOTIVO, type ConfigBeta, type ModoBeta } from "@/lib/beta/regras";
import { nomeDaTela } from "@/lib/uso/nomes";
import { cn } from "@/lib/utils";

// Tela só do admin: reportes do Beta e chave do Beta (modo + convidados).
// Não admin vê um aviso com link para o Início.
export const Route = createFileRoute("/beta-admin")({
  head: () => ({ meta: [{ title: "Beta test (admin) — Empire Hub" }] }),
  component: BetaAdminPage,
});

type StatusReporte = "novo" | "visto" | "resolvido";
type Reporte = {
  id: string | number;
  jogadorId: string;
  usuario: string;
  versao: string;
  tela: string;
  rota: string;
  texto: string;
  motivo: string | null;
  printUrl: string | null;
  tecnico: string | null;
  status: StatusReporte;
  criadoEm: number | string;
};

const POR_PAGINA = 20;
const ABAS = [
  { id: "reportes", rotulo: "Reportes" },
  { id: "chave", rotulo: "Chave do Beta" },
] as const;
const FILTROS: { id: string; rotulo: string; status?: StatusReporte }[] = [
  { id: "novo", rotulo: "Novos", status: "novo" },
  { id: "visto", rotulo: "Vistos", status: "visto" },
  { id: "resolvido", rotulo: "Resolvidos", status: "resolvido" },
  { id: "todos", rotulo: "Todos" },
];
const ROTULO_STATUS: Record<StatusReporte, string> = { novo: "Novo", visto: "Visto", resolvido: "Resolvido" };
const COR_STATUS: Record<StatusReporte, string> = {
  novo: "bg-destaque/20 text-destaque",
  visto: "bg-superficie-2 text-texto-secundario",
  resolvido: "bg-alta/15 text-alta",
};

const MODOS: { id: ModoBeta; rotulo: string; explica: string }[] = [
  { id: "desligado", rotulo: "Desligado", explica: "Ninguém vê o Beta, só o admin." },
  { id: "convidados", rotulo: "Só convidados", explica: "Só quem estiver na lista abaixo." },
  { id: "todos", rotulo: "Ligado para todos", explica: "Todos começam no Beta e podem voltar." },
  { id: "obrigatorio", rotulo: "Obrigatório", explica: "O Beta vira a única versão. O botão de voltar some." },
];

/** Data em horário de Brasília, "dd/mm HH:mm". */
function dataBrasilia(v: number | string): string {
  const d = new Date(typeof v === "string" && /^\d+$/.test(v) ? Number(v) : v);
  if (Number.isNaN(d.getTime())) return "";
  const partes = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const g = (t: string) => partes.find((p) => p.type === t)?.value ?? "";
  return `${g("day")}/${g("month")} ${g("hour")}:${g("minute")}`;
}

function tecnicoFormatado(t: string): string {
  try {
    return JSON.stringify(JSON.parse(t), null, 2);
  } catch {
    return t;
  }
}

/** Convidado como digitado, sem "@" inicial e sem espaços. */
function limparConvidado(v: string): string {
  return v.replace(/\s+/g, "").replace(/^@+/, "");
}

function BetaAdminPage() {
  const { carregado } = useJogador();
  const isAdmin = useIsAdmin();
  const [aba, setAba] = useState<(typeof ABAS)[number]["id"]>("reportes");

  // Antes de ler o login não dá para saber se é admin: não pisca o aviso.
  if (!carregado) return <main className="flex-1" />;

  if (!isAdmin) {
    return (
      <main className="flex-1 mx-auto w-full max-w-2xl px-4 pt-6 pb-20">
        <BackButton />
        <p className="mt-6 text-texto-secundario">Só o admin pode ver esta tela.</p>
        <Link to="/" className="mt-3 inline-block rounded-full bg-superficie-2 px-4 py-2 text-sm font-bold">
          Ir para o Início
        </Link>
      </main>
    );
  }

  return (
    <main className="flex-1 mx-auto w-full max-w-2xl px-4 pt-6 pb-20">
      <BackButton />
      <h1 className="mt-4 truncate text-2xl font-black">Beta test (admin)</h1>

      <ScrollRow rotulo="Seções do Beta test" selecionado={aba} className="-mx-4 mt-3">
        {ABAS.map((a, i) => (
          <div key={a.id} data-scroll-item={a.id} className={cn("shrink-0 py-1 pr-2", i === 0 && "pl-4")}>
            <button
              type="button"
              aria-pressed={a.id === aba}
              onClick={() => setAba(a.id)}
              className={cn(
                "shrink-0 whitespace-nowrap rounded-full px-4 py-2 text-sm font-bold transition-colors",
                a.id === aba ? "bg-destaque text-white" : "bg-superficie-2 text-foreground",
              )}
            >
              {a.rotulo}
            </button>
          </div>
        ))}
      </ScrollRow>

      {aba === "reportes" ? <AbaReportes /> : <AbaChave />}
    </main>
  );
}

function AbaReportes() {
  const qc = useQueryClient();
  const [filtro, setFiltro] = useState("novo");
  const [menuDe, setMenuDe] = useState<Reporte | null>(null);
  const [printAberto, setPrintAberto] = useState<string | null>(null);
  const status = FILTROS.find((f) => f.id === filtro)?.status;

  const q = useInfiniteQuery({
    queryKey: ["beta-reportes", filtro],
    queryFn: async ({ pageParam }) => {
      const r = await api.betaListarReportes({ status, antesDe: pageParam });
      return r.reportes as Reporte[];
    },
    initialPageParam: undefined as string | number | undefined,
    getNextPageParam: (ultima) =>
      ultima.length >= POR_PAGINA ? ultima[ultima.length - 1]?.criadoEm : undefined,
    ...opcoesConsulta("social"),
  });
  const reportes = q.data?.pages.flat() ?? [];

  const mudar = useMutation({
    mutationFn: (v: { id: string | number; status: StatusReporte }) => api.betaMudarStatus(v.id, v.status),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["beta-reportes"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const acoes: AcaoMenu[] = menuDe
    ? ([
        { id: "visto", rotulo: "Marcar como visto", icone: Eye, alvo: "visto" },
        { id: "resolvido", rotulo: "Marcar como resolvido", icone: Check, alvo: "resolvido" },
        { id: "novo", rotulo: "Voltar para novo", icone: RotateCcw, alvo: "novo" },
      ] as const)
        .filter((a) => a.alvo !== menuDe.status)
        .map((a) => ({
          id: a.id,
          rotulo: a.rotulo,
          icone: a.icone,
          aoEscolher: () => mudar.mutate({ id: menuDe.id, status: a.alvo }),
        }))
    : [];

  return (
    <section className="mt-3">
      <ScrollRow rotulo="Filtrar reportes" selecionado={filtro} className="-mx-4">
        {FILTROS.map((f, i) => (
          <div key={f.id} data-scroll-item={f.id} className={cn("shrink-0 py-1 pr-2", i === 0 && "pl-4")}>
            <button
              type="button"
              aria-pressed={f.id === filtro}
              onClick={() => setFiltro(f.id)}
              className={cn(
                "shrink-0 whitespace-nowrap rounded-full px-4 py-2 text-sm font-bold transition-colors",
                f.id === filtro ? "bg-destaque text-white" : "bg-superficie-2 text-foreground",
              )}
            >
              {f.rotulo}
            </button>
          </div>
        ))}
      </ScrollRow>

      <div className="mt-3 space-y-3">
        {q.isLoading && (
          <div className="flex justify-center py-8">
            <Loader2 className="size-6 animate-spin text-texto-secundario" aria-label="Carregando" />
          </div>
        )}
        {q.isError && (
          <div className="rounded-2xl bg-superficie-1 p-4 text-sm">
            <p className="text-queda">{(q.error as Error).message}</p>
            <button
              type="button"
              onClick={() => q.refetch()}
              className="mt-2 rounded-full bg-superficie-2 px-4 py-2 text-sm font-bold"
            >
              Tentar de novo
            </button>
          </div>
        )}
        {!q.isLoading && !q.isError && reportes.length === 0 && (
          <p className="py-8 text-center text-sm text-texto-secundario">Nenhum reporte aqui.</p>
        )}
        {reportes.map((r) => (
          <CartaoReporte
            key={r.id}
            r={r}
            aoMenu={() => setMenuDe(r)}
            aoPrint={() => r.printUrl && setPrintAberto(r.printUrl)}
          />
        ))}
        {q.hasNextPage && (
          <button
            type="button"
            onClick={() => q.fetchNextPage()}
            disabled={q.isFetchingNextPage}
            className="mx-auto flex min-w-0 items-center justify-center gap-2 rounded-full bg-superficie-2 px-5 py-2.5 text-sm font-bold disabled:opacity-60"
          >
            {q.isFetchingNextPage && <Loader2 className="size-4 shrink-0 animate-spin" />}
            <span className="truncate">Carregar mais</span>
          </button>
        )}
      </div>

      <ActionSheet aberto={!!menuDe} titulo="Reporte" acoes={acoes} aoFechar={() => setMenuDe(null)} />
      <Folha aberto={!!printAberto} titulo="Print do reporte" aoFechar={() => setPrintAberto(null)}>
        {() => (
          <div className="pb-2">
            {printAberto && <img src={printAberto} alt="Print do reporte" className="mx-auto max-h-[70dvh] w-full rounded-xl object-contain" />}
          </div>
        )}
      </Folha>
    </section>
  );
}

function CartaoReporte({ r, aoMenu, aoPrint }: { r: Reporte; aoMenu: () => void; aoPrint: () => void }) {
  const [expandido, setExpandido] = useState(false);
  const [temMais, setTemMais] = useState(false);
  const [tecnicoAberto, setTecnicoAberto] = useState(false);
  const textoRef = useRef<HTMLParagraphElement>(null);

  // "ver mais" só aparece se o texto passa de 3 linhas.
  useEffect(() => {
    const el = textoRef.current;
    if (el && !expandido) setTemMais(el.scrollHeight > el.clientHeight + 1);
  }, [r.texto, expandido]);

  return (
    <article className="min-w-0 rounded-2xl bg-superficie-1 p-4">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold">@{r.usuario}</p>
          <p className="text-xs text-texto-secundario">
            {dataBrasilia(r.criadoEm)} · versão {r.versao}
          </p>
        </div>
        <span className={cn("shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold", COR_STATUS[r.status])}>
          {ROTULO_STATUS[r.status] ?? r.status}
        </span>
        <button
          type="button"
          aria-label="Mais opções do reporte"
          onClick={aoMenu}
          className="grid size-10 shrink-0 place-items-center rounded-full bg-superficie-2 px-1 active:scale-95 transition-transform"
        >
          <MoreHorizontal className="size-5 shrink-0" />
        </button>
      </div>
      <p className="mt-2 break-words text-xs text-texto-secundario">
        Tela: <span className="text-foreground">{nomeDaTela(r.tela)}</span>
      </p>
      {r.motivo && (
        <p className="mt-1 break-words text-xs text-texto-secundario">
          Motivo: <span className="text-foreground">{(ROTULO_MOTIVO as Record<string, string>)[r.motivo] ?? r.motivo}</span>
        </p>
      )}
      <p ref={textoRef} className={cn("mt-2 whitespace-pre-wrap break-words text-sm", !expandido && "line-clamp-3")}>
        {r.texto}
      </p>
      {(temMais || expandido) && (
        <button
          type="button"
          onClick={() => setExpandido((v) => !v)}
          className="mt-1 rounded px-1 py-1 text-xs font-bold text-destaque"
        >
          {expandido ? "ver menos" : "ver mais"}
        </button>
      )}
      {r.printUrl && (
        <button type="button" onClick={aoPrint} aria-label="Abrir print em tamanho grande" className="mt-3 block rounded-xl">
          <img src={r.printUrl} alt="Print do reporte" loading="lazy" className="h-24 w-auto max-w-full rounded-xl object-cover" />
        </button>
      )}
      {r.tecnico && (
        <div className="mt-3">
          <button
            type="button"
            aria-expanded={tecnicoAberto}
            onClick={() => setTecnicoAberto((v) => !v)}
            className="flex min-w-0 items-center gap-1 rounded px-1 py-1 text-xs font-bold text-texto-secundario"
          >
            <ChevronDown className={cn("size-4 shrink-0 transition-transform", tecnicoAberto && "rotate-180")} />
            <span className="truncate">Dados técnicos</span>
          </button>
          {tecnicoAberto && (
            <pre className="mt-1 max-h-64 overflow-auto rounded-xl bg-black/30 p-3 text-[11px] leading-snug">
              {tecnicoFormatado(r.tecnico)}
            </pre>
          )}
        </div>
      )}
    </article>
  );
}

function AbaChave() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["beta-config"],
    queryFn: async () => (await api.betaConfig()).config,
    ...opcoesConsulta("aoVivo"),
  });
  const [rascunho, setRascunho] = useState<ConfigBeta | null>(null);
  const [novo, setNovo] = useState("");
  const [confirma, setConfirma] = useState(false);

  // Rascunho nasce da config do servidor; depois só o admin mexe nele.
  useEffect(() => {
    if (q.data && !rascunho) setRascunho({ modo: q.data.modo, convidados: [...q.data.convidados] });
  }, [q.data, rascunho]);

  const salvar = useMutation({
    mutationFn: (c: ConfigBeta) => api.betaSalvarConfig(c),
    onSuccess: (r) => {
      qc.setQueryData(["beta-config"], r.config);
      setRascunho({ modo: r.config.modo, convidados: [...r.config.convidados] });
      toast.success("Chave do Beta salva.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (q.isLoading || (!rascunho && !q.isError)) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="size-6 animate-spin text-texto-secundario" aria-label="Carregando" />
      </div>
    );
  }
  if (q.isError || !rascunho || !q.data) {
    return (
      <div className="mt-3 rounded-2xl bg-superficie-1 p-4 text-sm">
        <p className="text-queda">{(q.error as Error | null)?.message ?? "Não foi possível carregar."}</p>
        <button type="button" onClick={() => q.refetch()} className="mt-2 rounded-full bg-superficie-2 px-4 py-2 text-sm font-bold">
          Tentar de novo
        </button>
      </div>
    );
  }

  const base = q.data;
  const mudou =
    rascunho.modo !== base.modo ||
    rascunho.convidados.length !== base.convidados.length ||
    rascunho.convidados.some((c, i) => c !== base.convidados[i]);
  const rotuloModo = MODOS.find((m) => m.id === rascunho.modo)?.rotulo ?? rascunho.modo;

  const adicionar = () => {
    const c = limparConvidado(novo);
    if (!c) return;
    if (rascunho.convidados.some((x) => x.toLowerCase() === c.toLowerCase())) {
      toast.error("Esse convidado já está na lista.");
      return;
    }
    setRascunho({ ...rascunho, convidados: [...rascunho.convidados, c] });
    setNovo("");
  };

  const acoesConfirmar: AcaoMenu[] = [
    {
      id: "confirmar",
      rotulo: `Confirmar: ${rotuloModo}`,
      icone: Check,
      destrutiva: rascunho.modo === "obrigatorio",
      aoEscolher: () => salvar.mutate(rascunho),
    },
  ];

  return (
    <section className="mt-4">
      <div role="radiogroup" aria-label="Modo do Beta" className="space-y-2">
        {MODOS.map((m) => {
          const ativo = rascunho.modo === m.id;
          return (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={ativo}
              onClick={() => setRascunho({ ...rascunho, modo: m.id })}
              className={cn(
                "flex w-full min-w-0 items-start gap-3 rounded-2xl border px-4 py-3 text-left transition-colors",
                ativo ? "border-destaque bg-destaque/10" : "border-linha bg-superficie-1",
              )}
            >
              <span
                className={cn(
                  "mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border-2",
                  ativo ? "border-destaque" : "border-texto-secundario",
                )}
              >
                {ativo && <span className="size-2.5 rounded-full bg-destaque" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold">{m.rotulo}</span>
                <span className="block break-words text-xs text-texto-secundario">{m.explica}</span>
              </span>
            </button>
          );
        })}
      </div>

      <h2 className="mt-6 text-sm font-bold">Convidados</h2>
      <p className="text-xs text-texto-secundario">Adicione por ID ou @usuário. Vale quando a chave está em "Só convidados".</p>
      <form
        className="mt-2 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          adicionar();
        }}
      >
        <input
          value={novo}
          onChange={(e) => setNovo(e.target.value)}
          placeholder="ID ou @usuário"
          aria-label="ID ou @usuário do convidado"
          autoCapitalize="none"
          autoCorrect="off"
          className="min-w-0 flex-1 rounded-xl border border-linha bg-superficie-1 px-3 py-2.5 text-sm placeholder:text-texto-secundario focus:outline-none focus:border-destaque"
        />
        <button
          type="submit"
          disabled={!limparConvidado(novo)}
          className="shrink-0 rounded-xl bg-superficie-2 px-4 py-2.5 text-sm font-bold disabled:opacity-50"
        >
          Adicionar
        </button>
      </form>
      {rascunho.convidados.length === 0 ? (
        <p className="mt-3 text-xs text-texto-secundario">Nenhum convidado na lista.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {rascunho.convidados.map((c) => (
            <li key={c} className="flex min-w-0 items-center gap-2 rounded-xl bg-superficie-1 py-1 pl-4 pr-1">
              <span className="min-w-0 flex-1 truncate text-sm">{c}</span>
              <button
                type="button"
                aria-label={`Remover ${c}`}
                onClick={() => setRascunho({ ...rascunho, convidados: rascunho.convidados.filter((x) => x !== c) })}
                className="grid size-10 shrink-0 place-items-center rounded-full text-texto-secundario active:scale-95"
              >
                <X className="size-4 shrink-0" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        disabled={!mudou || salvar.isPending}
        onClick={() => setConfirma(true)}
        className="mt-6 flex w-full min-w-0 items-center justify-center gap-2 rounded-full bg-destaque px-4 py-3 text-sm font-bold text-white disabled:opacity-40"
      >
        {salvar.isPending && <Loader2 className="size-4 shrink-0 animate-spin" />}
        <span className="truncate">Salvar</span>
      </button>
      <ActionSheet aberto={confirma} titulo="Salvar a chave do Beta?" acoes={acoesConfirmar} aoFechar={() => setConfirma(false)} />
    </section>
  );
}
