import { Fragment, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { X, Play, Pause, Check, Loader2, Pencil, XCircle, Eye, Trash2, Plus, Minus } from "lucide-react";
import { toast } from "sonner";
import { api, driveImg } from "@/lib/api";
import { haptic, useTelegramUser } from "@/lib/telegram";
import { formatLrc, formatLrcTimestamp, parseLrc, findCurrentLrcLineIndex, type LrcLine } from "@/lib/lrc";
import { extractDriveFileId } from "./MusicPlayer";

export interface SyncStudioTrack {
  musicaRowIndex: number;
  titulo: string;
  artista: string;
  audioUrl: string;
  letra: string;
  letraSincronizada?: string | null;
  capaUrl?: string;
}

interface SyncStudioModalProps {
  track: SyncStudioTrack;
  onClose: () => void;
  onSaved: (lrc: string) => void;
}

// Versão da tela de sincronização usada direto do "Estúdio" em Gestão —
// mesmo fluxo de marcação/prévia do LyricSyncModal (aberto de dentro do
// player), mas com áudio próprio (o dono edita sem precisar estar ouvindo a
// faixa pelo player) e identificando a linha da planilha por
// musicaRowIndex, o que funciona mesmo pra faixa de álbum sem tópico
// publicado ainda (sem isso, só dava pra sincronizar depois de lançada).
export function SyncStudioModal({ track, onClose, onSaved }: SyncStudioModalProps) {
  const { user } = useTelegramUser();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  // Áudio do Drive precisa passar pelo proxy do backend (/api/media/audio) —
  // um fetch direto do navegador pra drive.google.com é bloqueado por CORS
  // na maioria dos casos, o que fazia o Play não fazer nada (mesmo ajuste já
  // usado no MusicPlayer).
  const driveFileId = extractDriveFileId(track.audioUrl);
  const effectiveAudioSrc = driveFileId ? `/api/media/audio?id=${driveFileId}` : track.audioUrl;

  // Linhas editáveis — não só os tempos, mas o texto em si. Dá pra remover
  // uma frase que não devia estar ali ou adicionar uma que a letra estática
  // não tinha (ex.: um "uh-uh" de fundo só perceptível ouvindo o áudio).
  const [lines, setLines] = useState<string[]>(() =>
    (track.letra || "").split("\n").map((l) => l.trim()).filter(Boolean),
  );
  const [times, setTimes] = useState<(number | null)[]>(() => {
    const existing = parseLrc(track.letraSincronizada);
    const raw = (track.letra || "").split("\n").map((l) => l.trim()).filter(Boolean);
    return raw.map((_, i) => existing[i]?.time ?? null);
  });
  const [newLineText, setNewLineText] = useState("");
  // Posição (índice) onde o "+" entre versos está aberto pra digitar uma
  // linha nova; null = nenhum aberto.
  const [insertingAt, setInsertingAt] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const firstPendingIndex = times.findIndex((t) => t == null);
  const allMarked = firstPendingIndex === -1;

  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const activeIndex = selectedIndex ?? firstPendingIndex;

  function togglePlay() {
    if (!audioRef.current) return;
    if (isPlaying) audioRef.current.pause();
    else audioRef.current.play().catch(() => {});
  }

  // Move o áudio de verdade (contador incluído) pra um instante — usado ao
  // escolher uma linha já marcada, pra ouvir exatamente aquele trecho antes
  // de decidir se corrige. Sem isso, selecionar a linha só mudava o alvo da
  // marcação, mas a música seguia tocando de onde estava, "sem sinergia".
  function seekTo(time: number) {
    const clamped = Math.max(0, time);
    setCurrentTime(clamped);
    if (audioRef.current) audioRef.current.currentTime = clamped;
  }

  // Ajuste fino (±0.2s) do tempo já marcado de uma linha, sem precisar
  // remarcar do zero — junto com o seek ao selecionar, é o que faz esse
  // editor funcionar de verdade pra corrigir um tempo levemente errado.
  function nudgeLine(index: number, delta: number) {
    setTimes((prev) => {
      const current = prev[index];
      if (current == null) return prev;
      const next = [...prev];
      next[index] = Math.max(0, current + delta);
      return next;
    });
  }

  function markLine(index: number) {
    if (index < 0 || index >= lines.length) return;
    haptic.light();
    setTimes((prev) => {
      const next = [...prev];
      next[index] = currentTime;
      return next;
    });
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

  function removeLine(index: number) {
    haptic.light();
    setLines((prev) => prev.filter((_, i) => i !== index));
    setTimes((prev) => prev.filter((_, i) => i !== index));
    setSelectedIndex(null);
  }

  // Insere uma linha nova numa posição específica (entre duas linhas
  // existentes, ou no fim) — o "+" que aparece entre versos guarda qual
  // posição está editando via insertingAt.
  function insertLineAt(index: number) {
    const text = newLineText.trim();
    if (!text) {
      setInsertingAt(null);
      return;
    }
    haptic.light();
    setLines((prev) => {
      const next = [...prev];
      next.splice(index, 0, text);
      return next;
    });
    setTimes((prev) => {
      const next = [...prev];
      next.splice(index, 0, null);
      return next;
    });
    setNewLineText("");
    setInsertingAt(null);
  }

  function undoLastMark() {
    const lastMarked = [...times].reverse().findIndex((t) => t != null);
    if (lastMarked === -1) return;
    const idx = times.length - 1 - lastMarked;
    clearLine(idx);
  }

  useEffect(() => {
    if (mode !== "edit") return;
    function onKey(e: KeyboardEvent) {
      const tag = document.activeElement?.tagName;
      // O atalho de espaço só vale fora de campos de texto — senão nem dava
      // pra digitar espaço numa linha nova (o "j" virava alvo de marcação
      // global e o espaço nunca chegava no input, engolindo as palavras).
      if (tag === "INPUT" || tag === "TEXTAREA" || (document.activeElement as HTMLElement)?.isContentEditable) {
        return;
      }
      if (e.code === "Space" && tag !== "BUTTON") {
        e.preventDefault();
        markLine(activeIndex);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, activeIndex, currentTime]);

  const previewLines: LrcLine[] = useMemo(
    () => lines.map((text, i) => ({ time: times[i] ?? 0, text })),
    [lines, times],
  );
  const previewCurrentIndex = findCurrentLrcLineIndex(previewLines, currentTime);
  const previewLineRefs = useRef<(HTMLParagraphElement | null)[]>([]);
  useEffect(() => {
    if (mode !== "preview" || previewCurrentIndex < 0) return;
    previewLineRefs.current[previewCurrentIndex]?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [mode, previewCurrentIndex]);

  // Linha marcada correspondente à posição atual do áudio — também no modo
  // de edição, não só na prévia. Sem isso, arrastar a timeline pra trás
  // pra reouvir um trecho não mostrava qual linha já marcada era aquela: a
  // lista só destacava o alvo da PRÓXIMA marcação, nunca "onde eu estou".
  const playbackLineIndex = useMemo(() => {
    let idx = -1;
    for (let i = 0; i < times.length; i++) {
      const t = times[i];
      if (t != null && t <= currentTime) idx = i;
      else if (t != null) break;
    }
    return idx;
  }, [times, currentTime]);
  const lineRefs = useRef<(HTMLButtonElement | null)[]>([]);
  useEffect(() => {
    if (mode !== "edit" || playbackLineIndex < 0) return;
    lineRefs.current[playbackLineIndex]?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [mode, playbackLineIndex]);

  async function handleSave() {
    if (!user || user.id === "guest") {
      toast.error("Não foi possível identificar você.");
      return;
    }
    setSaving(true);
    try {
      const lrc = formatLrc(previewLines);
      const res = await api.salvarLetraSincronizada(null, user.id, lrc, track.musicaRowIndex);
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
    <div className="fixed inset-0 z-[200] bg-neutral-950 flex flex-col overflow-hidden">
      {/* Fundo com a própria capa borrada, em vez de preto liso — visual
          mais limpo/atmosférico, na linha da referência mandada. */}
      {track.capaUrl && (
        <div className="absolute inset-0 -z-10">
          <img src={driveImg(track.capaUrl)} alt="" className="size-full object-cover blur-3xl scale-125 opacity-40" />
          <div className="absolute inset-0 bg-gradient-to-b from-neutral-950/70 via-neutral-950/85 to-neutral-950" />
        </div>
      )}
      <audio
        ref={audioRef}
        src={effectiveAudioSrc}
        preload="metadata"
        onTimeUpdate={() => audioRef.current && setCurrentTime(audioRef.current.currentTime)}
        onLoadedMetadata={() => audioRef.current && setDuration(audioRef.current.duration || 0)}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => setIsPlaying(false)}
        onError={() => toast.error("Não foi possível carregar o áudio dessa faixa.")}
      />

      <div className="flex items-center justify-between px-4 pt-[calc(env(safe-area-inset-top)+16px)] pb-3">
        <div className="min-w-0 flex items-center gap-3">
          {track.capaUrl && (
            <img
              src={driveImg(track.capaUrl)}
              alt=""
              className="size-9 rounded-xl object-cover shrink-0"
            />
          )}
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-[0.14em] text-emerald-400">
              {mode === "preview" ? "Prévia" : "Sincronizando"}
            </p>
            <h2 className="text-sm font-bold truncate">{track.titulo} — {track.artista}</h2>
          </div>
        </div>
        <button
          onClick={onClose}
          className="size-8 shrink-0 rounded-full bg-white/10 backdrop-blur grid place-items-center text-neutral-300 hover:text-white"
        >
          <X className="size-4" />
        </button>
      </div>

      {mode === "edit" ? (
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2">
          {lines.length === 0 && (
            <p className="text-center text-sm text-neutral-500 italic py-12">
              Essa faixa não tem letra cadastrada.
            </p>
          )}
          <p className="text-[11px] text-neutral-500 text-center pb-1">
            Toque numa linha pra escolher o alvo da próxima marcação — se ela já tem tempo marcado, a música pula pra lá.
          </p>
          <LineInsertSlot
            index={0}
            open={insertingAt === 0}
            value={newLineText}
            onOpen={() => setInsertingAt(0)}
            onChange={setNewLineText}
            onConfirm={() => insertLineAt(0)}
            onCancel={() => {
              setInsertingAt(null);
              setNewLineText("");
            }}
          />
          {lines.map((text, i) => {
            const marked = times[i] != null;
            const isActive = i === activeIndex;
            const isPlayingHere = i === playbackLineIndex;
            return (
              <Fragment key={i}>
              <button
                ref={(el) => {
                  lineRefs.current[i] = el;
                }}
                onClick={() => {
                  setSelectedIndex(i);
                  const t = times[i];
                  if (t != null) seekTo(Math.max(0, t - 0.15));
                }}
                className={`w-full flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors ${
                  isActive
                    ? "bg-emerald-500/15 border-emerald-500/50"
                    : isPlayingHere
                      ? "bg-white/[0.06] border-white/20"
                      : marked
                        ? "border-white/5 bg-white/[0.02]"
                        : "border-transparent"
                }`}
              >
                <span
                  className={`text-sm flex items-center gap-2 ${isActive ? "text-white font-bold" : marked ? "text-neutral-400" : "text-neutral-600"}`}
                >
                  {isPlayingHere && !isActive && (
                    <Play className="size-3 shrink-0 text-white fill-white" />
                  )}
                  {text}
                </span>
                <span className="shrink-0 flex items-center gap-1.5">
                  {marked && (
                    <>
                      <span
                        role="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          nudgeLine(i, -0.2);
                        }}
                        title="Atrasar 0,2s"
                        className="text-neutral-500 hover:text-white p-0.5"
                      >
                        <Minus className="size-3" />
                      </span>
                      <span className="flex items-center gap-1 text-[10px] font-mono text-emerald-400 tabular-nums">
                        <Check className="size-3" />
                        {formatLrcTimestamp(times[i] as number)}
                      </span>
                      <span
                        role="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          nudgeLine(i, 0.2);
                        }}
                        title="Adiantar 0,2s"
                        className="text-neutral-500 hover:text-white p-0.5"
                      >
                        <Plus className="size-3" />
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
                  <span
                    role="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeLine(i);
                    }}
                    title="Remover linha"
                    className="text-neutral-600 hover:text-red-400"
                  >
                    <Trash2 className="size-3.5" />
                  </span>
                </span>
              </button>
              <LineInsertSlot
                index={i + 1}
                open={insertingAt === i + 1}
                value={newLineText}
                onOpen={() => setInsertingAt(i + 1)}
                onChange={setNewLineText}
                onConfirm={() => insertLineAt(i + 1)}
                onCancel={() => {
                  setInsertingAt(null);
                  setNewLineText("");
                }}
              />
              </Fragment>
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
              onClick={() => seekTo(Math.max(0, line.time - 0.15))}
              className={
                i === previewCurrentIndex
                  ? "text-white font-black text-lg transition-colors cursor-pointer"
                  : i < previewCurrentIndex
                    ? "text-neutral-600 text-sm transition-colors cursor-pointer"
                    : "text-neutral-400 text-sm transition-colors cursor-pointer"
              }
            >
              {line.text}
            </p>
          ))}
        </div>
      )}

      <div className="border-t border-white/10 px-5 pt-4 pb-[calc(env(safe-area-inset-bottom)+18px)] bg-neutral-950 space-y-3">
        {duration > 0 && (
          <div className="space-y-1">
            <TimelineScrubber
              duration={duration}
              currentTime={currentTime}
              markers={times.filter((t): t is number => t != null)}
              onSeek={seekTo}
            />
            <div className="flex justify-between text-[10px] font-mono text-neutral-500">
              <span>{formatLrcTimestamp(currentTime)}</span>
              <span>{formatLrcTimestamp(duration)}</span>
            </div>
          </div>
        )}

        <div className="flex items-center gap-2">
          <button
            onClick={togglePlay}
            className="size-11 shrink-0 rounded-xl bg-white/5 border border-white/10 grid place-items-center text-white"
          >
            {isPlaying ? <Pause className="size-4" /> : <Play className="size-4 ml-0.5" />}
          </button>

          {mode === "edit" ? (
            <>
              <button
                onClick={() => markLine(activeIndex)}
                disabled={activeIndex < 0 || lines.length === 0}
                className="flex-1 h-11 rounded-xl bg-emerald-500/90 hover:bg-emerald-500 text-black font-semibold text-sm disabled:opacity-30 disabled:pointer-events-none flex items-center justify-center gap-2 transition-colors"
              >
                Marcar linha
                <span className="text-[10px] font-mono text-black/60 bg-black/10 px-1.5 py-0.5 rounded-md">espaço</span>
              </button>

              <button
                onClick={undoLastMark}
                disabled={times.every((t) => t == null)}
                title="Desfazer última marcação"
                className="size-11 shrink-0 rounded-xl bg-white/5 border border-white/10 grid place-items-center text-neutral-400 hover:text-white disabled:opacity-30 disabled:pointer-events-none text-sm"
              >
                ↺
              </button>
            </>
          ) : (
            <button
              onClick={() => setMode("edit")}
              className="flex-1 h-11 rounded-xl bg-white/5 border border-white/10 text-neutral-200 hover:text-white font-semibold text-sm flex items-center justify-center gap-2 transition-colors"
            >
              <Pencil className="size-3.5" />
              Voltar e ajustar
            </button>
          )}
        </div>

        {mode === "edit" ? (
          <button
            onClick={() => setMode("preview")}
            disabled={!allMarked || lines.length === 0}
            className="w-full h-11 rounded-xl bg-white/90 hover:bg-white text-black font-semibold text-sm disabled:opacity-40 disabled:pointer-events-none flex items-center justify-center gap-2 transition-colors"
          >
            <Eye className="size-3.5" />
            {allMarked ? "Pré-visualizar" : `Faltam ${times.filter((t) => t == null).length} linhas`}
          </button>
        ) : (
          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full h-11 rounded-xl bg-emerald-500/90 hover:bg-emerald-500 text-black font-semibold text-sm disabled:opacity-40 disabled:pointer-events-none flex items-center justify-center gap-2 transition-colors"
          >
            {saving && <Loader2 className="size-3.5 animate-spin" />}
            Confirmar e salvar
          </button>
        )}
      </div>
    </div>
  );
}

// Timeline estilo linha do tempo de editor de vídeo (CapCut e afins): barra
// inteira representa a faixa, ticks marcam onde cada linha já tem tempo
// definido, e o traço branco (playhead) pode ser arrastado direto — dá pra
// "sentir" a organização da letra no tempo, não só ver um número contando.
function TimelineScrubber({
  duration,
  currentTime,
  markers,
  onSeek,
}: {
  duration: number;
  currentTime: number;
  markers: number[];
  onSeek: (time: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);

  function timeFromClientX(clientX: number): number {
    const el = trackRef.current;
    if (!el || duration <= 0) return 0;
    const rect = el.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return ratio * duration;
  }

  function handlePointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    setDragging(true);
    (e.target as Element).setPointerCapture?.(e.pointerId);
    onSeek(timeFromClientX(e.clientX));
  }
  function handlePointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!dragging) return;
    onSeek(timeFromClientX(e.clientX));
  }
  function handlePointerUp() {
    setDragging(false);
  }

  const progressPct = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;

  return (
    <div
      ref={trackRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      className="relative h-11 rounded-xl bg-neutral-900 border border-white/10 cursor-pointer touch-none select-none overflow-hidden"
    >
      <div
        className="absolute inset-y-0 left-0 bg-emerald-500/15"
        style={{ width: `${progressPct}%` }}
      />
      {markers.map((t, i) => (
        <div
          key={i}
          className="absolute top-1.5 bottom-1.5 w-[3px] rounded-full bg-emerald-400/80"
          style={{ left: `calc(${duration > 0 ? (t / duration) * 100 : 0}% - 1.5px)` }}
        />
      ))}
      <div
        className="absolute top-0 bottom-0 w-0.5 bg-white shadow-[0_0_6px_rgba(255,255,255,0.6)]"
        style={{ left: `calc(${progressPct}% - 1px)` }}
      />
      <div
        className="absolute top-1/2 -translate-y-1/2 size-3.5 rounded-full bg-white shadow"
        style={{ left: `calc(${progressPct}% - 7px)` }}
      />
    </div>
  );
}

// "+" discreto entre versos — fechado, é só uma linha fina que ganha um
// círculo com "+" no hover/toque; aberto, vira um campo de texto inline
// pra digitar a linha nova bem onde ela vai entrar na letra.
function LineInsertSlot({
  index,
  open,
  value,
  onOpen,
  onChange,
  onConfirm,
  onCancel,
}: {
  index: number;
  open: boolean;
  value: string;
  onOpen: () => void;
  onChange: (value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  if (open) {
    return (
      <div className="flex items-center gap-2 py-1 px-1">
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onConfirm();
            } else if (e.key === "Escape") {
              e.preventDefault();
              onCancel();
            }
          }}
          onBlur={() => {
            if (!value.trim()) onCancel();
          }}
          placeholder="Nova linha..."
          className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-neutral-900 border border-emerald-500/40 text-sm text-white placeholder-neutral-600 focus:outline-none"
        />
        <button
          onClick={onConfirm}
          disabled={!value.trim()}
          className="size-8 shrink-0 rounded-lg bg-emerald-500/20 text-emerald-400 grid place-items-center disabled:opacity-30 disabled:pointer-events-none"
          title="Adicionar"
        >
          <Check className="size-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div className="group/slot relative h-3 flex items-center justify-center" data-index={index}>
      <button
        onClick={onOpen}
        title="Adicionar linha aqui"
        className="size-4 rounded-full bg-neutral-800/80 border border-white/10 text-neutral-600 hover:text-emerald-400 hover:border-emerald-500/40 hover:bg-neutral-800 active:scale-90 grid place-items-center transition-colors"
      >
        <Plus className="size-2.5" />
      </button>
    </div>
  );
}
