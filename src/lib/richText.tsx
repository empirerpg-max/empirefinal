import React from "react";

// Formatação simples de comentários — negrito **texto**, itálico *texto*,
// sublinhado __texto__ — sem HTML cru (nunca dangerouslySetInnerHTML com
// texto de jogador), só tokens markdown-like renderizados como <strong>/
// <em>/<u> de verdade. Emoji não precisa de tratamento — é unicode puro,
// já renderiza nativo dentro do texto.
const TOKEN_REGEX = /(\*\*[^*\n]+?\*\*|__[^_\n]+?__|\*[^*\n]+?\*)/g;

export function renderRichText(text: string): React.ReactNode {
  if (!text) return text;
  const parts = text.split(TOKEN_REGEX);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("__") && part.endsWith("__") && part.length > 4) {
      return <u key={i}>{part.slice(2, -2)}</u>;
    }
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
      return <em key={i}>{part.slice(1, -1)}</em>;
    }
    return part ? <React.Fragment key={i}>{part}</React.Fragment> : null;
  });
}

// Envolve (ou desenvolve) a seleção atual do textarea com o marcador de
// formatação, mantendo o cursor num lugar previsível depois — igual editores
// de texto simples (Discord, WhatsApp).
export function wrapTextareaSelection(
  textarea: HTMLTextAreaElement,
  value: string,
  setValue: (v: string) => void,
  marker: string,
) {
  const start = textarea.selectionStart ?? value.length;
  const end = textarea.selectionEnd ?? value.length;
  const before = value.slice(0, start);
  const selected = value.slice(start, end);
  const after = value.slice(end);

  const newValue = `${before}${marker}${selected}${marker}${after}`;
  setValue(newValue);

  requestAnimationFrame(() => {
    textarea.focus();
    const cursorPos = selected ? end + marker.length * 2 : start + marker.length;
    textarea.setSelectionRange(cursorPos, cursorPos);
  });
}

// Insere um emoji na posição do cursor (não substitui seleção).
export function insertAtCursor(
  textarea: HTMLTextAreaElement,
  value: string,
  setValue: (v: string) => void,
  text: string,
) {
  const start = textarea.selectionStart ?? value.length;
  const end = textarea.selectionEnd ?? value.length;
  const newValue = `${value.slice(0, start)}${text}${value.slice(end)}`;
  setValue(newValue);

  requestAnimationFrame(() => {
    textarea.focus();
    const cursorPos = start + text.length;
    textarea.setSelectionRange(cursorPos, cursorPos);
  });
}
