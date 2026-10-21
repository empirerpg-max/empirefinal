import { readAllCampanhas, calcularAcumulado } from "./preSaveController";

// Diagnóstico read-only: usuário perguntou por que a coluna "PRE-SAVE" de
// EDIÇÃO CHARTS ÁLBUMS ficou vazia pro álbum FOLLIA (Max Gorghan). O
// código JÁ tem a lógica real (processarLancamentosPreSaveScheduled: só
// roda se c.modo === "missao", grava Math.round(calcularAcumulado(c)) na
// coluna S — modo "contagem" nunca escreve nada ali, de propósito, por
// ser "vanity puro"). Mostra a campanha PRESAVE-7da5f189 inteira (modo,
// teto, duração, missões) e o valor que calcularAcumulado(c) dá AGORA
// pra ela, pra confirmar se o motivo de ter ficado vazia foi
// "modo=contagem" (comportamento esperado) ou outra coisa (bug real).
//
// GET /api/empire-play/admin/diagnostico-follia-presave-campanha
export async function adminDiagFolliaPresaveCampanhaController(): Promise<Response> {
  const campanhas = await readAllCampanhas().catch(() => []);
  const c = campanhas.find((x) => x.id === "PRESAVE-7da5f189");
  if (!c) {
    return new Response(JSON.stringify({ success: false, error: "Campanha PRESAVE-7da5f189 não encontrada." }), {
      status: 404,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  return new Response(
    JSON.stringify(
      {
        success: true,
        campanha: {
          id: c.id,
          albumTituloFull: c.albumTituloFull,
          modo: c.modo,
          status: c.status,
          duracaoDias: c.duracaoDias,
          tetoFinal: c.tetoFinal,
          codigoUnicoAlbum: c.codigoUnicoAlbum,
          missoes: c.missoes,
        },
        acumuladoCalculadoAgora: calcularAcumulado(c),
        acumuladoArredondado: Math.round(calcularAcumulado(c)),
      },
      null,
      2,
    ),
    { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
}
