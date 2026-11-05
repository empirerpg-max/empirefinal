import { googleSheetsService, normalizeComparison } from "../services/googleSheetsService";

// Corrige "IT'S OVER" (Samantha Cooper, EMP999): a música tem linha em
// EDIÇÃO CHARTS (codigoUnico EMP999, pendente, aparece nos charts) e tem
// dado completo acessível via D1/fórum (áudio, letra, comentários reais já
// recebidos) — mas NÃO TEM linha em "Musicas", a aba que alimenta o
// catálogo de verdade (Editar Lançamentos, Fórum via planilha). Causa
// provável: appendRow em Musicas "disse que gravou" (devolveu um número de
// linha, sem lançar erro) mas a linha não ficou lá de verdade — mesma
// classe de bug já blindada em appendRowMusicasSeguro/
// appendRowMusicasComCursor com uma releitura de confirmação (ver
// gestaoController.ts). Esse admin tool repara o caso específico já
// acontecido: recria a linha em Musicas com os dados reais (puxados do
// próprio tópico do fórum, que lê D1) e copia o Código único EMP999 pra
// Musicas!Z, igual createSongController faria numa criação normal.
//
// GET /api/gestao/admin/fix-its-over-musicas (dry-run) / ?confirmar=1
export async function adminFixItsOverMusicasController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const confirmar = url.searchParams.get("confirmar") === "1";
  const CODIGO = "emp999";
  const TOPIC_ID = "musica_1793844310095_u4hhzr";
  const TITULO_COMPLETO = "Samantha Cooper - IT’S OVER";

  // Confere que a linha realmente não existe em Musicas antes de criar
  // qualquer coisa — nunca duplica se alguém já tiver corrigido isso.
  const musicasRows = await googleSheetsService.principal.readValues("Musicas").catch(() => []);
  for (let i = 1; i < musicasRows.length; i++) {
    const row = musicasRows[i];
    if (normalizeComparison(row[25] || "") === CODIGO || (row[1] || "").trim() === TOPIC_ID) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `Já existe linha em Musicas pra EMP999 (linha ${i + 1}) — nada a corrigir.`,
        }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }
  }

  // Confere a linha real em EDIÇÃO CHARTS pra reaproveitar os dados
  // (data, tipo de single) em vez de inventar.
  const chartsRows = await googleSheetsService.edicaoCharts.readValues("EDIÇÃO CHARTS").catch(() => []);
  const chartsLinha = chartsRows.slice(1).find((r) => normalizeComparison(r[55] || "") === CODIGO);
  if (!chartsLinha) {
    return new Response(
      JSON.stringify({ success: false, error: "Linha EMP999 não encontrada em EDIÇÃO CHARTS." }),
      { status: 404, headers: { "Content-Type": "application/json" } },
    );
  }
  const dataFormatada = chartsLinha[0] || "";
  const tipoSingle = chartsLinha[2] || "PRÉ-ALBUM";
  const tipoMusica = chartsLinha[3] || "SOLO";

  // Áudio/letra/capa reais — mesmos dados já confirmados via fórum (que lê
  // D1, onde a música sempre existiu certinha).
  const AUDIO_URL = "https://drive.google.com/file/d/1Ud4oSZBaBcpkA6U_5t4_IP9NgGX9NN4e/view?usp=drivesdk";
  const CAPA_URL = "https://drive.google.com/file/d/1hkLwmJO177FqhV6jLcNKiAdYF7kc2IL-/view?usp=drivesdk";
  const LETRA =
    "Se você quiser\nPodemos adiar mais uma vez essa conversa\nMas não posso\nContinuar procurando o que perdemos de verdade\n\nIsso me quebra\nAgir como se não faltassem cobranças\nContinuar apoiando tudo apenas em lembranças\nMesmo que no fim de tudo seja só mais uma mudança\n\nEu acho que chegou a hora de aceitar que acabou, que acabou\nUh uh, uh uh\nEu acho que chegou a hora de aceitar que acabou, que acabou\nUh uh, uh uh\n\nAcho que fugimos mais do que deveríamos\nE conversamos menos do que poderíamos\nMas agora… uh uh\nEu acho que chegou a hora de aceitar que acabou, que acabou\nUh uh, uh uh\n\nEu prometo\nEstar aqui sempre que precisar de um sorriso\nE eu sei\nQue estará aqui sempre que eu precisar limpar uma lágrima\n\nIsso me quebra\nAgir como se não faltassem cobranças\nContinuar apoiando tudo apenas em lembranças\nMesmo que no fim de tudo seja só mais uma mudança\n\nEu acho que chegou a hora de aceitar que acabou, que acabou\nUh uh, uh uh\nEu acho que chegou a hora de aceitar que acabou, que acabou\nUh uh, uh uh\n\nAcho que fugimos mais do que deveríamos\nE conversamos menos do que poderíamos\nMas agora… uh uh\nEu acho que chegou a hora de aceitar que acabou, que acabou\nUh uh, uh uh\n\nAcabou…\nAcabou…\nAcabou…\nAcabou.";

  const novaLinha: string[] = [
    dataFormatada, // A
    TOPIC_ID, // B
    AUDIO_URL, // C
    CAPA_URL, // D
    LETRA, // E
    TOPIC_ID, // F
    "", // G
    TITULO_COMPLETO, // H
    tipoSingle, // I
    tipoMusica, // J
    "", // K
    "1", // L
    "", // M
    "Samantha Cooper", // N
    "", "", "", "", "", // O-S
    "", // T
    "", // U
    "", // V
    "", // W
    "Não", // X - já publicada (tem tópico, já tem comentários reais)
    "", // Y
  ];

  if (!confirmar) {
    return new Response(
      JSON.stringify(
        { success: true, confirmar, encontrouEmEdicaoCharts: true, linhaQueSeriaGravada: novaLinha },
        null,
        2,
      ),
      { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
    );
  }

  const linhaAlvo = await googleSheetsService.principal.appendRow("Musicas", novaLinha, "A:Y");
  if (!linhaAlvo) {
    return new Response(JSON.stringify({ success: false, error: "Falha ao gravar em Musicas." }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
  await googleSheetsService.principal.updateValues("Musicas", `Z${linhaAlvo}`, [["EMP999"]]);

  return new Response(
    JSON.stringify({ success: true, confirmar, linhaGravada: linhaAlvo }, null, 2),
    { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
}
