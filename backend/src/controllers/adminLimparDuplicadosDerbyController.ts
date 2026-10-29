import { googleSheetsService, normalizeComparison, normalizeText } from "../services/googleSheetsService";

// Limpeza das cópias duplicadas do álbum "DERBY" (Cowboy Fresh), geradas
// pelo bug do pre-save (ver writeLockService.ts, jaFoiLancadaDeVerdade) —
// a campanha relançou o álbum ~63 vezes em ~10h30 (2026-10-29). Escopo
// FECHADO: só Cowboy Fresh/DERBY — NUNCA tocar em Follia/Max Gorghan (já
// resolvido pelo usuário diretamente).
//
// Estratégia: mantém a cópia MAIS ANTIGA (primeira publicada de verdade,
// identificada pelo timestamp embutido no topicId: album_<timestampMs>_*)
// em "Albuns" (planilha principal) e apaga todas as outras; depois apaga
// as linhas correspondentes em "EDIÇÃO CHARTS ÁLBUMS" (planilha separada
// `edicaoCharts`) cruzando pelo "Código único" (Albuns!L <-> EDIÇÃO
// CHARTS ÁLBUMS!R, mesmo índice 17 já usado em lancarCampanhaPreSave).
//
// GET /api/empire-play/admin/limpar-duplicados-derby?confirmar=1
export async function adminLimparDuplicadosDerbyController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const confirmar = url.searchParams.get("confirmar") === "1";
  const ARTISTA = "cowboy fresh";
  const ALBUM = "derby";

  const albunsRows = await googleSheetsService.principal.readValues("Albuns", "A1:Z20000").catch(() => []);
  const candidatos: {
    linha: number;
    topicId: string;
    codigoUnico: string;
    timestampMs: number;
  }[] = [];
  for (let i = 1; i < albunsRows.length; i++) {
    const row = albunsRows[i];
    if (!row) continue;
    const novoNome = normalizeComparison(normalizeText(row[6]));
    if (!novoNome.includes(ARTISTA) || !novoNome.includes(ALBUM)) continue;
    const topicId = normalizeText(row[1]);
    const match = /^album_(\d+)_/.exec(topicId);
    candidatos.push({
      linha: i + 1,
      topicId,
      codigoUnico: normalizeText(row[11]), // coluna L (0-based 11) = Código único
      timestampMs: match ? Number(match[1]) : Number.MAX_SAFE_INTEGER,
    });
  }

  if (candidatos.length === 0) {
    return new Response(JSON.stringify({ success: true, mensagem: "Nenhuma cópia de DERBY/Cowboy Fresh encontrada em Albuns." }, null, 2), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  candidatos.sort((a, b) => a.timestampMs - b.timestampMs);
  const manter = candidatos[0];
  const duplicatas = candidatos.slice(1);

  const resultado: { confirmar: boolean; manter: typeof manter; totalEncontrado: number; duplicatasAlbuns: typeof duplicatas; edicaoChartsRemovidas?: number; erros: string[] } = {
    confirmar,
    manter,
    totalEncontrado: candidatos.length,
    duplicatasAlbuns: duplicatas,
    erros: [],
  };

  if (!confirmar) {
    return new Response(JSON.stringify(resultado, null, 2), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  // 1) Apaga as linhas duplicadas em "Albuns" (mantém a mais antiga).
  try {
    await googleSheetsService.principal.deleteRows("Albuns", duplicatas.map((d) => d.linha));
  } catch (err: any) {
    resultado.erros.push(`Falha ao apagar linhas duplicadas em Albuns: ${err?.message || err}`);
  }

  // 2) Apaga as linhas correspondentes em "EDIÇÃO CHARTS ÁLBUMS" — cruza
  // pelo Código único de cada duplicata (nunca pelo da que foi mantida).
  const codigosDuplicados = new Set(duplicatas.map((d) => normalizeComparison(d.codigoUnico)).filter(Boolean));
  try {
    const edicaoRows = await googleSheetsService.edicaoCharts.readValues("EDIÇÃO CHARTS ÁLBUMS", "A1:T20000").catch(() => []);
    const linhasParaApagar: number[] = [];
    for (let i = 1; i < edicaoRows.length; i++) {
      const row = edicaoRows[i];
      if (!row) continue;
      const codigo = normalizeComparison(normalizeText(row[17])); // coluna R (0-based 17)
      if (codigo && codigosDuplicados.has(codigo)) {
        linhasParaApagar.push(i + 1);
      }
    }
    if (linhasParaApagar.length > 0) {
      await googleSheetsService.edicaoCharts.deleteRows("EDIÇÃO CHARTS ÁLBUMS", linhasParaApagar);
    }
    resultado.edicaoChartsRemovidas = linhasParaApagar.length;
  } catch (err: any) {
    resultado.erros.push(`Falha ao apagar linhas duplicadas em EDIÇÃO CHARTS ÁLBUMS: ${err?.message || err}`);
  }

  return new Response(JSON.stringify(resultado, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
