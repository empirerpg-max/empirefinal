import {
  getCatalogKindController,
  getLancamentosController,
  getTopPlaylistsController,
} from "../controllers/catalogController";
import { getUserMeController } from "../controllers/userController";
import { chartsApiController } from "../controllers/chartsController";
import {
  getAcervoRevistasController,
  createAcervoRevistaController,
  getAcervoEntrevistasController,
  createAcervoEntrevistaController,
} from "../controllers/acervoController";
import { getNivelController } from "../controllers/nivelController";
import {
  createCommentController,
  getCommentsController,
  toggleCommentReactionController,
  editCommentController,
} from "../controllers/forumController";
import {
  createAlbumController,
  createSongController,
  createVideoController,
  getAlbumFaixasController,
  getMeusAlbunsController,
  getMusicasEmChartController,
  getFaixasSemAlbumController,
  reordenarAlbumFaixasController,
  substituirAlbumController,
  uploadDriveController,
  updateFaixaLetraController,
  publicarFaixaPendenteController,
} from "../controllers/gestaoController";
import {
  getReleasesForEditController,
  updateReleaseController,
} from "../controllers/editController";
import {
  getEmpirePlayHomeController,
  getEmpirePlayMusicasController,
  getEmpirePlayVideosController,
  getEmpirePlayAlbunsController,
  getEmpirePlayForumTopicController,
  getEmpirePlayUserController,
  getEmpirePlayLancamentosRecentesController,
} from "../controllers/empirePlayController";
import { reportVideoIssueController } from "../controllers/reportVideoController";
import { reportWrongContentController } from "../controllers/reportWrongContentController";
import {
  loginController,
  updateProfileController,
  trocarSenhaController,
  authHeartbeatController,
} from "../controllers/authController";
import {
  getMeusArtistasNomesController,
  getArtistasDisponiveisController,
  vincularArtistaController,
  criarArtistaController,
  getArtistInfoController,
  setArtistFotoController,
  getAllArtistasController,
} from "../controllers/artistasController";
import { calcularFortunaChartsController } from "../controllers/fortunaChartsController";
import {
  getProgramasTVController,
  registrarPresencaTVController,
  listarPresencaTVController,
  processarParticipacaoTV,
} from "../controllers/tvController";
import {
  getPontosController,
  salvarPontoCelulaController,
  distribuirPontosAleatorioController,
  limparPontoCelulaController,
} from "../controllers/pontoController";
import {
  getInvestimentosController,
  iniciarInvestimentoController,
  investirPlaylistController,
  limparInvestimentoController,
} from "../controllers/playlistsInvestimentoController";
import { listTvChatGifsController } from "../controllers/tvChatGifsController";
import {
  getSocialPostsController,
  createSocialPostController,
  curtirSocialPostController,
  getSocialComentariosController,
  comentarSocialPostController,
  editSocialCommentController,
  editSocialPostController,
  deleteSocialPostController,
  getSocialPerfisController,
  saveSocialPerfilController,
  getSocialNewsController,
  saveSocialNewsController,
} from "../controllers/socialController";
import {
  getPlaylistsController,
  getPlaylistByIdController,
  savePlaylistController,
  deletePlaylistController,
  getPlaylistsCatalogoController,
  getSalvosController,
  saveSalvoController,
  removeSalvoController,
  criarAlbumAntigoController,
  editarAlbumAntigoController,
  deletarAlbumAntigoController,
  getAlbunsAntigosController,
  getAlbumAntigoByIdController,
} from "../controllers/playlistsController";
import {
  getLocaisTurneController,
  simularTurneController,
  getTurnesController,
  getTurneDetalheController,
  criarTurneController,
  realizarAcaoDiaController,
  getComentariosTurneController,
  comentarTurneController,
  getMissoesController,
  getFeedGlobalController,
} from "../controllers/tourController";
import { handleMediaRoutes } from "./mediaRoutes";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Range, x-telegram-id",
};

export async function handleEmpireApiRoutes(request: Request): Promise<Response | null> {
  const mediaResponse = await handleMediaRoutes(request);
  if (mediaResponse) {
    return mediaResponse;
  }

  const url = new URL(request.url);

  // Match /api/editar ou /api/editar/:tipo/:id
  const isEditarPath = url.pathname === "/api/editar" || url.pathname.startsWith("/api/editar/");
  // Match /api/empire-play/forum ou /api/empire-play/forum/:tipo/:topicId
  const isEmpirePlayForumPath = url.pathname.startsWith("/api/empire-play/forum");
  // Match qualquer /api/empire-play/*
  const isEmpirePlayPath = url.pathname.startsWith("/api/empire-play/");
  // Match /api/playlists ou /api/playlists/:id
  const isPlaylistsPath = url.pathname === "/api/playlists" || url.pathname.startsWith("/api/playlists/");
  // Match /api/salvos ou /api/salvos/:acao
  const isSalvosPath = url.pathname === "/api/salvos" || url.pathname.startsWith("/api/salvos/");
  // Match /api/albuns-antigos ou /api/albuns-antigos/:id
  const isAlbunsAntigosPath =
    url.pathname === "/api/albuns-antigos" || url.pathname.startsWith("/api/albuns-antigos/");

  const supportedPaths = new Set([
    "/api/charts",
    "/api/acervo/revistas",
    "/api/acervo/entrevistas",
    "/api/auth/login",
    "/api/auth/heartbeat",
    "/api/auth/perfil",
    "/api/auth/trocar-senha",
    "/api/artistas/meus-nomes",
    "/api/artistas/disponiveis",
    "/api/artistas/listar-todos",
    "/api/artistas/calcular-fortuna-charts",
    "/api/tv/programas",
    "/api/tv/presenca",
    "/api/tv/processar-participacao",
    "/api/artistas/vincular",
    "/api/artistas/criar",
    "/api/artistas/infos",
    "/api/artistas/foto",
    "/api/user/me",
    "/api/user/nivel",
    "/api/top-playlists",
    "/api/lancamentos",
    "/api/musicas",
    "/api/music-videos",
    "/api/videos",
    "/api/albuns",
    "/api/forum/comment",
    "/api/forum/comments",
    "/api/forum/comment-reaction",
    "/api/forum/comment-edit",
    "/api/gestao/musica",
    "/api/gestao/video",
    "/api/gestao/album",
    "/api/gestao/album/substituir",
    "/api/gestao/album-faixas",
    "/api/gestao/album-faixas/reordenar",
    "/api/gestao/faixa-letra",
    "/api/gestao/musicas-em-chart",
    "/api/gestao/faixas-sem-album",
    "/api/gestao/faixa/publicar",
    "/api/gestao/meus-albuns",
    "/api/gestao/upload",
    "/api/editar",
    "/api/empire-play/home",
    "/api/empire-play/user",
    "/api/empire-play/musicas",
    "/api/empire-play/music-videos",
    "/api/empire-play/videos",
    "/api/empire-play/albuns",
    "/api/empire-play/lancamentos-recentes",
    "/api/empire-play/report-video-issue",
    "/api/empire-play/report-wrong-content",
    "/api/social/posts",
    "/api/social/curtir",
    "/api/social/comentarios",
    "/api/social/comentar",
    "/api/social/comentario/editar",
    "/api/ponto",
    "/api/ponto/salvar",
    "/api/ponto/distribuir-aleatorio",
    "/api/ponto/limpar",
    "/api/ponto/playlists",
    "/api/ponto/playlists/iniciar",
    "/api/ponto/playlists/investir",
    "/api/ponto/playlists/limpar",
    "/api/social/posts/editar",
    "/api/social/posts/deletar",
    "/api/social/perfis",
    "/api/social/news",
    "/api/empire-tv/gifs",
    "/api/turnes/locais",
    "/api/turnes/simular",
    "/api/turnes",
    "/api/turnes/detalhe",
    "/api/turnes/criar",
    "/api/turnes/acao",
    "/api/turnes/comentarios",
    "/api/turnes/comentar",
    "/api/turnes/missoes",
    "/api/turnes/feed",
  ]);

  if (
    !supportedPaths.has(url.pathname) &&
    !isEditarPath &&
    !isEmpirePlayPath &&
    !isPlaylistsPath &&
    !isSalvosPath &&
    !isAlbunsAntigosPath
  ) {
    return null;
  }

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  let response: Response;

  if (isEmpirePlayForumPath) {
    if (request.method !== "GET") {
      return new Response(
        JSON.stringify({ success: false, error: "Use GET para /api/empire-play/forum." }),
        { status: 405, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
      );
    }
    response = await getEmpirePlayForumTopicController(request);
  } else if (url.pathname === "/api/empire-play/home") {
    response = await getEmpirePlayHomeController();
  } else if (url.pathname === "/api/empire-play/user") {
    response = await getEmpirePlayUserController(request);
  } else if (url.pathname === "/api/empire-play/musicas") {
    response = await getEmpirePlayMusicasController(request);
  } else if (
    url.pathname === "/api/empire-play/videos" ||
    url.pathname === "/api/empire-play/music-videos"
  ) {
    // Vídeos e Music Videos foram consolidados num catálogo único
    // ("Music Videos" na planilha) — os dois paths respondem com os mesmos
    // dados, filtráveis por tag ("Tipo de vídeo") no frontend.
    response = await getEmpirePlayVideosController(request);
  } else if (url.pathname === "/api/empire-play/albuns") {
    response = await getEmpirePlayAlbunsController();
  } else if (url.pathname === "/api/empire-play/lancamentos-recentes") {
    response = await getEmpirePlayLancamentosRecentesController();
  } else if (url.pathname === "/api/empire-play/report-video-issue") {
    if (request.method !== "POST") {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Use POST para /api/empire-play/report-video-issue.",
        }),
        { status: 405, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
      );
    }
    response = await reportVideoIssueController(request);
  } else if (url.pathname === "/api/empire-play/report-wrong-content") {
    if (request.method !== "POST") {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Use POST para /api/empire-play/report-wrong-content.",
        }),
        { status: 405, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
      );
    }
    response = await reportWrongContentController(request);
  } else if (isEditarPath) {
    if (request.method === "GET") {
      response = await getReleasesForEditController(request);
    } else if (request.method === "PUT" || request.method === "POST") {
      response = await updateReleaseController(request);
    } else {
      return new Response(
        JSON.stringify({ success: false, error: "Use GET, PUT ou POST para /api/editar." }),
        { status: 405, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
      );
    }
  } else if (url.pathname === "/api/gestao/musica") {
    if (request.method !== "POST") {
      return new Response(
        JSON.stringify({ success: false, error: "Use POST para /api/gestao/musica." }),
        { status: 405, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
      );
    }
    response = await createSongController(request);
  } else if (url.pathname === "/api/gestao/video") {
    if (request.method !== "POST") {
      return new Response(
        JSON.stringify({ success: false, error: "Use POST para /api/gestao/video." }),
        { status: 405, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
      );
    }
    response = await createVideoController(request);
  } else if (url.pathname === "/api/gestao/album") {
    if (request.method !== "POST") {
      return new Response(
        JSON.stringify({ success: false, error: "Use POST para /api/gestao/album." }),
        { status: 405, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
      );
    }
    response = await createAlbumController(request);
  } else if (url.pathname === "/api/gestao/album/substituir") {
    if (request.method !== "POST") {
      return new Response(
        JSON.stringify({ success: false, error: "Use POST para /api/gestao/album/substituir." }),
        { status: 405, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
      );
    }
    response = await substituirAlbumController(request);
  } else if (url.pathname === "/api/gestao/album-faixas/reordenar") {
    if (request.method !== "POST") {
      return new Response(
        JSON.stringify({ success: false, error: "Use POST para /api/gestao/album-faixas/reordenar." }),
        { status: 405, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
      );
    }
    response = await reordenarAlbumFaixasController(request);
  } else if (url.pathname === "/api/gestao/faixa-letra") {
    if (request.method !== "POST" && request.method !== "PUT") {
      return new Response(
        JSON.stringify({ success: false, error: "Use POST ou PUT para /api/gestao/faixa-letra." }),
        { status: 405, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
      );
    }
    response = await updateFaixaLetraController(request);
  } else if (url.pathname === "/api/gestao/faixa/publicar") {
    if (request.method !== "POST") {
      return new Response(
        JSON.stringify({ success: false, error: "Use POST para /api/gestao/faixa/publicar." }),
        { status: 405, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
      );
    }
    response = await publicarFaixaPendenteController(request);
  } else if (url.pathname === "/api/gestao/upload") {
    if (request.method !== "POST") {
      return new Response(
        JSON.stringify({ success: false, error: "Use POST para /api/gestao/upload." }),
        { status: 405, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
      );
    }
    response = await uploadDriveController(request);
  } else if (url.pathname === "/api/acervo/revistas") {
    response =
      request.method === "GET"
        ? await getAcervoRevistasController()
        : request.method === "POST"
          ? await createAcervoRevistaController(request)
          : new Response(
              JSON.stringify({ success: false, error: "Use GET ou POST para /api/acervo/revistas." }),
              { status: 405, headers: { "Content-Type": "application/json" } },
            );
  } else if (url.pathname === "/api/acervo/entrevistas") {
    response =
      request.method === "GET"
        ? await getAcervoEntrevistasController()
        : request.method === "POST"
          ? await createAcervoEntrevistaController(request)
          : new Response(
              JSON.stringify({ success: false, error: "Use GET ou POST para /api/acervo/entrevistas." }),
              { status: 405, headers: { "Content-Type": "application/json" } },
            );
  } else if (url.pathname === "/api/social/posts") {
    response =
      request.method === "GET"
        ? await getSocialPostsController()
        : request.method === "POST"
          ? await createSocialPostController(request)
          : new Response(
              JSON.stringify({ success: false, error: "Use GET ou POST para /api/social/posts." }),
              { status: 405, headers: { "Content-Type": "application/json" } },
            );
  } else if (url.pathname === "/api/social/posts/editar") {
    if (request.method !== "POST") {
      return new Response(
        JSON.stringify({ success: false, error: "Use POST para /api/social/posts/editar." }),
        { status: 405, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
      );
    }
    response = await editSocialPostController(request);
  } else if (url.pathname === "/api/social/posts/deletar") {
    if (request.method !== "POST") {
      return new Response(
        JSON.stringify({ success: false, error: "Use POST para /api/social/posts/deletar." }),
        { status: 405, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
      );
    }
    response = await deleteSocialPostController(request);
  } else if (url.pathname === "/api/social/curtir") {
    if (request.method !== "POST") {
      return new Response(
        JSON.stringify({ success: false, error: "Use POST para /api/social/curtir." }),
        { status: 405, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
      );
    }
    response = await curtirSocialPostController(request);
  } else if (url.pathname === "/api/social/comentarios") {
    if (request.method !== "GET") {
      return new Response(
        JSON.stringify({ success: false, error: "Use GET para /api/social/comentarios." }),
        { status: 405, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
      );
    }
    response = await getSocialComentariosController(request);
  } else if (url.pathname === "/api/social/comentar") {
    if (request.method !== "POST") {
      return new Response(
        JSON.stringify({ success: false, error: "Use POST para /api/social/comentar." }),
        { status: 405, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
      );
    }
    response = await comentarSocialPostController(request);
  } else if (url.pathname === "/api/social/comentario/editar") {
    if (request.method !== "POST") {
      return new Response(
        JSON.stringify({ success: false, error: "Use POST para /api/social/comentario/editar." }),
        { status: 405, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
      );
    }
    response = await editSocialCommentController(request);
  } else if (url.pathname === "/api/social/perfis") {
    response =
      request.method === "GET"
        ? await getSocialPerfisController()
        : request.method === "POST"
          ? await saveSocialPerfilController(request)
          : new Response(
              JSON.stringify({ success: false, error: "Use GET ou POST para /api/social/perfis." }),
              { status: 405, headers: { "Content-Type": "application/json" } },
            );
  } else if (isPlaylistsPath) {
    if (url.pathname === "/api/playlists/excluir") {
      if (request.method !== "POST") {
        return new Response(
          JSON.stringify({ success: false, error: "Use POST para /api/playlists/excluir." }),
          { status: 405, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
        );
      }
      response = await deletePlaylistController(request);
    } else if (url.pathname === "/api/playlists/catalogo") {
      if (request.method !== "GET") {
        return new Response(
          JSON.stringify({ success: false, error: "Use GET para /api/playlists/catalogo." }),
          { status: 405, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
        );
      }
      response = await getPlaylistsCatalogoController();
    } else if (url.pathname === "/api/playlists/albuns") {
      if (request.method !== "POST") {
        return new Response(
          JSON.stringify({ success: false, error: "Use POST para /api/playlists/albuns." }),
          { status: 405, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
        );
      }
      response = await criarAlbumAntigoController(request);
    } else if (url.pathname === "/api/playlists/albuns/editar") {
      if (request.method !== "POST") {
        return new Response(
          JSON.stringify({ success: false, error: "Use POST para /api/playlists/albuns/editar." }),
          { status: 405, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
        );
      }
      response = await editarAlbumAntigoController(request);
    } else if (url.pathname === "/api/playlists/albuns/deletar") {
      if (request.method !== "POST") {
        return new Response(
          JSON.stringify({ success: false, error: "Use POST para /api/playlists/albuns/deletar." }),
          { status: 405, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
        );
      }
      response = await deletarAlbumAntigoController(request);
    } else if (url.pathname === "/api/playlists") {
      response =
        request.method === "GET"
          ? await getPlaylistsController()
          : request.method === "POST"
            ? await savePlaylistController(request)
            : new Response(
                JSON.stringify({ success: false, error: "Use GET ou POST para /api/playlists." }),
                { status: 405, headers: { "Content-Type": "application/json" } },
              );
    } else {
      if (request.method !== "GET") {
        return new Response(
          JSON.stringify({ success: false, error: "Use GET para /api/playlists/:id." }),
          { status: 405, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
        );
      }
      const id = decodeURIComponent(url.pathname.replace("/api/playlists/", ""));
      response = await getPlaylistByIdController(id);
    }
  } else if (isSalvosPath) {
    if (url.pathname === "/api/salvos/remover") {
      if (request.method !== "POST") {
        return new Response(
          JSON.stringify({ success: false, error: "Use POST para /api/salvos/remover." }),
          { status: 405, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
        );
      }
      response = await removeSalvoController(request);
    } else {
      response =
        request.method === "GET"
          ? await getSalvosController(request)
          : request.method === "POST"
            ? await saveSalvoController(request)
            : new Response(
                JSON.stringify({ success: false, error: "Use GET ou POST para /api/salvos." }),
                { status: 405, headers: { "Content-Type": "application/json" } },
              );
    }
  } else if (isAlbunsAntigosPath) {
    if (request.method !== "GET") {
      return new Response(
        JSON.stringify({ success: false, error: "Use GET para /api/albuns-antigos." }),
        { status: 405, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
      );
    }
    if (url.pathname === "/api/albuns-antigos") {
      response = await getAlbunsAntigosController();
    } else {
      const id = decodeURIComponent(url.pathname.replace("/api/albuns-antigos/", ""));
      response = await getAlbumAntigoByIdController(id);
    }
  } else if (url.pathname === "/api/ponto") {
    if (request.method !== "GET") {
      return new Response(
        JSON.stringify({ success: false, error: "Use GET para /api/ponto." }),
        { status: 405, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
      );
    }
    response = await getPontosController(request);
  } else if (url.pathname === "/api/ponto/salvar") {
    if (request.method !== "POST") {
      return new Response(
        JSON.stringify({ success: false, error: "Use POST para /api/ponto/salvar." }),
        { status: 405, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
      );
    }
    response = await salvarPontoCelulaController(request);
  } else if (url.pathname === "/api/ponto/distribuir-aleatorio") {
    if (request.method !== "POST") {
      return new Response(
        JSON.stringify({ success: false, error: "Use POST para /api/ponto/distribuir-aleatorio." }),
        { status: 405, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
      );
    }
    response = await distribuirPontosAleatorioController(request);
  } else if (url.pathname === "/api/ponto/playlists") {
    if (request.method !== "GET") {
      return new Response(
        JSON.stringify({ success: false, error: "Use GET para /api/ponto/playlists." }),
        { status: 405, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
      );
    }
    response = await getInvestimentosController(request);
  } else if (url.pathname === "/api/ponto/playlists/iniciar") {
    if (request.method !== "POST") {
      return new Response(
        JSON.stringify({ success: false, error: "Use POST para /api/ponto/playlists/iniciar." }),
        { status: 405, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
      );
    }
    response = await iniciarInvestimentoController(request);
  } else if (url.pathname === "/api/ponto/playlists/investir") {
    if (request.method !== "POST") {
      return new Response(
        JSON.stringify({ success: false, error: "Use POST para /api/ponto/playlists/investir." }),
        { status: 405, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
      );
    }
    response = await investirPlaylistController(request);
  } else if (url.pathname === "/api/ponto/limpar") {
    if (request.method !== "POST") {
      return new Response(JSON.stringify({ success: false, error: "Use POST para /api/ponto/limpar." }), {
        status: 405,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }
    response = await limparPontoCelulaController(request);
  } else if (url.pathname === "/api/ponto/playlists/limpar") {
    if (request.method !== "POST") {
      return new Response(
        JSON.stringify({ success: false, error: "Use POST para /api/ponto/playlists/limpar." }),
        { status: 405, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
      );
    }
    response = await limparInvestimentoController(request);
  } else if (url.pathname === "/api/empire-tv/gifs") {
    response = await listTvChatGifsController();
  } else if (url.pathname === "/api/artistas/vincular") {
    if (request.method !== "POST") {
      return new Response(
        JSON.stringify({ success: false, error: "Use POST para /api/artistas/vincular." }),
        { status: 405, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
      );
    }
    response = await vincularArtistaController(request);
  } else if (url.pathname === "/api/artistas/criar") {
    if (request.method !== "POST") {
      return new Response(
        JSON.stringify({ success: false, error: "Use POST para /api/artistas/criar." }),
        { status: 405, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
      );
    }
    response = await criarArtistaController(request);
  } else if (url.pathname === "/api/artistas/foto") {
    if (request.method !== "POST") {
      return new Response(
        JSON.stringify({ success: false, error: "Use POST para /api/artistas/foto." }),
        { status: 405, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
      );
    }
    response = await setArtistFotoController(request);
  } else if (url.pathname === "/api/tv/presenca") {
    response =
      request.method === "GET"
        ? await listarPresencaTVController(request)
        : request.method === "POST"
          ? await registrarPresencaTVController(request)
          : new Response(
              JSON.stringify({ success: false, error: "Use GET ou POST para /api/tv/presenca." }),
              { status: 405, headers: { "Content-Type": "application/json" } },
            );
  } else if (url.pathname === "/api/tv/processar-participacao") {
    if (request.method !== "POST") {
      return new Response(
        JSON.stringify({ success: false, error: "Use POST para /api/tv/processar-participacao." }),
        { status: 405, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
      );
    }
    try {
      const resultado = await processarParticipacaoTV();
      response = new Response(JSON.stringify({ success: true, data: resultado }), {
        status: 200,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    } catch (error: any) {
      response = new Response(
        JSON.stringify({ success: false, error: error.message || "Erro ao processar participação." }),
        { status: 500, headers: { "Content-Type": "application/json; charset=utf-8" } },
      );
    }
  } else if (url.pathname === "/api/social/news") {
    response =
      request.method === "GET"
        ? await getSocialNewsController()
        : request.method === "POST"
          ? await saveSocialNewsController(request)
          : new Response(
              JSON.stringify({ success: false, error: "Use GET ou POST para /api/social/news." }),
              { status: 405, headers: { "Content-Type": "application/json" } },
            );
  } else if (url.pathname === "/api/auth/login") {
    if (request.method !== "POST") {
      return new Response(
        JSON.stringify({ success: false, error: "Use POST para /api/auth/login." }),
        { status: 405, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
      );
    }
    response = await loginController(request);
  } else if (url.pathname === "/api/charts") {
    response = await chartsApiController(request);
  } else if (url.pathname === "/api/auth/heartbeat") {
    if (request.method !== "POST") {
      return new Response(
        JSON.stringify({ success: false, error: "Use POST para /api/auth/heartbeat." }),
        { status: 405, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
      );
    }
    response = await authHeartbeatController(request);
  } else if (url.pathname === "/api/auth/perfil") {
    if (request.method !== "POST") {
      return new Response(
        JSON.stringify({ success: false, error: "Use POST para /api/auth/perfil." }),
        { status: 405, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
      );
    }
    response = await updateProfileController(request);
  } else if (url.pathname === "/api/auth/trocar-senha") {
    if (request.method !== "POST") {
      return new Response(
        JSON.stringify({ success: false, error: "Use POST para /api/auth/trocar-senha." }),
        { status: 405, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
      );
    }
    response = await trocarSenhaController(request);
  } else if (url.pathname === "/api/forum/comment") {
    if (request.method !== "POST") {
      return new Response(
        JSON.stringify({ success: false, error: "Use POST para /api/forum/comment." }),
        { status: 405, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
      );
    }
    response = await createCommentController(request);
  } else if (url.pathname === "/api/forum/comments") {
    if (request.method !== "GET") {
      return new Response(
        JSON.stringify({ success: false, error: "Use GET para /api/forum/comments." }),
        { status: 405, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
      );
    }
    response = await getCommentsController(request);
  } else if (url.pathname === "/api/forum/comment-reaction") {
    if (request.method !== "POST") {
      return new Response(
        JSON.stringify({ success: false, error: "Use POST para /api/forum/comment-reaction." }),
        { status: 405, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
      );
    }
    response = await toggleCommentReactionController(request);
  } else if (url.pathname === "/api/forum/comment-edit") {
    if (request.method !== "POST") {
      return new Response(
        JSON.stringify({ success: false, error: "Use POST para /api/forum/comment-edit." }),
        { status: 405, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
      );
    }
    response = await editCommentController(request);
  } else if (url.pathname === "/api/turnes/locais") {
    if (request.method !== "GET") {
      return new Response(
        JSON.stringify({ success: false, error: "Use GET para /api/turnes/locais." }),
        { status: 405, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
      );
    }
    response = await getLocaisTurneController();
  } else if (url.pathname === "/api/turnes/simular") {
    if (request.method !== "POST") {
      return new Response(
        JSON.stringify({ success: false, error: "Use POST para /api/turnes/simular." }),
        { status: 405, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
      );
    }
    response = await simularTurneController(request);
  } else if (url.pathname === "/api/turnes") {
    if (request.method !== "GET") {
      return new Response(JSON.stringify({ success: false, error: "Use GET para /api/turnes." }), {
        status: 405,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }
    response = await getTurnesController(request);
  } else if (url.pathname === "/api/turnes/detalhe") {
    if (request.method !== "GET") {
      return new Response(
        JSON.stringify({ success: false, error: "Use GET para /api/turnes/detalhe." }),
        { status: 405, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
      );
    }
    response = await getTurneDetalheController(request);
  } else if (url.pathname === "/api/turnes/criar") {
    if (request.method !== "POST") {
      return new Response(
        JSON.stringify({ success: false, error: "Use POST para /api/turnes/criar." }),
        { status: 405, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
      );
    }
    response = await criarTurneController(request);
  } else if (url.pathname === "/api/turnes/acao") {
    if (request.method !== "POST") {
      return new Response(
        JSON.stringify({ success: false, error: "Use POST para /api/turnes/acao." }),
        { status: 405, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
      );
    }
    response = await realizarAcaoDiaController(request);
  } else if (url.pathname === "/api/turnes/comentarios") {
    if (request.method !== "GET") {
      return new Response(
        JSON.stringify({ success: false, error: "Use GET para /api/turnes/comentarios." }),
        { status: 405, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
      );
    }
    response = await getComentariosTurneController(request);
  } else if (url.pathname === "/api/turnes/comentar") {
    if (request.method !== "POST") {
      return new Response(
        JSON.stringify({ success: false, error: "Use POST para /api/turnes/comentar." }),
        { status: 405, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
      );
    }
    response = await comentarTurneController(request);
  } else if (url.pathname === "/api/turnes/missoes") {
    if (request.method !== "GET") {
      return new Response(
        JSON.stringify({ success: false, error: "Use GET para /api/turnes/missoes." }),
        { status: 405, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
      );
    }
    response = await getMissoesController(request);
  } else if (url.pathname === "/api/turnes/feed") {
    if (request.method !== "GET") {
      return new Response(JSON.stringify({ success: false, error: "Use GET para /api/turnes/feed." }), {
        status: 405,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }
    response = await getFeedGlobalController(request);
  } else {
    if (request.method !== "GET") {
      return new Response(
        JSON.stringify({ success: false, error: "Método HTTP não suportado. Use GET." }),
        { status: 405, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
      );
    }

    switch (url.pathname) {
      case "/api/user/me":
        response = await getUserMeController(request);
        break;
      case "/api/user/nivel":
        response = await getNivelController(request);
        break;
      case "/api/artistas/meus-nomes":
        response = await getMeusArtistasNomesController(request);
        break;
      case "/api/artistas/disponiveis":
        response = await getArtistasDisponiveisController();
        break;
      case "/api/artistas/infos":
        response = await getArtistInfoController(request);
        break;
      case "/api/artistas/listar-todos":
        response = await getAllArtistasController();
        break;
      case "/api/artistas/calcular-fortuna-charts":
        response = await calcularFortunaChartsController();
        break;
      case "/api/tv/programas":
        response = await getProgramasTVController();
        break;
      case "/api/gestao/musicas-em-chart":
        response = await getMusicasEmChartController();
        break;
      case "/api/gestao/faixas-sem-album":
        response = await getFaixasSemAlbumController(request);
        break;
      case "/api/gestao/meus-albuns":
        response = await getMeusAlbunsController();
        break;
      case "/api/gestao/album-faixas":
        response = await getAlbumFaixasController(request);
        break;
      case "/api/top-playlists":
        response = await getTopPlaylistsController();
        break;
      case "/api/lancamentos":
        response = await getLancamentosController(request);
        break;
      case "/api/musicas":
        response = await getCatalogKindController("musicas", request);
        break;
      case "/api/music-videos":
        response = await getCatalogKindController("music-videos", request);
        break;
      case "/api/videos":
        response = await getCatalogKindController("videos", request);
        break;
      case "/api/albuns":
        response = await getCatalogKindController("albuns", request);
        break;
      default:
        return null;
    }
  }

  // Attach CORS headers
  const headers = new Headers(response.headers);
  Object.entries(CORS_HEADERS).forEach(([key, val]) => {
    headers.set(key, val);
  });

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
