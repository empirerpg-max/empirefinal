import { readValues, updateValues, normalizeText, normalizeHeader } from "../services/googleSheetsService";

// Conserto pontual (não é rota de uso recorrente): a linha 437 da aba
// "Musicas" (planilha principal), "Boulangerie" / Rose Thompson, tinha o ID
// de arquivo de áudio errado — apontava pra uma música de outro artista
// completamente diferente ("Confidence Man & JADE - gossip"), e esse
// arquivo nem estava compartilhado com a conta que o app usa pra streaming
// (daí o "HTTP 404" reportado pelo jogador). Não existe um arquivo de áudio
// avulso certo pra essa faixa no Drive ainda — troca temporariamente pro
// vídeo oficial "Rose Thompson - Boulangerie.mp4" (já público, "qualquer
// pessoa com o link"), que pelo menos tem o áudio certo, até alguém extrair
// e subir um arquivo de áudio dedicado menor.
const SHEET = "Musicas";
const LINHA = 437; // confirmado pelo usuário
const ID_ANTIGO_ERRADO = "1gVSXeGjZpkxl9s97uwXe7pukI4qyzF54";
const NOVO_ARQUIVO_URL = "https://drive.google.com/file/d/1unv1-VuAg1cc4H2gMiZdgrk0t_As5N1f/view?usp=drivesdk";

export async function adminFixBoulangerieAudioController(): Promise<Response> {
  const rows = await readValues("principal", SHEET, "A:ZZ");
  const header = rows[0] || [];
  const row = rows[LINHA - 1];

  if (!row) {
    return new Response(
      JSON.stringify({ success: false, error: `Linha ${LINHA} não encontrada na aba ${SHEET}.` }),
      { status: 404, headers: { "Content-Type": "application/json; charset=utf-8" } },
    );
  }

  const colArquivoIdx = header.findIndex((h) => normalizeHeader(h) === "id_do_arquivo");
  if (colArquivoIdx < 0) {
    return new Response(
      JSON.stringify({ success: false, error: 'Coluna "ID do arquivo" não encontrada na aba Musicas.' }),
      { status: 500, headers: { "Content-Type": "application/json; charset=utf-8" } },
    );
  }

  const valorAtual = normalizeText(row[colArquivoIdx]);
  const titulo = normalizeText(row[header.findIndex((h) => normalizeHeader(h) === "nome_da_musica")] || "");
  const artista = normalizeText(row[header.findIndex((h) => normalizeHeader(h) === "act_principal")] || "");

  if (!valorAtual.includes(ID_ANTIGO_ERRADO)) {
    return new Response(
      JSON.stringify({
        success: false,
        error: "O valor atual da célula não é o ID quebrado esperado — abortado por segurança, nada foi alterado.",
        linha: LINHA,
        titulo,
        artista,
        valorAtual,
      }),
      { status: 409, headers: { "Content-Type": "application/json; charset=utf-8" } },
    );
  }

  const colunaLetra = String.fromCharCode(65 + colArquivoIdx);
  await updateValues("principal", SHEET, `${colunaLetra}${LINHA}`, [[NOVO_ARQUIVO_URL]]);

  return new Response(
    JSON.stringify({
      success: true,
      linha: LINHA,
      titulo,
      artista,
      valorAntigo: valorAtual,
      valorNovo: NOVO_ARQUIVO_URL,
    }),
    { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
}
