import { googleSheetsService, normalizeComparison } from "../services/googleSheetsService";
import { buildMusicaUpsertStatement, getCatalogoDb, type MusicaUpsert } from "../services/musicasDbService";
import { registrarLogSistema } from "../services/logSistemaService";

// Conserto pontual: pega a(s) linha(s) da planilha Musicas que casam com um
// "código único" exato (coluna Z) e grava/atualiza SÓ ESSA(S) linha(s) na
// tabela `musicas` do D1 — nada mais é tocado (sem varrer ou reescrever o
// resto da tabela). Feito pra cobrir casos em que `upsertMusicaD1` nunca
// rodou na hora da criação (ex.: Abaddon, código EMP663) e o D1 ficou sem
// essa linha enquanto a planilha já tinha o dado certo.
//
// POST /api/empire-play/admin/fix-backfill-musica-d1  body: { codigoUnico: "EMP663" }
export async function adminFixBackfillMusicaD1Controller(request: Request): Promise<Response> {
  let codigoUnico = "";
  try {
    const body = (await request.json()) as { codigoUnico?: string };
    codigoUnico = (body?.codigoUnico || "").trim();
  } catch {
    // ignora, cai no erro abaixo
  }
  if (!codigoUnico) {
    return new Response(JSON.stringify({ success: false, error: "codigoUnico é obrigatório." }), {
      status: 400,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  const rows = await googleSheetsService.principal.readValues("Musicas");
  const alvo = normalizeComparison(codigoUnico);
  const encontradas = rows
    .slice(1)
    .map((row, i) => ({ linha: i + 2, row }))
    .filter(({ row }) => normalizeComparison((row[25] || "").trim()) === alvo);

  if (encontradas.length === 0) {
    return new Response(
      JSON.stringify({ success: false, error: `Nenhuma linha na planilha Musicas com código único "${codigoUnico}".` }),
      { status: 404, headers: { "Content-Type": "application/json; charset=utf-8" } },
    );
  }

  const db = getCatalogoDb();
  if (!db) {
    return new Response(JSON.stringify({ success: false, error: "D1 (CATALOGO_DB) indisponível." }), {
      status: 503,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  const gravadas: string[] = [];
  for (const { linha, row } of encontradas) {
    const m: MusicaUpsert = {
      codigoUnico: (row[25] || "").trim(),
      idTopico: (row[1] || "").trim() || null,
      titulo: (row[7] || "").trim(),
      artista: (row[13] || "").trim(),
      artista2: (row[14] || "").trim() || null,
      artista3: (row[15] || "").trim() || null,
      artista4: (row[16] || "").trim() || null,
      artista5: (row[17] || "").trim() || null,
      artista6: (row[18] || "").trim() || null,
      album: (row[10] || "").trim() || null,
      capaUrl: (row[3] || "").trim() || null,
      audioUrl: (row[2] || "").trim() || null,
      letra: (row[4] || "").trim() || null,
      genero: (row[19] || "").trim() || null,
      tipoSingle: (row[8] || "").trim() || null,
      tipoMusica: (row[9] || "").trim() || null,
      dataLancamento: (row[0] || "").trim() || null,
      weeks: Number(row[11]) || null,
      weeksVideo: Number(row[12]) || null,
      ordem: Number(row[20]) || null,
      idCriador: (row[6] || "").trim() || null,
      comentariosPara: (row[5] || "").trim() || null,
      pendente: normalizeComparison((row[23] || "").trim()) === normalizeComparison("Sim"),
    };

    await buildMusicaUpsertStatement(db, m).run();
    gravadas.push(`linha ${linha} (${m.titulo})`);
  }

  await registrarLogSistema({
    categoria: "Ação concluída",
    oQueAconteceu: `Backfill manual D1 musicas: código único ${codigoUnico} — ${gravadas.join(", ")}`,
    onde: "adminFixBackfillMusicaD1Controller",
  }).catch(() => {});

  return new Response(JSON.stringify({ success: true, gravadas }, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
