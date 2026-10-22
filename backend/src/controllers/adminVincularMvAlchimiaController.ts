import { googleSheetsService } from "../services/googleSheetsService";
import { createVideoController } from "./gestaoController";

// Wesley (dono do Max Gorghan) reportou: o music video que já tinha
// postado da faixa "Alchimia" (link https://youtu.be/hCGvbfETceE) não
// vinculou porque a busca não achava a música (bug do título "Alchimi -
// Alchimia", já corrigido em adminFixAlchimiaTituloController). Agora que
// o título está certo ("Max Gorghan - Alchimia", Código único EMP948),
// registra o vídeo de verdade — mesmo fluxo completo de
// createVideoController (grava em "Music Videos", copia o Código único
// pra coluna U via EDIÇÃO CHARTS, marca a caixinha em "Pontos", espelha
// pro D1), chamado internamente em vez de reimplementado, pra garantir
// paridade total com o cadastro normal de vídeo.
//
// ?dryRun=1 só mostra o que seria enviado, sem gravar nada.
// GET /api/empire-play/admin/vincular-mv-alchimia?dryRun=1
export async function adminVincularMvAlchimiaController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const dryRun = url.searchParams.get("dryRun") === "1";

  const MUSICA_TITULO = "Max Gorghan - Alchimia";
  const ARTISTA = "Max Gorghan";
  const MV_URL = "https://youtu.be/hCGvbfETceE?is=mr8CjyvhJ1HodJYy";
  const NOME_JOGADOR = "Wesley";

  const capaRow = (
    await googleSheetsService.principal.readValues("Musicas", "D779:D779").catch(() => [])
  )[0];
  const capaUrl = (capaRow?.[0] || "").trim();

  const payload = {
    tituloVideo: "Alchimia",
    artistaResponsavel: ARTISTA,
    tipoVideo: "Music Video",
    musicasVinculadas: [MUSICA_TITULO],
    capaUrl,
    mediaUrl: MV_URL,
    nomeJogador: NOME_JOGADOR,
  };

  if (dryRun) {
    return new Response(JSON.stringify({ success: true, dryRun: true, payload }, null, 2), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  const fakeRequest = new Request("https://internal.empire/api/gestao/videos", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  const resultado = await createVideoController(fakeRequest);
  const resultadoJson = await resultado.json();

  return new Response(JSON.stringify({ success: true, resultadoCreateVideo: resultadoJson }, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
