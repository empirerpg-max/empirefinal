import { useState } from "react";
import { SmilePlus } from "lucide-react";
import { EmojiPicker } from "./EmojiPicker";

interface ReactionBarProps {
  reactions: Record<string, number>;
  reactedBy: Record<string, string[]>;
  myId: string;
  onToggle: (emoji: string) => void;
  disabled?: boolean;
}

export function ReactionBar({ reactions, reactedBy, myId, onToggle, disabled }: ReactionBarProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const entries = Object.entries(reactions).sort((a, b) => b[1] - a[1]);

  return (
    <div className="relative flex items-center gap-1.5 flex-wrap pt-1">
      {entries.map(([emoji, count]) => {
        const mine = (reactedBy[emoji] || []).includes(myId);
        return (
          <button
            key={emoji}
            type="button"
            disabled={disabled}
            onClick={() => onToggle(emoji)}
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold transition-all active:scale-90 border ${
              mine
                ? "bg-emerald-500/20 border-emerald-500/50 text-emerald-400"
                : "bg-white/5 border-white/10 text-neutral-300 hover:border-white/20"
            } disabled:opacity-50`}
          >
            <span>{emoji}</span>
            <span>{count}</span>
          </button>
        );
      })}

      <button
        type="button"
        disabled={disabled}
        onClick={() => setPickerOpen((v) => !v)}
        title="Reagir"
        className="size-6 rounded-full bg-white/5 border border-white/10 text-neutral-400 hover:text-white hover:border-white/20 grid place-items-center transition-all active:scale-90 disabled:opacity-50"
      >
        <SmilePlus className="size-3.5" />
      </button>

      {pickerOpen && (
        <EmojiPicker
          onSelect={(emoji) => {
            onToggle(emoji);
            setPickerOpen(false);
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}
