import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { ChevronLeft, Film, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { Field, Input, ResultBanner } from "./acoes.tour";

export const Route = createFileRoute("/acoes/cinema")({
  validateSearch: (s: Record<string, unknown>) => ({ nome: String(s.nome || "") }),
  component: CinemaForm,
});

function CinemaForm() {
  const { nome } = Route.useSearch();
  const [titulo, setTitulo] = useState("");
  const [tipo, setTipo] = useState("Filme");
  const [genero, setGenero] = useState("Drama");
  const [dataInicio, setDataInicio] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!titulo || !dataInicio) return;
    setSubmitting(true);
    setResult(null);
    const r = await api.comprarCinema({ nome, titulo, tipo, genero, dataInicio });
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
          <Film className="size-6" />
        </div>
        <div>
          <p className="text-xs uppercase tracking-widest text-muted-foreground font-bold">
            {nome}
          </p>
          <h1 className="text-2xl font-extrabold">Cinema / TV</h1>
        </div>
      </header>

      <form onSubmit={submit} className="space-y-5">
        <Field label="Título">
          <Input value={titulo} onChange={(e) => setTitulo(e.target.value)} required />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Tipo">
            <select
              value={tipo}
              onChange={(e) => setTipo(e.target.value)}
              className="w-full bg-card border border-border rounded-xl px-3 py-3 text-sm"
            >
              <option>Filme</option>
              <option>Série</option>
              <option>Documentário</option>
            </select>
          </Field>
          <Field label="Gênero">
            <select
              value={genero}
              onChange={(e) => setGenero(e.target.value)}
              className="w-full bg-card border border-border rounded-xl px-3 py-3 text-sm"
            >
              <option>Drama</option>
              <option>Comédia</option>
              <option>Ação</option>
              <option>Romance</option>
              <option>Terror</option>
              <option>Musical</option>
            </select>
          </Field>
        </div>
        <Field label="Data de início">
          <Input
            type="date"
            value={dataInicio}
            onChange={(e) => setDataInicio(e.target.value)}
            required
          />
        </Field>

        <button
          type="submit"
          disabled={submitting}
          className="w-full py-3.5 rounded-full bg-primary text-primary-foreground font-extrabold uppercase tracking-wider text-sm disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {submitting && <Loader2 className="size-4 animate-spin" />}
          {submitting ? "Processando..." : "Confirmar"}
        </button>
        {result && <ResultBanner text={result} />}
      </form>
    </main>
  );
}
