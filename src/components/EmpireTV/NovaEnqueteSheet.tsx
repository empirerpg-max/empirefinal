import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { Loader2, Plus, Trash2, X } from "lucide-react";
import { api } from "@/lib/api";

const MAX_PERGUNTA = 140;
const MAX_OPCAO = 60;
const MIN_OPCOES = 2;
const MAX_OPCOES = 10;
const MINUTOS = [0, 2, 5, 10, 15] as const;

/** Marca da folha no histórico: voltar fecha só ela (regra "voltar = tela anterior"). */
export const MARCA_NOVA_ENQUETE = "tvNovaEnquete";

function Chip({ ativo, onClick, children }: { ativo: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={ativo}
      className={`shrink-0 min-w-0 h-8 px-3 rounded-full text-[12px] font-semibold border transition active:scale-95 ${
        ativo ? "bg-primary text-primary-foreground border-primary" : "bg-muted/40 text-muted-foreground border-border hover:bg-muted"
      }`}
    >
      <span className="block truncate">{children}</span>
    </button>
  );
}

/**
 * Folha "Nova enquete" (só admin), por cima da sala. Empurra a própria
 * entrada no histórico ao abrir; o voltar do celular fecha só ela.
 */
export function NovaEnqueteSheet({
  programaId,
  onClose,
  onPublicada,
}: {
  programaId: string;
  onClose: () => void;
  onPublicada: () => void;
}) {
  const [pergunta, setPergunta] = useState("");
  const [tipo, setTipo] = useState<"unica" | "multipla">("unica");
  const [opcoes, setOpcoes] = useState<string[]>(["", ""]);
  const [secreto, setSecreto] = useState(true);
  const [soFim, setSoFim] = useState(false);
  const [minutos, setMinutos] = useState<(typeof MINUTOS)[number]>(0);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    window.history.pushState({ [MARCA_NOVA_ENQUETE]: true }, "");
    const onPop = () => {
      if (!window.history.state?.[MARCA_NOVA_ENQUETE]) onCloseRef.current();
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const fechar = () => {
    if (window.history.state?.[MARCA_NOVA_ENQUETE]) window.history.back();
    else onCloseRef.current();
  };

  const limpas = opcoes.map((o) => o.trim());
  const valida = pergunta.trim().length > 0 && limpas.filter(Boolean).length >= MIN_OPCOES;

  const publicar = async () => {
    if (enviando) return;
    setErro(null);
    const ops = limpas.filter(Boolean);
    if (!pergunta.trim()) return setErro("Escreva a pergunta.");
    if (ops.length < MIN_OPCOES) return setErro("Preencha pelo menos 2 opções.");
    if (new Set(ops.map((o) => o.toLowerCase())).size !== ops.length) return setErro("As opções não podem se repetir.");
    setEnviando(true);
    try {
      const r = await api.criarEnqueteTV({
        programaId,
        pergunta: pergunta.trim(),
        tipo,
        opcoes: ops,
        secreto,
        soFim,
        encerraEmMin: minutos,
      });
      if (!r.ok) {
        setErro(r.erro || "Não deu pra publicar. Tente de novo.");
        return;
      }
      toast.success("Enquete publicada no chat");
      onPublicada();
      fechar();
    } finally {
      setEnviando(false);
    }
  };

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[210] flex items-end sm:items-center justify-center" role="dialog" aria-modal="true" aria-label="Nova enquete">
      <div className="absolute inset-0 bg-black/60" onClick={fechar} aria-hidden="true" />
      <div
        className="relative w-full sm:max-w-md max-h-[90dvh] flex flex-col rounded-t-2xl sm:rounded-2xl border border-border bg-background shadow-2xl"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="flex items-start gap-2 px-4 pt-3 pb-2 border-b border-border shrink-0 min-w-0">
          <div className="flex-1 min-w-0">
            <b className="block text-[16px] truncate">📊 Nova enquete</b>
            <p className="text-[11.5px] text-muted-foreground">Só admin · aparece na hora no chat, fixada no topo</p>
          </div>
          <button type="button" onClick={fechar} className="size-9 shrink-0 rounded-full hover:bg-muted grid place-items-center" aria-label="Fechar">
            <X className="size-4 shrink-0" />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-4">
          <div>
            <label className="flex items-baseline justify-between text-[12px] font-bold text-muted-foreground mb-1" htmlFor="tv-nova-enq-pergunta">
              <span>Pergunta</span>
              <span className="font-normal">{pergunta.length}/{MAX_PERGUNTA}</span>
            </label>
            <input
              id="tv-nova-enq-pergunta"
              value={pergunta}
              onChange={(ev) => setPergunta(ev.target.value.slice(0, MAX_PERGUNTA))}
              maxLength={MAX_PERGUNTA}
              placeholder="Ex.: Melhor look da noite?"
              className="w-full h-10 px-3 rounded-lg bg-muted text-base outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          <div>
            <span className="block text-[12px] font-bold text-muted-foreground mb-1">Tipo</span>
            <div className="flex flex-wrap gap-2">
              <Chip ativo={tipo === "unica"} onClick={() => setTipo("unica")}>Escolha única</Chip>
              <Chip ativo={tipo === "multipla"} onClick={() => setTipo("multipla")}>Múltipla escolha</Chip>
            </div>
          </div>

          <div>
            <span className="block text-[12px] font-bold text-muted-foreground mb-1">
              Opções ({MIN_OPCOES} a {MAX_OPCOES})
            </span>
            <div className="space-y-1.5">
              {opcoes.map((o, i) => (
                <div key={i} className="flex items-center gap-1.5 min-w-0">
                  <input
                    value={o}
                    onChange={(ev) => {
                      const v = ev.target.value.slice(0, MAX_OPCAO);
                      setOpcoes((prev) => prev.map((x, j) => (j === i ? v : x)));
                    }}
                    maxLength={MAX_OPCAO}
                    placeholder={`Opção ${i + 1}`}
                    aria-label={`Opção ${i + 1}`}
                    className="flex-1 min-w-0 h-9 px-3 rounded-lg bg-muted text-base outline-none focus:ring-1 focus:ring-primary"
                  />
                  <button
                    type="button"
                    onClick={() => setOpcoes((prev) => prev.filter((_, j) => j !== i))}
                    disabled={opcoes.length <= MIN_OPCOES}
                    className="size-9 shrink-0 rounded-lg grid place-items-center text-muted-foreground hover:text-red-500 hover:bg-red-500/10 disabled:opacity-30 disabled:hover:bg-transparent"
                    aria-label={`Remover opção ${i + 1}`}
                  >
                    <Trash2 className="size-4 shrink-0" />
                  </button>
                </div>
              ))}
            </div>
            {opcoes.length < MAX_OPCOES && (
              <button
                type="button"
                onClick={() => setOpcoes((prev) => [...prev, ""])}
                className="w-full min-w-0 h-9 mt-2 px-3 rounded-lg border border-dashed border-border text-[12.5px] font-semibold text-muted-foreground hover:text-foreground hover:bg-muted/40 flex items-center justify-center gap-1.5"
              >
                <Plus className="size-4 shrink-0" />
                <span className="truncate">Adicionar opção</span>
              </button>
            )}
          </div>

          <div>
            <span className="block text-[12px] font-bold text-muted-foreground mb-1">Configurações</span>
            <div className="flex flex-wrap gap-2">
              <Chip ativo={secreto} onClick={() => setSecreto((v) => !v)}>Voto secreto</Chip>
              <Chip ativo={soFim} onClick={() => setSoFim((v) => !v)}>Resultado só no fim</Chip>
            </div>
          </div>

          <div>
            <span className="block text-[12px] font-bold text-muted-foreground mb-1">Encerrar sozinha</span>
            <div className="flex flex-wrap gap-2">
              {MINUTOS.map((m) => (
                <Chip key={m} ativo={minutos === m} onClick={() => setMinutos(m)}>
                  {m === 0 ? "Não" : `Em ${m} min`}
                </Chip>
              ))}
            </div>
          </div>

          {erro && (
            <p role="alert" className="text-[12.5px] font-semibold text-red-500 break-words">
              {erro}
            </p>
          )}
        </div>

        <div className="px-4 py-3 border-t border-border shrink-0">
          <button
            type="button"
            onClick={() => void publicar()}
            disabled={enviando || !valida}
            className="w-full min-w-0 h-11 px-3 rounded-xl bg-primary text-primary-foreground text-sm font-bold flex items-center justify-center gap-1.5 disabled:opacity-40 active:scale-[0.99] transition"
          >
            {enviando && <Loader2 className="size-4 shrink-0 animate-spin" />}
            <span className="truncate">📊 Publicar no chat</span>
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
