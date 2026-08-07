import { createFileRoute, Link } from "@tanstack/react-router";
import { BackButton } from "@/components/BackButton";
import { useEffect, useState } from "react";
import { ChevronLeft, Gavel, Loader2 } from "lucide-react";
import { api, fmtEC } from "@/lib/api";
import { useTelegramUser } from "@/lib/telegram";
import { notify } from "@/lib/notify";

export const Route = createFileRoute("/leiloes")({
  component: LeiloesPage,
  head: () => ({ meta: [{ title: "Leilões • Empire Hub" }] }),
});

function LeiloesPage() {
  const { user } = useTelegramUser();
  const [items, setItems] = useState<unknown[] | null>(null);
  const [meusArtistas, setMeusArtistas] = useState<string[]>([]);
  const [bidding, setBidding] = useState<string | null>(null);

  async function load() {
    const r = await api.listarLeiloes();
    setItems(r);
  }

  useEffect(() => {
    load();
  }, []);
  useEffect(() => {
    if (!user) return;
    api.meusArtistas(user.id).then((l) => setMeusArtistas(l.map((a) => a.nome)));
  }, [user]);

  async function bid(item: Record<string, unknown>) {
    if (!meusArtistas.length) {
      notify("⚠️ Você precisa ter um artista vinculado.");
      return;
    }
    const nome = meusArtistas[0];
    const valor = Number(
      prompt(
        `Lance atual: ${fmtEC(Number(item.lanceAtual || item.lance_atual || item.lanceMini || 0))}\nDigite seu lance em $EC:`,
      ) || 0,
    );
    if (!valor) return;
    setBidding(String(item.id));
    const r = (await api.darLance({ nome, itemId: String(item.id), valor })) as string;
    notify(r, { successFallback: "Lance dado!" });
    setBidding(null);
    load();
  }

  return (
    <main className="flex-1 mx-auto w-full max-w-2xl px-4 pt-6">
      <BackButton />
      <header className="mb-6 flex items-center gap-3">
        <div className="size-12 rounded-xl bg-primary/15 text-primary grid place-items-center">
          <Gavel className="size-6" />
        </div>
        <div>
          <h1 className="text-2xl font-extrabold">Leilões</h1>
          <p className="text-xs text-muted-foreground">Itens públicos disponíveis pra lance</p>
        </div>
      </header>

      {items === null && <div className="h-32 bg-card rounded-xl animate-pulse" />}
      {items?.length === 0 && (
        <p className="text-sm text-muted-foreground">Nenhum leilão ativo no momento.</p>
      )}
      <ul className="space-y-3">
        {(items as Record<string, unknown>[] | null)?.map((it, i) => (
          <li key={i} className="p-4 rounded-xl bg-card border border-border">
            <p className="font-bold text-sm">{String(it.descricao || it.titulo || "")}</p>
            <p className="text-xs text-muted-foreground mt-1">Vendedor: {String(it.vendedor || "")}</p>
            <div className="flex items-center justify-between mt-3">
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Lance atual
                </p>
                <p className="text-lg font-black text-primary">
                  {fmtEC(Number(it.lanceAtual || it.lance_atual || it.lanceMini || 0))}
                </p>
                <p className="text-[10px] text-muted-foreground">por {String(it.licitante || "—")}</p>
              </div>
              <button
                onClick={() => bid(it)}
                disabled={bidding === String(it.id)}
                className="px-4 py-2 rounded-full bg-primary text-primary-foreground font-bold text-xs uppercase tracking-wider inline-flex items-center gap-2"
              >
                {bidding === String(it.id) && <Loader2 className="size-3 animate-spin" />} Dar lance
              </button>
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
