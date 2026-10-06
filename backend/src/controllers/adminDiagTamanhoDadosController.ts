import { googleSheetsService } from "../services/googleSheetsService";

// Diagnóstico pontual (só leitura): mede o volume real de dado (linhas +
// bytes aproximados em UTF-8) de cada aba que entraria no Empire Catálogo
// se migrado pra um banco de verdade (Cloudflare D1) — pra decidir com
// número real, não estimativa, se cabe tranquilo no limite gratuito (5GB).
const ALVOS: { sheet: string; label: string }[] = [
  { sheet: "Musicas", label: "Músicas" },
  { sheet: "Music Videos", label: "Vídeos (Music Videos)" },
  { sheet: "Albuns", label: "Álbuns" },
  { sheet: "Comentarios_Musicas", label: "Comentários (Músicas)" },
  { sheet: "Comentarios_MV", label: "Comentários (Vídeos)" },
  { sheet: "Comentarios_Albuns", label: "Comentários (Álbuns)" },
];

function bytesUtf8(s: string): number {
  // TextEncoder não existe no worker runtime? Existe sim (Web APIs padrão).
  return new TextEncoder().encode(s).length;
}

export async function adminDiagTamanhoDadosController(): Promise<Response> {
  const resultados = await Promise.all(
    ALVOS.map(async ({ sheet, label }) => {
      try {
        const rows = await googleSheetsService.principal.readValues(sheet);
        const totalLinhas = Math.max(0, rows.length - 1);
        let totalBytes = 0;
        for (const row of rows) {
          for (const cell of row) {
            if (cell) totalBytes += bytesUtf8(String(cell));
          }
        }
        return {
          aba: label,
          sheet,
          totalLinhas,
          totalColunas: rows[0]?.length || 0,
          bytesConteudoTexto: totalBytes,
          mbConteudoTexto: Number((totalBytes / (1024 * 1024)).toFixed(3)),
        };
      } catch (err: any) {
        return { aba: label, sheet, erro: err?.message || String(err) };
      }
    }),
  );

  const totalBytesGeral = resultados.reduce(
    (acc, r: any) => acc + (typeof r.bytesConteudoTexto === "number" ? r.bytesConteudoTexto : 0),
    0,
  );
  const totalLinhasGeral = resultados.reduce(
    (acc, r: any) => acc + (typeof r.totalLinhas === "number" ? r.totalLinhas : 0),
    0,
  );

  return new Response(
    JSON.stringify(
      {
        success: true,
        // Soma só o texto cru das células (o que viraria linha/coluna no
        // D1) — SQLite/D1 adiciona overhead de índice/estrutura por cima
        // disso (tipicamente 20-60% a mais, dependendo de quantos índices),
        // então o "real" fica um pouco acima do "mbConteudoTextoTotal".
        mbConteudoTextoTotal: Number((totalBytesGeral / (1024 * 1024)).toFixed(3)),
        totalLinhasGeral,
        limiteGratuitoD1Mb: 5 * 1024,
        porAba: resultados,
      },
      null,
      2,
    ),
    { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
}
