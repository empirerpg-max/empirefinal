import { googleSheetsService, normalizeHeader, normalizeText, dedupeHeaders } from "../services/googleSheetsService";

// Usuário reportou inconsistência geral no upload/exibição de foto de
// perfil — pede pra investigar com o jogador "Adriano" como exemplo
// concreto. Dump BRUTO (todas as colunas, todas as linhas que batem,
// inclusive duplicatas) da aba "Usuários" pra esse nome, pra ver
// exatamente o que está gravado (ou não) em cada linha antes de decidir
// o que corrigir.
//
// GET /api/empire-play/admin/diagnostico-foto-usuario?nome=Adriano
export async function adminDiagFotoUsuarioController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const nomeFiltro = (url.searchParams.get("nome") || "").toLowerCase();

  const rawRows = await googleSheetsService.usuarios.readValues("Usuários").catch(() => []);
  if (!rawRows || rawRows.length < 2) {
    return new Response(JSON.stringify({ success: false, error: "Aba Usuários vazia ou inacessível." }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
  const headers = dedupeHeaders(
    "Usuários",
    rawRows[0].map((h, i) => normalizeHeader(h) || `coluna_${i + 1}`),
  );

  const achadas: Record<string, unknown>[] = [];
  for (let i = 1; i < rawRows.length; i++) {
    const row = rawRows[i];
    if (!row) continue;
    const rec: Record<string, string> = {};
    headers.forEach((h, hi) => {
      rec[h] = normalizeText(row[hi]);
    });
    const usuario = (rec["usuario"] || rec["nome"] || "").toLowerCase();
    if (nomeFiltro && !usuario.includes(nomeFiltro)) continue;
    achadas.push({ linha: i + 1, rec });
  }

  return new Response(JSON.stringify({ success: true, headers, total: achadas.length, achadas }, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
