import { googleSheetsService, normalizeComparison, normalizeText } from "../services/googleSheetsService";

// Correção pontual: a música "Fuori Rotta" (Max Gorghan) está com a coluna
// "ID do tópico" (Musicas!B) vazia — por isso comentários antigos ficaram
// órfãos sob IDs velhos (ex: "musica_1788994568297_j04lhl") e o Fórum nunca
// consegue casar nada com ela, então a página sempre mostra "sem
// comentários" mesmo tendo comentários de verdade guardados. Reaproveita o
// ID mais recente e no formato correto encontrado entre os órfãos (ver
// diagnóstico via /api/empire-play/admin/fix-orphan-comments) em vez de
// gerar um novo, pra já religar os comentários existentes na sequência.
const TITULO_ALVO = "fuori rotta";
const TOPIC_ID_CORRETO = "musica_1788994568297_j04lhl";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

export async function adminFixFuoriRottaTopicoController(): Promise<Response> {
  const rows = await googleSheetsService.principal.readValues("Musicas").catch(() => []);
  const alvo = normalizeComparison(TITULO_ALVO);

  const encontradas: { linha: number; titulo: string; idAtual: string }[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const titulo = normalizeText(row[7] || "");
    if (!normalizeComparison(titulo).includes(alvo)) continue;
    encontradas.push({ linha: i + 1, titulo, idAtual: normalizeText(row[1] || "") });
  }

  if (encontradas.length === 0) {
    return jsonResponse({ success: false, error: "Nenhuma linha de 'Fuori Rotta' encontrada em Musicas." }, 404);
  }

  const resultados = [];
  for (const item of encontradas) {
    if (item.idAtual) {
      resultados.push({ ...item, acao: "ja_tinha_id", idFinal: item.idAtual });
      continue;
    }
    await googleSheetsService.principal.updateValues("Musicas", `B${item.linha}`, [[TOPIC_ID_CORRETO]]);
    resultados.push({ ...item, acao: "id_escrito", idFinal: TOPIC_ID_CORRETO });
  }

  return jsonResponse({ success: true, data: resultados });
}
