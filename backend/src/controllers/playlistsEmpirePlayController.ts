// GET /api/empire-play/playlists          → { success, data: IndicePlaylists }
// GET /api/empire-play/playlists?id=<id>  → { success, data: Playlist }
// Id inválido ou inexistente → 404 "Playlist não encontrada.".
//
// Índice, ao vivo (`ao-vivo:*`) e países (`pais:*`): cache com a regra do ao
// vivo dos Charts (30 s, nunca mais que a leitura da EM Alta de onde saiu).
// Playlists da semana (`semana:*`): TTL normal de 5 min. limparCacheCharts
// zera tudo. Chave pelo id canônico (chaveCachePlaylist): variações de
// grafia dividem uma entrada. Nenhuma leitura de planilha além da EM Alta já
// lida pelo ao vivo; nenhuma escrita.
import { respostaAoVivoEmCache, respostaSemanaEmCache, type RespostaCharts } from "./chartsController";
import {
  chaveCachePlaylist,
  ehPlaylistDaSemana,
  fontesReais,
  montarIndice,
  montarPlaylist,
  parseIdPlaylist,
} from "../services/playlistsEmpirePlay";

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8" };
const NAO_ENCONTRADA = "Playlist não encontrada.";

const naoEncontrada = (): RespostaCharts => ({
  body: JSON.stringify({ success: false, error: NAO_ENCONTRADA }),
  status: 404,
});

export async function getPlaylistsEmpirePlayController(request: Request): Promise<Response> {
  try {
    const params = new URL(request.url).searchParams;
    if (!params.has("id")) {
      return await respostaAoVivoEmCache("empire-play/playlists", async () => ({
        body: JSON.stringify({ success: true, data: await montarIndice(fontesReais()) }),
      }));
    }
    const id = parseIdPlaylist(params.get("id") || "");
    if (!id) {
      const r = naoEncontrada();
      return new Response(r.body, { status: r.status, headers: JSON_HEADERS });
    }
    // 404 não fica em cache (só respostas 200 ficam).
    const emCache = ehPlaylistDaSemana(id) ? respostaSemanaEmCache : respostaAoVivoEmCache;
    return await emCache(`empire-play/playlists?id=${chaveCachePlaylist(id)}`, async () => {
      const playlist = await montarPlaylist(id, fontesReais());
      return playlist ? { body: JSON.stringify({ success: true, data: playlist }) } : naoEncontrada();
    });
  } catch (error: any) {
    console.error("[playlistsEmpirePlay] Erro:", error);
    return new Response(
      JSON.stringify({ success: false, error: error?.message || "Erro ao montar as playlists." }),
      { status: 500, headers: JSON_HEADERS },
    );
  }
}
