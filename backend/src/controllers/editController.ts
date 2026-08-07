import {
  googleSheetsService,
  normalizeComparison,
  normalizeText,
} from "../services/googleSheetsService";
import {
  DRIVE_FOLDERS,
  uploadFileToDrive,
  deleteFileFromDrive,
} from "../services/googleDriveService";

export type EditCategory = "musicas" | "videos" | "music-videos" | "albuns";

export interface ReleaseToEdit {
  id: string;
  rowIndex: number;
  tipo: EditCategory;
  titulo: string;
  artista: string;
  descricao?: string;
  capaUrl?: string;
  fields: Record<string, string>;
}

const SHEET_NAMES: Record<EditCategory, string> = {
  musicas: "Musicas",
  videos: "Videos",
  "music-videos": "Music Videos",
  albuns: "Albuns",
};

/**
  GET /api/editar?artist=Taylor+Swift&tipo=musicas
  Lista os lançamentos do artista fornecido na categoria especificada.
 */
export async function getReleasesForEditController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const artistParam = url.searchParams.get("artist") || url.searchParams.get("artista") || "";
  const tipoParam = (url.searchParams.get("tipo") || "musicas").toLowerCase() as EditCategory;

  if (!artistParam) {
    return new Response(
      JSON.stringify({ success: false, error: "Parâmetro 'artist' é obrigatório." }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const sheetName = SHEET_NAMES[tipoParam] || "Musicas";
  const normArtist = normalizeComparison(artistParam);

  try {
    const rawRows = await googleSheetsService.principal.readValues(sheetName);
    if (rawRows.length < 2) {
      return new Response(JSON.stringify({ success: true, data: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    const headers = rawRows[0].map((h) => normalizeComparison(h));
    const items: ReleaseToEdit[] = [];

    // Iterar pelas linhas de dados (a partir da linha 2 = index 1)
    for (let i = 1; i < rawRows.length; i++) {
      const row = rawRows[i];
      const rowIndex = i + 1; // 1-based index na planilha

      // Mapear campos baseados no tipo
      let title = "";
      let artist = "";
      let description = "";
      let cover = "";

      if (tipoParam === "musicas") {
        // Coluna H = index 7 (Título), Artista = index 2 ou busca por header
        title = row[7] || row[1] || "";
        artist = row[2] || row[1] || "";
        cover = row[7] || row[8] || ""; // Capa se houver
      } else if (tipoParam === "videos") {
        // Coluna G = index 6 (Título), Coluna M = index 12 (Descrição)
        title = row[6] || row[0] || "";
        artist = row[1] || row[2] || "";
        description = row[12] || "";
      } else if (tipoParam === "music-videos") {
        // Coluna C = index 2 (Título), Coluna N = index 13 (Descrição), Coluna J = index 9 (Thumb/Capa)
        title = row[2] || row[0] || "";
        artist = row[1] || "";
        cover = row[9] || "";
        description = row[13] || "";
      } else if (tipoParam === "albuns") {
        // Coluna B = index 1 (Título/Artista - Álbum), Coluna C = index 2 (Artista), Coluna D = index 3 (Capa)
        title = row[1] || "";
        artist = row[2] || row[1] || "";
        cover = row[3] || "";
      }

      // fallback de busca por headers se disponível
      if (!artist) {
        const artIdx = headers.findIndex((h) => h.includes("artista") || h.includes("act"));
        if (artIdx >= 0) artist = row[artIdx] || "";
      }
      if (!title) {
        const titIdx = headers.findIndex((h) => h.includes("titulo") || h.includes("nome"));
        if (titIdx >= 0) title = row[titIdx] || "";
      }

      const rowText = row.join(" ");
      const normRowText = normalizeComparison(rowText);
      const normArtistField = normalizeComparison(artist);

      // Verificar se o artista bate
      if (normArtistField.includes(normArtist) || normRowText.includes(normArtist)) {
        items.push({
          id: `${tipoParam}_${rowIndex}`,
          rowIndex,
          tipo: tipoParam,
          titulo: normalizeText(title),
          artista: normalizeText(artist),
          descricao: normalizeText(description),
          capaUrl: normalizeText(cover),
          fields: {},
        });
      }
    }

    return new Response(JSON.stringify({ success: true, data: items }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(
      JSON.stringify({ success: false, error: err.message || "Erro ao buscar lançamentos." }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}

/**
  PUT /api/editar
  Atualiza um lançamento existente conforme especificações do projeto.
 */
export async function updateReleaseController(request: Request): Promise<Response> {
  try {
    const body = await request.json();
    const {
      tipo,
      rowIndex,
      titulo,
      descricao,
      artista,
      capaBase64,
      capaMimeType,
      oldCapaUrl,
      oldTitulo,
    } = body;

    const tipoClean = (tipo || "musicas").toLowerCase() as EditCategory;
    const sheetName = SHEET_NAMES[tipoClean];

    if (!sheetName || !rowIndex || !titulo) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Campos 'tipo', 'rowIndex' e 'titulo' são obrigatórios.",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    let finalCapaUrl = oldCapaUrl || "";

    // 1. Processar Upload de Nova Capa se fornecida Base64
    if (capaBase64) {
      if (oldCapaUrl) {
        await deleteFileFromDrive(oldCapaUrl);
      }

      let folderId: string = DRIVE_FOLDERS.musicas;
      if (tipoClean === "albuns") folderId = DRIVE_FOLDERS.albuns;
      if (tipoClean === "music-videos") folderId = DRIVE_FOLDERS.musicVideos;

      const fileName = `${artista || "Artista"} - ${titulo.trim()} (EDITADO)`;
      finalCapaUrl = await uploadFileToDrive(
        fileName,
        folderId,
        capaMimeType || "image/jpeg",
        capaBase64,
      );
    }

    // 2. Atualizar Planilhas conforme Requisitos
    if (tipoClean === "musicas") {
      // Músicas:
      // Alterar Título na Coluna H (Col 8) da aba Musicas na planilha principal (1XYa6Pzd-lou3fzqaZgjhBYNb3Je2PB9Slu7ozzOghUo)
      await googleSheetsService.principal.updateValues(sheetName, `H${rowIndex}`, [
        [titulo.trim()],
      ]);

      // Se houver capa nova, atualizar também na Coluna I (Col 9) ou H se aplicável
      if (finalCapaUrl && finalCapaUrl !== oldCapaUrl) {
        await googleSheetsService.principal.updateValues(sheetName, `I${rowIndex}`, [
          [finalCapaUrl],
        ]);
      }

      // Atualizar o novo título na planilha Edição Charts (1GPajSCp1TkJDEDOGZIrXxgZuNuRs7545buFntyDlpL8), aba EDIÇÃO CHARTS, Coluna B
      try {
        const edicaoRows = await googleSheetsService.edicaoCharts.readValues("EDIÇÃO CHARTS");
        if (edicaoRows.length > 1) {
          const normTarget = normalizeComparison(oldTitulo || titulo);
          for (let eIdx = 1; eIdx < edicaoRows.length; eIdx++) {
            const eRowStr = normalizeComparison(edicaoRows[eIdx].join(" "));
            if (eRowStr.includes(normTarget)) {
              const eRowNumber = eIdx + 1;
              await googleSheetsService.edicaoCharts.updateValues(
                "EDIÇÃO CHARTS",
                `B${eRowNumber}`,
                [[titulo.trim()]],
              );
              break;
            }
          }
        }
      } catch (errChart) {
        console.warn("[updateReleaseController] Aviso ao atualizar EDIÇÃO CHARTS:", errChart);
      }
    } else if (tipoClean === "videos") {
      // Vídeos:
      // Alterar Título (Coluna G = Col 7) e Descrição (Coluna M = Col 13)
      await googleSheetsService.principal.updateValues(sheetName, `G${rowIndex}`, [
        [titulo.trim()],
      ]);
      if (descricao !== undefined) {
        await googleSheetsService.principal.updateValues(sheetName, `M${rowIndex}`, [
          [descricao.trim()],
        ]);
      }
    } else if (tipoClean === "music-videos") {
      // Music Videos:
      // Alterar Título (Coluna C = Col 3), Descrição (Coluna N = Col 14) e Thumb/Imagem (Coluna J = Col 10) na pasta Drive 1Jk9Jk-Zd6QAoZnW3nAqFhBiJCNAnw3wR
      await googleSheetsService.principal.updateValues(sheetName, `C${rowIndex}`, [
        [titulo.trim()],
      ]);
      if (descricao !== undefined) {
        await googleSheetsService.principal.updateValues(sheetName, `N${rowIndex}`, [
          [descricao.trim()],
        ]);
      }
      if (finalCapaUrl) {
        await googleSheetsService.principal.updateValues(sheetName, `J${rowIndex}`, [
          [finalCapaUrl],
        ]);
      }
    } else if (tipoClean === "albuns") {
      // Álbuns:
      // Alterar Título (Coluna B = Col 2) e Capa (Coluna D = Col 4)
      await googleSheetsService.principal.updateValues(sheetName, `B${rowIndex}`, [
        [titulo.trim()],
      ]);
      if (finalCapaUrl) {
        await googleSheetsService.principal.updateValues(sheetName, `D${rowIndex}`, [
          [finalCapaUrl],
        ]);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: "Lançamento atualizado com sucesso!",
        capaUrl: finalCapaUrl,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ success: false, error: err.message || "Erro ao atualizar lançamento." }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}
