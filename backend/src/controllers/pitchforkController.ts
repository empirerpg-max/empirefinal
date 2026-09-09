import { googleSheetsService, normalizeText, normalizeHeader, ensureSheetTab } from "../services/googleSheetsService";
import { resolveNomeOficial } from "./forumController";

// Foto de perfil de quem comentou — resolvida na LEITURA, não gravada no
// comentário (senão fica presa na foto antiga de quando comentou, mesmo
// que a pessoa troque de foto depois). Mesma fonte que o fórum usa: aba
// "Usuários" (planilha usuarios), colunas id / foto_do_perfil.
async function mapaFotosPorJogadorId(): Promise<Map<string, string>> {
  const rows = await googleSheetsService.usuarios.readValues("Usuários").catch(() => []);
  const headers = rows[0] || [];
  const idColIdx = headers.findIndex((h) => normalizeHeader(h) === "id");
  const fotoColIdx = headers.findIndex((h) => normalizeHeader(h) === "foto_do_perfil");
  const mapa = new Map<string, string>();
  if (idColIdx === -1 || fotoColIdx === -1) return mapa;
  for (const r of rows.slice(1)) {
    const id = normalizeText(r[idColIdx]);
    const foto = normalizeText(r[fotoColIdx]);
    if (id && foto) mapa.set(id, foto);
  }
  return mapa;
}

// "Pitchfork"/Empirefork — aba própria dentro de Acervo, no estilo de
// revista online (referência: pitchfork.com/reviews/best/tracks). Dois
// blocos, um por edição do mês:
//   - BEST_NEW_TRACK: a música mais bem avaliada lançada nas últimas 2
//     semanas (nota Metacritic real, sem geração por IA — cálculo simples).
//   - TOP_ARTIST: o artista #1 em pontos de posição no Billboard Hot 100 +
//     Billboard 200 do mês, com uma matéria escrita por IA (Gemini),
//     gerada DENTRO da planilha via Apps Script — não aqui no backend.
//
// Esse controller só LÊ a aba "Pitchfork" (planilha chartsTop50, já
// registrada em SPREADSHEETS) pronta, exatamente como foi deixada pelo
// Apps Script — nunca escreve nela, nunca chama IA. Aba: Tipo | PeriodoId
// | Titulo | Artista | CapaUrl | Nota | Texto | LinkTipo | LinkId | GeradoEm.
const SHEET = "Pitchfork";

// Curtidas E comentários das edições ficam numa aba só, UMA linha por
// edição (Tipo+PeriodoId), cada um guardado como JSON dentro da própria
// célula — não uma linha por comentário. Menos linhas = menos leitura/
// escrita na planilha (evita crescer sem limite e estourar cota/custo do
// Sheets API só por causa de comentário).
//
// Fica na planilha "principal" (catálogo), NÃO na "editorial"
// (chartsTop50) — essa última é mantida fora do app (só leitura pro
// backend, quem escreve nela é o Apps Script rodando como dono da
// planilha); o service account do backend não tem permissão de edição
// lá, só de leitura. "principal" já é gravável (é onde
// Comentarios_Musicas/Comentarios_Albuns vivem), então as interações do
// Empirefork usam essa mesma planilha.
const INTERACOES_SHEET = "Pitchfork_Interacoes";

// Cada geração mensal também vai pra uma aba "Arquivo AAAA-MM" (ver
// arquivarEdicao() no Apps Script) — nunca sobrescrita, só cresce. Não tem
// como listar abas da planilha por aqui, então geramos os nomes de mês
// candidatos (do lançamento do recurso até o mês atual) e testamos cada um.
const ARQUIVO_PREFIXO = "Arquivo ";
const ARQUIVO_MES_INICIAL = "2026-09"; // mês em que o Empirefork foi lançado

export interface PitchforkEdicao {
  tipo: "BEST_NEW_TRACK" | "TOP_ARTIST";
  periodoId: string;
  titulo: string;
  artista: string;
  capaUrl: string | null;
  nota: number | null;
  texto: string;
  linkTipo: string | null;
  linkId: string | null;
  geradoEm: string | null;
  curtidas: number;
  curtidoPorMim: boolean;
  comentarios: number;
}

export interface PitchforkComentario {
  id: string;
  jogadorId: string;
  nome: string;
  fotoPerfil: string | null;
  comentario: string;
  data: string;
}

interface InteracoesRow {
  curtidas: string[];
  comentarios: PitchforkComentario[];
}

function parseInteracoesRow(r: string[]): InteracoesRow {
  let curtidas: string[] = [];
  let comentarios: PitchforkComentario[] = [];
  try {
    curtidas = JSON.parse(normalizeText(r[2]) || "[]");
  } catch {
    curtidas = [];
  }
  try {
    comentarios = JSON.parse(normalizeText(r[3]) || "[]");
  } catch {
    comentarios = [];
  }
  return { curtidas, comentarios };
}

async function lerInteracoes(): Promise<{ rows: string[][]; porChave: Map<string, InteracoesRow> }> {
  const rows = await googleSheetsService.principal.readValues(INTERACOES_SHEET).catch(() => []);
  const porChave = new Map<string, InteracoesRow>();
  for (const r of rows.slice(1)) {
    const tipo = normalizeText(r[0]);
    const periodoId = normalizeText(r[1]);
    if (!tipo || !periodoId) continue;
    porChave.set(`${tipo}::${periodoId}`, parseInteracoesRow(r));
  }
  return { rows, porChave };
}

function mapearEdicoes(
  rows: string[][],
  interacoesPorChave: Map<string, InteracoesRow>,
  jogadorId: string,
): PitchforkEdicao[] {
  return rows.slice(1).reduce<PitchforkEdicao[]>((acc, r) => {
    const tipo = normalizeText(r[0]);
    if (tipo !== "BEST_NEW_TRACK" && tipo !== "TOP_ARTIST") return acc;
    const notaRaw = normalizeText(r[5]);
    const periodoId = normalizeText(r[1]);
    const interacoes = interacoesPorChave.get(`${tipo}::${periodoId}`) || { curtidas: [], comentarios: [] };
    acc.push({
      tipo,
      periodoId,
      titulo: normalizeText(r[2]),
      artista: normalizeText(r[3]),
      capaUrl: normalizeText(r[4]) || null,
      nota: notaRaw && Number.isFinite(Number(notaRaw)) ? Number(notaRaw) : null,
      texto: normalizeText(r[6]),
      linkTipo: normalizeText(r[7]) || null,
      linkId: normalizeText(r[8]) || null,
      geradoEm: normalizeText(r[9]) || null,
      curtidas: interacoes.curtidas.length,
      curtidoPorMim: !!jogadorId && interacoes.curtidas.includes(jogadorId),
      comentarios: interacoes.comentarios.length,
    });
    return acc;
  }, []);
}

export async function getPitchforkController(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const jogadorId = normalizeText(url.searchParams.get("jogadorId") || "");

    const [rows, { porChave }] = await Promise.all([
      googleSheetsService.chartsTop50.readValues(SHEET).catch(() => []),
      lerInteracoes(),
    ]);

    const edicoes = mapearEdicoes(rows, porChave, jogadorId);

    return new Response(JSON.stringify({ success: true, data: { edicoes } }), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  } catch (error: any) {
    return new Response(
      JSON.stringify({ success: false, error: error.message || "Erro ao ler a edição do Pitchfork." }),
      { status: 500, headers: { "Content-Type": "application/json; charset=utf-8" } },
    );
  }
}

// Lista os meses (AAAA-MM) que têm aba "Arquivo AAAA-MM" com dado — do mês
// de lançamento do recurso até o mês atual.
export async function getPitchforkMesesController(): Promise<Response> {
  try {
    const candidatos: string[] = [];
    const [anoIni, mesIni] = ARQUIVO_MES_INICIAL.split("-").map(Number);
    const inicio = new Date(anoIni, mesIni - 1, 1);
    const agora = new Date();
    const cursor = new Date(agora.getFullYear(), agora.getMonth(), 1);
    while (cursor >= inicio) {
      candidatos.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`);
      cursor.setMonth(cursor.getMonth() - 1);
    }

    const resultados = await Promise.all(
      candidatos.map(async (mes) => {
        const rows = await googleSheetsService.chartsTop50.readValues(ARQUIVO_PREFIXO + mes).catch(() => []);
        return { mes, temEdicao: rows.length > 1 };
      }),
    );

    return new Response(
      JSON.stringify({ success: true, data: { meses: resultados.filter((r) => r.temEdicao).map((r) => r.mes) } }),
      { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
    );
  } catch (error: any) {
    return new Response(
      JSON.stringify({ success: false, error: error.message || "Erro ao listar os meses do arquivo." }),
      { status: 500, headers: { "Content-Type": "application/json; charset=utf-8" } },
    );
  }
}

// Edições arquivadas de um mês específico (AAAA-MM) — mesmo schema da aba
// "Pitchfork", só que histórico (pode ter mais de uma linha por Tipo, já
// que arquivarEdicao() só acrescenta, nunca sobrescreve).
export async function getPitchforkArquivoController(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const mes = normalizeText(url.searchParams.get("mes") || "");
    const jogadorId = normalizeText(url.searchParams.get("jogadorId") || "");
    if (!mes) {
      return new Response(JSON.stringify({ success: false, error: "mes é obrigatório (formato AAAA-MM)." }), {
        status: 400,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }

    const [rows, { porChave }] = await Promise.all([
      googleSheetsService.chartsTop50.readValues(ARQUIVO_PREFIXO + mes).catch(() => []),
      lerInteracoes(),
    ]);

    const edicoes = mapearEdicoes(rows, porChave, jogadorId);

    return new Response(JSON.stringify({ success: true, data: { edicoes } }), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  } catch (error: any) {
    return new Response(
      JSON.stringify({ success: false, error: error.message || "Erro ao ler o arquivo do Empirefork." }),
      { status: 500, headers: { "Content-Type": "application/json; charset=utf-8" } },
    );
  }
}

export async function getPitchforkComentariosController(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const tipo = normalizeText(url.searchParams.get("tipo") || "");
    const periodoId = normalizeText(url.searchParams.get("periodoId") || "");
    if (!tipo || !periodoId) {
      return new Response(JSON.stringify({ success: false, error: "tipo e periodoId são obrigatórios." }), {
        status: 400,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }

    const [{ porChave }, fotos] = await Promise.all([lerInteracoes(), mapaFotosPorJogadorId()]);
    const comentarios = (porChave.get(`${tipo}::${periodoId}`)?.comentarios || [])
      .slice()
      .reverse()
      .map((c) => ({ ...c, fotoPerfil: fotos.get(c.jogadorId) || c.fotoPerfil }));

    return new Response(JSON.stringify({ success: true, data: { comentarios } }), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  } catch (error: any) {
    return new Response(
      JSON.stringify({ success: false, error: error.message || "Erro ao ler os comentários." }),
      { status: 500, headers: { "Content-Type": "application/json; charset=utf-8" } },
    );
  }
}

// Acha (ou cria) a linha de interações de uma edição na aba
// "Pitchfork_Interacoes" e devolve o índice da linha (1-based, incluindo
// cabeçalho) + o estado atual já parseado.
async function acharOuCriarLinhaInteracoes(
  tipo: string,
  periodoId: string,
): Promise<{ linha: number; estado: InteracoesRow }> {
  // A aba nunca foi criada manualmente na planilha "principal" — sem isso,
  // appendRow/updateValues apontam pra uma faixa (ex: "Pitchfork_Interacoes!A:ZZ")
  // que não existe, e falham. ensureSheetTab é idempotente (só cria se faltar).
  await ensureSheetTab("principal", INTERACOES_SHEET);

  const rows = await googleSheetsService.principal.readValues(INTERACOES_SHEET).catch(() => []);
  if (rows.length === 0) {
    const cabecalho = await googleSheetsService.principal.appendRow(INTERACOES_SHEET, [
      "Tipo",
      "PeriodoId",
      "CurtidasJson",
      "ComentariosJson",
    ]);
    if (cabecalho === null) throw new Error('Não foi possível criar o cabeçalho da aba "Pitchfork_Interacoes".');
  }

  const idx = rows.slice(1).findIndex((r) => normalizeText(r[0]) === tipo && normalizeText(r[1]) === periodoId);
  if (idx !== -1) {
    return { linha: idx + 2, estado: parseInteracoesRow(rows[idx + 1]) };
  }

  const linhaNova = await googleSheetsService.principal.appendRow(INTERACOES_SHEET, [tipo, periodoId, "[]", "[]"]);
  if (linhaNova === null) throw new Error('Não foi possível criar a linha de interações na aba "Pitchfork_Interacoes".');
  return { linha: linhaNova, estado: { curtidas: [], comentarios: [] } };
}

interface CriarComentarioBody {
  tipo: "BEST_NEW_TRACK" | "TOP_ARTIST";
  periodoId: string;
  jogadorId: string;
  nomeJogador: string;
  fotoPerfil?: string;
  comentario: string;
}

export async function createPitchforkComentarioController(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as CriarComentarioBody;
    const tipo = normalizeText(body.tipo);
    const periodoId = normalizeText(body.periodoId);
    const jogadorId = normalizeText(body.jogadorId);
    const comentario = (body.comentario || "").trim();

    if (!tipo || !periodoId || !jogadorId || !comentario) {
      return new Response(
        JSON.stringify({ success: false, error: "Campos obrigatórios ausentes." }),
        { status: 400, headers: { "Content-Type": "application/json; charset=utf-8" } },
      );
    }

    const nomeOficial = await resolveNomeOficial(jogadorId, (body.nomeJogador || "").trim());
    const { linha, estado } = await acharOuCriarLinhaInteracoes(tipo, periodoId);

    const novoComentario: PitchforkComentario = {
      id: `pf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      jogadorId,
      nome: nomeOficial,
      fotoPerfil: body.fotoPerfil || null,
      comentario,
      data: new Date().toISOString(),
    };
    const comentarios = [...estado.comentarios, novoComentario];

    await googleSheetsService.principal.updateValues(INTERACOES_SHEET, `D${linha}`, [
      [JSON.stringify(comentarios)],
    ]);

    return new Response(
      JSON.stringify({ success: true, data: novoComentario }),
      { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
    );
  } catch (error: any) {
    return new Response(
      JSON.stringify({ success: false, error: error.message || "Erro ao publicar o comentário." }),
      { status: 500, headers: { "Content-Type": "application/json; charset=utf-8" } },
    );
  }
}

interface ToggleCurtidaBody {
  tipo: "BEST_NEW_TRACK" | "TOP_ARTIST";
  periodoId: string;
  jogadorId: string;
}

export async function togglePitchforkCurtidaController(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as ToggleCurtidaBody;
    const tipo = normalizeText(body.tipo);
    const periodoId = normalizeText(body.periodoId);
    const jogadorId = normalizeText(body.jogadorId);
    if (!tipo || !periodoId || !jogadorId) {
      return new Response(
        JSON.stringify({ success: false, error: "Campos obrigatórios ausentes." }),
        { status: 400, headers: { "Content-Type": "application/json; charset=utf-8" } },
      );
    }

    const { linha, estado } = await acharOuCriarLinhaInteracoes(tipo, periodoId);
    const curtiu = estado.curtidas.includes(jogadorId);
    const curtidas = curtiu ? estado.curtidas.filter((id) => id !== jogadorId) : [...estado.curtidas, jogadorId];

    await googleSheetsService.principal.updateValues(INTERACOES_SHEET, `C${linha}`, [
      [JSON.stringify(curtidas)],
    ]);

    return new Response(
      JSON.stringify({ success: true, data: { curtidas: curtidas.length, curtidoPorMim: !curtiu } }),
      { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
    );
  } catch (error: any) {
    return new Response(
      JSON.stringify({ success: false, error: error.message || "Erro ao curtir." }),
      { status: 500, headers: { "Content-Type": "application/json; charset=utf-8" } },
    );
  }
}
