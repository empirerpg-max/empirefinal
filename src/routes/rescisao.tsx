import { createFileRoute, Link } from "@tanstack/react-router";
import { BackButton } from "@/components/BackButton";
import { useEffect, useState } from "react";
import { ChevronLeft, FileText, Loader2, AlertCircle, ShieldAlert } from "lucide-react";
import { api, fmtEC, type Artist } from "@/lib/api";
import { useTelegramUser } from "@/lib/telegram";
import { notify } from "@/lib/notify";
import { Field } from "./acoes.tour";

export const Route = createFileRoute("/rescisao")({
  component: RescisaoPage,
});

function RescisaoPage() {
  const { user, ready } = useTelegramUser();
  const [artists, setArtists] = useState<Artist[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Form
  const [selectedArtist, setSelectedArtist] = useState("");
  const [destino, setDestino] = useState("Independent");

  useEffect(() => {
    if (!ready || !user) return;
    api.meusArtistas(user.id).then((a) => {
      setArtists(a);
      if (a.length > 0) setSelectedArtist(a[0].nome);
      setLoading(false);
    });
  }, [ready, user]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedArtist || !destino) return;
    setSubmitting(true);
    const r = await api.rescisao({
      nome: selectedArtist,
      destino: destino,
    });
    notify(r, { successFallback: "Contrato rescindido com sucesso!" });
    setSubmitting(false);
  }

  const artist = artists.find((a) => a.nome === selectedArtist);
  // Simulação de multa (no backend ela é calulada no Apps Script)
  const multaEstimada = artist ? 500000 : 0;

  return (
    <main className="flex-1 mx-auto w-full max-w-2xl px-4 pt-6 pb-20">
      <BackButton />

      <header className="mb-8">
        <div className="size-12 rounded-xl bg-red-500/15 text-red-500 grid place-items-center mb-4">
          <FileText className="size-6" />
        </div>
        <h1 className="text-3xl font-black">Rescisão de Contrato</h1>
        <p className="text-muted-foreground mt-2">
          Saia da sua gravadora atual para ser independente ou mudar de selo.
        </p>
      </header>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="p-6 rounded-2xl bg-card border border-border space-y-4">
          <Field label="Artista">
            <select
              value={selectedArtist}
              onChange={(e) => setSelectedArtist(e.target.value)}
              className="w-full bg-background border border-border rounded-xl px-3 py-3 text-sm"
              disabled={loading}
            >
              {artists.map((a) => (
                <option key={a.nome} value={a.nome}>
                  {a.nome} ({a.gravadora})
                </option>
              ))}
            </select>
          </Field>

          <Field label="Novo Destino / Selo">
            <select
              value={destino}
              onChange={(e) => setDestino(e.target.value)}
              className="w-full bg-background border border-border rounded-xl px-3 py-3 text-sm"
            >
              <option value="Independent">Independent (Independente)</option>
              <option value="King & Queen">King & Queen</option>
              <option value="Crown">Crown</option>
            </select>
          </Field>
        </div>

        {artist && artist.gravadora !== "Independent" && (
          <div className="p-5 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-500">
            <div className="flex items-center gap-2 mb-2">
              <ShieldAlert className="size-5" />
              <h3 className="font-bold">Aviso de Multa Contractual</h3>
            </div>
            <p className="text-xs leading-relaxed opacity-90">
              Rescindir antes do prazo final implica no pagamento de uma multa de rescisão.
              Verifique se o seu artista possui saldo suficiente em <strong>Empire Coin</strong>.
            </p>
            <p className="mt-3 font-black text-sm uppercase tracking-wider">
              Multa Aproximada: {fmtEC(multaEstimada)}
            </p>
          </div>
        )}

        {artist && artist.gravadora === "Independent" && (
          <div className="p-5 rounded-2xl bg-blue-500/10 border border-blue-500/20 text-blue-500">
            <div className="flex items-center gap-2 mb-2">
              <AlertCircle className="size-5" />
              <h3 className="font-bold text-sm">Artista Independente</h3>
            </div>
            <p className="text-xs">
              Você é independente e não precisará pagar multa para se juntar a um selo.
            </p>
          </div>
        )}

        <button
          type="submit"
          disabled={submitting || !selectedArtist}
          className="w-full py-4 rounded-full bg-red-600 text-white font-extrabold shadow-lg shadow-red-600/20 disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {submitting ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <ShieldAlert className="size-4" />
          )}
          Assinar Rescisão
        </button>
      </form>
    </main>
  );
}
