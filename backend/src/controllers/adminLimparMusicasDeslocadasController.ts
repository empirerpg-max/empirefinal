import { googleSheetsService, normalizeText } from "../services/googleSheetsService";

// Limpeza das linhas de "Musicas" que o :append deixou deslocadas de
// coluna (ver gravarLinhaMusicasNaPosicao em gestaoController.ts — caso
// Peter Johnson, "Road Of Fallin'", 2026-11-13). Cada tentativa de
// lançamento que falhava na releitura de confirmação deixava uma linha
// com a coluna H (Nome) vazia e o conteúdo jogado mais à direita.
//
// Critério bem restrito, pra nunca pegar linha legítima:
//   - coluna H vazia; E
//   - coluna B NÃO é um ID de tópico de música (linha legítima tem); E
//   - algum OUTRO lugar da linha tem um ID no formato exato gerado por
//     createSongController/processarFaixasDoAlbum (musica_<13 dígitos>_<6>)
//     — é a assinatura de uma linha nossa que caiu fora de posição.
//
// Regra do usuário pra limpeza de planilha (ver
// adminLimparFolliaDuplicadosController): NUNCA excluir linha — só
// ESVAZIAR as células, preservando a posição.
//
// ?dryRun=1 só lista o que seria limpo, sem gravar nada.
// GET /api/empire-play/admin/limpar-musicas-deslocadas?dryRun=1
const ID_MUSICA = /^musica_\d{13}_[a-z0-9]{6}$/;

export async function adminLimparMusicasDeslocadasController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const dryRun = url.searchParams.get("dryRun") === "1";

  const rows = await googleSheetsService.principal.readValuesFresh("Musicas");
  const deslocadas: {
    linha: number;
    colunaDoId: number;
    id: string;
    celulas: { col: number; valor: string }[];
  }[] = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] || [];
    if (normalizeText(row[7])) continue;
    if (ID_MUSICA.test(normalizeText(row[1]))) continue;
    const colunaDoId = row.findIndex((c, idx) => idx !== 1 && ID_MUSICA.test(normalizeText(c)));
    if (colunaDoId < 0) continue;
    const celulas: { col: number; valor: string }[] = [];
    row.forEach((c, col) => {
      const v = normalizeText(c);
      if (v) celulas.push({ col, valor: v.length > 80 ? `${v.slice(0, 80)}…` : v });
    });
    deslocadas.push({ linha: i + 1, colunaDoId, id: normalizeText(row[colunaDoId]), celulas });
  }

  let limpas = 0;
  if (!dryRun && deslocadas.length > 0) {
    const ok = await googleSheetsService.principal.updateValuesBatch(
      deslocadas.map((d) => {
        const largura = (rows[d.linha - 1] || []).length;
        return {
          sheetName: "Musicas",
          range: `A${d.linha}`,
          values: [Array.from({ length: largura }, () => "")],
        };
      }),
    );
    if (!ok) {
      return new Response(
        JSON.stringify(
          { success: false, error: "Falha ao esvaziar as linhas (batchUpdate).", deslocadas },
          null,
          2,
        ),
        { status: 500, headers: { "Content-Type": "application/json; charset=utf-8" } },
      );
    }
    limpas = deslocadas.length;
  }

  return new Response(
    JSON.stringify(
      {
        success: true,
        dryRun,
        totalLinhas: rows.length,
        encontradas: deslocadas.length,
        limpas,
        deslocadas,
      },
      null,
      2,
    ),
    { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
}
