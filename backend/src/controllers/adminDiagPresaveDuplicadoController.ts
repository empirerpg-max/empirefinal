import { googleSheetsService } from "../services/googleSheetsService";

// Só leitura. Investiga relato de álbum de pre-save "lançado várias
// vezes": lê a aba PreSave_Album inteira (status de cada campanha) e as
// últimas linhas de LOGS (logsSistema), que já registra toda falha de
// lançamento automático (ver processarLancamentosPreSaveScheduled).
export async function adminDiagPresaveDuplicadoController(): Promise<Response> {
  const presaveRows = await googleSheetsService.principal.readValues("PreSave_Album").catch(() => []);
  const logsRows = await googleSheetsService.logsSistema.readValues("LOGS").catch(() => []);

  const campanhas = presaveRows.slice(1).map((r, i) => ({
    linha: i + 2,
    albumTitulo: r[1] || "",
    dataLancamento: r[9] || "",
    status: r[12] || "",
  }));

  const ultimosLogs = logsRows.slice(-30);

  return new Response(
    JSON.stringify({ success: true, campanhas, ultimosLogs }, null, 2),
    { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
}
