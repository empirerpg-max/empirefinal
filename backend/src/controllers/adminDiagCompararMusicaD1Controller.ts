import { googleSheetsService, normalizeComparison, normalizeText } from "../services/googleSheetsService";
import { getCatalogoDb } from "../services/musicasDbService";

// Compara, lado a lado, o que está na planilha Musicas (fonte "ao vivo")
// com o que está na tabela `musicas` do D1 (mirror lido pelo Catálogo/
// Fórum) — pra uma música específica, por substring de título. Nenhuma
// escrita, só leitura.
//
// GET /api/empire-play/admin/diagnostico-comparar-musica-d1?q=Abaddon
export async function adminDiagCompararMusicaD1Controller(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const q = normalizeComparison(url.searchParams.get("q") || "");
  if (!q) {
    return new Response(JSON.stringify({ success: false, error: "q é obrigatório." }), {
      status: 400,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  // 1. Planilha Musicas (crua, direto da fonte).
  const rows = await googleSheetsService.principal.readValues("Musicas");
  const naPlanilha = rows
    .slice(1)
    .map((row, i) => ({
      linha: i + 2,
      H_nome: normalizeText(row[7]),
      K_album: normalizeText(row[10]),
      N_artista: normalizeText(row[13]),
      X_pendente: normalizeText(row[23]),
      B_idTopico: normalizeText(row[1]),
      F_comentariosPara: normalizeText(row[5]),
      Z_codigoUnico: normalizeText(row[25]),
      D_capa: normalizeText(row[3]),
    }))
    .filter((r) => normalizeComparison(r.H_nome).includes(q));

  // 2. Tabela `musicas` do D1 (o que Catálogo/Fórum de fato leem).
  const db = getCatalogoDb();
  let noD1: unknown[] = [];
  let d1Disponivel = !!db;
  if (db) {
    const result = await db
      .prepare("SELECT codigo_unico, id_topico, titulo, artista, album, capa_url, pendente, comentarios_para FROM musicas WHERE LOWER(titulo) LIKE ?")
      .bind(`%${q}%`)
      .all()
      .catch((err) => {
        d1Disponivel = false;
        console.warn("[adminDiagCompararMusicaD1Controller] Erro ao ler D1:", err);
        return { results: [] };
      });
    noD1 = (result as { results?: unknown[] })?.results || [];
  }

  return new Response(
    JSON.stringify({ success: true, d1Disponivel, naPlanilha, noD1 }, null, 2),
    { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
}
