import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";

// Paleta curada, sem depender de lib externa — emoji nativo do sistema,
// igual ao que já aparecia nas reações reais do Telegram (❤️, 🔥, 😂...).
const EMOJI_CATEGORIES: { label: string; emojis: string[] }[] = [
  {
    label: "Reações",
    emojis: ["❤️", "🔥", "👍", "👎", "😂", "😮", "😢", "😡", "🎉", "👏", "🙏", "💯"],
  },
  {
    label: "Rostos",
    emojis: [
      "😀", "😁", "😃", "😄", "😆", "😅", "🥹", "😊", "😇", "🙂", "🙃", "😉",
      "😍", "🥰", "😘", "😋", "😛", "🤪", "😜", "🤔", "🫡", "😐", "😑", "😶",
      "🙄", "😏", "😴", "🤤", "😪", "😵", "🤯", "🥳", "😎", "🥸", "🤓", "😱",
      "😨", "😰", "😥", "😓", "🤗", "🤭", "🫢", "🤫", "🫠", "🥴", "🤢", "🤮",
    ],
  },
  {
    label: "Gestos",
    emojis: [
      "👋", "🤙", "💪", "🙌", "👐", "🤝", "🤞", "✌️", "🤟", "👌", "🫶", "👊",
      "✊", "👇", "👆", "☝️", "👉", "👈", "✋", "🖐️", "🫰", "💅", "🦵", "🦶",
    ],
  },
  {
    label: "Corações",
    emojis: [
      "❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "🤎", "💔", "❣️", "💕",
      "💞", "💓", "💗", "💖", "💘", "💝", "💟",
    ],
  },
  {
    label: "Música & Estrelas",
    emojis: [
      "🎵", "🎶", "🎤", "🎧", "🎸", "🥁", "🎹", "🎷", "🎺", "⭐", "🌟", "✨",
      "💫", "🌈", "☀️", "🌙", "⚡", "💥", "🎇", "🎆",
    ],
  },
  {
    label: "Objetos & Comemoração",
    emojis: [
      "🎉", "🎊", "🏆", "🥇", "🎁", "🍾", "🥂", "🍰", "👑", "💎", "🔊", "📢",
      "💬", "💭", "✅", "❌", "🚀", "💀", "👻", "🤡",
    ],
  },
];

const ALL_EMOJIS = Array.from(new Set(EMOJI_CATEGORIES.flatMap((c) => c.emojis)));

// Índice mínimo de palavras-chave (PT) pra busca funcionar de verdade em vez
// de só "mostrar tudo" — cobre os casos mais comuns, não é exaustivo.
const KEYWORDS: Record<string, string[]> = {
  amor: ["❤️", "🧡", "💛", "💚", "💙", "💜", "😍", "🥰", "💕", "💖"],
  coracao: ["❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "🤎", "💔"],
  fogo: ["🔥"],
  top: ["👍", "💯", "🔥"],
  bom: ["👍", "🎉", "🔥"],
  ruim: ["👎", "😡", "😢"],
  riso: ["😂", "🤣", "😆"],
  rir: ["😂", "🤣", "😆"],
  triste: ["😢", "😥", "😓"],
  raiva: ["😡", "🤬"],
  choque: ["😮", "😱", "🤯"],
  surpresa: ["😮", "😱"],
  festa: ["🎉", "🎊", "🥳"],
  aplauso: ["👏"],
  parabens: ["🎉", "🏆", "👏"],
  musica: ["🎵", "🎶", "🎤", "🎧"],
  estrela: ["⭐", "🌟", "✨"],
  premio: ["🏆", "🥇"],
  coroa: ["👑"],
  diamante: ["💎"],
  ok: ["👌", "✅"],
  errado: ["❌"],
  foguete: ["🚀"],
  fantasma: ["👻"],
  caveira: ["💀"],
  palhaco: ["🤡"],
  mao: ["👋", "🤙", "🙌", "🤝", "🤞", "✌️", "👌"],
  reza: ["🙏"],
};

function searchEmojis(query: string): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return ALL_EMOJIS;
  const fromKeywords = new Set<string>();
  Object.entries(KEYWORDS).forEach(([word, emojis]) => {
    if (word.includes(q) || q.includes(word)) emojis.forEach((e) => fromKeywords.add(e));
  });
  return Array.from(fromKeywords);
}

interface EmojiPickerProps {
  onSelect: (emoji: string) => void;
  onClose: () => void;
}

export function EmojiPicker({ onSelect, onClose }: EmojiPickerProps) {
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose]);

  const visible = useMemo(() => {
    if (!query.trim()) return null; // null = mostra por categoria
    return searchEmojis(query);
  }, [query]);

  return (
    <div
      ref={containerRef}
      className="absolute z-20 mt-2 w-72 max-h-80 flex flex-col bg-neutral-900 border border-white/15 rounded-2xl shadow-2xl overflow-hidden"
    >
      <div className="flex items-center gap-2 p-2.5 border-b border-white/10 shrink-0">
        <Search className="size-3.5 text-neutral-500 shrink-0" />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar emoji..."
          className="w-full bg-transparent text-xs text-white placeholder-neutral-500 focus:outline-none"
        />
        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded-full text-neutral-500 hover:text-white hover:bg-white/10 shrink-0"
        >
          <X className="size-3.5" />
        </button>
      </div>

      <div className="overflow-y-auto p-2 space-y-3">
        {visible ? (
          visible.length === 0 ? (
            <p className="text-center text-[11px] text-neutral-500 py-6">
              Nenhum emoji encontrado pra "{query.trim()}".
            </p>
          ) : (
            <div className="grid grid-cols-8 gap-1">
              {visible.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => onSelect(emoji)}
                  className="size-8 grid place-items-center text-lg rounded-lg hover:bg-white/10 active:scale-90 transition-all"
                >
                  {emoji}
                </button>
              ))}
            </div>
          )
        ) : (
          EMOJI_CATEGORIES.map((cat) => (
            <div key={cat.label}>
              <p className="text-[10px] font-black uppercase tracking-wider text-neutral-500 mb-1 px-1">
                {cat.label}
              </p>
              <div className="grid grid-cols-8 gap-1">
                {cat.emojis.map((emoji) => (
                  <button
                    key={`${cat.label}-${emoji}`}
                    type="button"
                    onClick={() => onSelect(emoji)}
                    className="size-8 grid place-items-center text-lg rounded-lg hover:bg-white/10 active:scale-90 transition-all"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
