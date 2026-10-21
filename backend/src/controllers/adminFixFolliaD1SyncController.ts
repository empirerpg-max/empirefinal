import { getCatalogoDb } from "../services/musicasDbService";
import { googleSheetsService, normalizeText, normalizeComparison } from "../services/googleSheetsService";
import { mirrorMusicaRowParaD1 } from "./gestaoController";

// Corrige a divergência encontrada em diagnostico-follia-topicos: o
// usuário corrigiu manualmente no Sheets o "Pendente?"/tópico de várias
// faixas do álbum FOLLIA (Max Gorghan), mas o espelho D1 (tabela
// `musicas`, fonte real de leitura do Fórum) nunca foi re-sincronizado —
// por isso faixas pendentes (ex.: "Alchimia" EMP948, "Tutte le volte"
// EMP951) ainda apareciam com tópico aberto ("ACESSAR") no Fórum mesmo
// marcadas como pendente="Sim" no Sheets.
//
// Além disso o D1 ficou com dezenas de linhas-lixo duplicadas (resíduo da
// corrupção antiga do appendRow em Musicas) pro mesmo álbum, com
// codigo_unico que nunca existiu de fato no Sheets.
//
// Passo 1: re-espelha (mirrorMusicaRowParaD1) cada uma das linhas reais
// do Sheets pro FOLLIA, usando o Sheets como fonte da verdade — corrige
// pendente/id_topico/comentarios_para pra bater exatamente com o Sheets
// atual.
// Passo 2: apaga (DELETE — regra de "nunca deletar" vale só pro Sheets,
// não pro D1) toda linha de `musicas` com album = "Max Gorghan - FOLLIA"
// cujo codigo_unico não corresponda a nenhuma linha real do Sheets.
//
// ?dryRun=1 só mostra o plano, sem gravar/apagar nada.
// GET /api/empire-play/admin/fix-follia-d1-sync?dryRun=1
export async function adminFixFolliaD1SyncController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const dryRun = url.searchParams.get("dryRun") === "1";
  const ALBUM_TITULO = "Max Gorghan - FOLLIA";

  const rows = await googleSheetsService.principal.readValues("Musicas", "A1:AE2000").catch(() => []);
  const linhasReais: { linha: number; titulo: string; codigoUnico: string }[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    const album = normalizeText(row[10]);
    if (normalizeComparison(album) !== normalizeComparison(ALBUM_TITULO)) continue;
    const codigoUnico = normalizeText(row[25]);
    if (!codigoUnico) continue;
    linhasReais.push({ linha: i + 1, titulo: normalizeText(row[7]), codigoUnico });
  }

  const codigosReais = new Set(linhasReais.map((l) => l.codigoUnico));

  const db = getCatalogoDb();
  if (!db) {
    return new Response(JSON.stringify({ success: false, error: "D1 indisponível" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const d1Antes = await db
    .prepare("SELECT codigo_unico, titulo, pendente FROM musicas WHERE album = ?")
    .bind(ALBUM_TITULO)
    .all()
    .catch(() => null);
  const todasLinhasD1 = (d1Antes?.results || []) as { codigo_unico: string; titulo: string; pendente: number }[];
  const codigosLixo = todasLinhasD1.map((r) => r.codigo_unico).filter((c) => !codigosReais.has(c));

  if (dryRun) {
    return new Response(
      JSON.stringify(
        {
          success: true,
          dryRun: true,
          linhasReaisParaResincronizar: linhasReais,
          totalLinhasLixoParaApagar: codigosLixo.length,
          codigosLixo,
        },
        null,
        2,
      ),
      { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
    );
  }

  let resincronizadas = 0;
  for (const l of linhasReais) {
    await mirrorMusicaRowParaD1(l.linha);
    resincronizadas++;
  }

  let apagadas = 0;
  for (const codigo of codigosLixo) {
    const r = await db.prepare("DELETE FROM musicas WHERE album = ? AND codigo_unico = ?").bind(ALBUM_TITULO, codigo).run().catch(() => null);
    if (r) apagadas++;
  }

  return new Response(
    JSON.stringify({ success: true, resincronizadas, apagadas, totalLixoEncontrado: codigosLixo.length }, null, 2),
    { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
}
