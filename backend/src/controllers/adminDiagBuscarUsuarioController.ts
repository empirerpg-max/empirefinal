import { googleSheetsService, normalizeComparison, normalizeText } from "../services/googleSheetsService";

// Busca por substring (case/acento-insensível) na aba Usuários — usado pra
// achar o "usuario" exato de alguém quando o admin-impersonar diz "não
// encontrado" (o campo usado no login é a coluna "Usuário", que pode ser
// diferente do nome exibido/apelido que o admin tem em mente).
//
// GET /api/empire-play/admin/diagnostico-buscar-usuario?q=delyrance
export async function adminDiagBuscarUsuarioController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const q = normalizeComparison(url.searchParams.get("q") || "");
  if (!q) {
    return new Response(JSON.stringify({ success: false, error: "q é obrigatório." }), {
      status: 400,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  const rows = await googleSheetsService.usuarios.readValues("Usuários");
  const header = rows[0] || [];
  const idxUsuario = header.findIndex((h) => normalizeComparison(h) === normalizeComparison("Usuário"));
  const idxNome = header.findIndex((h) => normalizeComparison(h) === normalizeComparison("Nome"));
  const idxId = header.findIndex((h) => normalizeComparison(h) === normalizeComparison("ID"));

  const achados = rows
    .slice(1)
    .map((row) => ({
      usuario: idxUsuario >= 0 ? normalizeText(row[idxUsuario]) : "",
      nome: idxNome >= 0 ? normalizeText(row[idxNome]) : "",
      id: idxId >= 0 ? normalizeText(row[idxId]) : "",
    }))
    .filter(
      (r) =>
        normalizeComparison(r.usuario).includes(q) ||
        normalizeComparison(r.nome).includes(q) ||
        normalizeComparison(r.id).includes(q),
    );

  return new Response(
    JSON.stringify({ success: true, colunas: { idxUsuario, idxNome, idxId }, total: achados.length, achados }, null, 2),
    { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
}
