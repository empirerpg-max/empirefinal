import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { X, Image as ImageIcon, ZoomIn } from "lucide-react";

function clamp01(v: number) {
  return Math.min(1, Math.max(0, v));
}

export interface ImageCropOptions {
  /** Largura/altura do recorte final, em pixels — define a proporção do quadro. */
  targetW: number;
  targetH: number;
  /** "circle" desenha a moldura como avatar; "square" cobre cantos arredondados normais. */
  shape?: "circle" | "square";
  title?: string;
}

/**
 * Editor de recorte com arrastar-pra-posicionar + zoom — mesmo padrão do
 * WhatsApp/Instagram/LinkedIn na hora de trocar foto/banner: a imagem SEMPRE
 * preenche o quadro (sem sobrar vazio) e a pessoa escolhe o que fica dentro
 * arrastando e ajustando o zoom, em vez do app cortar a parte errada sem
 * avisar. Generalizado a partir do crop que já existia só pra capa de
 * artista (CapaCropField).
 */
export function ImageCropModal({
  file,
  options,
  onCancel,
  onCropped,
}: {
  file: File;
  options: ImageCropOptions;
  onCancel: () => void;
  onCropped: (blob: Blob) => void;
}) {
  const { targetW, targetH, shape = "square", title = "Editar imagem" } = options;
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [frameSize, setFrameSize] = useState({ w: 0, h: 0 });
  const [rawSrc, setRawSrc] = useState<string | null>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({ x: 0.5, y: 0.5 });
  const [saving, setSaving] = useState(false);
  const dragRef = useRef<{ startX: number; startY: number; startPos: { x: number; y: number } } | null>(null);

  useEffect(() => {
    const reader = new FileReader();
    reader.onload = () => {
      const src = String(reader.result);
      const img = new Image();
      img.onload = () => {
        setNatural({ w: img.naturalWidth, h: img.naturalHeight });
        setRawSrc(src);
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  }, [file]);

  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const update = () => setFrameSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [rawSrc]);

  // Mesma fórmula pra prévia em tela (tamanho real do quadro) e pro recorte
  // final (tamanho alvo em pixels) — garante que o que a pessoa vê é
  // exatamente o que vira o arquivo enviado.
  function geometry(boxW: number, boxH: number) {
    if (!natural || boxW <= 0 || boxH <= 0) return null;
    const coverScale = Math.max(boxW / natural.w, boxH / natural.h);
    const scale = coverScale * zoom;
    const drawW = natural.w * scale;
    const drawH = natural.h * scale;
    const excessX = Math.max(0, drawW - boxW);
    const excessY = Math.max(0, drawH - boxH);
    return { drawW, drawH, dx: -excessX * pos.x, dy: -excessY * pos.y, excessX, excessY };
  }

  const previewGeo = geometry(frameSize.w, frameSize.h);

  function handlePointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (!previewGeo) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    dragRef.current = { startX: e.clientX, startY: e.clientY, startPos: pos };
  }
  function handlePointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!dragRef.current || !previewGeo) return;
    const { excessX, excessY } = previewGeo;
    const dxClient = e.clientX - dragRef.current.startX;
    const dyClient = e.clientY - dragRef.current.startY;
    setPos({
      x: excessX > 0 ? clamp01(dragRef.current.startPos.x - dxClient / excessX) : 0.5,
      y: excessY > 0 ? clamp01(dragRef.current.startPos.y - dyClient / excessY) : 0.5,
    });
  }
  function handlePointerUp() {
    dragRef.current = null;
  }

  async function handleSave() {
    if (!natural || !rawSrc) return;
    const geo = geometry(targetW, targetH);
    if (!geo) return;
    setSaving(true);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("Falha ao processar a imagem."));
        img.src = rawSrc;
      });
      ctx.drawImage(img, geo.dx, geo.dy, geo.drawW, geo.drawH);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), "image/jpeg", 0.92));
      if (blob) onCropped(blob);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[200] bg-black/85 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
      <div className="w-full max-w-md bg-neutral-900 border border-white/10 rounded-3xl overflow-hidden shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <h3 className="text-sm font-black text-white">{title}</h3>
          <button
            onClick={onCancel}
            className="size-8 rounded-full grid place-items-center text-neutral-400 hover:text-white hover:bg-white/10 transition"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {rawSrc && natural ? (
            <>
              <div
                ref={frameRef}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
                style={{ aspectRatio: `${targetW} / ${targetH}` }}
                className={`relative w-full overflow-hidden bg-black border border-white/10 cursor-grab active:cursor-grabbing touch-none select-none ${
                  shape === "circle" ? "rounded-full" : "rounded-2xl"
                }`}
              >
                {previewGeo && (
                  <img
                    src={rawSrc}
                    alt=""
                    draggable={false}
                    className="absolute max-w-none pointer-events-none"
                    style={{
                      width: previewGeo.drawW,
                      height: previewGeo.drawH,
                      left: previewGeo.dx,
                      top: previewGeo.dy,
                    }}
                  />
                )}
              </div>

              <div className="flex items-center gap-3">
                <ZoomIn className="size-4 text-neutral-400 shrink-0" />
                <input
                  type="range"
                  min={1}
                  max={3}
                  step={0.01}
                  value={zoom}
                  onChange={(e) => setZoom(parseFloat(e.target.value))}
                  className="flex-1"
                />
              </div>
              <p className="text-[11px] text-neutral-500 text-center">Arraste pra posicionar, use o zoom pra ajustar</p>
            </>
          ) : (
            <div style={{ aspectRatio: `${targetW} / ${targetH}` }} className="w-full rounded-2xl bg-secondary grid place-items-center">
              <ImageIcon className="size-8 text-muted-foreground animate-pulse" />
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-white/10">
          <button
            onClick={onCancel}
            className="px-4 py-2.5 rounded-full text-xs font-bold text-neutral-400 hover:text-white hover:bg-white/5 transition"
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={!rawSrc || saving}
            className="px-6 py-2.5 rounded-full bg-primary text-primary-foreground font-black text-xs uppercase tracking-wider disabled:opacity-50 transition"
          >
            {saving ? "Salvando..." : "Salvar alterações"}
          </button>
        </div>
      </div>
    </div>
  );
}
