// Preferência de player da sala da Empire TV neste aparelho:
// "app" = player próprio (som com um toque), "kick" = player embutido da Kick.
// Padrão: "app". Sem armazenamento disponível, vale o padrão.
const CHAVE = "tvPlayerModo";

export type TvPlayerModo = "app" | "kick";

export function lerPlayerModo(): TvPlayerModo {
  try {
    return window.localStorage.getItem(CHAVE) === "kick" ? "kick" : "app";
  } catch {
    return "app";
  }
}

export function gravarPlayerModo(modo: TvPlayerModo): void {
  try {
    window.localStorage.setItem(CHAVE, modo);
  } catch {
    /* sem armazenamento: vale só nesta tela */
  }
}
