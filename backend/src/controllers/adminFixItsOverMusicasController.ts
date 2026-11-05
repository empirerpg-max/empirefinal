import { googleSheetsService, normalizeComparison } from "../services/googleSheetsService";

// Corrige "IT'S OVER" (Samantha Cooper, EMP999): a linha em "Musicas"
// (linha 831, confirmado ao vivo) existe mas está corrompida — quase toda
// coluna vazia, só "Código único" (Z) com "EMP999" e, por engano, a capa
// (uma URL do Drive) parada na coluna X ("Pendente?") em vez da D. Data,
// título, áudio, letra, ACT PRINCIPAL — tudo vazio. É por isso que a
// música nunca aparecia em Editar Lançamentos (busca por título/artista
// não acha nada em colunas vazias), mesmo já tendo tópico publicado,
// comentários reais e aparecendo em EDIÇÃO CHARTS.
//
// Causa provável: o appendRow original devolveu um número de linha válido
// (sem lançar erro) mas gravou a linha vazia — mesma classe de bug já
// blindada em appendRowMusicasSeguro/appendRowMusicasComCursor com uma
// releitura de confirmação depois do append (ver gestaoController.ts).
// Esse admin tool repara o caso específico já acontecido: SOBRESCREVE a
// linha 831 inteira (A:Y) com os dados reais (áudio/letra/capa já
// confirmados via D1/fórum), sem criar linha nova (evita duplicar).
//
// GET /api/empire-play/admin/fix-its-over-musicas (dry-run) / ?confirmar=1
export async function adminFixItsOverMusicasController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const confirmar = url.searchParams.get("confirmar") === "1";
  const CODIGO = "emp999";
  const TOPIC_ID = "musica_1793844310095_u4hhzr";
  const TITULO_COMPLETO = "Samantha Cooper - IT’S OVER";

  const musicasRows = await googleSheetsService.principal.readValues("Musicas").catch(() => []);
  let linhaAlvo = -1;
  for (let i = 1; i < musicasRows.length; i++) {
    const row = musicasRows[i];
    if (normalizeComparison(row[25] || "") === CODIGO || (row[1] || "").trim() === TOPIC_ID) {
      linhaAlvo = i + 1;
      break;
    }
  }
  if (linhaAlvo === -1) {
    return new Response(
      JSON.stringify({ success: false, error: "Nenhuma linha com EMP999/topicId encontrada em Musicas." }),
      { status: 404, headers: { "Content-Type": "application/json" } },
    );
  }

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

  const linhaCorrigida: string[] = [
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
    "", // K - não é faixa de álbum
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
      JSON.stringify({ success: true, confirmar, linhaAlvo, linhaQueSeriaGravada: linhaCorrigida }, null, 2),
      { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
    );
  }

  const gravou = await googleSheetsService.principal.updateValues(
    "Musicas",
    `A${linhaAlvo}:Y${linhaAlvo}`,
    [linhaCorrigida],
  );
  if (!gravou) {
    return new Response(JSON.stringify({ success: false, error: "Falha ao sobrescrever a linha em Musicas." }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
  await googleSheetsService.principal.updateValues("Musicas", `Z${linhaAlvo}`, [["EMP999"]]);

  return new Response(
    JSON.stringify({ success: true, confirmar, linhaCorrigida: linhaAlvo }, null, 2),
    { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
}
