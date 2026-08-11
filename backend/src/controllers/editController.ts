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

// "Videos" não existe mais como aba própria — consolidada em "Music Videos".
const SHEET_NAMES: Record<EditCategory, string> = {
  musicas: "Musicas",
  videos: "Music Videos",
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
        // Coluna H = index 7 (Nome da música), Coluna D = index 3 (Capa),
        // Coluna N = index 13 (ACT PRINCIPAL)
        title = row[7] || row[1] || "";
        artist = row[13] || "";
        cover = row[3] || "";
      } else if (tipoParam === "videos" || tipoParam === "music-videos") {
        // Aba real é "Music Videos" (vinte colunas: A=ID do usuário,
        // B=Título do tópico, C=ID da mensagem original, D=chat_id,
        // E=chat_id_interno, F=message_thread_id, G=Link direto (t.me),
        // H=Tipo de vídeo, I=Descrição, J=Data do envio, K=fonte, L=ID da
        // mensagem duplicada, M=Link do vídeo, N=Likes, O=Média Likes,
        // P=Nome original, Q=ID da mensagem reconvertido, R=Status da
        // reconversão, S=Reportado em, T=Thumb). Título = Coluna B (index
        // 1), Descrição = Coluna I (index 8), Capa/Thumb = Coluna T (index
        // 19) — vira a capa/fundo do vídeo no catálogo. O artista fica
        // embutido no título ("Artista - Música").
        title = row[1] || row[0] || "";
        description = row[8] || "";
        cover = row[19] || "";
        const dashMatch = title.match(/^(.+?)\s[-–—]\s(.+)$/);
        if (dashMatch) artist = dashMatch[1].trim();
      } else if (tipoParam === "albuns") {
        // Coluna G = index 6 (Nome), Coluna F = index 5 (Nome do criador),
        // Coluna C = index 2 (Capa), Coluna B = index 1 (ID do tópico —
        // usado pra buscar/reordenar as faixas do álbum).
        title = row[6] || "";
        artist = row[5] || "";
        cover = row[2] || "";
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
          fields: tipoParam === "albuns" ? { topicId: normalizeText(row[1]) } : {},
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
      if (tipoClean === "videos" || tipoClean === "music-videos") {
        folderId = DRIVE_FOLDERS.musicVideos;
      }

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

      // Atualizar o novo título na planilha Edição Charts (1GPajSCp1TkJDEDOGZIrXxgZuNuRs7545buFntyDlpL8), aba EDIÇÃO CHARTS, Coluna A (MÚSICA)
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
                `A${eRowNumber}`,
                [[titulo.trim()]],
              );
              break;
            }
          }
        }
      } catch (errChart) {
        console.warn("[updateReleaseController] Aviso ao atualizar EDIÇÃO CHARTS:", errChart);
      }
    } else if (tipoClean === "videos" || tipoClean === "music-videos") {
      // Aba real é "Music Videos" — cabeçalho confirmado: ID do usuário,
      // Título do tópico, ID da mensagem [ORIGINAL do Telegram — nunca
      // sobrescrever, é a chave de streaming do vídeo], chat_id,
      // chat_id_interno, message_thread_id, Link direto (t.me), Tipo de
      // vídeo, Descrição, Data do envio, fonte, ID da mensagem [duplicada],
      // Link do vídeo, Likes por jogador, Média Likes, Nome original nos
      // charts, ID da mensagem reconvertido, Status da reconversão,
      // Reportado em, Thumb (Coluna T — vira a capa/fundo do vídeo).
      await googleSheetsService.principal.updateValues(sheetName, `B${rowIndex}`, [
        [titulo.trim()],
      ]);
      if (descricao !== undefined) {
        await googleSheetsService.principal.updateValues(sheetName, `I${rowIndex}`, [
          [descricao.trim()],
        ]);
      }
      if (finalCapaUrl && finalCapaUrl !== oldCapaUrl) {
        await googleSheetsService.principal.updateValues(sheetName, `T${rowIndex}`, [
          [finalCapaUrl],
        ]);
      }
    } else if (tipoClean === "albuns") {
      // Álbuns — cabeçalho real confirmado: Data de lançamento, ID do
      // tópico, Capa, Comentários para, ID do Criador, Nome do criador,
      // Nome, Metacritic por jogador, Média Metacritic, Encarte, Tipo.
      // Alterar Título (Coluna G = Nome) e Capa (Coluna C = Capa). B é o ID
      // do tópico e D é a referência de comentários — nunca sobrescrever.
      await googleSheetsService.principal.updateValues(sheetName, `G${rowIndex}`, [
        [titulo.trim()],
      ]);
      if (finalCapaUrl) {
        await googleSheetsService.principal.updateValues(sheetName, `C${rowIndex}`, [
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
