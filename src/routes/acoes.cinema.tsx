import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import logoIcon from "@/assets/logo-icon.png";

export const Route = createFileRoute("/acoes/cinema")({
  validateSearch: (s: Record<string, unknown>) => ({ nome: String(s.nome || "") }),
  component: CinemaEmBreve,
});

function CinemaEmBreve() {
  const { nome } = Route.useSearch();

  return (
    <main className="flex-1 mx-auto w-full max-w-2xl px-4 pt-6">
      <Link
        to="/artistas/$nome"
        params={{ nome }}
        className="inline-flex items-center gap-1 text-muted-foreground mb-4"
      >
        <ChevronLeft className="size-4" /> Voltar
      </Link>

      <div className="flex flex-col items-center justify-center text-center py-24">
        <img src={logoIcon} alt="Empire Hub" className="size-16 rounded-2xl object-contain mb-6" />
        <p className="text-sm font-black uppercase tracking-widest text-muted-foreground">
          Em breve
        </p>
      </div>
    </main>
  );
}
