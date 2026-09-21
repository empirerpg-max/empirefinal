import { sheetsService } from "../services/sheetsService";
import { normalizeText } from "../services/googleSheetsService";

// Conserto único (não é rota de uso recorrente) dos clipes legados de
// vídeo cadastrados manualmente na aba "Music Videos" (ex: os 16 clipes
// antigos da Jessica, Código único ARQMV001-016, de antes do app existir).
// A aba "Music Videos" não tem coluna própria de artista — buildCleanItem
// (empirePlayController.ts) extrai artista+título direto de "Título do
// tópico", que precisa vir como "Artista - Título". Essas linhas foram
// gravadas só com o título puro ("Major Beat (Official Music Video)"),
// sem o prefixo do artista — o app caía no fallback "Artista
// Independente". Deriva o título certo a partir de "Nome original nos
// charts" (coluna já correta, "Artista - Título"), que também corrige de
// passagem um typo achado numa das linhas ("Tal Shit" → "Talk Shit").
export async function adminFixLegacyVideoTitlesController(): Promise<Response> {
  const rows = await sheetsService.readValues("Music Videos");
  const header = rows[0] || [];

  const colTitulo = header.findIndex((h) => normalizeText(h).toLowerCase().includes("título do tópico"));
  const colCodigo = header.findIndex((h) => normalizeText(h).toLowerCase().includes("código único"));
  const colNomeChart = header.findIndex((h) => normalizeText(h).toLowerCase().includes("nome original nos charts"));

  if (colTitulo < 0 || colCodigo < 0 || colNomeChart < 0) {
    return new Response(
      JSON.stringify({ success: false, error: "Colunas esperadas não encontradas na aba Music Videos." }),
      { status: 500, headers: { "Content-Type": "application/json; charset=utf-8" } },
    );
  }

  const resultados: any[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const codigo = (row[colCodigo] || "").trim();
    if (!codigo.startsWith("ARQMV")) continue;

    const tituloAtual = (row[colTitulo] || "").trim();
    const nomeChart = (row[colNomeChart] || "").trim();
    if (!nomeChart.includes(" - ")) {
      resultados.push({ linha: i + 1, codigo, ok: false, motivo: "Nome original nos charts sem 'Artista - Título'." });
      continue;
    }

    const sepIdx = nomeChart.indexOf(" - ");
    const artista = nomeChart.slice(0, sepIdx).trim();
    const tituloBase = nomeChart.slice(sepIdx + 3).trim();
    const sufixo = tituloAtual.match(/\s(\([^)]*\))\s*$/)?.[1] || "(Official Music Video)";
    const tituloNovo = `${artista} - ${tituloBase} ${sufixo}`;

    if (tituloNovo === tituloAtual) {
      resultados.push({ linha: i + 1, codigo, ok: false, motivo: "Já estava correto." });
      continue;
    }

    const colunaLetra = String.fromCharCode(65 + colTitulo);
    await sheetsService.updateValues("Music Videos", `${colunaLetra}${i + 1}`, [[tituloNovo]]);
    resultados.push({ linha: i + 1, codigo, ok: true, tituloAntigo: tituloAtual, tituloNovo });
  }

  return new Response(JSON.stringify({ success: true, resultados }), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
