import { createFileRoute, Link, useNavigate, Outlet } from "@tanstack/react-router";
import { useState } from "react";
import { ChevronLeft, Loader2, Shuffle, Edit3 } from "lucide-react";
import { api } from "@/lib/api";
import { useTelegramUser } from "@/lib/telegram";
import { notify } from "@/lib/notify";

export const Route = createFileRoute("/ponto/distribuir")({
  component: PontoDistribuir,
});

function PontoDistribuir() {
  const { user } = useTelegramUser();
  const navigate = useNavigate();
  const [running, setRunning] = useState(false);

  async function distribuirAleatorio() {
    if (!user?.id) return;
    setRunning(true);
    const r = await api.distribuirPontosAleatorio(String(user.id));
    notify(r, { successFallback: "Pontos atribuídos com sucesso" });
    setRunning(false);
  }

  return (
    <>
      <main className="flex-1 mx-auto w-full max-w-md px-6 pt-6 pb-24">
        <Link to="/ponto" className="inline-flex items-center gap-1 text-muted-foreground mb-6 text-sm">
          <ChevronLeft className="size-4" /> Voltar
        </Link>
        <h1 className="text-2xl font-black italic tracking-tighter mb-1">Distribuir pontos</h1>
        <p className="text-sm text-muted-foreground mb-6">Como você quer fazer?</p>

        <div className="space-y-3">
          <button
            onClick={distribuirAleatorio}
            disabled={running}
            className="w-full text-left p-5 rounded-3xl bg-card border border-white/5 hover:border-primary/40 transition-colors disabled:opacity-50"
          >
            <div className="flex items-center gap-4">
              <div className="size-12 rounded-2xl bg-primary/10 text-primary grid place-items-center">
                {running ? <Loader2 className="size-6 animate-spin" /> : <Shuffle className="size-6" />}
              </div>
              <div>
                <h2 className="font-black uppercase">Aleatoriamente</h2>
                <p className="text-xs text-muted-foreground">O script distribui % por categoria (soma 100)</p>
              </div>
            </div>
          </button>

          <button
            onClick={() => navigate({ to: "/ponto/distribuir/planilha" })}
            className="w-full text-left p-5 rounded-3xl bg-card border border-white/5 hover:border-primary/40 transition-colors"
          >
            <div className="flex items-center gap-4">
              <div className="size-12 rounded-2xl bg-primary/10 text-primary grid place-items-center">
                <Edit3 className="size-6" />
              </div>
              <div>
                <h2 className="font-black uppercase">Manualmente</h2>
                <p className="text-xs text-muted-foreground">Editar a planilha de pontos no app</p>
              </div>
            </div>
          </button>
        </div>
      </main>
      <Outlet />
    </>
  );
}
