import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ChevronLeft, Building2, Sparkles, Briefcase, Loader2 } from "lucide-react";
import { api, fmtEC, fmtMoney, type BemItem } from "@/lib/api";
import { notify } from "@/lib/notify";

export const Route = createFileRoute("/artistas/$nome/bens")({
  component: BensPage,
});

const CAT_ICON: Record<string, React.ReactNode> = {
  IMOVEIS: <Building2 className="size-5" />,
  MARKET: <Sparkles className="size-5" />,
  CARREIRA: <Briefcase className="size-5" />,
};

function BensPage() {
  const { nome } = Route.useParams();
  const [bens, setBens] = useState<BemItem[] | null>(null);
  const [selling, setSelling] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  useEffect(() => {
    api.meusBens(nome).then(setBens);
  }, [nome]);

  async function vender(id: string) {
    setSelling(id);
    const r = await api.venderBem({ nome, id });
    notify(r, { successFallback: "Bem vendido." });
    setSelling(null);
    setConfirmId(null);
    api.meusBens(nome).then(setBens);
  }

  const total = bens?.reduce((s, b) => s + (b.status === "Vendido" ? 0 : b.valor), 0) || 0;

  return (
    <main className="flex-1 mx-auto w-full max-w-2xl px-4 pt-4">
      <Link
        to="/artistas/$nome"
        params={{ nome }}
        className="inline-flex items-center gap-1 text-muted-foreground mb-4"
      >
        <ChevronLeft className="size-5" /> {nome}
      </Link>
      <h1 className="text-2xl font-black">Meus Bens</h1>
      <p className="text-sm text-muted-foreground">
        Patrimônio total: <span className="font-bold text-foreground">{fmtMoney(total)}</span>
      </p>

      <div className="mt-6 space-y-3">
        {bens === null ? (
          <div className="rounded-xl bg-card animate-pulse h-32" />
        ) : bens.length === 0 ? (
          <EmptyBens nome={nome} />
        ) : (
          bens.map((b, i) => {
            const id = b.id || String(i);
            const ativo = b.status !== "Vendido";
            return (
              <div
                key={id}
                className={`p-4 rounded-xl bg-card flex items-center gap-3 ${!ativo ? "opacity-50" : ""}`}
              >
                <div className="size-12 rounded-lg bg-primary/15 text-primary grid place-items-center shrink-0">
                  {CAT_ICON[b.categoria] || <Sparkles className="size-5" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-extrabold text-sm truncate">{b.item}</p>
                  <p className="text-xs text-muted-foreground">
                    {b.categoria} • {b.data?.split("T")[0] || ""}
                  </p>
                  <p className="text-sm font-bold text-primary">{fmtEC(b.valor)}</p>
                </div>
                {ativo && b.id && (
                  <button
                    onClick={() => setConfirmId(b.id!)}
                    disabled={selling === b.id}
                    className="px-3 py-2 rounded-full bg-secondary text-xs font-bold inline-flex items-center gap-1.5 disabled:opacity-50"
                  >
                    {selling === b.id ? <Loader2 className="size-3 animate-spin" /> : null} Vender
                  </button>
                )}
                {!ativo && (
                  <span className="text-[10px] uppercase font-bold text-muted-foreground">
                    Vendido
                  </span>
                )}
              </div>
            );
          })
        )}
      </div>

      {confirmId && (
        <ConfirmSell
          item={bens?.find((b) => b.id === confirmId)}
          onCancel={() => setConfirmId(null)}
          onConfirm={() => vender(confirmId)}
          loading={selling === confirmId}
        />
      )}
    </main>
  );
}

function EmptyBens({ nome: _nome }: { nome: string }) {
  return (
    <div className="rounded-2xl bg-card p-8 text-center">
      <div className="size-14 rounded-full bg-primary/15 text-primary grid place-items-center mx-auto mb-3">
        <Building2 className="size-6" />
      </div>
      <p className="font-extrabold mb-1">Nenhum bem ainda</p>
      <p className="text-xs text-muted-foreground mb-4">
        Quando você comprar imóveis, mansões ou itens duráveis no Empire Market, eles aparecem aqui
        como patrimônio.
      </p>
      <Link
        to="/market"
        className="inline-block px-4 py-2 rounded-full bg-primary text-primary-foreground text-xs font-extrabold uppercase tracking-wider"
      >
        Ir ao Empire Market
      </Link>
    </div>
  );
}

function ConfirmSell({
  item,
  onCancel,
  onConfirm,
  loading,
}: {
  item?: BemItem;
  onCancel: () => void;
  onConfirm: () => void;
  loading: boolean;
}) {
  if (!item) return null;
  const retorno = Math.floor(item.valor * 0.7);
  return (
    <div
      onClick={onCancel}
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm grid place-items-end sm:place-items-center p-0 sm:p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md bg-card rounded-t-2xl sm:rounded-2xl p-5 border border-border"
      >
        <h3 className="text-lg font-extrabold mb-1">Vender este bem?</h3>
        <p className="text-sm text-muted-foreground mb-4">{item.item}</p>
        <div className="rounded-xl bg-background p-4 mb-4 space-y-1">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Pagou</span>
            <span className="font-bold">{fmtEC(item.valor)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Você recebe (70%)</span>
            <span className="font-black text-primary">{fmtEC(retorno)}</span>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={onCancel}
            className="py-3 rounded-full bg-secondary font-bold text-sm uppercase tracking-wider"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className="py-3 rounded-full bg-primary text-primary-foreground font-extrabold text-sm uppercase tracking-wider disabled:opacity-50 inline-flex items-center justify-center gap-2"
          >
            {loading && <Loader2 className="size-4 animate-spin" />} Vender
          </button>
        </div>
      </div>
    </div>
  );
}
