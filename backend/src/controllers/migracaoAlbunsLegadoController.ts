import { googleSheetsService, normalizeComparison } from "../services/googleSheetsService";

// Migração pontual dos álbuns "legados" (planilha separada, materiais que já
// saíram dos charts) pro app: cria o tópico do álbum + uma linha pendente em
// Musicas por faixa, e grava o "Código único" (EMPALBM.../EMP...) de volta
// nas próprias abas SINGLES/ALBUMS da planilha legada, continuando a
// sequência já usada nas abas "vivas" (EDIÇÃO CHARTS / EDIÇÃO CHARTS
// ÁLBUMS). Rodada em lotes (offset/limit) pra não estourar o tempo de
// execução de uma request só — ver /api/debug/migrar-albuns-legado.

const CODIGO_HEADER = "Código único";

// Olha tanto a aba "viva" (EDIÇÃO CHARTS / EDIÇÃO CHARTS ÁLBUMS) quanto a
// legada (SINGLES/ALBUMS, já com os códigos que essa própria migração foi
// gravando em lotes anteriores) — nunca reaproveita número.
async function acharMaiorCodigo(prefixo: string): Promise<number> {
  const vivaSheet = prefixo === "EMPALBM" ? "EDIÇÃO CHARTS ÁLBUMS" : "EDIÇÃO CHARTS";
  const legadaSheet = prefixo === "EMPALBM" ? "ALBUMS" : "SINGLES";
  const [edicaoRows, legadaRows] = await Promise.all([
    googleSheetsService.edicaoCharts.readValues(vivaSheet, "A1:BZ5000").catch(() => []),
    googleSheetsService.saidosCharts.readValues(legadaSheet, "A1:BZ5000").catch(() => []),
  ]);
  let maior = 0;
  const re = new RegExp(`^${prefixo}(\\d+)$`, "i");
  const scan = (rows: string[][]) => {
    if (!rows.length) return;
    const headers = rows[0].map((h) => normalizeComparison(h));
    const col = headers.findIndex((h) => h.startsWith("codigo unico"));
    if (col < 0) return;
    for (let i = 1; i < rows.length; i++) {
      const m = (rows[i][col] || "").trim().match(re);
      if (m) maior = Math.max(maior, parseInt(m[1], 10));
    }
  };
  scan(edicaoRows);
  scan(legadaRows);
  return maior;
}

// Garante que a aba legada (SINGLES/ALBUMS) tem uma coluna "Código único"
// no fim — cria o cabeçalho só se ainda não existir. Devolve o índice
// (0-based) dessa coluna.
async function garantirColunaCodigo(sheetName: string, headerRow: string[]): Promise<number> {
  const headers = headerRow.map((h) => normalizeComparison(h));
  const existente = headers.findIndex((h) => h.startsWith("codigo unico"));
  if (existente >= 0) return existente;
  const novaColIndex = headerRow.length;
  const colLetter = colIndexToA1Letter(novaColIndex);
  await googleSheetsService.saidosCharts.updateValues(sheetName, `${colLetter}1`, [[CODIGO_HEADER]]);
  return novaColIndex;
}

function colIndexToA1Letter(colIndex: number): string {
  let temp = colIndex;
  let letter = "";
  while (temp >= 0) {
    letter = String.fromCharCode((temp % 26) + 65) + letter;
    temp = Math.floor(temp / 26) - 1;
  }
  return letter;
}

interface AlbumMigrado {
  nome: string;
  artista: string;
  faixas: number;
  status: "migrado" | "pulado_ja_existe" | "erro";
  erro?: string;
}

export async function migrarAlbunsLegadoController(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const offset = Math.max(0, parseInt(url.searchParams.get("offset") || "0", 10) || 0);
    const limit = Math.max(1, Math.min(20, parseInt(url.searchParams.get("limit") || "3", 10) || 3));
    // Pra rodar um teste com álbuns específicos (não os N primeiros por
    // posição) — nomes exatos separados por "|".
    const nomesAlvo = (url.searchParams.get("nomes") || "")
      .split("|")
      .map((n) => n.trim().toLowerCase())
      .filter(Boolean);

    const [albumsFull, singlesFull, albunsApp] = await Promise.all([
      googleSheetsService.saidosCharts.readValues("ALBUMS", "A1:BZ5000"),
      googleSheetsService.saidosCharts.readValues("SINGLES", "A1:BZ5000"),
      googleSheetsService.principal.readValues("Albuns", "A1:J5000"),
    ]);

    const albunsHeader = albumsFull[0] || [];
    const singlesHeader = singlesFull[0] || [];
    const albumsRows = albumsFull.slice(1);
    const singlesRows = singlesFull.slice(1);

    const albunsAppNomes = new Set(
      albunsApp.slice(1).map((r) => (r[6] || "").trim().toLowerCase()).filter(Boolean),
    );

    const codigoColAlbums = await garantirColunaCodigo("ALBUMS", albunsHeader);
    const codigoColSingles = await garantirColunaCodigo("SINGLES", singlesHeader);
    const colLetterAlbums = colIndexToA1Letter(codigoColAlbums);
    const colLetterSingles = colIndexToA1Letter(codigoColSingles);

    let proximoAlbumNum = (await acharMaiorCodigo("EMPALBM")) + 1;
    let proximoMusicaNum = (await acharMaiorCodigo("EMP")) + 1;

    const comIndice = albumsRows.map((row, i) => ({ row, sheetRowIndex: i + 2 }));
    const lote =
      nomesAlvo.length > 0
        ? comIndice.filter(({ row }) => nomesAlvo.includes((row[3] || "").trim().toLowerCase()))
        : comIndice.slice(offset, offset + limit);
    const resultados: AlbumMigrado[] = [];

    for (const { row, sheetRowIndex } of lote) {
      const artista = (row[0] || "").trim();
      const nome = (row[3] || "").trim();
      const data = (row[1] || "").trim();
      if (!nome) continue;

      if (albunsAppNomes.has(nome.toLowerCase())) {
        resultados.push({ nome, artista, faixas: 0, status: "pulado_ja_existe" });
        continue;
      }

      try {
        const faixasDoAlbum = singlesRows
          .map((r, i) => ({ r, rowIndex: i + 2 }))
          .filter(({ r }) => (r[5] || "").trim() === nome);

        const tipoAlbum = faixasDoAlbum.length > 0 && faixasDoAlbum.length <= 6 ? "EP" : "Álbum";
        const albumTopicId = `album_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const codigoAlbum = `EMPALBM${String(proximoAlbumNum).padStart(3, "0")}`;
        proximoAlbumNum++;

        // 1. Tópico do álbum em Albuns (principal) — sem jogador dono real
        // (é migração, não lançamento de ninguém); capa fica vazia até o
        // dono do artista editar.
        await googleSheetsService.principal.appendRow("Albuns", [
          data || "", // A - Data de lançamento
          albumTopicId, // B - ID do tópico
          "", // C - Capa
          albumTopicId, // D - Comentários para
          "", // E - ID do Criador
          "Migração", // F - Nome do criador
          nome, // G - Nome (Artista - Título)
          "", // H - Metacritic por jogador
          "", // I - Média Metacritic
          "", // J - Encarte
          tipoAlbum, // K - Tipo
        ]);

        // 2. Uma linha pendente em Musicas por faixa, na ordem em que
        // aparecem na planilha legada.
        let ordem = 1;
        for (const { r: single, rowIndex } of faixasDoAlbum) {
          const tituloFaixa = (single[3] || "").trim();
          const artistaFaixa = (single[0] || "").trim() || artista;
          const tipoSingle = (single[1] || "").trim() || "TRACKLIST ALBUM";
          const artistas2a5 = [single[13], single[14], single[15], single[16]]
            .map((v) => (v || "").trim())
            .filter(Boolean);
          const tipoMusica = artistas2a5.length > 0 ? "PARCERIA" : "SOLO";
          const codigoMusica = `EMP${String(proximoMusicaNum).padStart(3, "0")}`;
          proximoMusicaNum++;

          await googleSheetsService.principal.appendRow("Musicas", [
            data || "", // A - Data
            "", // B - ID do tópico (pendente)
            "", // C - ID do arquivo
            "", // D - Capa
            "", // E - Letra
            "", // F - Comentários para
            "", // G - ID do Criador
            tituloFaixa, // H - Nome da música
            tipoSingle, // I - TIPO DE SINGLE
            tipoMusica, // J - TIPO DE MÚSICA
            nome, // K - ALBUM
            "", // L - WEEKS
            "", // M - WEEKS VIDEO
            artistaFaixa, // N - ACT PRINCIPAL
            artistas2a5[0] || "", // O - ARTISTA 2
            artistas2a5[1] || "", // P - ARTISTA 3
            artistas2a5[2] || "", // Q - ARTISTA 4
            artistas2a5[3] || "", // R - ARTISTA 5
            "", // S - ARTISTA 6
            "", // T - GÊNERO
            String(ordem), // U - Ordem
            "", // V - Metacritic por jogador
            "", // W - Média Metacritic
            "Sim", // X - Pendente?
            "", // Y - Referência
          ]);
          ordem++;

          await googleSheetsService.saidosCharts.updateValues(
            "SINGLES",
            `${colLetterSingles}${rowIndex}`,
            [[codigoMusica]],
          );
        }

        await googleSheetsService.saidosCharts.updateValues(
          "ALBUMS",
          `${colLetterAlbums}${sheetRowIndex}`,
          [[codigoAlbum]],
        );

        resultados.push({ nome, artista, faixas: faixasDoAlbum.length, status: "migrado" });
      } catch (err: any) {
        resultados.push({ nome, artista, faixas: 0, status: "erro", erro: err?.message || String(err) });
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        data: {
          totalAlbuns: albumsRows.length,
          offset,
          limit,
          proximoOffset: offset + limit,
          temMais: offset + limit < albumsRows.length,
          resultados,
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (error: any) {
    console.error("[migrarAlbunsLegadoController] Erro:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message || "Erro na migração." }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}
