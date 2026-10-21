import { googleSheetsService, normalizeText } from "../services/googleSheetsService";

// Diagnóstico read-only: usuário identificou que as 10 faixas inéditas do
// FOLLIA (gravadas por adminFixFolliaFaixasController via
// processarFaixasDoAlbum -> appendRow("Musicas", ...)) caíram "colunas e
// colunas à frente" a partir da linha ~777 — o mesmo bug de
// deslocamento de coluna do :append do Sheets já documentado e corrigido
// pra "Albuns"/"EDIÇÃO CHARTS ÁLBUMS", mas que processarFaixasDoAlbum
// ainda não evita pra "Musicas". Dump bruto (sem range limitado) de uma
// faixa de linhas pra confirmar visualmente onde o conteúdo real caiu.
//
// GET /api/empire-play/admin/diagnostico-musicas-corruptas?inicio=770&fim=800
export async function adminDiagMusicasCorruptasController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const inicio = Number(url.searchParams.get("inicio") || "770");
  const fim = Number(url.searchParams.get("fim") || "800");

  const rows = await googleSheetsService.principal
    .readValues("Musicas", `A${inicio}:BZ${fim}`)
    .catch(() => []);

  const achadas = rows.map((row, i) => {
    const linha = inicio + i;
    // Índice da primeira célula preenchida e da última, pra visualizar o
    // "bloco" de dados de verdade na linha, onde quer que ele esteja.
    let primeiraPreenchida = -1;
    let ultimaPreenchida = -1;
    for (let c = 0; c < row.length; c++) {
      if (normalizeText(row[c])) {
        if (primeiraPreenchida < 0) primeiraPreenchida = c;
        ultimaPreenchida = c;
      }
    }
    return {
      linha,
      primeiraColunaPreenchida: primeiraPreenchida >= 0 ? primeiraPreenchida : null,
      ultimaColunaPreenchida: ultimaPreenchida >= 0 ? ultimaPreenchida : null,
      amostra: primeiraPreenchida >= 0 ? row.slice(primeiraPreenchida) : [],
    };
  });

  return new Response(JSON.stringify({ success: true, inicio, fim, achadas }, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
