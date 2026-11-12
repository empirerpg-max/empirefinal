import { googleSheetsService, normalizeComparison } from "../services/googleSheetsService";
import { readAllCampanhas, calcularAcumulado } from "./preSaveController";

// Reparo pontual (2026-11-12): bônus de missões do pre-save (modo "missao")
// da campanha da Samantha Cooper ("WELL, IT'S OVER") não foi gravado na
// coluna S ("PRE-SAVE") de "EDIÇÃO CHARTS ÁLBUMS" — reportado pelo admin.
// Causa raiz real: em lancarCampanhaPreSave (preSaveController.ts), essa
// escrita inteira (ler "EDIÇÃO CHARTS ÁLBUMS" A1:T20000 — 400 mil células —
// achar a linha pelo Código único, escrever a coluna S) está num
// try/catch que só faz console.warn em caso de falha, e NUNCA avisa nada
// quando a linha simplesmente não é encontrada (linhaAlvo === -1) — mesma
// classe de falha silenciosa já vista nesta sessão (rate-limit do Sheets
// numa leitura grande, ou timing entre a criação da linha do álbum e essa
// leitura). Esse endpoint recalcula o valor certo a partir da campanha já
// salva (readAllCampanhas/calcularAcumulado — mesma fórmula usada no
// lançamento) e grava na coluna certa.
//
// Dry-run por padrão — ?confirmar=1 pra gravar de verdade.
// GET /api/gestao/admin/fix-presave-bonus-samantha[?confirmar=1]
export async function adminFixPresaveBonusSamanthaController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const confirmar = url.searchParams.get("confirmar") === "1";

  const campanhas = await readAllCampanhas();
  const candidatas = campanhas.filter(
    (c) =>
      normalizeComparison(c.artista || "").includes("samantha cooper") &&
      normalizeComparison(c.albumTituloFull || "").includes("it's over"),
  );

  if (candidatas.length === 0) {
    return new Response(
      JSON.stringify({ success: false, error: "Nenhuma campanha de pre-save encontrada pra Samantha Cooper / WELL, IT'S OVER." }),
      { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
    );
  }

  const resultados: unknown[] = [];
  for (const c of candidatas) {
    const acumuladoFinal = Math.round(calcularAcumulado(c));
    const info: Record<string, unknown> = {
      campanhaId: c.id,
      albumTituloFull: c.albumTituloFull,
      modo: c.modo,
      status: c.status,
      acumuladoCalculado: acumuladoFinal,
    };

    if (c.modo !== "missao") {
      info.acao = "Modo não é 'missao' — essa campanha nunca escreve nada em S (vanity puro). Nada a fazer.";
      resultados.push(info);
      continue;
    }

    const rows = await googleSheetsService.edicaoCharts.readValues("EDIÇÃO CHARTS ÁLBUMS", "A1:T20000");
    const header = rows[0] || [];
    let colIndex = header.findIndex(
      (h) => normalizeComparison(h) === "pre save" || normalizeComparison(h) === "presave",
    );
    if (colIndex < 0) colIndex = 18;
    const colLetra = String.fromCharCode(65 + colIndex);

    let linhaAlvo = -1;
    for (let i = 1; i < rows.length; i++) {
      if (normalizeComparison(rows[i]?.[3] || "") === normalizeComparison(c.albumTituloFull || "")) {
        linhaAlvo = i + 1;
        break;
      }
    }
    if (linhaAlvo === -1) {
      info.acao = `Linha do álbum "${c.albumTituloFull}" não encontrada em EDIÇÃO CHARTS ÁLBUMS por título — não gravado.`;
      resultados.push(info);
      continue;
    }

    const valorAtual = (rows[linhaAlvo - 1]?.[colIndex] || "").trim();
    info.linhaEdicaoChartsAlbuns = linhaAlvo;
    info.colunaPreSave = colLetra;
    info.valorAtual = valorAtual || "(vazio)";
    info.acao = confirmar
      ? `Coluna ${colLetra}${linhaAlvo} gravada com ${acumuladoFinal}.`
      : `Coluna ${colLetra}${linhaAlvo} seria gravada com ${acumuladoFinal} (valor atual: "${valorAtual || "(vazio)"}").`;

    if (confirmar) {
      await googleSheetsService.edicaoCharts.updateValues(
        "EDIÇÃO CHARTS ÁLBUMS",
        `${colLetra}${linhaAlvo}:${colLetra}${linhaAlvo}`,
        [[String(acumuladoFinal)]],
      );
    }
    resultados.push(info);
  }

  return new Response(
    JSON.stringify({ success: true, confirmar, resultados }, null, 2),
    { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
}
