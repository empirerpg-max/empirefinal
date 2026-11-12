import { googleSheetsService } from "../services/googleSheetsService";
import { TracklistEntry } from "./gestaoController";

// Unificação pontual (2026-11-12, pedido direto do admin): a "edição de
// aniversário" (EMPALBM095, "Amanda Brokne - TRAINWRECK (The 13th
// Anniversary Edition)") passa a mostrar o álbum completo — Disco 1 = as
// 12 faixas originais do TRAINWRECK, Disco 2 = as 6 faixas novas — igual
// uma reedição de verdade no Spotify. O álbum original (EMPALBM092,
// "Amanda Brokne - TRAINWRECK") CONTINUA existindo com seu próprio
// tópico e as mesmas 12 faixas — nada é removido de lá.
//
// Mecanismo (ver getReleasesForTrackMatching/getEmpirePlayAlbunsController
// em gestaoController.ts/empirePlayController.ts): quando um álbum tem
// tracklist própria (Albuns!M), ELA decide sozinha quais faixas
// pertencem a ele (por título) — não depende mais só de Musicas!K (que
// só aceita UM álbum por faixa). Por isso a mesma faixa pode aparecer
// nos dois álbuns sem conflito: basta cada um ter sua própria tracklist
// listando-a. Musicas!K nunca é tocada aqui.
//
// Dry-run por padrão — ?confirmar=1 pra gravar de verdade.
// GET /api/gestao/admin/merge-albuns-amanda-brokne[?confirmar=1]

const FAIXAS_ORIGINAL = [
  "Amanda Brokne - TRAINWRECK",
  "Amanda Brokne - Killer 69 (feat. JOE)",
  "Amanda Brokne - Little Hussy Ass",
  "Amanda Brokne - Your Eyes Don't Lie",
  "Amanda Brokne - Lighthouse",
  "Amanda Brokne - #1 (Number One)",
  "Amanda Brokne - Photobooth",
  "Amanda Brokne - Jungle Town (Walked Outta Heaven)",
  "Amanda Brokne - Till It Kills Me",
  "Amanda Brokne - 4th D",
  "Amanda Brokne - Curtains",
  "Amanda Brokne - Counting Stars",
];

const FAIXAS_NOVAS_ANIVERSARIO = [
  "Amanda Brokne - Troublemaker",
  "Amanda Brokne - Light It Up",
  "Amanda Brokne - A Different Way to Deceive",
  "Amanda Brokne - What Suits Me",
  "Amanda Brokne - Lighthouse (French Remix)",
  "Amanda Brokne - Your Eyes Don't Lie (Remix)",
];

const ALBUNS_LINHA_PADRAO = 103;
const ALBUNS_LINHA_ANIVERSARIO = 106;

export async function adminMergeAlbunsAmandaBrokneController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const confirmar = url.searchParams.get("confirmar") === "1";
  const acoes: string[] = [];

  // Álbum padrão: mantém só disco 1 com as 12 faixas (tópico próprio
  // intacto) — já estava assim desde o backfill anterior, regrava igual
  // só pra garantir consistência.
  const tracklistPadrao: TracklistEntry[] = FAIXAS_ORIGINAL.map((titulo, i) => ({
    titulo,
    disco: 1,
    ordem: i + 1,
  }));
  acoes.push(
    `Albuns linha ${ALBUNS_LINHA_PADRAO} (TRAINWRECK original): Albuns!M ${confirmar ? "gravada" : "seria gravada"} com ${tracklistPadrao.length} faixas (disco 1) — tópico e página próprios mantidos.`,
  );
  if (confirmar) {
    await googleSheetsService.principal.updateValues("Albuns", `M${ALBUNS_LINHA_PADRAO}`, [
      [JSON.stringify(tracklistPadrao)],
    ]);
  }

  // Edição de aniversário: disco 1 = as mesmas 12 originais (shared),
  // disco 2 = as 6 novas.
  const tracklistAniversario: TracklistEntry[] = [
    ...FAIXAS_ORIGINAL.map((titulo, i) => ({ titulo, disco: 1, ordem: i + 1 })),
    ...FAIXAS_NOVAS_ANIVERSARIO.map((titulo, i) => ({ titulo, disco: 2, ordem: i + 1 })),
  ];
  acoes.push(
    `Albuns linha ${ALBUNS_LINHA_ANIVERSARIO} (Edição de Aniversário): Albuns!M ${confirmar ? "gravada" : "seria gravada"} com ${tracklistAniversario.length} faixas (Disco 1: ${FAIXAS_ORIGINAL.length} originais compartilhadas, Disco 2: ${FAIXAS_NOVAS_ANIVERSARIO.length} novas).`,
  );
  if (confirmar) {
    await googleSheetsService.principal.updateValues("Albuns", `M${ALBUNS_LINHA_ANIVERSARIO}`, [
      [JSON.stringify(tracklistAniversario)],
    ]);
  }

  return new Response(JSON.stringify({ success: true, confirmar, acoes }, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
