import { useEffect } from "react";
import { api } from "@/lib/api";
import { ColetorMinutos } from "@/lib/tvPresencaCliente";
import { getStoredLogin, getStoredSessionToken } from "@/components/LoginScreen";

const MARCAR_A_CADA_MS = 60_000;
const ENVIAR_A_CADA_MS = 5 * 60_000;

/**
 * Conta a presença na Empire TV enquanto há transmissão aberta — na sala
 * (tela cheia) OU no mini player flutuante, já que os dois vivem dentro do
 * TvPlayerProvider. Com a aba visível, marca o minuto a cada 60 s; envia as
 * marcas a cada 5 min, ao esconder a aba e no pagehide. Trocar de programa
 * envia o que estava pendente do anterior antes de começar o novo.
 * Montado pelo próprio TvPlayerProvider, que passa o `watching` atual.
 * Não desenha nada.
 */
export function PresencaTVTracker({ programaId }: { programaId: string | null }) {
  useEffect(() => {
    if (!programaId || typeof document === "undefined") return;
    const coletor = new ColetorMinutos();
    let enviando = false;

    const identificado = () => !!(getStoredLogin()?.id || getStoredSessionToken());

    const marcar = () => {
      if (!document.hidden) coletor.marcar(Date.now());
    };

    /** `saindo`: a página/programa está indo embora — manda mesmo com envio em andamento. */
    const enviar = (saindo = false) => {
      if (!identificado()) return;
      if (enviando && !saindo) return;
      const idades = coletor.pendentes(Date.now());
      if (idades.length === 0) return;
      const nome = getStoredLogin()?.nome || "Anônimo";
      const envio = api.enviarMinutosPresenca(programaId, idades, nome);
      if (saindo) return; // sem confirmar: o servidor une os minutos, reenvio não duplica
      enviando = true;
      envio
        .then((ok) => {
          if (ok) coletor.confirmar();
        })
        .finally(() => {
          enviando = false;
        });
    };

    const onVisibilidade = () => {
      if (document.hidden) enviar();
      else marcar();
    };
    const onPagehide = () => enviar(true);

    marcar();
    const tMarcar = setInterval(marcar, MARCAR_A_CADA_MS);
    const tEnviar = setInterval(() => enviar(), ENVIAR_A_CADA_MS);
    document.addEventListener("visibilitychange", onVisibilidade);
    window.addEventListener("pagehide", onPagehide);

    return () => {
      clearInterval(tMarcar);
      clearInterval(tEnviar);
      document.removeEventListener("visibilitychange", onVisibilidade);
      window.removeEventListener("pagehide", onPagehide);
      // Troca de programa / fechou a transmissão: envia o pendente deste programa.
      enviar(true);
    };
  }, [programaId]);

  return null;
}
