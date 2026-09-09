import { googleSheetsService, normalizeText } from "../services/googleSheetsService";
import { resolveNomeOficial } from "./forumController";

// "Pitchfork"/Empirefork — aba própria dentro de Acervo, no estilo de
// revista online (referência: pitchfork.com/reviews/best/tracks). Dois
// blocos, um por edição do mês:
//   - BEST_NEW_TRACK: a música mais bem avaliada lançada nas últimas 2
//     semanas (nota Metacritic real, sem geração por IA — cálculo simples).
//   - TOP_ARTIST: o artista com maior "Fortuna Charts" (pontuação
//     acumulada real nos charts, já calculada por calcularFortunaChartsController)
//     no momento da geração, com uma matéria escrita por IA (Gemini),
//     gerada DENTRO da planilha via Apps Script — não aqui no backend.
//
// Esse controller só LÊ a aba "Pitchfork" (planilha chartsTop50, já
// registrada em SPREADSHEETS) pronta, exatamente como foi deixada pelo
// Apps Script — nunca escreve nela, nunca chama IA. Aba: Tipo | PeriodoId
// | Titulo | Artista | CapaUrl | Nota | Texto | LinkTipo | LinkId | GeradoEm.
//
// Comentários e curtidas das edições, por outro lado, SÃO gravados por
// este controller (o Apps Script não sabe nada disso) — em duas abas
// próprias na mesma planilha chartsTop50, chaveadas por Tipo+PeriodoId
// (a edição atual), já que o Pitchfork só guarda uma linha por Tipo:
//   - "Pitchfork_Comentarios": Id | Tipo | PeriodoId | JogadorId | Nome | FotoPerfil | Comentario | Data
//   - "Pitchfork_Curtidas": Tipo | PeriodoId | JogadoresJson (array JSON de jogadorId)
const SHEET = "Pitchfork";
const COMENTARIOS_SHEET = "Pitchfork_Comentarios";
const CURTIDAS_SHEET = "Pitchfork_Curtidas";

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

async function contarCurtidas(
  tipo: string,
  periodoId: string,
  jogadorId: string,
): Promise<{ total: number; curtiPorMim: boolean }> {
  const rows = await googleSheetsService.chartsTop50.readValues(CURTIDAS_SHEET).catch(() => []);
  const linha = rows.slice(1).find((r) => normalizeText(r[0]) === tipo && normalizeText(r[1]) === periodoId);
  if (!linha) return { total: 0, curtiPorMim: false };
  try {
    const lista: string[] = JSON.parse(normalizeText(linha[2]) || "[]");
    return { total: lista.length, curtiPorMim: !!jogadorId && lista.includes(jogadorId) };
  } catch {
    return { total: 0, curtiPorMim: false };
  }
}

export async function getPitchforkController(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const jogadorId = normalizeText(url.searchParams.get("jogadorId") || "");

    const rows = await googleSheetsService.chartsTop50.readValues(SHEET).catch(() => []);
    const comentariosRows = await googleSheetsService.chartsTop50
      .readValues(COMENTARIOS_SHEET)
      .catch(() => []);
    const curtidasRows = await googleSheetsService.chartsTop50.readValues(CURTIDAS_SHEET).catch(() => []);

    const contarComentarios = (tipo: string, periodoId: string) =>
      comentariosRows
        .slice(1)
        .filter((r) => normalizeText(r[1]) === tipo && normalizeText(r[2]) === periodoId).length;

    const curtidasPorChave = new Map<string, { total: number; curtiPorMim: boolean }>();
    for (const r of curtidasRows.slice(1)) {
      const tipo = normalizeText(r[0]);
      const periodoId = normalizeText(r[1]);
      if (!tipo || !periodoId) continue;
      try {
        const lista: string[] = JSON.parse(normalizeText(r[2]) || "[]");
        curtidasPorChave.set(`${tipo}::${periodoId}`, {
          total: lista.length,
          curtiPorMim: !!jogadorId && lista.includes(jogadorId),
        });
      } catch {
        // ignora linha com JSON inválido
      }
    }

    const edicoes: PitchforkEdicao[] = rows.slice(1).reduce<PitchforkEdicao[]>((acc, r) => {
      const tipo = normalizeText(r[0]);
      if (tipo !== "BEST_NEW_TRACK" && tipo !== "TOP_ARTIST") return acc;
      const notaRaw = normalizeText(r[5]);
      const periodoId = normalizeText(r[1]);
      const curtidas = curtidasPorChave.get(`${tipo}::${periodoId}`) || { total: 0, curtiPorMim: false };
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
        curtidas: curtidas.total,
        curtidoPorMim: curtidas.curtiPorMim,
        comentarios: contarComentarios(tipo, periodoId),
      });
      return acc;
    }, []);

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

    const rows = await googleSheetsService.chartsTop50.readValues(COMENTARIOS_SHEET).catch(() => []);
    const comentarios = rows
      .slice(1)
      .filter((r) => normalizeText(r[1]) === tipo && normalizeText(r[2]) === periodoId)
      .map((r) => ({
        id: normalizeText(r[0]),
        jogadorId: normalizeText(r[3]),
        nome: normalizeText(r[4]),
        fotoPerfil: normalizeText(r[5]) || null,
        comentario: normalizeText(r[6]),
        data: normalizeText(r[7]),
      }))
      .reverse();

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
    const id = `pf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const dataHora = new Date().toISOString();

    const rows = await googleSheetsService.chartsTop50.readValues(COMENTARIOS_SHEET).catch(() => []);
    if (rows.length === 0) {
      await googleSheetsService.chartsTop50.appendRow(COMENTARIOS_SHEET, [
        "Id",
        "Tipo",
        "PeriodoId",
        "JogadorId",
        "Nome",
        "FotoPerfil",
        "Comentario",
        "Data",
      ]);
    }

    await googleSheetsService.chartsTop50.appendRow(COMENTARIOS_SHEET, [
      id,
      tipo,
      periodoId,
      jogadorId,
      nomeOficial,
      body.fotoPerfil || "",
      comentario,
      dataHora,
    ]);

    return new Response(
      JSON.stringify({
        success: true,
        data: { id, nome: nomeOficial, fotoPerfil: body.fotoPerfil || null, comentario, data: dataHora },
      }),
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

    const rows = await googleSheetsService.chartsTop50.readValues(CURTIDAS_SHEET).catch(() => []);
    if (rows.length === 0) {
      await googleSheetsService.chartsTop50.appendRow(CURTIDAS_SHEET, ["Tipo", "PeriodoId", "JogadoresJson"]);
    }

    const linhaIndex = rows.slice(1).findIndex((r) => normalizeText(r[0]) === tipo && normalizeText(r[1]) === periodoId);

    let lista: string[] = [];
    if (linhaIndex !== -1) {
      try {
        lista = JSON.parse(normalizeText(rows[linhaIndex + 1][2]) || "[]");
      } catch {
        lista = [];
      }
    }

    const curtiu = lista.includes(jogadorId);
    lista = curtiu ? lista.filter((id) => id !== jogadorId) : [...lista, jogadorId];

    if (linhaIndex !== -1) {
      await googleSheetsService.chartsTop50.updateValues(CURTIDAS_SHEET, `C${linhaIndex + 2}`, [
        [JSON.stringify(lista)],
      ]);
    } else {
      await googleSheetsService.chartsTop50.appendRow(CURTIDAS_SHEET, [tipo, periodoId, JSON.stringify(lista)]);
    }

    return new Response(
      JSON.stringify({ success: true, data: { curtidas: lista.length, curtidoPorMim: !curtiu } }),
      { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
    );
  } catch (error: any) {
    return new Response(
      JSON.stringify({ success: false, error: error.message || "Erro ao curtir." }),
      { status: 500, headers: { "Content-Type": "application/json; charset=utf-8" } },
    );
  }
}
