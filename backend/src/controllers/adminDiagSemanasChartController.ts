import { googleSheetsService, normalizeText } from "../services/googleSheetsService";

// Diagnóstico pontual (só leitura): confirmar ao vivo se as colunas reais de
// "semanas no chart" têm dado preenchido — fonte de verdade é EDIÇÃO CHARTS
// (música, cruzado por Código único) e EDIÇÃO CHARTS ÁLBUMS (álbum, cruzado
// por Código único), não as cópias em Musicas!L/Albuns. Usuário reportou não
// ver o pill "X semanas no chart" no Fórum depois do primeiro deploy.
export async function adminDiagSemanasChartController(): Promise<Response> {
  const [musicasRows, edicaoChartsRows, edicaoAlbunsRows] = await Promise.all([
    googleSheetsService.principal.readValues("Musicas", "A2:Z30").catch(() => []),
    googleSheetsService.edicaoCharts.readValues("EDIÇÃO CHARTS", "A2:BD15").catch(() => []),
    googleSheetsService.edicaoCharts.readValues("EDIÇÃO CHARTS ÁLBUMS", "A2:R15").catch(() => []),
  ]);

  const musicas = musicasRows.map((r, i) => ({
    linha: i + 2,
    titulo_H: normalizeText(r[7]).slice(0, 40),
    weeks_L: normalizeText(r[11]),
    weeks_video_M: normalizeText(r[12]),
    codigo_unico_Z: normalizeText(r[25]),
  }));

  const edicaoCharts = edicaoChartsRows.map((r, i) => ({
    linha: i + 2,
    nome_B: normalizeText(r[1]).slice(0, 40),
    weeks_F: normalizeText(r[5]),
    codigo_unico_BD: normalizeText(r[55]),
  }));

  const edicaoAlbuns = edicaoAlbunsRows.map((r, i) => ({
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
