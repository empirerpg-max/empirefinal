import { googleSheetsService } from "../services/googleSheetsService";
import { mirrorMusicaRowParaD1 } from "./gestaoController";

// Conserto final da colisão de "Código único" EMP663, diagnosticada no
// início desta sessão e nunca fechada: três faixas da Emma disputavam o
// mesmo código, cada uma gravando por cima da outra no D1 (fonte real do
// Fórum/Catálogo) — explicava tanto a troca de capa vista no Catálogo
// quanto a Abaddon aparecer sem capa/áudio no chart agora.
//
// Confirmado ao vivo em EDIÇÃO CHARTS (fonte real do código único):
// - Abaddon (Musicas!423): EMP663 é o código CERTO dela.
// - Oraculum (Musicas!424): código certo é EMP661, mas Z tinha EMP663
//   (bug de cópia já identificado antes).
// - "Emma - MY JUGULAR" (Musicas!766): nunca teve registro em EDIÇÃO
//   CHARTS — o EMP663 ali é espúrio, sem correspondência real nenhuma.
//
// Ação: corrige Oraculum pro código certo (EMP661), limpa o código
// espúrio da My Jugular (só a célula Z — a faixa em si não é tocada,
// continua com áudio/capa/tópico intactos, só fica sem código único até
// alguém decidir registrá-la de verdade), e reespelha Abaddon + Oraculum
// pro D1 — a última escrita em EMP663 (Abaddon) passa a ser a que fica.
//
// GET /api/empire-play/admin/fix-colisao-emp663
const LINHA_ABADDON = 423;
const LINHA_ORACULUM = 424;
const LINHA_MY_JUGULAR = 766;
const CODIGO_CERTO_ORACULUM = "EMP661";

export async function adminFixColisaoEmp663Controller(): Promise<Response> {
  // 1. Limpa o código espúrio da My Jugular ANTES de mexer no resto —
  // assim ela para de competir pela mesma PK no D1.
  await googleSheetsService.principal.updateValues("Musicas", `Z${LINHA_MY_JUGULAR}`, [[""]]);

  // 2. Corrige o código da Oraculum pro certo.
  await googleSheetsService.principal.updateValues("Musicas", `Z${LINHA_ORACULUM}`, [[CODIGO_CERTO_ORACULUM]]);

  // 3. Reespelha as duas pro D1 — Oraculum agora sob EMP661 (sem conflito),
  // Abaddon reafirmando EMP663 com os dados dela de verdade.
  const oraculumOk = await mirrorMusicaRowParaD1(LINHA_ORACULUM);
  const abaddonOk = await mirrorMusicaRowParaD1(LINHA_ABADDON);

  return new Response(
    JSON.stringify({ success: true, data: { oraculumOk, abaddonOk } }, null, 2),
    { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
}
