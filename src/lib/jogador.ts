import type { LoginResult } from "@/components/LoginScreen";

/** Quem está usando o app agora (só o que as telas precisam para decidir). */
export type Jogador = { id: string; usuario: string; tipoPerfil?: string };

/**
 * Puro: o login salvo (aba Usuários) vem primeiro; sem login, o id do
 * `useTelegramUser` (compatibilidade com as telas de hoje, que caem nele);
 * sem nada, `null`. O visitante ("guest", fallback do `useTelegramUser`)
 * não conta como jogador.
 */
export function jogadorAtual(login: LoginResult | null, tgUserId?: string): Jogador | null {
  if (login?.id) {
    return { id: String(login.id), usuario: login.usuario || "", tipoPerfil: login.tipoPerfil };
  }
  const id = tgUserId ? String(tgUserId) : "";
  if (!id || id === "guest") return null;
  return { id, usuario: "" };
}
