import { googleSheetsService, normalizeComparison, normalizeText } from "../services/googleSheetsService";

// Contenção urgente (2026-10-29): álbum "DERBY" (Cowboy Fresh) lançado
// dezenas de vezes hoje — mesma classe de bug já relatada antes (Max
// Gorghan/Follia), supostamente fechada com withWriteLock em
// processarLancamentosPreSaveScheduled. Esse endpoint:
//  1) Lê PreSave_Album (layout real, ver rowToCampanha em
//     preSaveController.ts: D=artista, E=álbum, J=dataLancamento,
//     M=status) e acha a campanha por nome de artista/álbum.
//  2) Reporta status atual e quantas cópias de "Albuns" já existem pra
//     esse álbum (com timestamp de criação embutido no topicId).
//  3) Com ?parar=1, escreve "lancada" direto na coluna M da campanha —
//     ação de contenção imediata (impede qualquer nova execução do cron
//     de reconhecer a campanha como "ativa" e lançar de novo), sem
//     mexer nas cópias já duplicadas em Albuns (limpeza é outro passo).
//
// GET /api/empire-play/admin/parar-presave-duplicado?artista=Cowboy%20Fresh&album=DERBY&parar=1
export async function adminPararPresaveDuplicadoController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const artistaAlvo = normalizeComparison(url.searchParams.get("artista") || "");
  const albumAlvo = normalizeComparison(url.searchParams.get("album") || "");
  const parar = url.searchParams.get("parar") === "1";

  if (!artistaAlvo || !albumAlvo) {
    return new Response(JSON.stringify({ success: false, error: "artista e album são obrigatórios." }), {
      status: 400,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  const presaveRows = await googleSheetsService.principal.readValues("PreSave_Album").catch(() => []);
  const linhasAchadas: { linha: number; artista: string; album: string; status: string; dataLancamento: string }[] = [];
  for (let i = 1; i < presaveRows.length; i++) {
    const row = presaveRows[i];
    if (!row) continue;
    const artista = normalizeText(row[3]);
    const album = normalizeText(row[4]);
    if (normalizeComparison(artista).includes(artistaAlvo) && normalizeComparison(album).includes(albumAlvo)) {
      linhasAchadas.push({
        linha: i + 1,
        artista,
        album,
        status: normalizeText(row[12]),
        dataLancamento: normalizeText(row[9]),
      });
    }
  }

  const albunsRows = await googleSheetsService.principal.readValues("Albuns", "A1:Z20000").catch(() => []);
  let copiasEmAlbuns = 0;
  let primeiraCopia: string | null = null;
  let ultimaCopia: string | null = null;
  for (let i = 1; i < albunsRows.length; i++) {
    const row = albunsRows[i];
    if (!row) continue;
    const novoNome = normalizeComparison(normalizeText(row[6]));
    if (novoNome.includes(artistaAlvo) && novoNome.includes(albumAlvo)) {
      copiasEmAlbuns++;
      const topicId = normalizeText(row[1]);
      const match = /^album_(\d+)_/.exec(topicId);
      if (match) {
        const iso = new Date(Number(match[1])).toISOString();
        if (!primeiraCopia || iso < primeiraCopia) primeiraCopia = iso;
        if (!ultimaCopia || iso > ultimaCopia) ultimaCopia = iso;
      }
    }
  }

  const resultadosParada: { linha: number; gravado: boolean }[] = [];
  if (parar) {
    for (const item of linhasAchadas) {
      if (normalizeComparison(item.status) === "ativa") {
        const ok = await googleSheetsService.principal.updateValues(
          "PreSave_Album",
          `M${item.linha}:M${item.linha}`,
          [["lancada"]],
        );
        resultadosParada.push({ linha: item.linha, gravado: ok });
      }
    }
  }

  return new Response(
    JSON.stringify(
      { success: true, parar, campanhasAchadas: linhasAchadas, copiasEmAlbuns, primeiraCopia, ultimaCopia, resultadosParada },
      null,
      2,
    ),
    { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
}
