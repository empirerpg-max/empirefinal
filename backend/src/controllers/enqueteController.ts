import {
  googleSheetsService,
  ensureSheetTab,
  normalizeComparison,
  normalizeText,
} from "../services/googleSheetsService";

// Duas abas na planilha "usuarios" (mesma de Usuários/Níveis) — a aba de
// perguntas ("Vota_Award") já foi criada manualmente pelo usuário; a de
// respostas é criada sob demanda pelo app (self-healing, mesmo padrão de
// Notificacoes em notificacoesController.ts). Cabeçalho escrito
// automaticamente na primeira leitura se a aba ainda estiver vazia.
//
// "Vota_Award" — cadastrada à MÃO pelo admin direto na planilha. Cada linha
// é uma enquete; criar uma nova enquete não exige nenhum deploy, só uma
// linha nova aqui:
//   A=ID (livre, ex: enquete1)         B=Programa ID (sala onde aparece)
//   C=Pergunta                          D=Alvo (nome exibido, opcional)
//   E=Nota mínima (padrão 7 se vazio)   F=Nota máxima (padrão 10 se vazio)
//   G=Ativa? (SIM/NAO)                  H=Data de criação
//
// "Vota_Award_Respostas" — só o app escreve aqui. Uma linha por resposta:
//   A=ID da enquete   B=Programa ID   C=Telegram ID   D=Nome   E=Nota   F=Data
const SHEET_ENQUETES = "Vota_Award";
const SHEET_RESPOSTAS = "Vota_Award_Respostas";
const HEADER_ENQUETES = ["ID", "Programa ID", "Pergunta", "Alvo", "Nota Min", "Nota Max", "Ativa?", "Data Criação"];
const HEADER_RESPOSTAS = ["ID Enquete", "Programa ID", "Telegram ID", "Nome", "Nota", "Data"];
const NOTA_MIN_PADRAO = 7;
const NOTA_MAX_PADRAO = 10;

let sheetsReady = false;
async function ensureEnqueteSheets(): Promise<void> {
  if (sheetsReady) return;
  await ensureSheetTab("usuarios", SHEET_ENQUETES);
  await ensureSheetTab("usuarios", SHEET_RESPOSTAS);
  const [primeiraEnquetes, primeiraRespostas] = await Promise.all([
    googleSheetsService.usuarios.readValues(SHEET_ENQUETES, "A1:A1"),
    googleSheetsService.usuarios.readValues(SHEET_RESPOSTAS, "A1:A1"),
  ]);
  const escritas: Promise<unknown>[] = [];
  if (!primeiraEnquetes?.[0]?.[0]?.trim()) {
    escritas.push(googleSheetsService.usuarios.updateValues(SHEET_ENQUETES, "A1:H1", [HEADER_ENQUETES]));
  }
  if (!primeiraRespostas?.[0]?.[0]?.trim()) {
    escritas.push(googleSheetsService.usuarios.updateValues(SHEET_RESPOSTAS, "A1:F1", [HEADER_RESPOSTAS]));
  }
  await Promise.all(escritas);
  sheetsReady = true;
}

interface EnquetePost {
  id: string;
  programaId: string;
  pergunta: string;
  alvo: string;
  notaMin: number;
  notaMax: number;
}

function parseEnqueteRow(row: string[]): EnquetePost | null {
  const id = (row[0] || "").trim();
  const ativa = normalizeComparison(row[6] || "") === "sim";
  if (!id || !ativa) return null;
  const notaMin = Number(row[4]) || NOTA_MIN_PADRAO;
  const notaMax = Number(row[5]) || NOTA_MAX_PADRAO;
  return {
    id,
    programaId: row[1] || "",
    pergunta: normalizeText(row[2]),
    alvo: normalizeText(row[3]),
    notaMin,
    notaMax: notaMax >= notaMin ? notaMax : notaMin,
  };
}

/**
 * GET /api/tv/enquete?programaId=...&tgId=...
 * Devolve a enquete ATIVA da sala (se houver — cadastrada à mão na aba
 * ENQUETES, nenhuma criação passa por aqui), a média/total de respostas, e
 * se o jogador (tgId) já respondeu (e com qual nota, pra mostrar em vez do
 * formulário de novo).
 */
export async function getEnqueteController(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const programaId = (url.searchParams.get("programaId") || "").trim();
    const tgId = (url.searchParams.get("tgId") || "").trim();
    if (!programaId) {
      return new Response(JSON.stringify({ success: false, error: "programaId é obrigatório." }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    await ensureEnqueteSheets();
    const rows = await googleSheetsService.usuarios.readValues(SHEET_ENQUETES).catch(() => []);
    const normPrograma = normalizeComparison(programaId);
    // A mais recente entre as ativas dessa sala, se houver mais de uma.
    const enquete = (rows.length > 1 ? rows.slice(1) : [])
      .map(parseEnqueteRow)
      .filter((e): e is EnquetePost => !!e && normalizeComparison(e.programaId) === normPrograma)
      .pop();

    if (!enquete) {
      return new Response(JSON.stringify({ success: true, data: null }), {
        status: 200,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }

    const respostasRows = await googleSheetsService.usuarios.readValues(SHEET_RESPOSTAS).catch(() => []);
    const respostasDaEnquete = (respostasRows.length > 1 ? respostasRows.slice(1) : []).filter(
      (r) => (r[0] || "").trim() === enquete.id,
    );
    const notas = respostasDaEnquete.map((r) => Number(r[4])).filter((n) => Number.isFinite(n));
    const media = notas.length > 0 ? notas.reduce((a, b) => a + b, 0) / notas.length : 0;
    const minhaResposta = tgId
      ? respostasDaEnquete.find((r) => normalizeComparison(r[2] || "") === normalizeComparison(tgId))
      : undefined;

    return new Response(
      JSON.stringify({
        success: true,
        data: {
          ...enquete,
          totalRespostas: notas.length,
          media: Math.round(media * 10) / 10,
          minhaNota: minhaResposta ? Number(minhaResposta[4]) : null,
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
    );
  } catch (error: any) {
    console.error("[getEnqueteController] Erro:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message || "Erro ao buscar a enquete." }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}

/**
 * POST /api/tv/enquete/responder { enqueteId, programaId, tgId, nome, nota }
 * 1 resposta por jogador por enquete — se já respondeu, atualiza a nota em
 * vez de duplicar linha.
 */
export async function responderEnqueteController(request: Request): Promise<Response> {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      enqueteId?: string;
      programaId?: string;
      tgId?: string;
      nome?: string;
      nota?: number;
    };
    const enqueteId = (body.enqueteId || "").trim();
    const programaId = (body.programaId || "").trim();
    const tgId = (body.tgId || "").trim();
    const nota = Number(body.nota);
    if (!enqueteId || !programaId || !tgId || !Number.isFinite(nota)) {
      return new Response(
        JSON.stringify({ success: false, error: "enqueteId, programaId, tgId e nota são obrigatórios." }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    await ensureEnqueteSheets();
    const rows = await googleSheetsService.usuarios.readValues(SHEET_RESPOSTAS);
    const rowIndex = rows.findIndex(
      (row, i) =>
        i > 0 &&
        (row[0] || "").trim() === enqueteId &&
        normalizeComparison(row[2] || "") === normalizeComparison(tgId),
    );

    const nowIso = new Date().toISOString();
    if (rowIndex === -1) {
      const linhaGravada = await googleSheetsService.usuarios.appendRow(
        SHEET_RESPOSTAS,
        [enqueteId, programaId, tgId, body.nome || "", nota, nowIso],
        "A:F",
      );
      if (linhaGravada === null) {
        return new Response(
          JSON.stringify({ success: false, error: "Não deu pra registrar sua resposta. Tente de novo." }),
          { status: 500, headers: { "Content-Type": "application/json" } },
        );
      }
    } else {
      await googleSheetsService.usuarios.updateValues(SHEET_RESPOSTAS, `E${rowIndex + 1}:F${rowIndex + 1}`, [
        [nota, nowIso],
      ]);
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  } catch (error: any) {
    console.error("[responderEnqueteController] Erro:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message || "Erro ao responder a enquete." }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}
