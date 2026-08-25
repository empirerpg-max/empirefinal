import { googleSheetsService, normalizeComparison, normalizeText } from "../services/googleSheetsService";

// Material extra dos tópicos de Música/Álbum — botões "Shop", "Info" e
// "Visual" que o jogador pode ativar na criação (Gestão) ou depois, editando
// o lançamento. Vive em duas abas próprias na planilha principal, já criadas
// pelo usuário: Extra_Musicas e Extra_Albuns — mesmo layout nas duas:
//
// A Código único | B Shop (JSON) | C Info (texto livre) | D Arte (JSON)
//
// Código único é a mesma chave usada em EDIÇÃO CHARTS/EDIÇÃO CHARTS ÁLBUMS
// (ver registroLogController.ts) — Musicas!Z e Albuns!L. Uma linha por
// música/álbum; criada só quando o jogador ativa alguma das 3 seções pela
// primeira vez.
const SHEETS = {
  musica: "Extra_Musicas",
  album: "Extra_Albuns",
} as const;

export type ExtraMaterialTipo = keyof typeof SHEETS;

export interface ShopItem {
  foto: string;
  titulo: string;
}

export type VisualBloco = { tipo: "imagem"; url: string } | { tipo: "texto"; conteudo: string };

export interface ExtraMaterial {
  codigoUnico: string;
  shop: ShopItem[];
  info: string;
  arte: VisualBloco[];
}

function sheetNameFor(tipo: string): string | null {
  const key = (tipo || "").trim().toLowerCase();
  if (key === "musica" || key === "musicas" || key === "song") return SHEETS.musica;
  if (key === "album" || key === "albuns" || key === "álbum") return SHEETS.album;
  return null;
}

function parseJsonArray<T>(raw: string): T[] {
  try {
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

async function findRow(sheetName: string, codigoUnico: string): Promise<{ rowIndex: number; row: string[] } | null> {
  const rows = await googleSheetsService.principal.readValues(sheetName, "A:D");
  const alvo = normalizeComparison(codigoUnico);
  for (let i = 1; i < rows.length; i++) {
    if (normalizeComparison(rows[i]?.[0]) === alvo) {
      return { rowIndex: i + 1, row: rows[i] };
    }
  }
  return null;
}

// GET /api/gestao/extra?codigoUnico=EMP001&tipo=musica|album
export async function getExtraMaterialController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const codigoUnico = normalizeText(url.searchParams.get("codigoUnico") || "");
  const sheetName = sheetNameFor(url.searchParams.get("tipo") || "");

  if (!codigoUnico || !sheetName) {
    return jsonResponse({ ok: false, error: "codigoUnico e tipo (musica|album) são obrigatórios." }, 400);
  }

  const found = await findRow(sheetName, codigoUnico);
  const material: ExtraMaterial = {
    codigoUnico,
    shop: found ? parseJsonArray<ShopItem>(found.row[1]) : [],
    info: found ? normalizeText(found.row[2]) : "",
    arte: found ? parseJsonArray<VisualBloco>(found.row[3]) : [],
  };
  return jsonResponse({ ok: true, data: material });
}

// POST /api/gestao/extra — { codigoUnico, tipo, shop?, info?, arte? }
// Só sobrescreve os campos que vierem no payload — permite ativar/editar
// Shop, Info e Visual em momentos diferentes sem apagar os outros.
export async function saveExtraMaterialController(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as {
    codigoUnico?: string;
    tipo?: string;
    shop?: ShopItem[];
    info?: string;
    arte?: VisualBloco[];
  };

  const codigoUnico = normalizeText(body.codigoUnico || "");
  const sheetName = sheetNameFor(body.tipo || "");
  if (!codigoUnico || !sheetName) {
    return jsonResponse({ ok: false, error: "codigoUnico e tipo (musica|album) são obrigatórios." }, 400);
  }

  const found = await findRow(sheetName, codigoUnico);

  const shopFinal = body.shop !== undefined ? body.shop : found ? parseJsonArray<ShopItem>(found.row[1]) : [];
  const infoFinal = body.info !== undefined ? body.info : found ? normalizeText(found.row[2]) : "";
  const arteFinal = body.arte !== undefined ? body.arte : found ? parseJsonArray<VisualBloco>(found.row[3]) : [];

  if (found) {
    await googleSheetsService.principal.updateValues(sheetName, `B${found.rowIndex}:D${found.rowIndex}`, [
      [JSON.stringify(shopFinal), infoFinal, JSON.stringify(arteFinal)],
    ]);
  } else {
    // Range explícito (A:D) — um range aberto pode fazer a API do Sheets
    // deslocar a linha inteira pra direita (mesma classe de bug já corrigida
    // em vários outros pontos do app nesta sessão).
    await googleSheetsService.principal.appendRow(
      sheetName,
      [codigoUnico, JSON.stringify(shopFinal), infoFinal, JSON.stringify(arteFinal)],
      "A:D",
    );
  }

  return jsonResponse({ ok: true });
}
