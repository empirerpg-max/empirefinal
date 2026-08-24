import { googleSheetsService, normalizeText, normalizeComparison } from "../services/googleSheetsService";

// Projetos de Cinema/TV do artista — aba "Projetos" na planilha usuarios
// (mesmo padrão de DADOS_TOUR/CONTROLE_TOURS em tourController.ts).
// Colunas: A artista | B tipo | C titulo | D status | E data | F detalhe
const PROJETOS_SHEET = "Projetos";

interface ProjetoRow {
  tipo: string;
  titulo: string;
  status: string;
  data?: string;
  detalhe?: string;
}

function rowToProjeto(row: string[]): ProjetoRow {
  return {
    tipo: normalizeText(row[1]),
    titulo: normalizeText(row[2]),
    status: normalizeText(row[3]),
    data: normalizeText(row[4]) || undefined,
    detalhe: normalizeText(row[5]) || undefined,
  };
}

// GET /api/projetos?artista=Nome — lista os projetos de Cinema/TV do artista.
export async function getProjetosController(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const artista = normalizeComparison(url.searchParams.get("artista") || "");
    if (!artista) {
      return new Response(JSON.stringify({ success: false, error: "Parâmetro 'artista' é obrigatório." }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const rows = await googleSheetsService.usuarios.readValues(PROJETOS_SHEET).catch(() => []);
    const projetos = rows
      .slice(1)
      .filter((row) => normalizeComparison(row[0]) === artista)
      .map(rowToProjeto)
      .filter((p) => p.titulo);

    return new Response(JSON.stringify({ success: true, data: projetos }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("[getProjetosController] Erro:", err);
    return new Response(
      JSON.stringify({ success: false, error: err.message || "Falha ao carregar projetos." }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}
