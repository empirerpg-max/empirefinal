import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ChevronLeft, Mic2, Loader2 } from "lucide-react";
import { api } from "@/lib/api";

export const Route = createFileRoute("/acoes/tour")({
  validateSearch: (s: Record<string, unknown>) => ({ nome: String(s.nome || "") }),
  component: TourForm,
});

const PORTES = [
  { id: "Indie", label: "Indie", desc: "Casas de show pequenas (~3k)" },
  { id: "Arena", label: "Arena", desc: "Arenas médias (~20k)" },
  { id: "Estádio", label: "Estádio", desc: "Estádios (~60k)" },
];

function TourForm() {
  const { nome } = Route.useSearch();
  const navigate = useNavigate();
  const [tipo, setTipo] = useState("Arena");
  const [titulo, setTitulo] = useState("");
  const [dataInicio, setDataInicio] = useState("");
  const [qtd, setQtd] = useState(10);
  const [continente, setContinente] = useState("Norte-Americano");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!titulo || !dataInicio) return;
    setSubmitting(true);
    setResult(null);
    const r = await api.comprarTour({ nome, tipo, titulo, dataInicio, qtd, continente });
    setResult(typeof r === "string" ? (r as string) : r.message || JSON.stringify(r));
    setSubmitting(false);
  }

  return (
    <main className="flex-1 mx-auto w-full max-w-2xl px-4 pt-6">
      <Link
        to="/artistas/$nome"
        params={{ nome }}
        className="inline-flex items-center gap-1 text-muted-foreground mb-4"
      >
        <ChevronLeft className="size-4" /> Voltar
      </Link>
      <header className="mb-6 flex items-center gap-3">
        <div className="size-12 rounded-xl bg-primary/15 text-primary grid place-items-center">
          <Mic2 className="size-6" />
        </div>
        <div>
          <p className="text-xs uppercase tracking-widest text-muted-foreground font-bold">
            {nome}
          </p>
          <h1 className="text-2xl font-extrabold">Comprar Tour</h1>
        </div>
      </header>

      <form onSubmit={submit} className="space-y-5">
        <Field label="Porte da turnê">
          <div className="grid grid-cols-3 gap-2">
            {PORTES.map((p) => (
              <button
                type="button"
                key={p.id}
                onClick={() => setTipo(p.id)}
                className={`p-3 rounded-xl border text-left transition-colors ${tipo === p.id ? "border-primary bg-primary/10" : "border-border bg-card"}`}
              >
                <p className="font-bold text-sm">{p.label}</p>
                <p className="text-[10px] text-muted-foreground">{p.desc}</p>
              </button>
            ))}
          </div>
        </Field>
        <Field label="Nome da turnê">
          <Input
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            placeholder="The Empire Tour"
            required
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Data de início">
            <Input
              type="date"
              value={dataInicio}
              onChange={(e) => setDataInicio(e.target.value)}
              required
            />
          </Field>
          <Field label="Nº de shows">
            <Input
              type="number"
              min={1}
              max={100}
              value={qtd}
              onChange={(e) => setQtd(Number(e.target.value))}
            />
          </Field>
        </div>
        <p className="text-[11px] text-muted-foreground -mt-2 px-1">
          As datas dos shows são geradas automaticamente, espaçadas ao longo dos próximos meses conforme o porte da turnê.
        </p>
        <Field label="Continente">
          <select
            value={continente}
            onChange={(e) => setContinente(e.target.value)}
            className="w-full bg-card border border-border rounded-xl px-3 py-3 text-sm"
          >
            <option>Norte-Americano</option>
            <option>Sul-Americano</option>
            <option>Europeu</option>
            <option>Asiático</option>
            <option>Africano</option>
            <option>Oceania</option>
          </select>
        </Field>

        <button
          type="submit"
          disabled={submitting}
          className="w-full py-3.5 rounded-full bg-primary text-primary-foreground font-extrabold uppercase tracking-wider text-sm disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {submitting && <Loader2 className="size-4 animate-spin" />}
          {submitting ? "Processando..." : "Confirmar compra"}
        </button>

        {result && <ResultBanner text={result} />}
      </form>
    </main>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground block mb-2">
        {label}
      </span>
      {children}
    </label>
  );
}
export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className="w-full bg-card border border-border rounded-xl px-3 py-3 text-sm focus:outline-none focus:border-primary"
    />
  );
}
export function ResultBanner({ text }: { text: string }) {
  const isErr = text.includes("❌") || /erro|insuficiente|inválid/i.test(text);
  return (
    <div
      className={`p-4 rounded-xl text-sm whitespace-pre-wrap ${isErr ? "bg-destructive/10 border border-destructive/40 text-destructive-foreground" : "bg-primary/10 border border-primary/40"}`}
    >
      {text}
    </div>
  );
}
