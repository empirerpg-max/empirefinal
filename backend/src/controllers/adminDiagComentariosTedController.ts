import { googleSheetsService } from "../services/googleSheetsService";

// Diagnóstico read-only: dump cru (linha + array de colunas) de
// Comentarios_Musicas pra qualquer linha cujo texto contenha um dos
// termos de busca — usado pra achar os comentários do tópico de TED
// ("nostalgic traveller") sem confiar que a coluna A seja mesmo o
// topicId (o limpar-comentarios-ted?dryRun=1 voltou 0 resultados
// buscando por coluna A === topicId, então a suposição de layout de
// coluna pode estar errada pra essas linhas específicas).
//
// GET /api/empire-play/admin/diagnostico-comentarios-ted
export async function adminDiagComentariosTedController(): Promise<Response> {
  const termos = ["teste típico ted", "teddd, meu amor", "nostalgic traveller", "63282h"];
  const rows = await googleSheetsService.principal.readValues("Comentarios_Musicas").catch(() => []);
  const achadas: Record<string, unknown>[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    const linhaTexto = row.join(" | ").toLowerCase();
    if (termos.some((t) => linhaTexto.includes(t))) {
      achadas.push({ linha: i + 1, row });
    }
  }
  return new Response(JSON.stringify({ success: true, achadas, totalLinhas: rows.length - 1 }, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
