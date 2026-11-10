import { googleSheetsService } from "../services/googleSheetsService";

// Diagnóstico pontual (2026-11-10): o usuário reportou que faixas
// TRACKLIST ALBUM do Marco (migradas como pendentes via
// adminMigrarFaixasPendentesController) apareceram em "Lançamentos
// Recentes" sem ninguém ter clicado em publicar — suspeita de corrupção
// de coluna da PRIMEIRA tentativa da migração (appendRow bugado, já
// corrigido depois). Dump bruto das linhas inteiras (A:AE) de "Musicas"
// pra conferir coluna a coluna, sem passar pelo mapeamento normalizado de
// diagnosticoMusicaController (que só expõe os campos já interpretados).
//
// GET /api/gestao/admin/dump-linhas-musicas?linhas=836,837,838,839
export async function adminDumpLinhasMusicasController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const linhasParam = url.searchParams.get("linhas") || "";
  const linhas = linhasParam
    .split(",")
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n) && n > 1);

  if (linhas.length === 0) {
    return new Response(JSON.stringify({ success: false, error: "Informe ?linhas=836,837,838" }), {
      status: 400,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  const rows = await googleSheetsService.principal.readValues("Musicas", "A1:AE20000").catch(() => []);
  const header = rows[0] || [];
  const data = linhas.map((linha) => {
    const row = rows[linha - 1] || [];
    const porColuna: Record<string, string> = {};
    row.forEach((valor, idx) => {
      const letra = String.fromCharCode(65 + idx <= 90 ? 65 + idx : 65 + idx); // A..Z, AA+ não esperado aqui (só até AE=30)
      const col =
        idx < 26
          ? String.fromCharCode(65 + idx)
          : "A" + String.fromCharCode(65 + (idx - 26));
      porColuna[col] = valor;
    });
    return { linha, headerNaColuna: header[0] || "", porColuna, rowCru: row };
  });

  return new Response(JSON.stringify({ success: true, data }, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
