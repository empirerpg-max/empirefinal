import { googleSheetsService } from "../services/googleSheetsService";
import { TracklistEntry } from "./gestaoController";

// Backfill pontual (2026-11-12): os 2 álbuns da Amanda Brokne (EMPALBM092
// "TRAINWRECK" padrão e EMPALBM095 "TRAINWRECK (The 13th Anniversary
// Edition)") foram lançados ANTES da tracklist própria por álbum existir
// (Albuns!M, ver construirTracklistEntries/lerTracklistAlbum em
// gestaoController.ts) — por isso getAlbumFaixasController ainda caía no
// fallback antigo (Musicas!U global), que é exatamente a causa da posição
// duplicada reportada ("1" aparecendo duas vezes). Grava a tracklist
// retroativamente pros dois, com a ordem real já confirmada pelo admin.
//
// Dry-run por padrão — ?confirmar=1 pra gravar de verdade.
// GET /api/gestao/admin/backfill-tracklist-amanda-brokne[?confirmar=1]

const TRAINWRECK_PADRAO: { linha: number; titulos: string[] } = {
  linha: 103,
  titulos: [
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
  ],
};

const TRAINWRECK_ANIVERSARIO: { linha: number; titulos: string[] } = {
  linha: 106,
  titulos: [
    "Amanda Brokne - Troublemaker",
    "Amanda Brokne - Light It Up",
    "Amanda Brokne - A Different Way to Deceive",
    "Amanda Brokne - What Suits Me",
    "Amanda Brokne - Lighthouse (French Remix)",
    "Amanda Brokne - Your Eyes Don't Lie (Remix)",
  ],
};

// BUG REAL confirmado em produção (2026-11-12, verificado ao vivo via
// getAlbumFaixasController pós tracklist): "Troublemaker" (Musicas linha
// 828) tinha a coluna K ("ALBUM", usada pra achar as faixas de um álbum)
// gravada como "Amanda Brokne - TRAINWRECK" (álbum PADRÃO) em vez de
// "...TRAINWRECK (The 13th Anniversary Edition)" — por isso ela aparecia
// (errado) na tracklist do álbum padrão também, igual ao sintoma original
// reportado (faixa em dois álbuns ao mesmo tempo). Corrige a célula.
const MUSICAS_ALBUM_ERRADO = {
  linha: 828,
  colunaAlbum: "K",
  valorErrado: "Amanda Brokne - TRAINWRECK",
  valorCorreto: "Amanda Brokne - TRAINWRECK (The 13th Anniversary Edition)",
};

export async function adminBackfillTracklistAmandaBrokneController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const confirmar = url.searchParams.get("confirmar") === "1";

  const acoes: string[] = [];

  const musicasRows = await googleSheetsService.principal.readValues("Musicas");
  const valorAtual = (musicasRows[MUSICAS_ALBUM_ERRADO.linha - 1]?.[10] || "").trim();
  if (valorAtual === MUSICAS_ALBUM_ERRADO.valorErrado) {
    acoes.push(
      `Musicas linha ${MUSICAS_ALBUM_ERRADO.linha} ("Troublemaker"): coluna K ${confirmar ? "corrigida" : "seria corrigida"} de "${MUSICAS_ALBUM_ERRADO.valorErrado}" pra "${MUSICAS_ALBUM_ERRADO.valorCorreto}".`,
    );
    if (confirmar) {
      await googleSheetsService.principal.updateValues(
        "Musicas",
        `${MUSICAS_ALBUM_ERRADO.colunaAlbum}${MUSICAS_ALBUM_ERRADO.linha}`,
        [[MUSICAS_ALBUM_ERRADO.valorCorreto]],
      );
    }
  } else {
    acoes.push(
      `Musicas linha ${MUSICAS_ALBUM_ERRADO.linha} ("Troublemaker"): coluna K já não é mais "${MUSICAS_ALBUM_ERRADO.valorErrado}" (valor atual: "${valorAtual}") — nada a fazer.`,
    );
  }

  // BUG REAL confirmado em produção (2026-11-12, verificado ao vivo via
  // /api/empire-play/albuns): mesmo com a coluna K corrigida, a tela de
  // Fórum (fluxo D1, ver empirePlayController.ts) ainda lê a ordem de
  // Musicas!U (coluna "Ordem", global, pré-tracklist-por-álbum) — "Troublemaker"
  // tinha um valor antigo (13) ali, jogando ela pro fim da lista em vez da
  // posição 1. Corrige Musicas!U pras 6 faixas da edição de aniversário
  // pra bater com a tracklist (Albuns!M) — nunca foi migrado quando essas
  // faixas foram criadas, porque o código único delas falhou de gravar
  // (mesmo bug de falha silenciosa do rate-limit, já corrigido antes).
  const MUSICAS_ORDEM_ANIVERSARIO: { linha: number; ordem: number }[] = [
    { linha: 828, ordem: 1 }, // Troublemaker
    { linha: 849, ordem: 2 }, // Light It Up
    { linha: 850, ordem: 3 }, // A Different Way to Deceive
    { linha: 851, ordem: 4 }, // What Suits Me
    { linha: 852, ordem: 5 }, // Lighthouse (French Remix)
    { linha: 853, ordem: 6 }, // Your Eyes Don't Lie (Remix)
  ];
  for (const item of MUSICAS_ORDEM_ANIVERSARIO) {
    const ordemAtual = (musicasRows[item.linha - 1]?.[20] || "").trim();
    acoes.push(
      `Musicas linha ${item.linha}: coluna U (Ordem) ${confirmar ? "corrigida" : "seria corrigida"} de "${ordemAtual || "(vazio)"}" pra "${item.ordem}".`,
    );
    if (confirmar) {
      await googleSheetsService.principal.updateValues("Musicas", `U${item.linha}`, [[String(item.ordem)]]);
    }
  }

  for (const album of [TRAINWRECK_PADRAO, TRAINWRECK_ANIVERSARIO]) {
    const tracklist: TracklistEntry[] = album.titulos.map((titulo, i) => ({
      titulo,
      disco: 1,
      ordem: i + 1,
    }));
    const json = JSON.stringify(tracklist);
    acoes.push(
      `Albuns linha ${album.linha}: Albuns!M ${confirmar ? "gravada" : "seria gravada"} com ${tracklist.length} faixas (disco 1, ordem 1-${tracklist.length}).`,
    );
    if (confirmar) {
      await googleSheetsService.principal.updateValues("Albuns", `M${album.linha}`, [[json]]);
    }
  }

  return new Response(JSON.stringify({ success: true, confirmar, acoes }, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
