import {
  googleSheetsService,
  ensureSheetTab,
  readValues,
  appendRow,
} from "../services/googleSheetsService";
import { getNivelAtual, getNiveis, getRegrasPrestigio, gastarPrestigio } from "../services/prestigioService";

const COMPRAS_SHEET = "Market_Compras";
const COMPRAS_HEADER = ["Data", "TelegramID", "Usuario", "ProdutoID", "Produto", "Preco", "Detalhe", "Status"];

export interface MarketProduto {
  id: string;
  nome: string;
  descricao: string;
  preco: number;
  icone: "week_off" | "music_boost" | "album_boost" | "double_week";
  pedeDetalhe: boolean;
  detalhePlaceholder?: string;
}

// Preços calibrados pela escala de prestígio (100 no nível 1 até 2550 no
// nível 50, +50 por nível) e pelo ritmo de ganho das regras ativas (login
// diário 10, comentário 2, post social 5 etc — um jogador ativo soma
// ~100-250/semana). Cada produto fica ao alcance de cerca de uma semana de
// atividade normal, sem ser trivial.
export const MARKET_PRODUTOS: MarketProduto[] = [
  {
    id: "week_off",
    nome: "Week Off",
    descricao: "Não precisa bater o ponto na semana em que ativar.",
    preco: 150,
    icone: "week_off",
    pedeDetalhe: false,
  },
  {
    id: "music_boost",
    nome: "Music Boost",
    descricao: "Impulsiona uma música da sua escolha.",
    preco: 100,
    icone: "music_boost",
    pedeDetalhe: true,
    detalhePlaceholder: "Nome da música",
  },
  {
    id: "album_boost",
    nome: "Album Boost",
    descricao: "Impulsiona um álbum da sua escolha.",
    preco: 200,
    icone: "album_boost",
    pedeDetalhe: true,
    detalhePlaceholder: "Nome do álbum",
  },
  {
    id: "double_week",
    nome: "Double Week",
    descricao: "Os comentários recebidos valem o dobro durante a semana.",
    preco: 180,
    icone: "double_week",
    pedeDetalhe: false,
  },
];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

/**
 * GET /api/market/produtos?telegramId=...
 * Lista os produtos fixos + o saldo de prestígio do jogador (se informado).
 */
export async function getMarketProdutosController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const telegramId = url.searchParams.get("telegramId") || "";
  const usuario = url.searchParams.get("usuario") || "";

  let saldo = 0;
  if (telegramId || usuario) {
    try {
      const nivel = await getNivelAtual({ telegramId, usuario });
      saldo = nivel.prestigioAtual;
    } catch {
      saldo = 0;
    }
  }

  return jsonResponse({ success: true, data: { produtos: MARKET_PRODUTOS, saldo } });
}

/**
 * GET /api/market/regras
 * Pra tela "Entenda os prestígios": escada completa de níveis + as ações
 * que somam prestígio.
 */
export async function getMarketRegrasController(): Promise<Response> {
  try {
    const [niveis, regrasMap] = await Promise.all([getNiveis(), getRegrasPrestigio()]);
    const regras = Array.from(regrasMap.values()).filter((r) => r.ativo);
    return jsonResponse({ success: true, data: { niveis, regras } });
  } catch (error: any) {
    return jsonResponse({ success: false, error: error?.message || "Erro ao buscar regras." }, 500);
  }
}

/**
 * POST /api/market/comprar
 * body: { produtoId, telegramId, usuario, detalhe? }
 *
 * Desconta o preço do saldo de prestígio do jogador e registra a compra na
 * aba "Market_Compras" (planilha usuarios) — cria a aba com cabeçalho se
 * ainda não existir. O uso de fato do item (ex: aplicar o Week Off, validar
 * o boost) é tratado à parte, manualmente por enquanto.
 */
export async function postMarketComprarController(request: Request): Promise<Response> {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ success: false, error: "Corpo inválido." }, 400);
  }

  const produtoId = String(body?.produtoId || "").trim();
  const telegramId = String(body?.telegramId || "").trim();
  const usuario = String(body?.usuario || "").trim();
  const detalhe = String(body?.detalhe || "").trim();

  const produto = MARKET_PRODUTOS.find((p) => p.id === produtoId);
  if (!produto) {
    return jsonResponse({ success: false, error: "Produto inválido." }, 400);
  }
  if (!telegramId && !usuario) {
    return jsonResponse({ success: false, error: "Usuário não identificado." }, 400);
  }
  if (produto.pedeDetalhe && !detalhe) {
    return jsonResponse({ success: false, error: "Preencha o campo pedido pelo produto." }, 400);
  }

  try {
    const novoSaldo = await gastarPrestigio({ telegramId, usuario }, produto.preco);

    await ensureSheetTab("usuarios", COMPRAS_SHEET);
    const existentes = await readValues("usuarios", COMPRAS_SHEET, "A1:A1");
    if (!existentes.length || !existentes[0]?.[0]) {
      await appendRow("usuarios", COMPRAS_SHEET, COMPRAS_HEADER, "A:H");
    }
    await appendRow(
      "usuarios",
      COMPRAS_SHEET,
      [
        new Date().toISOString(),
        telegramId,
        usuario,
        produto.id,
        produto.nome,
        produto.preco,
        detalhe,
        "Pendente",
      ],
      "A:H",
    );

    return jsonResponse({ success: true, data: { saldo: novoSaldo } });
  } catch (error: any) {
    return jsonResponse({ success: false, error: error?.message || "Não foi possível comprar." }, 400);
  }
}
