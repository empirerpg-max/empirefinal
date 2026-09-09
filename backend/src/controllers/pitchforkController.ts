import { googleSheetsService, normalizeText } from "../services/googleSheetsService";

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
const SHEET = "Pitchfork";

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
}

export async function getPitchforkController(): Promise<Response> {
  try {
    const rows = await googleSheetsService.chartsTop50.readValues(SHEET).catch(() => []);
    const edicoes: PitchforkEdicao[] = rows.slice(1).reduce<PitchforkEdicao[]>((acc, r) => {
      const tipo = normalizeText(r[0]);
      if (tipo !== "BEST_NEW_TRACK" && tipo !== "TOP_ARTIST") return acc;
      const notaRaw = normalizeText(r[5]);
      acc.push({
        tipo,
        periodoId: normalizeText(r[1]),
        titulo: normalizeText(r[2]),
        artista: normalizeText(r[3]),
        capaUrl: normalizeText(r[4]) || null,
        nota: notaRaw && Number.isFinite(Number(notaRaw)) ? Number(notaRaw) : null,
        texto: normalizeText(r[6]),
        linkTipo: normalizeText(r[7]) || null,
        linkId: normalizeText(r[8]) || null,
        geradoEm: normalizeText(r[9]) || null,
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
