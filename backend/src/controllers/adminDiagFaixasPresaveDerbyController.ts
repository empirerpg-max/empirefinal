import { googleSheetsService, normalizeComparison, normalizeText } from "../services/googleSheetsService";

// Só leitura. O jogador reportou que o álbum DERBY (Cowboy Fresh) ficou
// com só 3 faixas depois da limpeza de duplicatas — mas a campanha de
// pre-save original (PreSave_Album!N, coluna FaixasJson) tem a lista
// REAL configurada pelo jogador, incluindo faixas inéditas E faixas
// existentes vinculadas (campo `inedita: false`, que processarFaixasDoAlbum
// trata via vincularFaixaExistenteAoAlbum — não cria linha nova em
// Musicas, só atualiza a coluna K/ALBUM da faixa já existente). Esse
// diagnóstico lê a campanha e compara com o que está hoje em "Musicas"
// pra achar exatamente o que falta.
export async function adminDiagFaixasPresaveDerbyController(): Promise<Response> {
  const presaveRows = await googleSheetsService.principal.readValues("PreSave_Album").catch(() => []);
  let linhaCampanha = -1;
  let faixasRaw = "";
  let albumTituloFull = "";
  for (let i = 1; i < presaveRows.length; i++) {
    const row = presaveRows[i];
    if (!row) continue;
    const artista = normalizeComparison(row[3]);
    const album = normalizeComparison(row[4]);
    if (artista.includes("cowboy fresh") && album.includes("derby")) {
      linhaCampanha = i + 1;
      faixasRaw = row[13] || "";
      albumTituloFull = row[4] || "";
      break;
    }
  }

  let faixasCampanha: any[] = [];
  try {
    faixasCampanha = JSON.parse(faixasRaw || "[]");
  } catch {
    faixasCampanha = [];
  }

  const musicasRows = await googleSheetsService.principal.readValues("Musicas", "A1:AE50000").catch(() => []);
  const faixasAtuais: { linha: number; ordem: string; titulo: string }[] = [];
  for (let i = 1; i < musicasRows.length; i++) {
    const row = musicasRows[i];
    if (!row) continue;
    const album = normalizeComparison(row[10]); // K
    if (album.includes("cowboy fresh") && album.includes("derby")) {
      faixasAtuais.push({ linha: i + 1, ordem: normalizeText(row[20]), titulo: normalizeText(row[7]) });
    }
  }

  const titulosAtuais = new Set(faixasAtuais.map((f) => normalizeComparison(f.titulo)));
  const faltando = faixasCampanha.filter((f) => {
    const titulo = normalizeText(f.titulo || "");
    const tituloComArtista = titulo.includes(" - ") ? titulo : `Cowboy Fresh - ${titulo}`;
    return !titulosAtuais.has(normalizeComparison(tituloComArtista)) && !titulosAtuais.has(normalizeComparison(titulo));
  });

  return new Response(
    JSON.stringify(
      {
        success: true,
        linhaCampanha,
        albumTituloFull,
        totalFaixasCampanha: faixasCampanha.length,
        faixasCampanha,
        faixasAtuaisEmMusicas: faixasAtuais,
        faltando,
      },
      null,
      2,
    ),
    { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
}
