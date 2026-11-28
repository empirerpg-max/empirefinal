import { useEffect, useRef, useState } from "react";
import { Paperclip } from "lucide-react";
import { toast } from "sonner";
import { useBeta, useTelaAtual } from "@/hooks/useBeta";
import { uploadToDrive } from "@/lib/driveUpload";
import { nomeDaTela } from "@/lib/uso/nomes";
import { Folha } from "./Folha";

// Pasta do Drive do print. Trocar aqui quando existir a pasta própria do Beta.
export const PASTA_PRINT_REPORTE = "socialPosts" as const;
const MAX_TEXTO = 2000;
const MAX_PRINT = 8 * 1024 * 1024;

export function FolhaReportar({ aberto, aoFechar }: { aberto: boolean; aoFechar: () => void }) {
  const { reportar } = useBeta();
  const [texto, setTexto] = useState("");
  const [print, setPrint] = useState<File | null>(null);
  const [erroPrint, setErroPrint] = useState("");
  const [tecnico, setTecnico] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");
  const tela = useTelaAtual();
  const arquivo = useRef<HTMLInputElement>(null);

  // Ao abrir: limpa o formulário e fixa o nome da tela de onde o jogador veio.
  useEffect(() => {
    if (!aberto) return;
    setTexto("");
    setPrint(null);
    setErroPrint("");
    setTecnico(true);
    setErro("");
    setEnviando(false);
  }, [aberto]);

  return (
    <Folha aberto={aberto} titulo="Reportar um problema" aoFechar={aoFechar}>
      {(fechar) => {
        const enviar = async () => {
          if (enviando || !texto.trim()) return;
          setEnviando(true);
          setErro("");
          let printUrl: string | undefined;
          try {
            if (print) printUrl = await uploadToDrive(print, PASTA_PRINT_REPORTE);
          } catch {
            setEnviando(false);
            setErro("Não deu para enviar o print. Tente de novo ou envie sem ele.");
            return;
          }
          const r = await reportar({ texto: texto.trim(), printUrl, incluirTecnico: tecnico });
          setEnviando(false);
          if (r.ok) {
            toast.success("Recebido! A moderação vai olhar.");
            fechar();
          } else {
            setErro(r.erro);
          }
        };
        return (
          <div className="space-y-3">
            <label className="block">
              <span className="block px-1 mb-1 text-sm font-bold">O que aconteceu?</span>
              <textarea
                value={texto}
                maxLength={MAX_TEXTO}
                onChange={(e) => setTexto(e.target.value)}
                rows={4}
                className="w-full rounded-2xl border border-border bg-muted/40 px-3 py-2 text-sm outline-none focus:border-primary/50"
              />
              <span className="block px-1 text-right text-[11px] text-muted-foreground">
                {texto.length}/{MAX_TEXTO}
              </span>
            </label>

            <p className="min-w-0 truncate px-1 text-xs text-muted-foreground">Tela: {nomeDaTela(tela)}</p>

            <div>
              <input
                ref={arquivo}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  e.target.value = "";
                  if (f && f.size > MAX_PRINT) {
                    setPrint(null);
                    setErroPrint("A imagem passa de 8 MB.");
                    return;
                  }
                  setErroPrint("");
                  setPrint(f);
                }}
              />
              <button
                type="button"
                onClick={() => arquivo.current?.click()}
                className="w-full min-w-0 min-h-11 flex items-center gap-2 rounded-2xl bg-muted px-3 text-sm font-bold active:scale-[0.98] transition-transform"
              >
                <Paperclip className="size-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate text-left">{print ? print.name : "Anexar print"}</span>
              </button>
              {erroPrint && <p className="px-1 pt-1 text-xs text-destructive">{erroPrint}</p>}
            </div>

            <button
              type="button"
              role="switch"
              aria-checked={tecnico}
              onClick={() => setTecnico(!tecnico)}
              className="w-full min-w-0 min-h-11 flex items-center gap-3 rounded-2xl bg-muted/40 border border-border px-3"
            >
              <span className="min-w-0 flex-1 truncate text-left text-sm font-bold">Incluir dados técnicos</span>
              <span
                className={`shrink-0 relative h-6 w-10 rounded-full transition-colors ${tecnico ? "bg-primary" : "bg-muted-foreground/40"}`}
                aria-hidden="true"
              >
                <span
                  className={`absolute top-0.5 size-5 rounded-full bg-white transition-all ${tecnico ? "left-[18px]" : "left-0.5"}`}
                />
              </span>
            </button>

            {erro && <p role="alert" className="px-1 text-sm text-destructive">{erro}</p>}

            <button
              type="button"
              disabled={!texto.trim() || enviando}
              onClick={enviar}
              className="w-full min-w-0 min-h-11 px-3 rounded-2xl bg-primary text-primary-foreground text-sm font-bold disabled:opacity-40 active:scale-[0.98] transition-transform"
            >
              <span className="block truncate">{enviando ? "Enviando..." : "Enviar"}</span>
            </button>
          </div>
        );
      }}
    </Folha>
  );
}
