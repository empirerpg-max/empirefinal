// Proteções em volta do lançamento em passos do pre-save: aviso ao admin
// quando um passo trava (e, na Task 9, bloqueio da Gestão em álbum que
// ainda está sendo completado).

export interface DepsAviso {
  push(title: string, body: string): Promise<void>;
  log(oQueAconteceu: string, detalhe: string): Promise<void>;
}

function depsAvisoReais(): DepsAviso {
  return {
    async push(title, body) {
      const { enviarPushParaUsuario } = await import("../../services/webPushService");
      const { ADMIN_TG_ID } = await import("../../services/sessionService");
      // Canal de preferência "comentario_forum" de propósito: um tipo novo de
      // notificação exigiria mexer no sininho do frontend (NotificationBell).
      await enviarPushParaUsuario(ADMIN_TG_ID, "comentario_forum", {
        title,
        body,
        url: "/catalogo",
        tag: `presave-travado-${body.slice(0, 40)}`,
      });
    },
    async log(oQueAconteceu, detalhe) {
      const { registrarLogSistema } = await import("../../services/logSistemaService");
      await registrarLogSistema({
        categoria: "Erro do app",
        oQueAconteceu,
        onde: "presaveLancamento/motor",
        causaProvavel: "Falha repetida do Google Sheets (cota/limite) ou dado inesperado na planilha.",
        comoResolver:
          "Veja o estado em /api/presave/admin/lancamento?campanhaId=... e, corrigida a causa, reabra com /api/gestao/admin/relancar-faixas-faltantes-presave?campanhaId=...&confirmar=1.",
        detalheTecnico: detalhe,
      });
    },
  };
}

/** Avisa o admin (push + LOGS) que um passo travou. Nunca lança. */
export async function avisarPassoTravado(
  c: { id: string; albumTituloFull: string },
  passo: string,
  erro: string,
  deps: DepsAviso = depsAvisoReais(),
): Promise<void> {
  const msg = `Pre-save "${c.albumTituloFull}" (${c.id}) travou no passo "${passo}" depois de várias tentativas.`;
  await deps.push("⚠️ Pre-save travado", msg).catch(() => {});
  await deps.log(msg, erro).catch(() => {});
}
