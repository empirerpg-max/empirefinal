import React, { useRef, useState, useEffect } from "react";
import { X, Send, Sparkles, Star, ThumbsUp, User, SmilePlus } from "lucide-react";
import { useTelegramUser } from "@/lib/telegram";
import { getStoredLogin } from "@/components/LoginScreen";
import { EmojiPicker } from "./EmojiPicker";
import { RichTextToolbar } from "./RichTextToolbar";

// Mesma paleta de destaque do EmojiPicker — atalho rápido pra reagir sem
// precisar abrir o seletor completo.
const QUICK_EMOJIS = ["❤️", "🔥", "👍", "😂", "😮", "🎉"];

export interface CommentModalProps {
  isOpen: boolean;
  onClose: () => void;
  tipoMedia: "musica" | "music-video" | "video" | "album";
  tituloMedia: string;
  topicId?: string;
  onCommentSubmitted?: (data: any) => void;
}

const INTERVAL_OPTIONS = ["45 - 60", "61 - 75", "76 - 90", "91 - 100"] as const;

export const CommentModal: React.FC<CommentModalProps> = ({
  isOpen,
  onClose,
  tipoMedia,
  tituloMedia,
  topicId,
  onCommentSubmitted,
}) => {
  const { user: telegramUser } = useTelegramUser();
  const [nomeJogador, setNomeJogador] = useState("");
  const [comentario, setComentario] = useState("");
  const [intervalo, setIntervalo] = useState<string>("76 - 90");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [selectedEmoji, setSelectedEmoji] = useState<string | null>(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const comentarioRef = useRef<HTMLTextAreaElement | null>(null);

  // Nome do jogador logado — mesmo padrão usado em toda a Ponto/Header/etc:
  // getStoredLogin()?.nome (login próprio) primeiro, telegramUser.name como
  // fallback só pra quem ainda não migrou pro login novo. Sempre automático,
  // nunca digitado à mão — antes esse campo dependia de /api/user/me (fonte
  // antiga, telegram_id às vezes sem match) e ficava em branco, obrigando o
  // jogador a digitar o próprio nome, com risco de erro de digitação.
  useEffect(() => {
    if (isOpen && !nomeJogador) {
      const nomeLogin = getStoredLogin()?.nome || telegramUser?.name || "";
      if (nomeLogin) setNomeJogador(nomeLogin);
    }
  }, [isOpen, telegramUser, nomeJogador]);

  if (!isOpen) return null;

  const isMetacritic = tipoMedia === "musica" || tipoMedia === "album";

  const questionText = isMetacritic
    ? "Para o Metacritic, qual nota você daria pra essa música/álbum?"
    : "Em questão de Likes, qual o intervalo que você daria?";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nomeJogador.trim()) {
      setErrorMsg("Por favor, digite seu nome de jogador.");
      return;
    }
    if (!comentario.trim()) {
      setErrorMsg("Por favor, escreva um comentário.");
      return;
    }

    setLoading(true);
    setErrorMsg(null);

    try {
      const response = await fetch("/api/forum/comment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tipoMedia,
          tituloMedia,
          topicId,
          jogadorId: telegramUser?.id || "",
          nomeJogador: nomeJogador.trim(),
          comentario: comentario.trim(),
          intervalo,
        }),
      });

      const json = await response.json();

      if (!response.ok || !json.success) {
        throw new Error(json.error || "Erro ao publicar comentário.");
      }

      // Se o jogador escolheu uma reação junto do comentário, aplica ela
      // direto na linha que acabou de ser criada — sem esse dado do
      // createCommentController (rowIndex/sheetComments) não teria como
      // reagir sem antes reler a aba inteira.
      if (selectedEmoji && telegramUser?.id && json.data?.rowIndex && json.data?.sheetComments) {
        try {
          await fetch("/api/forum/comment-reaction", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sheetComments: json.data.sheetComments,
              rowIndex: json.data.rowIndex,
              emoji: selectedEmoji,
              jogadorId: String(telegramUser.id),
            }),
          }).catch(() => {});
        } catch {
          // reação é um extra opcional — falha aqui não deve bloquear o fluxo
        }
      }

      if (onCommentSubmitted) {
        onCommentSubmitted(json.data);
      }

      // Reset fields
      setComentario("");
      setSelectedEmoji(null);
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || "Erro de conexão ao enviar comentário.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in">
      <div className="relative w-full max-w-lg bg-neutral-900 border border-white/10 rounded-3xl p-6 sm:p-8 shadow-2xl space-y-6 text-white overflow-hidden">
        {/* Glow de fundo */}
        <div className="absolute -top-12 -right-12 size-40 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />

        {/* Header do Modal */}
        <div className="flex items-start justify-between gap-4 border-b border-white/10 pb-4">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-400 text-xs font-semibold uppercase tracking-wider mb-2">
              <Sparkles className="size-3.5" />
              {isMetacritic ? "Metacritic & Comentário" : "Likes & Comentário"}
            </div>
            <h3 className="text-lg sm:text-xl font-black text-white line-clamp-1">{tituloMedia}</h3>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-white/10 text-neutral-400 hover:text-white transition"
          >
            <X className="size-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Campo Nome do Jogador */}
          <div>
            <label className="block text-xs font-bold text-neutral-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <User className="size-3.5 text-emerald-400" />
              Nome do Jogador / OFF
            </label>
            <input
              type="text"
              value={nomeJogador}
              readOnly
              placeholder="Carregando..."
              className="w-full px-4 py-3 bg-neutral-800/40 border border-white/10 rounded-2xl text-sm text-neutral-300 placeholder-neutral-500 cursor-not-allowed"
            />
          </div>

          {/* Pergunta Interativa de Intervalo (Metacritic / Likes) */}
          <div>
            <label className="block text-xs sm:text-sm font-bold text-neutral-200 mb-3 flex items-center gap-2">
              {isMetacritic ? (
                <Star className="size-4 text-yellow-400 fill-yellow-400" />
              ) : (
                <ThumbsUp className="size-4 text-emerald-400" />
              )}
              {questionText}
            </label>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {INTERVAL_OPTIONS.map((option) => {
                const active = intervalo === option;
                return (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setIntervalo(option)}
                    className={`px-3 py-2.5 rounded-2xl text-xs font-black uppercase tracking-wider transition border text-center ${
                      active
                        ? "bg-emerald-500 text-black border-emerald-400 shadow-lg shadow-emerald-500/20 scale-[1.02]"
                        : "bg-neutral-800/60 border-white/10 text-neutral-300 hover:bg-neutral-700/60 hover:text-white"
                    }`}
                  >
                    {option}
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] text-neutral-400 mt-2 italic">
              * O sistema sorteará um valor aleatório dentro deste intervalo para a sua avaliação.
            </p>
          </div>

          {/* Campo Comentário */}
          <div>
            <label className="block text-xs font-bold text-neutral-400 uppercase tracking-wider mb-2">
              Seu Comentário
            </label>
            <RichTextToolbar textareaRef={comentarioRef} value={comentario} onChange={setComentario} />
            <textarea
              ref={comentarioRef}
              rows={4}
              value={comentario}
              onChange={(e) => setComentario(e.target.value)}
              placeholder="Escreva sua opinião, análise ou mensagem para a comunidade..."
              className="w-full px-4 py-3 bg-neutral-800/80 border border-white/10 rounded-2xl text-sm text-white placeholder-neutral-500 focus:outline-none focus:border-emerald-500 transition resize-none"
              required
            />
          </div>

          {/* Reação embutida — junto do comentário, não como ação separada depois */}
          <div>
            <label className="block text-xs font-bold text-neutral-400 uppercase tracking-wider mb-2">
              Reagir com emoji (opcional)
            </label>
            <div className="flex flex-wrap items-center gap-2 relative">
              {QUICK_EMOJIS.map((emoji) => {
                const active = selectedEmoji === emoji;
                return (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => setSelectedEmoji(active ? null : emoji)}
                    className={`size-10 rounded-2xl text-lg grid place-items-center border transition ${
                      active
                        ? "bg-emerald-500/20 border-emerald-400 scale-110"
                        : "bg-neutral-800/60 border-white/10 hover:bg-neutral-700/60"
                    }`}
                  >
                    {emoji}
                  </button>
                );
              })}

              {/* Emoji escolhido fora do atalho rápido (via seletor completo) */}
              {selectedEmoji && !QUICK_EMOJIS.includes(selectedEmoji) && (
                <button
                  type="button"
                  onClick={() => setSelectedEmoji(null)}
                  className="size-10 rounded-2xl text-lg grid place-items-center border bg-emerald-500/20 border-emerald-400 scale-110"
                >
                  {selectedEmoji}
                </button>
              )}

              <button
                type="button"
                onClick={() => setShowEmojiPicker((v) => !v)}
                className="size-10 rounded-2xl grid place-items-center border border-white/10 bg-neutral-800/60 hover:bg-neutral-700/60 text-neutral-300 hover:text-white transition"
                title="Mais emojis"
              >
                <SmilePlus className="size-4.5" />
              </button>

              {showEmojiPicker && (
                <div className="absolute top-full left-0 mt-2 z-10">
                  <EmojiPicker
                    onSelect={(emoji) => {
                      setSelectedEmoji(emoji);
                      setShowEmojiPicker(false);
                    }}
                    onClose={() => setShowEmojiPicker(false)}
                  />
                </div>
              )}
            </div>
          </div>

          {errorMsg && (
            <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-2xl text-red-400 text-xs font-medium">
              {errorMsg}
            </div>
          )}

          {/* Botões do Rodapé */}
          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2.5 rounded-full text-xs font-bold text-neutral-400 hover:text-white hover:bg-white/5 transition"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-6 py-2.5 rounded-full bg-emerald-500 hover:bg-emerald-400 text-black font-black text-xs uppercase tracking-wider flex items-center gap-2 shadow-lg shadow-emerald-500/20 transition disabled:opacity-50"
            >
              {loading ? (
                <>Enviando...</>
              ) : (
                <>
                  <Send className="size-3.5" />
                  Publicar Comentário
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
