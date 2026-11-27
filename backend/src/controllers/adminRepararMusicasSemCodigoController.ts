import {
  googleSheetsService,
  normalizeComparison,
  normalizeText,
} from "../services/googleSheetsService";
import { analisarFormulaBD } from "../services/codigoUnicoEdicaoCharts";
import {
  garantirCodigoUnicoNaEdicaoCharts,
  mirrorMusicaRowParaD1,
  registrarInfosMusicas,
} from "./gestaoController";

// Repara músicas lançadas que ficaram SEM Código único porque a fórmula de
// EDIÇÃO CHARTS!BD não cobria a linha delas (caso Sparks, 26-27/11/2026:
// "Alone" x2 e "Foolish", EDIÇÃO CHARTS 1065-1067, Musicas 912-914). Sem
// código elas não aparecem publicadas nem entram nos charts.
//
// Escopo restrito: só as linhas do FIM de EDIÇÃO CHARTS depois da última
// que tem código, pareadas por título com linhas de Musicas sem Z, sem
// referência (Y) e não pendentes.
//
// GET /api/gestao/admin/reparar-musicas-sem-codigo                 -> simulação (não grava)
// GET ...?confirmar=1                                              -> grava os códigos
// GET ...?confirmar=1&descartar=912                                -> idem + apaga a(s)
//     linha(s) de Musicas listadas (reenvio duplicado) e limpa a linha
//     pareada em EDIÇÃO CHARTS, sem dar código a elas.
export async function adminRepararMusicasSemCodigoController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const confirmar = url.searchParams.get("confirmar") === "1";
  const descartar = new Set(
    (url.searchParams.get("descartar") || "")
      .split(",")
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => Number.isFinite(n) && n > 1),
  );

  try {
    const topoBD = await googleSheetsService.edicaoCharts.readValuesFormula(
      "EDIÇÃO CHARTS",
      "BD1:BD3",
    );
    const formulaBD = analisarFormulaBD(topoBD.map((r) => r?.[0] || ""));

    const ec = await googleSheetsService.edicaoCharts.readValuesFresh(
      "EDIÇÃO CHARTS",
      "A1:BD20000",
    );
    let ultimaComCodigo = 1;
    for (let i = 1; i < ec.length; i++) {
      if ((ec[i]?.[1] || "").trim() && (ec[i]?.[55] || "").trim()) ultimaComCodigo = i + 1;
    }
    const ecOrfas: { linha: number; titulo: string }[] = [];
    for (let i = ultimaComCodigo; i < ec.length; i++) {
      const titulo = normalizeText(ec[i]?.[1]);
      if (titulo && !(ec[i]?.[55] || "").trim()) ecOrfas.push({ linha: i + 1, titulo });
    }

    const musicas = await googleSheetsService.principal.readValuesFresh("Musicas", "A1:Z20000");
    const musicasOrfas: { linha: number; titulo: string; capa: string; data: string }[] = [];
    for (let i = 1; i < musicas.length; i++) {
      const r = musicas[i] || [];
      const titulo = normalizeText(r[7]);
      if (!titulo || (r[25] || "").trim() || (r[24] || "").trim()) continue;
      if (normalizeComparison(r[23] || "") === "sim") continue;
      musicasOrfas.push({
        linha: i + 1,
        titulo,
        capa: normalizeText(r[3]),
        data: normalizeText(r[0]),
      });
    }

    // Pareia na ordem: 1ª linha de EDIÇÃO CHARTS de um título com a 1ª linha
    // de Musicas desse título que ainda está órfã, e assim por diante.
    const usadas = new Set<number>();
    const pares = ecOrfas.map((e) => {
      const m = musicasOrfas.find(
        (x) =>
          !usadas.has(x.linha) && normalizeComparison(x.titulo) === normalizeComparison(e.titulo),
      );
      if (m) usadas.add(m.linha);
      return {
        edicaoCharts: e.linha,
        musicas: m?.linha ?? null,
        titulo: e.titulo,
        capa: m?.capa || "",
      };
    });

    const resultado: Record<string, unknown>[] = [];
    if (confirmar) {
      for (const p of pares) {
        if (p.musicas && descartar.has(p.musicas)) continue;
        if (!p.musicas) {
          resultado.push({ ...p, status: "sem linha em Musicas — nada feito" });
          continue;
        }
        const codigo = await garantirCodigoUnicoNaEdicaoCharts(p.edicaoCharts);
        if (!codigo) {
          resultado.push({ ...p, status: "não foi possível gravar o código (ver formulaBD)" });
          continue;
        }
        const okZ = await googleSheetsService.principal.updateValues("Musicas", `Z${p.musicas}`, [
          [codigo],
        ]);
        const okD1 = okZ ? await mirrorMusicaRowParaD1(p.musicas) : false;
        await registrarInfosMusicas({ fullTitle: p.titulo, capaUrl: p.capa });
        resultado.push({ ...p, codigo, musicasZ: okZ, d1: okD1 });
      }
      // Descartes por último: apagar linhas de Musicas desloca as de baixo.
      const descartados = pares.filter((p) => p.musicas && descartar.has(p.musicas));
      for (const p of descartados) {
        await googleSheetsService.edicaoCharts.clearValues(
          "EDIÇÃO CHARTS",
          `A${p.edicaoCharts}:Q${p.edicaoCharts}`,
        );
      }
      if (descartados.length) {
        await googleSheetsService.principal.deleteRows(
          "Musicas",
          descartados.map((p) => p.musicas as number),
        );
        for (const p of descartados) resultado.push({ ...p, status: "descartada (duplicata)" });
      }
    }

    return new Response(
      JSON.stringify(
        {
          success: true,
          confirmar,
          formulaBD,
          ultimaLinhaComCodigoEdicaoCharts: ultimaComCodigo,
          pares,
          descartar: [...descartar],
          resultado,
        },
        null,
        2,
      ),
      { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
    );
  } catch (err) {
    const mensagem = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ success: false, error: mensagem }), {
      status: 500,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }
}
