import { googleSheetsService, normalizeText } from "../services/googleSheetsService";

// Diagnóstico pontual (só leitura): confirmar ao vivo se as colunas de
// "semanas no chart" (Musicas!L/M e EDIÇÃO CHARTS ÁLBUMS!C) têm dado
// preenchido de verdade pra algum item real, já que o usuário reportou não
// ver o pill "X semanas no chart" no Fórum depois do deploy.
export async function adminDiagSemanasChartController(): Promise<Response> {
  const [musicasRows, edicaoAlbunsRows] = await Promise.all([
    googleSheetsService.principal.readValues("Musicas", "A2:N30").catch(() => []),
    googleSheetsService.edicaoCharts.readValues("EDIÇÃO CHARTS ÁLBUMS", "A2:D30").catch(() => []),
  ]);

  const musicas = musicasRows.map((r, i) => ({
    linha: i + 2,
    titulo_H: normalizeText(r[7]).slice(0, 40),
    weeks_L: normalizeText(r[11]),
    weeks_video_M: normalizeText(r[12]),
  }));

  const edicaoAlbuns = edicaoAlbunsRows.map((r, i) => ({
    linha: i + 2,
    artista_A: normalizeText(r[0]).slice(0, 30),
    semanas_C: normalizeText(r[2]),
    nome_album_D: normalizeText(r[3]).slice(0, 30),
  }));

  return new Response(JSON.stringify({ success: true, musicas, edicaoAlbuns }, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
