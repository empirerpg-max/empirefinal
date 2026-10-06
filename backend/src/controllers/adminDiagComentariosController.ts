import { googleSheetsService, normalizeText } from "../services/googleSheetsService";

// Diagnóstico pontual (só leitura): confirma o layout REAL de colunas das 3
// abas de comentário (header + últimas linhas) antes de reescrever a
// gravação — e varre por linhas "empurradas" (coluna A vazia mas alguma
// outra coluna com texto), sintoma do bug de ancoragem do endpoint
// `:append` do Sheets (mesma causa raiz já corrigida em SOCIAL_POSTS).
// Também varre Musicas/Music Videos/Albuns por linhas sem "ID do tópico"
// estável ainda.
const COMENTARIOS_SHEETS = ["Comentarios_Musicas", "Comentarios_MV", "Comentarios_Albuns"];

export async function adminDiagComentariosController(): Promise<Response> {
  const [comMusicas, comMV, comAlbuns, musicas, musicVideos, albuns] = await Promise.all([
    googleSheetsService.principal.readValues("Comentarios_Musicas").catch(() => []),
    googleSheetsService.principal.readValues("Comentarios_MV").catch(() => []),
    googleSheetsService.principal.readValues("Comentarios_Albuns").catch(() => []),
    googleSheetsService.principal.readValues("Musicas", "A:AA").catch(() => []),
    googleSheetsService.principal.readValues("Music Videos", "A:T").catch(() => []),
    googleSheetsService.principal.readValues("Albuns", "A:L").catch(() => []),
  ]);

  const resumoComentarios = (rows: string[][], nome: string) => {
    const header = rows[0] || [];
    const total = Math.max(0, rows.length - 1);
    const amostraFinal = rows.slice(-5).map((r, i) => ({ linha: rows.length - 5 + i + 1, valores: r }));
    // Linha "empurrada": coluna A (índice 0) vazia mas alguma outra célula
    // da linha tem conteúdo — sintoma do bug de ancoragem do :append.
    const empurradas: { linha: number; valores: string[] }[] = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i] || [];
      const colAVazia = !normalizeText(row[0]);
      const temConteudoEmOutraColuna = row.slice(1).some((c) => normalizeText(c));
      if (colAVazia && temConteudoEmOutraColuna) {
        empurradas.push({ linha: i + 1, valores: row });
      }
    }
    return { aba: nome, header, totalLinhas: total, amostraFinal, linhasEmpurradas: empurradas };
  };

  const semIdTopico = (rows: string[][], nome: string, colId: number, colTitulo: number) => {
    const faltando: { linha: number; titulo: string }[] = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i] || [];
      // Linha totalmente vazia não conta.
      if (!row.some((c) => normalizeText(c))) continue;
      if (!normalizeText(row[colId])) {
        faltando.push({ linha: i + 1, titulo: normalizeText(row[colTitulo]).slice(0, 60) });
      }
    }
    return { aba: nome, totalSemId: faltando.length, exemplos: faltando.slice(0, 20) };
  };

  return new Response(
    JSON.stringify(
      {
        success: true,
        comentarios: [
          resumoComentarios(comMusicas, "Comentarios_Musicas"),
          resumoComentarios(comMV, "Comentarios_MV"),
          resumoComentarios(comAlbuns, "Comentarios_Albuns"),
        ],
        idsFaltando: [
          semIdTopico(musicas, "Musicas", 1, 7), // B ID do tópico, H Nome
          semIdTopico(musicVideos, "Music Videos", 5, 1), // F message_thread_id, B Título
          semIdTopico(albuns, "Albuns", 1, 6), // B ID do tópico, G Novo Nome
        ],
      },
      null,
      2,
    ),
    { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
}
