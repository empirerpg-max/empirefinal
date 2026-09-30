import { googleSheetsService, normalizeText, normalizeComparison } from "../services/googleSheetsService";
import { getArtistNamesForOwner } from "./artistasController";
import { getSaldosEcoin } from "./marketController";

// Aba "Leilão_Lances" (planilha usuarios, mesma do MARKET_ITENS) — criada
// manualmente pela produção. Layout confirmado com o usuário:
// A Nome do award | B Lances (JSON) | C Encerrado? | D Vencedor | E Imagem
// Dados começam na linha 2 (linha 1 = cabeçalho).
//
// "Nome do award" só é preenchido quando existe um leilão de verdade — o
// leilão ATUAL é sempre a última linha com essa coluna preenchida (não dá
// pra ter dois leilões "correntes" ao mesmo tempo no fluxo de compra).
//
// "Encerrado?" tem 3 estados possíveis nessa coluna, todos escritos pela
// PRODUÇÃO à mão, exceto "Pago" que o backend escreve sozinho depois de
// processar:
//   "" / qualquer outra coisa -> aberto, aceita lance
//   "Sim"                     -> produção encerrou; ainda falta processar
//                                 (descontar o vencedor) — é o gatilho
//   "Pago"                    -> já processado, não mexe de novo (evita
//                                 descontar o vencedor duas vezes)
const LEILAO_SHEET = "Leilão_Lances";
const COL_NOME = 0; // A
const COL_LANCES = 1; // B
const COL_ENCERRADO = 2; // C
const COL_VENCEDOR = 3; // D
const COL_IMAGEM = 4; // E

interface Lance {
  artista: string;
  valor: number;
  ts: string;
}

function parseLances(raw: string): Lance[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((l) => l && typeof l.artista === "string" && typeof l.valor === "number")
      .map((l) => ({ artista: l.artista, valor: l.valor, ts: typeof l.ts === "string" ? l.ts : "" }));
  } catch {
    return [];
  }
}

function liderDoLances(lances: Lance[]): Lance | null {
  if (!lances.length) return null;
  return lances.reduce((top, l) => (l.valor > top.valor ? l : top), lances[0]);
}

async function acharLinhaLeilaoAtual(): Promise<{ linha: number; row: string[] } | null> {
  const rows = await googleSheetsService.usuarios.readValues(LEILAO_SHEET);
  for (let i = rows.length - 1; i >= 1; i--) {
    if (normalizeText(rows[i]?.[COL_NOME])) return { linha: i + 1, row: rows[i] };
  }
  return null;
}

// DADOS!AC (nome do artista) / AD ("SALDO ORIGINAL") — confirmado com o
// usuário: AD é o campo onde o saldo de ECoin de fato é descontado (texto
// solto, formatado "R$ 1.500.000"), diferente de AI (saldo ao vivo,
// calculado) que só é usado pra EXIBIR o saldo disponível. REGISTRO e
// ECOIN + INVESTIMENTO são só log/registro — não afetam esse desconto.
async function descontarSaldoArtista(artista: string, valor: number): Promise<void> {
  const rows = await googleSheetsService.registrosCharts.readValues("DADOS", "AC1:AD5000");
  const idx = rows.findIndex((r) => normalizeComparison(r?.[0]) === normalizeComparison(artista));
  if (idx === -1) {
    console.warn(`[Leilão] Artista "${artista}" não encontrado em DADOS!AC pra descontar saldo do leilão.`);
    return;
  }
  const bruto = normalizeText(rows[idx][1]);
  const temPrefixo = /r\$/i.test(bruto);
  const numerico = parseFloat(bruto.replace(/[^\d,-]/g, "").replace(",", ".")) || 0;
  const novoValor = numerico - valor;
  const novoTexto = temPrefixo ? `R$ ${novoValor.toLocaleString("pt-BR")}` : String(novoValor);
  await googleSheetsService.registrosCharts.updateValues("DADOS", `AD${idx + 1}`, [[novoTexto]]);
}

// Se a produção acabou de marcar "Sim" em Encerrado?, processa o
// fechamento: desconta só o vencedor (maior lance) e marca "Pago" pra não
// processar de novo na próxima leitura. Os demais nunca tiveram nada
// debitado (o lance só existe em Leilão_Lances enquanto o leilão está
// aberto), então "devolver" o valor deles é automático — não tem o que
// fazer.
async function processarEncerramentoSeNecessario(linha: number, row: string[]): Promise<string[]> {
  const status = normalizeComparison(row[COL_ENCERRADO]);
  if (status !== "sim") return row;

  const lances = parseLances(normalizeText(row[COL_LANCES]));
  const lider = liderDoLances(lances);

  if (lider) {
    await descontarSaldoArtista(lider.artista, lider.valor);
  }

  await googleSheetsService.usuarios.updateValues(LEILAO_SHEET, `C${linha}:D${linha}`, [
    ["Pago", lider ? lider.artista : ""],
  ]);

  const novoRow = row.slice();
  novoRow[COL_ENCERRADO] = "Pago";
  if (lider) novoRow[COL_VENCEDOR] = lider.artista;
  return novoRow;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

/**
 * GET /api/market/leilao?telegramId=...
 * Devolve o leilão atual (última linha com "Nome do award" preenchido),
 * processando o encerramento na hora se a produção acabou de marcar "Sim"
 * e ninguém ainda passou por aqui pra descontar o vencedor.
 */
export async function getLeilaoAtualController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const telegramId = url.searchParams.get("telegramId") || "";

  try {
    const atual = await acharLinhaLeilaoAtual();
    if (!atual) {
      return jsonResponse({ success: true, data: null });
    }

    const row = await processarEncerramentoSeNecessario(atual.linha, atual.row);
    const lances = parseLances(normalizeText(row[COL_LANCES]));
    const lider = liderDoLances(lances);
    const statusNorm = normalizeComparison(row[COL_ENCERRADO]);
    const encerrado = statusNorm === "sim" || statusNorm === "pago";

    let artistas: { nome: string; saldoEcoin: number }[] = [];
    if (telegramId) {
      const nomesArtistas = await getArtistNamesForOwner(telegramId);
      if (nomesArtistas.length > 0) {
        const saldos = await getSaldosEcoin(nomesArtistas);
        artistas = nomesArtistas.map((nome) => ({
          nome,
          saldoEcoin: saldos.get(normalizeComparison(nome)) ?? 0,
        }));
      }
    }

    return jsonResponse({
      success: true,
      data: {
        nome: normalizeText(row[COL_NOME]),
        imagem: normalizeText(row[COL_IMAGEM]) || null,
        encerrado,
        vencedor: normalizeText(row[COL_VENCEDOR]) || (lider ? lider.artista : ""),
        liderValor: lider ? lider.valor : 0,
        lances: lances.slice().sort((a, b) => b.valor - a.valor),
        artistas,
      },
    });
  } catch (error: any) {
    console.error("[getLeilaoAtualController] Erro:", error);
    return jsonResponse({ success: false, error: error.message || "Erro ao buscar leilão." }, 500);
  }
}

/**
 * POST /api/market/leilao/lance
 * body: { telegramId, artista, valor }
 * Envia (ou substitui) o lance do artista — sempre reescreve o array
 * inteiro em JSON na coluna B, removendo qualquer lance anterior desse
 * mesmo artista antes de inserir o novo (histórico guarda só o lance
 * mais recente de cada um, como pedido).
 */
export async function postLeilaoLanceController(request: Request): Promise<Response> {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ success: false, error: "Corpo inválido." }, 400);
  }

  const telegramId = String(body?.telegramId || "").trim();
  const artista = String(body?.artista || "").trim();
  const valor = Number(body?.valor);

  if (!telegramId || !artista) {
    return jsonResponse({ success: false, error: "Usuário/artista não identificado." }, 400);
  }
  if (!Number.isFinite(valor) || valor <= 0) {
    return jsonResponse({ success: false, error: "Valor de lance inválido." }, 400);
  }

  try {
    const meusArtistas = await getArtistNamesForOwner(telegramId);
    if (!meusArtistas.some((a) => normalizeComparison(a) === normalizeComparison(artista))) {
      return jsonResponse({ success: false, error: "Esse artista não é seu." }, 403);
    }

    const saldos = await getSaldosEcoin([artista]);
    const saldoDisponivel = saldos.get(normalizeComparison(artista)) ?? 0;
    if (valor > saldoDisponivel) {
      return jsonResponse({ success: false, error: "Esse lance passa do seu saldo de ECoin disponível." }, 400);
    }

    const MAX_TENTATIVAS = 3;
    for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa++) {
      const atual = await acharLinhaLeilaoAtual();
      if (!atual) {
        return jsonResponse({ success: false, error: "Nenhum leilão em andamento no momento." }, 400);
      }
      const row = await processarEncerramentoSeNecessario(atual.linha, atual.row);
      const statusNorm = normalizeComparison(row[COL_ENCERRADO]);
      if (statusNorm === "sim" || statusNorm === "pago") {
        return jsonResponse({ success: false, error: "Esse leilão já foi encerrado." }, 400);
      }

      const lances = parseLances(normalizeText(row[COL_LANCES]));
      const liderAtual = liderDoLances(lances.filter((l) => normalizeComparison(l.artista) !== normalizeComparison(artista)));
      if (liderAtual && valor <= liderAtual.valor) {
        return jsonResponse(
          { success: false, error: `Seu lance precisa ser maior que o atual (R$ ${liderAtual.valor.toLocaleString("pt-BR")}).` },
          400,
        );
      }

      const novosLances = lances.filter((l) => normalizeComparison(l.artista) !== normalizeComparison(artista));
      novosLances.push({ artista, valor, ts: new Date().toISOString() });
      const novoLider = liderDoLances(novosLances)!;

      await googleSheetsService.usuarios.updateValues(LEILAO_SHEET, `B${atual.linha}:D${atual.linha}`, [
        [JSON.stringify(novosLances), row[COL_ENCERRADO] || "", novoLider.artista],
      ]);

      const confirmacao = await googleSheetsService.usuarios.readValues(LEILAO_SHEET, `B${atual.linha}`);
      const salvou = parseLances(normalizeText(confirmacao?.[0]?.[0])).some(
        (l) => normalizeComparison(l.artista) === normalizeComparison(artista) && l.valor === valor,
      );
      if (salvou) {
        return jsonResponse({ success: true, data: { lances: novosLances, vencedor: novoLider.artista } });
      }
      console.warn(`[Leilão] Colisão ao gravar lance (tentativa ${tentativa}/${MAX_TENTATIVAS}) — tentando de novo.`);
    }

    return jsonResponse({ success: false, error: "Não foi possível gravar seu lance — tente de novo." }, 500);
  } catch (error: any) {
    console.error("[postLeilaoLanceController] Erro:", error);
    return jsonResponse({ success: false, error: error.message || "Erro ao enviar lance." }, 500);
  }
}
