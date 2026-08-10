import {
  getCatalogKindController,
  getLancamentosController,
  getTopPlaylistsController,
} from "../controllers/catalogController";
import { getUserMeController } from "../controllers/userController";
import {
  createCommentController,
  getCommentsController,
  toggleCommentReactionController,
} from "../controllers/forumController";
import {
  createAlbumController,
  createSongController,
  createVideoController,
  getMeusAlbunsController,
  getMusicasEmChartController,
  substituirAlbumController,
  uploadDriveController,
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
} from "../controllers/empirePlayController";
import { reportVideoIssueController } from "../controllers/reportVideoController";
import { reportWrongContentController } from "../controllers/reportWrongContentController";
import { loginController } from "../controllers/authController";
import { getMeusArtistasNomesController } from "../controllers/artistasController";
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

  const supportedPaths = new Set([
    "/api/auth/login",
    "/api/artistas/meus-nomes",
    "/api/user/me",
    "/api/top-playlists",
    "/api/lancamentos",
    "/api/musicas",
    "/api/music-videos",
    "/api/videos",
    "/api/albuns",
    "/api/forum/comment",
    "/api/forum/comments",
    "/api/forum/comment-reaction",
    "/api/gestao/musica",
    "/api/gestao/video",
    "/api/gestao/album",
    "/api/gestao/album/substituir",
    "/api/gestao/musicas-em-chart",
    "/api/gestao/meus-albuns",
    "/api/gestao/upload",
    "/api/editar",
    "/api/empire-play/home",
    "/api/empire-play/user",
    "/api/empire-play/musicas",
    "/api/empire-play/music-videos",
    "/api/empire-play/videos",
    "/api/empire-play/albuns",
    "/api/empire-play/report-video-issue",
    "/api/empire-play/report-wrong-content",
  ]);

  if (!supportedPaths.has(url.pathname) && !isEditarPath && !isEmpirePlayPath) {
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
  } else if (url.pathname === "/api/gestao/upload") {
    if (request.method !== "POST") {
      return new Response(
        JSON.stringify({ success: false, error: "Use POST para /api/gestao/upload." }),
        { status: 405, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
      );
    }
    response = await uploadDriveController(request);
  } else if (url.pathname === "/api/auth/login") {
    if (request.method !== "POST") {
      return new Response(
        JSON.stringify({ success: false, error: "Use POST para /api/auth/login." }),
        { status: 405, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
      );
    }
    response = await loginController(request);
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
      case "/api/artistas/meus-nomes":
        response = await getMeusArtistasNomesController(request);
        break;
      case "/api/gestao/musicas-em-chart":
        response = await getMusicasEmChartController();
        break;
      case "/api/gestao/meus-albuns":
        response = await getMeusAlbunsController();
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
