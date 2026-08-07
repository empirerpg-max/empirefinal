import { createFileRoute, Link } from "@tanstack/react-router";
import { BackButton } from "@/components/BackButton";
import { useEffect, useState } from "react";
import { ChevronLeft, Radio, Loader2, Sparkles, Megaphone, Globe, Map } from "lucide-react";
import { api, fmtEC, type Artist } from "@/lib/api";
import { useTelegramUser } from "@/lib/telegram";
import { notify } from "@/lib/notify";
import { Field, Input } from "./acoes.tour";

export const Route = createFileRoute("/payola")({
  component: PayolaPage,
});

function PayolaPage() {
  const { user, ready } = useTelegramUser();
  const [artists, setArtists] = useState<Artist[]>([]);
  const [musicas, setMusicas] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Form
  const [selectedArtist, setSelectedArtist] = useState("");
  const [selectedMusica, setSelectedMusica] = useState("");
  const [valor, setValor] = useState("");

  useEffect(() => {
    if (!ready || !user) return;
    api.meusArtistas(user.id).then((a) => {
      setArtists(a);
      if (a.length > 0) setSelectedArtist(a[0].nome);
      setLoading(false);
    });
  }, [ready, user]);

  useEffect(() => {
    if (selectedArtist) {
      (api as any).listaMusicas?.(selectedArtist).then(setMusicas);
    }
  }, [selectedArtist]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedArtist || !selectedMusica || !valor) return;
    setSubmitting(true);
    const r = await api.payola({
      nome: selectedArtist,
      musica: selectedMusica,
      valor: parseFloat(valor),
    });
    notify(r, { successFallback: "Investimento em Payola realizado!" });
    setSubmitting(false);
    if (r) {
      setValor("");
    }
  }

  const vNum = parseFloat(valor) || 0;
  const level =
    vNum >= 1000000
      ? "Global"
      : vNum >= 500000
        ? "Nacional"
        : vNum >= 100000
          ? "Regional"
          : "Inválido";

  return (
    <main className="flex-1 mx-auto w-full max-w-2xl px-4 pt-6 pb-20">
      <BackButton />

      <header className="mb-8">
        <div className="size-12 rounded-xl bg-orange-500/15 text-orange-500 grid place-items-center mb-4">
          <Megaphone className="size-6" />
        </div>
        <h1 className="text-3xl font-black">Central da Payola</h1>
        <p className="text-muted-foreground mt-2">
          Invista nas rádios para impulsionar suas músicas nos charts.
        </p>
      </header>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="p-6 rounded-2xl bg-card border border-border space-y-4">
          <Field label="Selecione o Artista">
            <select
              value={selectedArtist}
              onChange={(e) => setSelectedArtist(e.target.value)}
              className="w-full bg-background border border-border rounded-xl px-3 py-3 text-sm"
              disabled={loading}
            >
              {artists.map((a) => (
                <option key={a.nome} value={a.nome}>
                  {a.nome} ({fmtEC(a.saldo)})
                </option>
              ))}
            </select>
          </Field>

          <Field label="Música do Lançamento">
            <select
              value={selectedMusica}
              onChange={(e) => setSelectedMusica(e.target.value)}
              className="w-full bg-background border border-border rounded-xl px-3 py-3 text-sm"
              disabled={loading || musicas.length === 0}
            >
              <option value="">Selecione uma música...</option>
              {musicas.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Valor do Investimento (EC)">
            <Input
              type="number"
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              placeholder="Ex: 500000"
              required
            />
          </Field>
        </div>

        {/* Níveis de Payola */}
        <div className="grid grid-cols-3 gap-3">
          <LevelCard
            active={level === "Regional"}
            icon={<Map className="size-4" />}
            label="Regional"
            min="100k"
          />
          <LevelCard
            active={level === "Nacional"}
            icon={<Radio className="size-4" />}
            label="Nacional"
            min="500k"
          />
          <LevelCard
            active={level === "Global"}
            icon={<Globe className="size-4" />}
            label="Global"
            min="1M"
          />
        </div>

        <div className="p-4 rounded-xl bg-orange-500/5 border border-orange-500/20">
          <p className="text-xs text-orange-500/80 leading-relaxed italic">
            * O investimento gera um bônus aleatório de audiência proporcional ao valor investido. O
            resultado é aplicado na atualização semanal do chart.
          </p>
        </div>

        <button
          type="submit"
          disabled={submitting || !selectedMusica || !valor || level === "Inválido"}
          className="w-full py-4 rounded-full bg-orange-500 text-white font-extrabold shadow-lg shadow-orange-500/20 disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {submitting ? <Loader2 className="size-4 animate-spin" /> : <Radio className="size-4" />}
          Lançar Payola
        </button>
      </form>

      {/* Histórico recente? (Pode ser adicionado se houver API) */}
    </main>
  );
}

function LevelCard({
  active,
  icon,
  label,
  min,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  min: string;
}) {
  return (
    <div
      className={`p-4 rounded-2xl border transition-all text-center ${active ? "bg-orange-500 border-orange-500 text-white shadow-xl scale-105" : "bg-card border-border text-muted-foreground"}`}
    >
      <div
        className={`size-8 rounded-full grid place-items-center mx-auto mb-2 ${active ? "bg-white/20" : "bg-muted"}`}
      >
        {icon}
      </div>
      <p className="text-[10px] uppercase font-bold tracking-widest">{label}</p>
      <p className={`text-xs font-black mt-0.5 ${active ? "text-white" : "text-foreground"}`}>
        Mín {min}
      </p>
    </div>
  );
}
