import { useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { BookOpen, Bug, Undo2 } from "lucide-react";
import { useBeta } from "@/hooks/useBeta";
import { Folha } from "./Folha";
import { FolhaReportar } from "./FolhaReportar";
import { FolhaVoltarVersao } from "./FolhaVoltarVersao";

const LINHA = "w-full min-w-0 min-h-11 flex items-center gap-3 px-3 py-2 text-left active:bg-muted transition-colors";

/** Menu do selo BETA. Reportar abre POR CIMA (voltar fecha só ela); Voltar à anterior troca no mesmo toque. */
export function FolhaBeta({ aberto, aoFechar }: { aberto: boolean; aoFechar: () => void }) {
  const { estado } = useBeta();
  const router = useRouter();
  const [reportar, setReportar] = useState(false);
  const [voltar, setVoltar] = useState(false);

  return (
    <>
      <Folha aberto={aberto} titulo="Você está no Beta test" aoFechar={aoFechar}>
        {(fechar) => (
          <div className="rounded-2xl bg-muted/40 border border-border overflow-hidden divide-y divide-border">
            <button type="button" onClick={() => setReportar(true)} className={LINHA}>
              <Bug className="size-[18px] shrink-0" />
              <span className="min-w-0 flex-1 truncate text-sm font-bold">Reportar um problema</span>
            </button>
            <button
              type="button"
              // muda de tela: só depois que a entrada da folha saiu do histórico
              // (a fase 1c troca /tutorial pelo tutorial novo)
              onClick={() => fechar(() => router.navigate({ to: "/tutorial" }))}
              className={LINHA}
            >
              <BookOpen className="size-[18px] shrink-0" />
              <span className="min-w-0 flex-1 truncate text-sm font-bold">Como usar</span>
            </button>
            {estado.podeVoltar && (
              <button
                type="button"
                // troca no mesmo toque: a folha nova reaproveita a entrada desta
                onClick={() => {
                  fechar();
                  setVoltar(true);
                }}
                className={LINHA}
              >
                <Undo2 className="size-[18px] shrink-0" />
                <span className="min-w-0 flex-1 truncate text-sm font-bold">Voltar para a versão anterior</span>
              </button>
            )}
          </div>
        )}
      </Folha>
      <FolhaReportar aberto={reportar} aoFechar={() => setReportar(false)} />
      <FolhaVoltarVersao aberto={voltar} aoFechar={() => setVoltar(false)} />
    </>
  );
}
