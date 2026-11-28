import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useBeta } from "@/hooks/useBeta";
import { MOTIVOS_VOLTA, ROTULO_MOTIVO, type MotivoVolta } from "@/lib/beta/regras";
import { Folha } from "./Folha";

export function FolhaVoltarVersao({ aberto, aoFechar }: { aberto: boolean; aoFechar: () => void }) {
  const { trocarVersao } = useBeta();
  const [motivo, setMotivo] = useState<MotivoVolta | null>(null);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");

  useEffect(() => {
    if (!aberto) return;
    setMotivo(null);
    setTexto("");
    setEnviando(false);
    setErro("");
  }, [aberto]);

  return (
    <Folha aberto={aberto} titulo="Voltar para a versão anterior?" aoFechar={aoFechar}>
      {(fechar) => (
        <div className="space-y-3">
          <div role="radiogroup" aria-label="Motivo" className="rounded-2xl bg-muted/40 border border-border overflow-hidden divide-y divide-border">
            {MOTIVOS_VOLTA.map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={motivo === m}
                // tocar de novo desmarca (o motivo é opcional)
                onClick={() => setMotivo(motivo === m ? null : m)}
                className="w-full min-w-0 min-h-11 flex items-center gap-3 px-3 text-left"
              >
                <span
                  className={`shrink-0 size-5 rounded-full border-2 grid place-items-center ${motivo === m ? "border-primary" : "border-muted-foreground/50"}`}
                  aria-hidden="true"
                >
                  {motivo === m && <span className="size-2.5 rounded-full bg-primary" />}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-bold">{ROTULO_MOTIVO[m]}</span>
              </button>
            ))}
          </div>

          <label className="block">
            <span className="block px-1 mb-1 text-sm font-bold">Quer contar mais? (opcional)</span>
            <textarea
              value={texto}
              maxLength={500}
              onChange={(e) => setTexto(e.target.value)}
              rows={3}
              className="w-full rounded-2xl border border-border bg-muted/40 px-3 py-2 text-sm outline-none focus:border-primary/50"
            />
          </label>

          {erro && <p role="alert" className="px-1 text-sm text-destructive">{erro}</p>}

          <div className="flex gap-2">
            <button
              type="button"
              disabled={enviando}
              onClick={async () => {
                setEnviando(true);
                setErro("");
                const ok = await trocarVersao("anterior", {
                  motivo: motivo ?? undefined,
                  texto: texto.trim() || undefined,
                });
                setEnviando(false);
                if (ok) toast.success("Pronto! Você está na versão anterior.");
                else setErro("Não deu para voltar agora. Tente de novo.");
              }}
              className="flex-1 min-w-0 min-h-11 px-3 rounded-2xl bg-primary text-primary-foreground text-sm font-bold disabled:opacity-40 active:scale-[0.98] transition-transform"
            >
              <span className="block truncate">Voltar agora</span>
            </button>
            <button
              type="button"
              onClick={() => fechar()}
              className="flex-1 min-w-0 min-h-11 px-3 rounded-2xl bg-muted text-foreground text-sm font-bold active:scale-[0.98] transition-transform"
            >
              <span className="block truncate">Ficar no Beta</span>
            </button>
          </div>
        </div>
      )}
    </Folha>
  );
}
