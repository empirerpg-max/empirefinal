import logoIcon from "@/assets/logo-icon.png";

// Estado de erro reaproveitável pra "a request falhou de verdade" (distinto
// de "está vazio mesmo") — logo do Empire balançando + copy descontraída,
// pedido explícito do usuário depois do bug de telas "sumindo" ao atualizar/
// voltar demais em pouco tempo (falha passageira de backend virando "vazio").
export function LoadErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="p-6 rounded-[1.5rem] bg-destructive/10 border border-destructive/20 text-center flex flex-col items-center gap-3">
      <img
        src={logoIcon}
        alt=""
        aria-hidden="true"
        className="size-12 animate-bounce opacity-90"
      />
      <p className="text-xs font-bold text-destructive max-w-[18rem] leading-relaxed">
        A fama engoliu os dados por alguns minutos. Clique abaixo pra fazê-la cuspir de volta.
      </p>
      <button
        onClick={onRetry}
        className="text-[11px] font-black uppercase tracking-wider text-primary underline min-h-11"
      >
        Tentar novamente
      </button>
    </div>
  );
}
