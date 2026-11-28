import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Copy, Layers, MoreHorizontal, Trash2, User, X } from "lucide-react";
import { toast } from "sonner";
import { BackButton } from "@/components/BackButton";
import { ScrollRow } from "@/components/ScrollRow";
import { ActionSheet, type AcaoMenu } from "@/components/ActionSheet";
import { useHistoryOverlay } from "@/hooks/useHistoryOverlay";
import { useIsAdmin, useJogador } from "@/hooks/useJogador";
import { cn } from "@/lib/utils";

// Vitrine das peças do Beta (fase 0, docs/beta-fundacoes.md). Escondida, só
// admin, sem link em menu nenhum — serve para conferir as peças no navegador
// (fileira rolável, menu ⋯, folha por cima de folha, voltar, tokens).
// Acesso: /beta-pecas.
export const Route = createFileRoute("/beta-pecas")({
  head: () => ({ meta: [{ title: "Peças do Beta — Empire Hub" }] }),
  component: BetaPecasPage,
});

const PILULAS = Array.from({ length: 10 }, (_, i) => `Pílula ${i + 1}`);

const TOKENS = [
  "--superficie-1",
  "--superficie-2",
  "--texto-secundario",
  "--linha",
  "--destaque",
  "--ao-vivo",
  "--alta",
  "--queda",
  "--ouro",
] as const;

function BetaPecasPage() {
  const { carregado } = useJogador();
  const isAdmin = useIsAdmin();
  const router = useRouter();
  const [pilula, setPilula] = useState("Pílula 9");
  const [menuAberto, setMenuAberto] = useState(false);
  const [folhaAberta, setFolhaAberta] = useState(false);

  // Antes de ler o login não dá para saber se é admin: não pisca o "não encontrada".
  if (!carregado) return <main className="flex-1" />;

  if (!isAdmin) {
    return (
      <main className="flex-1 mx-auto w-full max-w-2xl px-4 pt-6 pb-20">
        <BackButton />
        <p className="text-muted-foreground mt-6">Página não encontrada.</p>
      </main>
    );
  }

  const acoes: AcaoMenu[] = [
    { id: "excluir", rotulo: "Excluir", icone: Trash2, destrutiva: true, aoEscolher: () => toast("Excluir (só teste).") },
    { id: "folha", rotulo: "Abrir outra folha", icone: Layers, aoEscolher: () => setFolhaAberta(true) },
    {
      id: "perfil",
      rotulo: "Ir para o Perfil",
      icone: User,
      navega: true,
      aoEscolher: () => router.navigate({ to: "/perfil" }),
    },
    { id: "copiar", rotulo: "Copiar", icone: Copy, aoEscolher: () => toast("Copiado (só teste).") },
  ];

  return (
    <main className="flex-1 mx-auto w-full max-w-2xl px-4 pt-6 pb-20">
      <BackButton />
      <div className="mt-4 flex items-center gap-2">
        <h1 className="min-w-0 flex-1 truncate text-2xl font-black">Peças do Beta</h1>
        <button
          type="button"
          aria-label="Mais opções"
          data-testid="botao-menu"
          onClick={() => setMenuAberto(true)}
          className="grid size-11 shrink-0 place-items-center rounded-full bg-superficie-2 px-1 active:scale-95 transition-transform"
        >
          <MoreHorizontal className="size-5 shrink-0" />
        </button>
      </div>
      <p className="text-sm text-texto-secundario mt-1">
        Só admin vê esta página. Ela não aparece em menu nenhum.
      </p>

      <h2 className="mt-6 mb-2 text-sm font-bold">Fileira rolável (ScrollRow)</h2>
      <ScrollRow rotulo="Pílulas de teste" selecionado={pilula} className="-mx-4">
        {PILULAS.map((nome, i) => {
          const ativo = nome === pilula;
          return (
            <div key={nome} data-scroll-item={nome} className={cn("shrink-0 py-1 pr-2", i === 0 && "pl-4", i === PILULAS.length - 1 && "pr-4")}>
              <button
                type="button"
                aria-pressed={ativo}
                onClick={() => setPilula(nome)}
                className={cn(
                  "shrink-0 whitespace-nowrap rounded-full px-4 py-2 text-sm font-bold transition-colors",
                  ativo ? "bg-destaque text-white" : "bg-superficie-2 text-foreground",
                )}
              >
                {nome}
              </button>
            </div>
          );
        })}
      </ScrollRow>
      <p className="mt-2 text-xs text-texto-secundario">Selecionada: {pilula}</p>

      <h2 className="mt-8 mb-2 text-sm font-bold">Tokens de cor (escuro = hoje · claro = definido, não ligado)</h2>
      <div className="grid grid-cols-2 gap-3">
        <AmostrasTokens titulo="Escuro" />
        <AmostrasTokens titulo="Claro (.tema-claro)" claro />
      </div>

      <ActionSheet aberto={menuAberto} titulo="Opções de teste" acoes={acoes} aoFechar={() => setMenuAberto(false)} />
      <FolhaSimples
        aberta={folhaAberta}
        aoFechar={() => setFolhaAberta(false)}
        irParaPerfil={() => router.navigate({ to: "/perfil" })}
      />
    </main>
  );
}

function AmostrasTokens({ titulo, claro }: { titulo: string; claro?: boolean }) {
  return (
    <div
      data-testid={claro ? "tokens-claro" : "tokens-escuro"}
      className={cn("min-w-0 rounded-2xl border p-3", claro ? "tema-claro bg-white text-black border-black/10" : "bg-background border-linha")}
    >
      <b className="block min-w-0 truncate text-xs font-bold mb-2">{titulo}</b>
      <ul className="space-y-1.5">
        {TOKENS.map((t) => (
          <li key={t} className="flex min-w-0 items-center gap-2">
            <span className="size-6 shrink-0 rounded-md border border-[var(--linha)]" style={{ background: `var(${t})` }} />
            <code className="min-w-0 break-all text-[11px]" style={{ color: t === "--texto-secundario" ? `var(${t})` : undefined }}>
              {t}
            </code>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Segunda folha, aberta pelo menu ⋯ por TROCA (o menu fecha e ela reaproveita
 * a entrada dele). Dentro dela, outro ⋯ abre um menu EMPILHADO por cima
 * (entrada própria): voltar fecha só o de cima; o X da folha fecha os dois.
 */
function FolhaSimples({
  aberta,
  aoFechar,
  irParaPerfil,
}: {
  aberta: boolean;
  aoFechar: () => void;
  irParaPerfil: () => void;
}) {
  const { fechar } = useHistoryOverlay(aberta, aoFechar);
  const [montado, setMontado] = useState(false);
  const [menuAberto, setMenuAberto] = useState(false);
  const dialogoRef = useRef<HTMLDivElement>(null);
  useEffect(() => setMontado(true), []);
  // Fecha o menu de cima junto quando a folha fecha (mesmo commit: um único go()).
  useEffect(() => {
    if (!aberta) setMenuAberto(false);
  }, [aberta]);
  // Foco em efeito passivo, só ao abrir: roda depois da limpeza do ActionSheet
  // que devolve o foco ao ⋯ (troca no mesmo commit), então o foco fica aqui.
  useEffect(() => {
    if (aberta && montado) dialogoRef.current?.focus({ preventScroll: true });
  }, [aberta, montado]);
  if (!montado || !aberta) return null;
  const acoesDeCima: AcaoMenu[] = [
    {
      id: "perfil",
      rotulo: "Ir para o Perfil",
      icone: User,
      navega: true,
      // O menu já saiu do histórico; fecha a folha e só navega quando a
      // entrada dela também saiu (nada órfão por baixo do /perfil).
      aoEscolher: () => fechar(irParaPerfil),
    },
    { id: "copiar", rotulo: "Copiar", icone: Copy, aoEscolher: () => toast("Copiado (só teste).") },
  ];
  const aoTeclar = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      fechar();
    }
  };
  return createPortal(
    <div className="fixed inset-0 z-[300] flex items-end sm:items-center justify-center" data-testid="folha-simples">
      <div className="absolute inset-0 bg-black/70" onClick={() => fechar()} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Outra folha"
        tabIndex={-1}
        ref={dialogoRef}
        onKeyDown={aoTeclar}
        className="relative w-full sm:max-w-sm rounded-t-[1.75rem] sm:rounded-[1.75rem] border-t sm:border border-border bg-background p-4 outline-none"
        style={{ paddingBottom: "calc(1rem + env(safe-area-inset-bottom))" }}
      >
        <div className="flex items-center gap-2">
          <b className="min-w-0 flex-1 truncate px-1 text-base font-bold">Outra folha</b>
          <button
            type="button"
            aria-label="Mais opções da folha"
            data-testid="botao-menu-folha"
            onClick={() => setMenuAberto(true)}
            className="grid size-11 shrink-0 place-items-center rounded-full bg-superficie-2 px-1"
          >
            <MoreHorizontal className="size-5 shrink-0" />
          </button>
          <button
            type="button"
            aria-label="Fechar"
            onClick={() => fechar()}
            className="grid size-11 shrink-0 place-items-center rounded-full bg-superficie-2 px-1"
          >
            <X className="size-5 shrink-0" />
          </button>
        </div>
        <p className="mt-2 px-1 text-sm text-texto-secundario">
          Aberta no lugar do menu ⋯ (troca). O ⋯ daqui abre um menu por cima
          desta folha; o voltar fecha só o de cima.
        </p>
      </div>
      <ActionSheet
        aberto={aberta && menuAberto}
        titulo="Opções da folha"
        acoes={acoesDeCima}
        aoFechar={() => setMenuAberto(false)}
      />
    </div>,
    document.body,
  );
}
