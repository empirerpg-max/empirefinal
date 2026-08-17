import { useRef, useState } from "react";
import { Bold, Italic, Underline, SmilePlus } from "lucide-react";
import { EmojiPicker } from "./EmojiPicker";
import { wrapTextareaSelection, insertAtCursor } from "@/lib/richText";

interface RichTextToolbarProps {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  value: string;
  onChange: (v: string) => void;
}

// Barra de formatação (negrito/itálico/sublinhado + emoji) pra qualquer
// textarea de comentário — reutilizada no modal de novo comentário e na
// edição de comentário existente.
export function RichTextToolbar({ textareaRef, value, onChange }: RichTextToolbarProps) {
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  const applyMarker = (marker: string) => {
    const el = textareaRef.current;
    if (!el) return;
    wrapTextareaSelection(el, value, onChange, marker);
  };

  const insertEmoji = (emoji: string) => {
    const el = textareaRef.current;
    setShowEmojiPicker(false);
    if (!el) return;
    insertAtCursor(el, value, onChange, emoji);
  };

  const btnClass =
    "size-7 rounded-lg grid place-items-center text-neutral-300 hover:text-white hover:bg-white/10 transition";

  return (
    <div ref={wrapperRef} className="relative flex items-center gap-1 mb-1.5">
      <button type="button" title="Negrito" className={btnClass} onClick={() => applyMarker("**")}>
        <Bold className="size-3.5" />
      </button>
      <button type="button" title="Itálico" className={btnClass} onClick={() => applyMarker("*")}>
        <Italic className="size-3.5" />
      </button>
      <button type="button" title="Sublinhado" className={btnClass} onClick={() => applyMarker("__")}>
        <Underline className="size-3.5" />
      </button>
      <button
        type="button"
        title="Emoji"
        className={btnClass}
        onClick={() => setShowEmojiPicker((v) => !v)}
      >
        <SmilePlus className="size-3.5" />
      </button>

      {showEmojiPicker && (
        <div className="absolute top-full left-0 mt-1 z-20">
          <EmojiPicker onSelect={insertEmoji} onClose={() => setShowEmojiPicker(false)} />
        </div>
      )}
    </div>
  );
}
