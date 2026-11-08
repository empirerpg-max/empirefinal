import { normalizeComparison } from "../services/googleSheetsService";
import { readAllCampanhas } from "./preSaveController";

// Só leitura. Dump completo (sem esconder tetoFinal, ao contrário das
// respostas públicas) de toda campanha de pre-save cujo artista bate com
// a busca — pra investigar relatos pontuais (post duplicado, missões não
// aparecendo) com o dado real, em vez de suposição.
//
// GET /api/empire-play/admin/diagnostico-presave-campanha-artista?artista=Samantha Cooper
export async function adminDiagPresaveCampanhaArtistaController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const alvo = normalizeComparison(url.searchParams.get("artista") || "");
  if (!alvo) {
    return new Response(JSON.stringify({ success: false, error: "artista é obrigatório." }), {
      status: 400,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  const campanhas = await readAllCampanhas();
  const achadas = campanhas.filter((c) => normalizeComparison(c.artista).includes(alvo));

  return new Response(JSON.stringify({ success: true, totalAchadas: achadas.length, achadas }, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
