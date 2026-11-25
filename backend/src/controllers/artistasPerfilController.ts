// Perfil do artista lido do espelho D1 (tabela `artistas`) e editado pelo
// dono/admin: GET/POST /api/artistas/perfil, GET /api/artistas/generos e as
// rotas de admin (importar, atualizar a partir da planilha). Também o passo
// do cron de 10 min (importação única / reconciliação de hora em hora).
import { getCatalogoDb, type D1DatabaseLike } from "../services/catalogoDbService";
import {
  atualizarDaPlanilha,
  buscarArtista,
  copiarCelulasArtistas,
  copiarParaArtistas,
  fontesDaPlanilha,
  gravarPerfil,
  importacaoFeita,
  importarArtistas,
  listarGeneros,
  reconciliarArtistas,
  type Artista,
  type CamposEditaveis,
  type CelulaArtistas,
} from "../services/artistasD1";
import { googleSheetsService } from "../services/googleSheetsService";
import { extractBearerToken, requestProvesAdmin, verifySessionToken } from "../services/sessionService";

type Ctx = { waitUntil: (promise: Promise<unknown>) => void };

export const ERRO_SO_DONO = "Só o dono do artista pode editar.";
const ABA_ARTISTAS = "ARTISTAS";
const MARCA_RECONCILIADO = "artistas_d1_reconciliado_em";
const UMA_HORA_MS = 60 * 60 * 1000;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

/**
 * Quem pode editar o artista: o dono (ID Usuário = usuário da sessão) ou um
 * admin de verdade. Sem sessão válida, ninguém.
 */
export async function permissaoDeEdicao(
  request: Request,
  artista: Artista,
): Promise<{ ok: true; ehAdmin: boolean } | { ok: false }> {
  const sessao = await verifySessionToken(extractBearerToken(request));
  if (!sessao) return { ok: false };
  const ehAdmin = await requestProvesAdmin(request);
  const ehDono = !!artista.idUsuario && sessao.id.trim() === artista.idUsuario.trim();
  if (ehDono || ehAdmin) return { ok: true, ehAdmin };
  return { ok: false };
}

/**
 * `copiar` do gravarPerfil: a cópia para a aba ARTISTAS roda em segundo
 * plano (ctx.waitUntil) quando dá, com uma nova tentativa se o Google
 * recusar; falha só é logada (a edição no D1 já valeu).
 */
export function copiaEmSegundoPlano(ctx?: Ctx) {
  return (celulas: { coluna: string; valor: string }[], linha: number): Promise<void> => {
    const tarefa = copiarParaArtistas(celulas, linha)
      .catch(() => copiarParaArtistas(celulas, linha))
      .catch((e) => console.warn(`[artistasPerfil] Cópia para a ARTISTAS falhou (linha ${linha}):`, e));
    if (ctx?.waitUntil) {
      ctx.waitUntil(tarefa);
      return Promise.resolve();
    }
    return tarefa;
  };
}

/** Escreve na ARTISTAS as células que a importação completou a partir da INFOS ACTS. */
async function copiarCelulasDaImportacao(celulas: CelulaArtistas[]): Promise<string> {
  if (!celulas.length) return "nada a copiar";
  try {
    await copiarCelulasArtistas(celulas);
    return "ok";
  } catch (e1) {
    try {
      await copiarCelulasArtistas(celulas);
      return "ok";
    } catch (e2) {
      console.warn("[artistasPerfil] Cópia das células da importação falhou:", e1, e2);
      return `falhou: ${String((e2 as Error)?.message ?? e2)}`;
    }
  }
}

/** Campos editáveis aceitos no corpo do POST (o resto é ignorado). */
function camposDoCorpo(corpo: Record<string, unknown>): CamposEditaveis {
  const campos: CamposEditaveis = {};
  for (const k of ["fotoUrl", "capaPerfilUrl", "capaPerfilMobileUrl", "biografia", "generoPrincipal", "pais"] as const) {
    const v = corpo[k];
    if (typeof v === "string") campos[k] = v;
  }
  return campos;
}

async function getPerfil(db: D1DatabaseLike, request: Request): Promise<Response> {
  const nome = (new URL(request.url).searchParams.get("nome") || "").trim();
  if (!nome) return json({ success: false, error: "nome é obrigatório." }, 400);
  const artista = await buscarArtista(db, nome);
  if (!artista) return json({ success: false, error: "Artista não encontrado." }, 404);
  return json({ success: true, data: artista });
}

async function postPerfil(db: D1DatabaseLike, request: Request, ctx?: Ctx): Promise<Response> {
  const corpo = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const nome = typeof corpo.nome === "string" ? corpo.nome.trim() : "";
  if (!nome) return json({ success: false, error: "nome é obrigatório." }, 400);
  const artista = await buscarArtista(db, nome);
  if (!artista) return json({ success: false, error: "Artista não encontrado." }, 404);
  const permissao = await permissaoDeEdicao(request, artista);
  if (!permissao.ok) return json({ success: false, error: ERRO_SO_DONO }, 403);
  const r = await gravarPerfil(db, artista.idUnico, camposDoCorpo(corpo), permissao.ehAdmin, copiaEmSegundoPlano(ctx));
  if (!r.ok) return json({ success: false, error: r.erro }, r.status);
  return json({ success: true, data: r.artista });
}

async function postImportar(db: D1DatabaseLike): Promise<Response> {
  const r = await importarArtistas(db);
  const copiaPlanilha = await copiarCelulasDaImportacao(r.celulas);
  return json({ success: true, data: { total: r.total, complementados: r.complementados, celulas: r.celulas.length, copiaPlanilha } });
}

async function postAtualizarDaPlanilha(db: D1DatabaseLike, request: Request): Promise<Response> {
  const corpo = (await request.json().catch(() => ({}))) as { idUnico?: unknown };
  const idUnico = typeof corpo.idUnico === "string" && corpo.idUnico.trim() ? corpo.idUnico.trim() : undefined;
  // Leitura sem cache: o admin acabou de corrigir a planilha
  const linhas = await googleSheetsService.usuarios.readValuesFresh(ABA_ARTISTAS);
  const data = await atualizarDaPlanilha(db, linhas, idUnico);
  if (idUnico && !data.length) return json({ success: false, error: "Artista não encontrado na planilha." }, 404);
  return json({ success: true, data });
}

/** Roteador das rotas de perfil/admin de artistas. */
export async function artistasPerfilController(request: Request, ctx?: Ctx): Promise<Response> {
  try {
    const db = getCatalogoDb();
    if (!db) return json({ success: false, error: "Banco de dados indisponível." }, 503);
    const { pathname } = new URL(request.url);
    const metodo = request.method;

    if (pathname === "/api/artistas/perfil") {
      if (metodo === "GET") return await getPerfil(db, request);
      if (metodo === "POST") return await postPerfil(db, request, ctx);
      return json({ success: false, error: "Método não permitido." }, 405);
    }
    if (pathname === "/api/artistas/generos") {
      if (metodo !== "GET") return json({ success: false, error: "Use GET para /api/artistas/generos." }, 405);
      return json({ success: true, data: await listarGeneros(db) });
    }
    if (pathname === "/api/admin/artistas/importar" || pathname === "/api/admin/artistas/atualizar-da-planilha") {
      if (metodo !== "POST") return json({ success: false, error: `Use POST para ${pathname}.` }, 405);
      if (!(await requestProvesAdmin(request))) return json({ success: false, error: "Acesso restrito ao admin." }, 403);
      if (pathname === "/api/admin/artistas/importar") return await postImportar(db);
      return await postAtualizarDaPlanilha(db, request);
    }
    return json({ success: false, error: "Rota não encontrada." }, 404);
  } catch (e) {
    console.error("[artistasPerfilController] Erro:", e);
    return json({ success: false, error: (e as Error)?.message || "Erro no perfil do artista." }, 500);
  }
}

/**
 * Passo do cron de 10 min: sem a marca da importação, roda a importação
 * única (com a cópia das células completadas para a ARTISTAS); depois dela,
 * a reconciliação planilha -> D1 no máximo 1x por hora (hora da última
 * tentativa em chart_config). Devolve o que fez.
 */
export async function rodarCronArtistas(
  db: D1DatabaseLike,
  agora: Date = new Date(),
  deps: {
    fontes?: ReturnType<typeof fontesDaPlanilha>;
    copiarCelulas?: (celulas: CelulaArtistas[]) => Promise<string>;
  } = {},
): Promise<{ acao: "importou"; total: number; copiaPlanilha: string } | { acao: "reconciliou"; mudancas: number } | { acao: "nada" }> {
  const fontes = deps.fontes ?? fontesDaPlanilha();
  if (!(await importacaoFeita(db))) {
    const r = await importarArtistas(db, fontes, agora);
    const copiaPlanilha = await (deps.copiarCelulas ?? copiarCelulasDaImportacao)(r.celulas);
    return { acao: "importou", total: r.total, copiaPlanilha };
  }
  const { results } = await db
    .prepare("SELECT valor FROM chart_config WHERE chave = ?")
    .bind(MARCA_RECONCILIADO)
    .all<{ valor: string }>();
  const ultima = Date.parse(results[0]?.valor ?? "");
  if (Number.isFinite(ultima) && agora.getTime() - ultima < UMA_HORA_MS) return { acao: "nada" };
  // Marca antes de ler: uma planilha fora do ar não vira leitura a cada 10 min
  await db
    .prepare("INSERT OR REPLACE INTO chart_config (chave, valor) VALUES (?, ?)")
    .bind(MARCA_RECONCILIADO, agora.toISOString())
    .run();
  const mudancas = await reconciliarArtistas(db, await fontes.artistas(), agora);
  return { acao: "reconciliou", mudancas };
}
