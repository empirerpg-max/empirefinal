import { AlertTriangle, RotateCw, Home } from "lucide-react";

/**
 * Substitui a caixinha padrão de erro do TanStack Router (mensagem escondida
 * atrás de um botão minúsculo "Show Error", difícil de tocar no celular). A
 * mensagem já vem sempre visível, e o erro é reportado automaticamente pro
 * log (ver defaultOnCatch em router.tsx) — ninguém precisa conseguir clicar
 * em nada pra gente saber o que quebrou.
 */
export function RouteErrorScreen({ error, reset }: { error: unknown; reset?: () => void }) {
  const message = error instanceof Error ? error.message : String(error);

  return (
    <main className="flex-1 flex flex-col items-center justify-center min-h-[70vh] px-6 text-center">
      <div className="size-14 rounded-2xl bg-red-500/15 text-red-400 grid place-items-center mb-4">
        <AlertTriangle className="size-7" />
      </div>
      <h1 className="text-lg font-black uppercase tracking-tight text-white">Algo deu errado</h1>
      <p className="text-sm text-neutral-500 mt-2 max-w-sm">
        Essa tela não carregou. Já registramos o erro — pode tentar de novo ou voltar ao início.
      </p>

      {message && (
        <pre className="mt-4 w-full max-w-sm text-left text-[11px] text-red-400/80 bg-red-500/5 border border-red-500/20 rounded-xl p-3 overflow-x-auto whitespace-pre-wrap break-words">
          {message}
        </pre>
      )}

      <div className="flex items-center gap-3 mt-6">
        <button
          onClick={() => (reset ? reset() : window.location.reload())}
          className="flex items-center gap-2 px-5 py-3 rounded-2xl bg-white/5 border border-white/10 text-sm font-black uppercase tracking-wider active:scale-95 transition-all"
        >
          <RotateCw className="size-4" /> Tentar de novo
        </button>
        <a
          href="/"
          className="flex items-center gap-2 px-5 py-3 rounded-2xl bg-primary text-primary-foreground text-sm font-black uppercase tracking-wider active:scale-95 transition-all"
        >
          <Home className="size-4" /> Início
        </a>
      </div>
    </main>
  );
}
