// Perfil do artista lido do espelho D1 (tabela `artistas`) e editado pelo
// dono/admin: GET/POST /api/artistas/perfil, GET /api/artistas/generos e as
// rotas de admin (importar, atualizar a partir da planilha). Também o passo
// do cron de 10 min (importação única, fila de cópia para a planilha e
// reconciliação de hora em hora).
import { getCatalogoDb, type D1DatabaseLike } from "../services/catalogoDbService";
import {
  atualizarDaPlanilha,
  buscarArtista,
  descarregarPendencias,
  enfileirarPendencias,
  fontesDaPlanilha,
  gravarPerfil,
  importacaoFeita,
  importarArtistas,
  listarGeneros,
  reconciliarArtistas,
  type Artista,
  type CamposEditaveis,
  type CelulaArtistas,
  type ResultadoDescarga,
} from "../services/artistasD1";
import { googleSheetsService } from "../services/googleSheetsService";
import { extractBearerToken, requestProvesAdmin, verifySessionToken } from "../services/sessionService";

type Ctx = { waitUntil: (promise: Promise<unknown>) => void };

export const ERRO_SO_DONO = "Só o dono do artista pode editar.";
const ABA_ARTISTAS = "ARTISTAS";
const MARCA_RECONCILIADO = "artistas_d1_reconciliado_em";
const MARCA_IMPORTACAO_TENTADA = "artistas_d1_importacao_tentada_em";
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
 * `copiar` do gravarPerfil: as células entram na fila de cópia
 * (artistas_pendencias_planilha) antes de tudo e a cópia para a aba
 * ARTISTAS roda em segundo plano (ctx.waitUntil) quando dá, com uma nova
 * tentativa se o Google recusar. O que não for aceito fica na fila e o cron
 * tenta de novo; a edição no D1 já valeu.
 */
export function copiaEmSegundoPlano(db: D1DatabaseLike, ctx?: Ctx) {
  return async (celulas: { coluna: string; valor: string }[], idUnico: string): Promise<void> => {
    await enfileirarPendencias(db, celulas.map((c) => ({ ...c, idUnico })));
    const tarefa = descarregarPendencias(db, [idUnico])
      .then((r) => (r.restantes ? descarregarPendencias(db, [idUnico]) : r))
      .then((r) => {
        if (r.restantes) console.warn(`[artistasPerfil] Cópia para a ARTISTAS ficou na fila (${idUnico}):`, r.erro);
      })
      .catch((e) => console.warn(`[artistasPerfil] Cópia para a ARTISTAS falhou (${idUnico}):`, e));
    if (ctx?.waitUntil) {
      ctx.waitUntil(tarefa);
      return;
    }
    await tarefa;
  };
}

/** Texto curto do resultado de uma descarga da fila (para o admin/cron). */
function textoDescarga(r: ResultadoDescarga): string {
  if (r.restantes) return `falhou: ${r.erro ?? "células ainda na fila"} (${r.restantes} na fila)`;
  return r.escritas || r.descartadas ? "ok" : "nada a copiar";
}

/** Põe na fila as células que a importação trouxe da INFOS ACTS e tenta copiá-las já. */
async function copiarCelulasDaImportacao(db: D1DatabaseLike, celulas: CelulaArtistas[]): Promise<string> {
  if (!celulas.length) return "nada a copiar";
  await enfileirarPendencias(db, celulas);
  return textoDescarga(await descarregarPendencias(db));
}

export const ERRO_PENDENCIAS = "Há alterações aguardando cópia para a planilha. Tente de novo em alguns minutos.";

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
  const r = await gravarPerfil(db, artista.idUnico, camposDoCorpo(corpo), permissao.ehAdmin, copiaEmSegundoPlano(db, ctx));
  if (!r.ok) return json({ success: false, error: r.erro }, r.status);
  return json({ success: true, data: r.artista });
}

async function postImportar(db: D1DatabaseLike): Promise<Response> {
  const r = await importarArtistas(db);
  const copiaPlanilha = await copiarCelulasDaImportacao(db, r.celulas);
  return json({ success: true, data: { total: r.total, complementados: r.complementados, celulas: r.celulas.length, copiaPlanilha } });
}

async function postAtualizarDaPlanilha(db: D1DatabaseLike, request: Request): Promise<Response> {
  const corpo = (await request.json().catch(() => ({}))) as { idUnico?: unknown };
  const idUnico = typeof corpo.idUnico === "string" && corpo.idUnico.trim() ? corpo.idUnico.trim() : undefined;
  // Antes de sobrescrever o app com a planilha, a planilha tem de ter as
  // edições do app: descarrega a fila (do artista ou de todos); se ainda
  // sobrar algo, recusa — senão dados velhos da planilha apagariam edições.
  const fila = await descarregarPendencias(db, idUnico ? [idUnico] : undefined);
  if (fila.restantes) return json({ success: false, error: ERRO_PENDENCIAS }, 409);
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
 * Passo do cron de 10 min. Sem a marca da importação, roda a importação
 * única (no máximo 1 tentativa por hora enquanto falhar — hora da última
 * tentativa em chart_config), já com a cópia das células completadas para
 * a ARTISTAS. Depois dela: a cada execução, tenta copiar a fila de
 * pendências (uma leitura + uma gravação batch, só se houver fila) e a
 * reconciliação planilha -> D1 roda no máximo 1x por hora. Devolve o que fez.
 */
export async function rodarCronArtistas(
  db: D1DatabaseLike,
  agora: Date = new Date(),
  deps: {
    fontes?: ReturnType<typeof fontesDaPlanilha>;
    descarregar?: (db: D1DatabaseLike) => Promise<ResultadoDescarga>;
  } = {},
): Promise<
  | { acao: "importou"; total: number; copiaPlanilha: string }
  | { acao: "reconciliou"; mudancas: number; pendencias?: string }
  | { acao: "nada"; pendencias?: string }
> {
  const fontes = deps.fontes ?? fontesDaPlanilha();
  const descarregar = deps.descarregar ?? ((d: D1DatabaseLike) => descarregarPendencias(d));
  const recente = async (chave: string): Promise<boolean> => {
    const { results } = await db.prepare("SELECT valor FROM chart_config WHERE chave = ?").bind(chave).all<{ valor: string }>();
    const ultima = Date.parse(results[0]?.valor ?? "");
    return Number.isFinite(ultima) && agora.getTime() - ultima < UMA_HORA_MS;
  };
  // Marca antes de ler: uma planilha fora do ar não vira leitura a cada 10 min
  const marcar = (chave: string) =>
    db.prepare("INSERT OR REPLACE INTO chart_config (chave, valor) VALUES (?, ?)").bind(chave, agora.toISOString()).run();

  if (!(await importacaoFeita(db))) {
    if (await recente(MARCA_IMPORTACAO_TENTADA)) return { acao: "nada" };
    await marcar(MARCA_IMPORTACAO_TENTADA);
    const r = await importarArtistas(db, fontes, agora);
    if (r.celulas.length) await enfileirarPendencias(db, r.celulas, agora);
    const copiaPlanilha = r.celulas.length ? textoDescarga(await descarregar(db)) : "nada a copiar";
    return { acao: "importou", total: r.total, copiaPlanilha };
  }

  const fila = await descarregar(db);
  const pendencias = fila.escritas || fila.descartadas || fila.restantes ? textoDescarga(fila) : undefined;
  const extra = pendencias ? { pendencias } : {};
  if (await recente(MARCA_RECONCILIADO)) return { acao: "nada", ...extra };
  await marcar(MARCA_RECONCILIADO);
  const mudancas = await reconciliarArtistas(db, await fontes.artistas(), agora);
  return { acao: "reconciliou", mudancas, ...extra };
}
