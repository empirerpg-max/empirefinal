import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { EnqueteTV } from "@/lib/api";
import { EnqueteCartao } from "@/components/EmpireTV/EnquetesPanel";

const CHAVE = (id: string) => `tvEnqFaixa:${id}`;

function lerExpandida(id: string): boolean {
  try {
    return window.localStorage.getItem(CHAVE(id)) === "1";
  } catch {
    return false;
  }
}

function gravarExpandida(id: string, v: boolean) {
  try {
    window.localStorage.setItem(CHAVE(id), v ? "1" : "0");
  } catch {
    /* sem armazenamento: só não lembra */
  }
}

/**
 * Faixa fixa no topo do chat enquanto houver enquete aberta (fica FORA da
 * lista rolável, então não mexe na rolagem do chat). Recolhida = uma linha;
 * expandida = as opções para votar ali. O estado fica salvo por enquete no
 * aparelho. Mostra a enquete aberta mais recente.
 */
export function EnqueteFaixa({
  enquete,
  programaId,
  isAdmin,
  onMudou,
  onExpandidaChange,
}: {
  enquete: EnqueteTV;
  programaId: string;
  isAdmin: boolean;
  onMudou: () => Promise<void>;
  onExpandidaChange: (expandida: boolean) => void;
}) {
  const [expandida, setExpandida] = useState(() => lerExpandida(enquete.id));
  useEffect(() => {
    setExpandida(lerExpandida(enquete.id));
  }, [enquete.id]);

  useEffect(() => {
    onExpandidaChange(expandida);
  }, [expandida, onExpandidaChange]);
  useEffect(() => () => onExpandidaChange(false), [onExpandidaChange]);

  const alternar = () => {
    setExpandida((v) => {
      gravarExpandida(enquete.id, !v);
      return !v;
    });
  };

  const votou = !!enquete.meuVoto && enquete.meuVoto.length > 0;

  return (
    <div className="shrink-0 border-b border-border bg-card/80 backdrop-blur min-w-0" data-enquete-faixa={enquete.id}>
      <button
        type="button"
        onClick={alternar}
        aria-expanded={expandida}
        className="w-full min-w-0 flex items-center gap-2 px-3 py-1.5 text-left hover:bg-muted/40 transition"
      >
        <span className="w-[3px] self-stretch rounded-full bg-primary shrink-0" aria-hidden="true" />
        <span className="flex-1 min-w-0 truncate text-[12.5px]">
          <span aria-hidden="true">📊 </span>
          {expandida ? (
            <span className="font-bold text-primary">Enquete aberta</span>
          ) : (
            <span className="font-semibold text-foreground">{enquete.pergunta}</span>
          )}
        </span>
        <span className="shrink-0 text-[12px] font-extrabold text-primary">
          {expandida ? "Recolher" : votou ? "Ver" : "Votar"}
        </span>
        <ChevronDown className={`size-4 shrink-0 text-primary transition-transform ${expandida ? "rotate-180" : ""}`} />
      </button>
      {expandida && (
        <div className="max-h-[45vh] overflow-y-auto px-3 pb-2.5">
          <EnqueteCartao enquete={enquete} programaId={programaId} isAdmin={isAdmin} onMudou={onMudou} embutido />
        </div>
      )}
    </div>
  );
}
