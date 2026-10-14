import { getCatalog } from "./catalogController";
import { getArtistNamesForOwner } from "./artistasController";
import { normalizeComparison, normalizeText } from "../services/googleSheetsService";

// Diagnóstico read-only: por que o Spotlight Banner (bannerController.ts,
// getBannerOpcoesController) mostra só parte dos lançamentos de um artista
// (ex: álbuns aparecem, músicas não) — mesmo filtro usado lá (artist exato
// + telegramTopicId presente), mas aqui mostra TODAS as linhas do artista
// (mesmo sem tópico), pra ver onde cada uma está falhando.
//
// ?telegramId=...&artista=... (ou só ?artista=... pra pular a checagem de
// dono, só pra inspecionar o catálogo).
export async function adminDiagBannerOpcoesController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const telegramId = normalizeText(url.searchParams.get("telegramId"));
  const artista = normalizeText(url.searchParams.get("artista"));
  if (!artista) {
    return new Response(JSON.stringify({ success: false, error: "Use ?artista=<nome>" }), {
      status: 400,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  const meusArtistas = telegramId ? await getArtistNamesForOwner(telegramId) : [];
  const donoBate = telegramId
    ? meusArtistas.some((a) => normalizeComparison(a) === normalizeComparison(artista))
    : null;

  const [musicas, albuns] = await Promise.all([
    getCatalog("musicas", { artist: artista }),
    getCatalog("albuns", { artist: artista }),
  ]);

  const dump = (items: typeof musicas) =>
    items.map((item) => ({
      titulo: item.title,
      artistaRaw: item.artist,
      artistaBateExato: normalizeComparison(item.artist) === normalizeComparison(artista),
      telegramTopicId: item.telegramTopicId,
    }));

  return new Response(
    JSON.stringify(
      {
        success: true,
        artista,
        meusArtistas,
        donoBate,
        musicas: dump(musicas),
        albuns: dump(albuns),
      },
      null,
      2,
    ),
    { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
}
