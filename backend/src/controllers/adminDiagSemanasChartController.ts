import { googleSheetsService, normalizeText, normalizeComparison } from "../services/googleSheetsService";

// Diagnóstico pontual (só leitura): confirmar ao vivo se as colunas reais de
// "semanas no chart" têm dado preenchido — fonte de verdade é EDIÇÃO CHARTS
// (música, cruzado por Código único) e EDIÇÃO CHARTS ÁLBUMS (álbum, cruzado
// por Código único), não as cópias em Musicas!L/Albuns. Usuário reportou não
// ver o pill "X semanas no chart" no Fórum depois do primeiro deploy.
//
// ?busca=<texto> filtra Albuns/EDIÇÃO CHARTS ÁLBUMS por nome (em vez de só
// mostrar as primeiras linhas) — usado pra investigar um álbum específico
// que não está mostrando o pill (ex: "SANTISSIMA").
export async function adminDiagSemanasChartController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const busca = normalizeComparison(url.searchParams.get("busca") || "");

  const [musicasRows, edicaoChartsRows, edicaoAlbunsRows, albunsRows] = await Promise.all([
    googleSheetsService.principal.readValues("Musicas", "A2:Z30").catch(() => []),
    googleSheetsService.edicaoCharts.readValues("EDIÇÃO CHARTS", "A2:BD5000").catch(() => []),
    googleSheetsService.edicaoCharts.readValues("EDIÇÃO CHARTS ÁLBUMS", "A2:R5000").catch(() => []),
    googleSheetsService.principal.readValues("Albuns", "A2:L500").catch(() => []),
  ]);

  const musicas = musicasRows.map((r, i) => ({
    linha: i + 2,
    titulo_H: normalizeText(r[7]).slice(0, 40),
    weeks_L: normalizeText(r[11]),
    weeks_video_M: normalizeText(r[12]),
    codigo_unico_Z: normalizeText(r[25]),
  }));

  if (busca) {
    const albunsMatch = albunsRows
      .map((r, i) => ({
        linha: i + 2,
        nome_B: normalizeText(r[1]).slice(0, 60),
        codigo_unico_L: normalizeText(r[11]),
      }))
      .filter((a) => normalizeComparison(a.nome_B).includes(busca));

    const edicaoAlbunsMatch = edicaoAlbunsRows
      .map((r, i) => ({
        linha: i + 2,
        artista_A: normalizeText(r[0]).slice(0, 30),
        semanas_C: normalizeText(r[2]),
        nome_album_D: normalizeText(r[3]).slice(0, 40),
        codigo_unico_R: normalizeText(r[17]),
      }))
      .filter(
        (a) =>
          normalizeComparison(a.nome_album_D).includes(busca) ||
          normalizeComparison(a.artista_A).includes(busca),
      );

    return new Response(
      JSON.stringify({ success: true, busca, albunsMatch, edicaoAlbunsMatch }, null, 2),
      { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
    );
  }

  const edicaoCharts = edicaoChartsRows.slice(0, 15).map((r, i) => ({
    linha: i + 2,
    nome_B: normalizeText(r[1]).slice(0, 40),
    weeks_F: normalizeText(r[5]),
    codigo_unico_BD: normalizeText(r[55]),
  }));

  const edicaoAlbuns = edicaoAlbunsRows.slice(0, 15).map((r, i) => ({
    linha: i + 2,
    artista_A: normalizeText(r[0]).slice(0, 30),
    semanas_C: normalizeText(r[2]),
    nome_album_D: normalizeText(r[3]).slice(0, 30),
    codigo_unico_R: normalizeText(r[17]),
  }));

  return new Response(JSON.stringify({ success: true, musicas, edicaoCharts, edicaoAlbuns }, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
