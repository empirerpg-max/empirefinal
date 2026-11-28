import { useEffect, useState } from "react";
import { getStoredLogin, isAdminLogin, type LoginResult } from "@/components/LoginScreen";
import { useTelegramUser } from "@/lib/telegram";
import { jogadorAtual, type Jogador } from "@/lib/jogador";

export { jogadorAtual, type Jogador };

/**
 * O jogador atual: login salvo primeiro, senão o id do `useTelegramUser`.
 * SSR-safe: o login só é lido em efeito (no servidor e no 1º render do
 * cliente `jogador` é `null`, sem divergir na hidratação).
 * `carregado` = já dá para confiar no resultado (login lido e, sem login,
 * o `useTelegramUser` terminou de procurar).
 */
export function useJogador(): { jogador: Jogador | null; carregado: boolean } {
  const { user, ready } = useTelegramUser();
  const [login, setLogin] = useState<LoginResult | null>(null);
  const [loginLido, setLoginLido] = useState(false);

  useEffect(() => {
    setLogin(getStoredLogin());
    setLoginLido(true);
  }, []);

  const jogador = loginLido ? jogadorAtual(login, user?.id ? String(user.id) : undefined) : null;
  const carregado = loginLido && (!!login?.id || ready);
  return { jogador, carregado };
}

/**
 * Critério único de admin (`isAdminLogin` de LoginScreen.tsx) aplicado ao
 * jogador atual. Sem jogador (SSR / antes de carregar / sem login) → false.
 * Só decide o que mostrar; o backend confere de novo pela sessão.
 */
export function useIsAdmin(): boolean {
  const { jogador } = useJogador();
  return jogador ? isAdminLogin(getStoredLogin(), jogador.id) : false;
}
