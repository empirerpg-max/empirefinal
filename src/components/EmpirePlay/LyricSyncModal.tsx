import { useEffect, useMemo, useRef, useState } from "react";
import { X, Play, Pause, Check, Loader2, Pencil, XCircle, Eye } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { haptic, useTelegramUser } from "@/lib/telegram";
import { formatLrc, formatLrcTimestamp, parseLrc, findCurrentLrcLineIndex, type LrcLine } from "@/lib/lrc";
import type { PlayableTrack } from "./MusicPlayer";

interface LyricSyncModalProps {
  track: PlayableTrack;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  onTogglePlay: () => void;
  onSeek: (time: number) => void;
  onClose: () => void;
  onSaved: (lrc: string) => void;
}

// Tela de sincronização — só o dono do artista chega aqui (MusicPlayer já
// filtra). A letra normal (currentTrack.letra) vira uma linha por linha; ao
// tocar "Marcar" (ou apertar espaço), a linha selecionada recebe o
// currentTime do áudio, que já está tocando no player por trás. Qualquer
// linha (já marcada ou não) pode virar a linha selecionada de novo — dá pra
// corrigir uma marcação errada sem refazer tudo. Antes de salvar de
// verdade, uma prévia mostra a letra "andando" igual vai aparecer pra quem
// ouvir, pra pegar erro de tempo antes de confirmar.
export function LyricSyncModal({
  track,
  isPlaying,
  currentTime,
  duration,
  onTogglePlay,
  onSeek,
  onClose,
  onSaved,
}: LyricSyncModalProps) {
  const { user } = useTelegramUser();
  const [mode, setMode] = useState<"edit" | "preview">("edit");

  const rawLines = useMemo(
    () => (track.letra || "").split("\n").map((l) => l.trim()).filter(Boolean),
    [track.letra],
  );

  // Pré-preenche com os tempos já salvos, casando por ordem — se a letra
  // mudou de tamanho desde a última sincronização, o excedente fica pendente.
  const [times, setTimes] = useState<(number | null)[]>(() => {
    const existing = parseLrc(track.letraSincronizada);
    return rawLines.map((_, i) => existing[i]?.time ?? null);
  });
  const [saving, setSaving] = useState(false);

  const firstPendingIndex = times.findIndex((t) => t == null);
  const allMarked = firstPendingIndex === -1;

  // Linha alvo da próxima marcação — some do controle automático assim que
  // o jogador clica numa linha específica pra corrigir ela.
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const activeIndex = selectedIndex ?? firstPendingIndex;

  function markLine(index: number) {
    if (index < 0 || index >= rawLines.length) return;
    haptic.light();
    setTimes((prev) => {
      const next = [...prev];
      next[index] = currentTime;
      return next;
    });
    // Depois de corrigir uma linha específica, volta o alvo automático pra
    // próxima pendente em vez de travar nessa mesma linha.
    setSelectedIndex(null);
  }

  function clearLine(index: number) {
    setTimes((prev) => {
      const next = [...prev];
      next[index] = null;
      return next;
    });
    setSelectedIndex(index);
  }

  function undoLastMark() {
    const lastMarked = [...times].reverse().findIndex((t) => t != null);
    if (lastMarked === -1) return;
    const idx = times.length - 1 - lastMarked;
    clearLine(idx);
  }

  // Espaço marca a linha atual — só no modo de edição.
  useEffect(() => {
    if (mode !== "edit") return;
    function onKey(e: KeyboardEvent) {
      if (e.code === "Space" && document.activeElement?.tagName !== "BUTTON") {
        e.preventDefault();
        markLine(activeIndex);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, activeIndex, currentTime]);

  const previewLines: LrcLine[] = useMemo(
    () => rawLines.map((text, i) => ({ time: times[i] ?? 0, text })),
    [rawLines, times],
  );
  const previewCurrentIndex = findCurrentLrcLineIndex(previewLines, currentTime);
  const previewLineRefs = useRef<(HTMLParagraphElement | null)[]>([]);
  useEffect(() => {
    if (mode !== "preview" || previewCurrentIndex < 0) return;
    previewLineRefs.current[previewCurrentIndex]?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [mode, previewCurrentIndex]);

  async function handleSave() {
    if (!user || user.id === "guest" || !track.telegramTopicId) {
      toast.error("Não foi possível identificar você ou a faixa.");
      return;
    }
    setSaving(true);
    try {
      const lrc = formatLrc(previewLines);
      const res = await api.salvarLetraSincronizada(track.telegramTopicId, user.id, lrc);
      if (res.success) {
        haptic.success();
        toast.success("Letra sincronizada!", { description: "Já aparece pra quem ouvir essa faixa." });
        onSaved(lrc);
      } else {
        toast.error(res.error || "Não deu pra salvar a sincronização agora.");
      }
    } catch {
      toast.error("Erro de conexão ao salvar.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[80] bg-black/90 backdrop-blur-sm flex flex-col">
      <div className="flex items-center justify-between px-4 pt-[calc(env(safe-area-inset-top)+16px)] pb-3 border-b border-white/10">
        <div className="min-w-0">
          <h2 className="text-sm font-black uppercase tracking-wide truncate">
            {mode === "preview" ? "Prévia" : "Sincronizar Letra"}
          </h2>
          <p className="text-xs text-neutral-400 truncate">{track.titulo}</p>
        </div>
        <button
          onClick={onClose}
          className="size-9 shrink-0 rounded-full bg-white/5 border border-white/10 grid place-items-center text-neutral-300 hover:text-white"
        >
          <X className="size-4" />
        </button>
      </div>

      {mode === "edit" ? (
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2">
          {rawLines.length === 0 && (
            <p className="text-center text-sm text-neutral-500 italic py-12">
              Essa faixa não tem letra cadastrada.
            </p>
          )}
          <p className="text-[11px] text-neutral-500 text-center pb-1">
            Toque numa linha pra escolher ela como alvo da próxima marcação — dá pra corrigir qualquer uma.
          </p>
          {rawLines.map((text, i) => {
            const marked = times[i] != null;
            const isActive = i === activeIndex;
            return (
              <button
                key={i}
                onClick={() => setSelectedIndex(i)}
                className={`w-full flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors ${
                  isActive
                    ? "bg-emerald-500/15 border-emerald-500/50"
                    : marked
                      ? "border-white/5 bg-white/[0.02]"
                      : "border-transparent"
                }`}
              >
                <span
                  className={`text-sm ${isActive ? "text-white font-bold" : marked ? "text-neutral-400" : "text-neutral-600"}`}
                >
                  {text}
                </span>
                <span className="shrink-0 flex items-center gap-2">
                  {marked && (
                    <>
                      <span className="flex items-center gap-1 text-[10px] font-mono text-emerald-400">
                        <Check className="size-3" />
                        {formatLrcTimestamp(times[i] as number)}
                      </span>
                      <span
                        role="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          clearLine(i);
                        }}
                        title="Limpar marcação"
                        className="text-neutral-500 hover:text-red-400"
                      >
                        <XCircle className="size-3.5" />
                      </span>
                    </>
                  )}
                  {isActive && !marked && <Pencil className="size-3.5 text-emerald-400" />}
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-6 py-8 flex flex-col items-center justify-center text-center gap-4">
          {previewLines.map((line, i) => (
            <p
              key={i}
              ref={(el) => {
                previewLineRefs.current[i] = el;
              }}
              className={
                i === previewCurrentIndex
                  ? "text-white font-black text-lg transition-colors"
                  : i < previewCurrentIndex
                    ? "text-neutral-600 text-sm transition-colors"
                    : "text-neutral-400 text-sm transition-colors"
              }
            >
              {line.text}
            </p>
          ))}
        </div>
      )}

      <div className="border-t border-white/10 px-5 pt-4 pb-[calc(env(safe-area-inset-bottom)+18px)] bg-neutral-950 space-y-3">
        {duration > 0 && (
          <div className="flex items-center gap-3">
            <span className="text-[10px] font-mono text-neutral-500 w-10 text-right">
              {formatLrcTimestamp(currentTime)}
            </span>
            <input
              type="range"
              min={0}
              max={duration}
              step={0.1}
              value={currentTime}
              onChange={(e) => onSeek(parseFloat(e.target.value))}
              className="flex-1 accent-emerald-500"
            />
            <span className="text-[10px] font-mono text-neutral-500 w-10">
              {formatLrcTimestamp(duration)}
            </span>
          </div>
        )}

        <div className="flex items-center gap-2">
          <button
            onClick={onTogglePlay}
            className="size-12 shrink-0 rounded-2xl bg-white/5 border border-white/10 grid place-items-center text-white"
          >
            {isPlaying ? <Pause className="size-5" /> : <Play className="size-5 ml-0.5" />}
          </button>

          {mode === "edit" ? (
            <>
              <button
                onClick={() => markLine(activeIndex)}
                disabled={activeIndex < 0 || rawLines.length === 0}
                className="flex-1 h-12 rounded-2xl bg-emerald-500 text-black font-black text-sm uppercase tracking-wide disabled:opacity-30 disabled:pointer-events-none flex items-center justify-center gap-2"
              >
                {selectedIndex != null ? "Corrigir linha" : "Marcar linha atual"}
                <span className="text-[10px] font-mono font-bold bg-black/15 px-1.5 py-0.5 rounded">espaço</span>
              </button>

              <button
                onClick={undoLastMark}
                disabled={times.every((t) => t == null)}
                title="Desfazer última marcação"
                className="size-12 shrink-0 rounded-2xl bg-white/5 border border-white/10 grid place-items-center text-neutral-300 hover:text-white disabled:opacity-30 disabled:pointer-events-none"
              >
                ↺
              </button>
            </>
          ) : (
            <button
              onClick={() => setMode("edit")}
              className="flex-1 h-12 rounded-2xl bg-white/5 border border-white/10 text-white font-black text-sm uppercase tracking-wide flex items-center justify-center gap-2"
            >
              <Pencil className="size-4" />
              Voltar e ajustar
            </button>
          )}
        </div>

        {mode === "edit" ? (
          <button
            onClick={() => setMode("preview")}
            disabled={!allMarked || rawLines.length === 0}
            className="w-full h-12 rounded-2xl bg-white text-black font-black text-sm uppercase tracking-wide disabled:opacity-30 disabled:pointer-events-none flex items-center justify-center gap-2"
          >
            <Eye className="size-4" />
            {allMarked ? "Pré-visualizar" : `Faltam ${times.filter((t) => t == null).length} linhas`}
          </button>
        ) : (
          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full h-12 rounded-2xl bg-emerald-500 text-black font-black text-sm uppercase tracking-wide disabled:opacity-30 disabled:pointer-events-none flex items-center justify-center gap-2"
          >
            {saving && <Loader2 className="size-4 animate-spin" />}
            Confirmar e salvar
          </button>
        )}
      </div>
    </div>
  );
}
