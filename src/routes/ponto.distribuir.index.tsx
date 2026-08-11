import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ChevronLeft, Loader2, Shuffle, Edit3, ChevronRight, CheckCircle2 } from "lucide-react";
import { api } from "@/lib/api";
import { useTelegramUser, haptic } from "@/lib/telegram";
import { notify } from "@/lib/notify";

export const Route = createFileRoute("/ponto/distribuir/")({
  component: PontoDistribuir,
});

function PontoDistribuir() {
  const { user } = useTelegramUser();
  const navigate = useNavigate();
  const [running, setRunning] = useState(false);
  const [resultado, setResultado] = useState<{ distribuidas: number } | null>(null);

  async function distribuirAleatorio() {
    if (!user?.id || running) return;
    haptic.selection();
    setRunning(true);
    setResultado(null);
    const r = await api.distribuirPontosAleatorioNovo(String(user.id));
    setRunning(false);
    if ((r as any)?.ok) {
      haptic.success();
      setResultado({ distribuidas: (r as any).distribuidas ?? 0 });
    } else {
      notify(r, { successFallback: "Pontos atribuídos com sucesso" });
    }
  }

  return (
    <main className="flex-1 mx-auto w-full max-w-md px-6 pt-6 pb-24">
      <Link to="/ponto" className="inline-flex items-center gap-1 text-neutral-500 hover:text-emerald-500 mb-6 text-sm transition-colors">
        <ChevronLeft className="size-4" /> Voltar
      </Link>
      <h1 className="text-2xl font-black italic tracking-tighter mb-1 text-white">Distribuir pontos</h1>
      <p className="text-sm text-neutral-500 mb-6">Como você quer fazer?</p>

      <div className="space-y-2">
        <button
          onClick={distribuirAleatorio}
          disabled={running}
          className="w-full flex items-center gap-4 text-left p-4 rounded-2xl bg-neutral-900 border border-white/10 hover:border-emerald-500/40 hover:bg-neutral-800 transition-colors disabled:opacity-50"
        >
          <div className="size-12 rounded-2xl bg-emerald-500/15 text-emerald-500 grid place-items-center shrink-0">
            {running ? <Loader2 className="size-6 animate-spin" /> : <Shuffle className="size-6" />}
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="font-black uppercase text-white text-sm">Aleatoriamente</h2>
            <p className="text-xs text-neutral-500">Sorteia % por categoria (soma sempre 100%)</p>
          </div>
          <ChevronRight className="size-4 text-neutral-600 shrink-0" />
        </button>

        {resultado && (
          <div className="flex items-center gap-2 px-4 py-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-sm font-semibold">
            <CheckCircle2 className="size-4 shrink-0" />
            {resultado.distribuidas > 0
              ? `${resultado.distribuidas} música${resultado.distribuidas > 1 ? "s" : ""} recebeu pontos aleatórios.`
              : "Nenhuma música pendente — todas já têm pontos distribuídos."}
          </div>
        )}

        <button
          onClick={() => navigate({ to: "/ponto/distribuir/planilha" })}
          className="w-full flex items-center gap-4 text-left p-4 rounded-2xl bg-neutral-900 border border-white/10 hover:border-emerald-500/40 hover:bg-neutral-800 transition-colors"
        >
          <div className="size-12 rounded-2xl bg-emerald-500/15 text-emerald-500 grid place-items-center shrink-0">
            <Edit3 className="size-6" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="font-black uppercase text-white text-sm">Manualmente</h2>
            <p className="text-xs text-neutral-500">Editar a planilha de pontos no app</p>
          </div>
          <ChevronRight className="size-4 text-neutral-600 shrink-0" />
        </button>
      </div>
    </main>
  );
}
