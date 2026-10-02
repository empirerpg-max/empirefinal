import { googleSheetsService, normalizeText } from "../services/googleSheetsService";

// Conserto pontual (2026-10-02): linhas 239 e 240 de SOCIAL_POSTS (planilha
// usuarios) foram gravadas 3 colunas deslocadas pra direita (A:C vazio,
// dado real começa em D) pelo bug já corrigido em
// createSocialPostController (ver comentário em gravarPostSocial). Esse
// endpoint só re-realinha essas duas linhas específicas de volta pra A:M —
// não mexe em mais nada, e aborta sem escrever nada se o estado atual não
// bater exatamente com o esperado.
const SHEET = "SOCIAL_POSTS";
const LINHAS_DESLOCADAS = [239, 240];
const DESLOCAMENTO = 3; // dado real começa em D (índice 3), devia estar em A (índice 0)
const LARGURA = 13; // A..M

export async function adminFixSocialPostsShift3Controller(): Promise<Response> {
  const resultados: Record<string, unknown>[] = [];

  for (const linha of LINHAS_DESLOCADAS) {
    const cells = await googleSheetsService.usuarios.readValues(SHEET, `A${linha}:P${linha}`);
    const row = cells?.[0] || [];

    const aVazio = !normalizeText(row[0]) && !normalizeText(row[1]) && !normalizeText(row[2]);
    const idRealocado = normalizeText(row[DESLOCAMENTO]).startsWith("POST-");

    if (!aVazio || !idRealocado) {
      resultados.push({
        linha,
        aplicado: false,
        motivo: "Estado atual não bate com o esperado (A:C vazio + POST- em D) — abortado por segurança.",
        rowAtual: row,
      });
      continue;
    }

    const bloco = Array.from({ length: LARGURA }, (_, k) => row[DESLOCAMENTO + k] ?? "");
    await googleSheetsService.usuarios.updateValues(SHEET, `A${linha}:M${linha}`, [bloco]);

    // Limpa o que sobrou em N/O/P (onde a cauda do post deslocado tinha ido parar).
    await googleSheetsService.usuarios.updateValues(SHEET, `N${linha}:P${linha}`, [["", "", ""]]);

    resultados.push({ linha, aplicado: true, novoId: bloco[0] });
  }

  return new Response(JSON.stringify({ success: true, resultados }, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
