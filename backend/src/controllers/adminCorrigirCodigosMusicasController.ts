// Corrige o Código único (coluna Z da aba Musicas + D1) das músicas listadas
// em CORRECOES_CODIGOS_MUSICAS (aprovado pelo usuário em 2026-11-18, fonte:
// arquivo EDIÇÃO CHARTS). Cada música é achada na planilha pelo TÓPICO
// (coluna B) ou, sem tópico, por título (H) + código atual (Z); se alguma não
// casar com exatamente UMA linha, nada é gravado.
//
// GET /api/empire-play/admin/corrigir-codigos-musicas            -> simulação
// GET /api/empire-play/admin/corrigir-codigos-musicas?confirmar=1 -> aplica
import { googleSheetsService, normalizeText, readValuesFresh } from "../services/googleSheetsService";
import { getCatalogoDb } from "../services/catalogoDbService";
import { registrarLogSistema } from "../services/logSistemaService";
import { CORRECOES_CODIGOS_MUSICAS } from "../data/correcoesCodigosMusicas20261118";
import { tituloBase } from "../services/musicasRekeyD1";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });
}

export async function adminCorrigirCodigosMusicasController(request: Request): Promise<Response> {
  const confirmar = new URL(request.url).searchParams.get("confirmar") === "1";
  const db = getCatalogoDb();
  if (!db) return json({ success: false, error: "sem D1" }, 500);
  try {
    const rows = await readValuesFresh("principal", "Musicas", "A:Z");
    const plano: { linha: number; titulo: string; chave: string; de: string; para: string }[] = [];
    const jaCorretas: string[] = [];
    const erros: { titulo: string; motivo: string }[] = [];
    for (const c of CORRECOES_CODIGOS_MUSICAS) {
      const topico = c.chave.startsWith("t:") ? c.chave.slice(2) : "";
      const linhas: number[] = [];
      for (let i = 1; i < rows.length; i++) {
        const r = rows[i] || [];
        const z = normalizeText(r[25]);
        const casa = topico
          ? normalizeText(r[1]) === topico
          : !normalizeText(r[1]) && tituloBase(normalizeText(r[7])) === tituloBase(c.titulo) && // D1 às vezes guarda sem o "Artista - "
             (z === c.atual || z === c.correto);
        if (casa) linhas.push(i + 1);
      }
      if (linhas.length !== 1) {
        erros.push({ titulo: c.titulo, motivo: `${linhas.length} linhas na planilha casam` });
        continue;
      }
      const z = normalizeText(rows[linhas[0] - 1][25]);
      if (z === c.correto) {
        jaCorretas.push(c.titulo);
        continue;
      }
      if (z !== c.atual) {
        erros.push({ titulo: c.titulo, motivo: `código na planilha é "${z}", esperado "${c.atual}"` });
        continue;
      }
      plano.push({ linha: linhas[0], titulo: c.titulo, chave: c.chave, de: c.atual, para: c.correto });
    }
    if (erros.length) return json({ success: false, mensagem: "Nada gravado.", erros, plano: plano.length }, 409);
    if (!confirmar) return json({ success: true, simulacao: true, total: plano.length, jaCorretas: jaCorretas.length, plano });

    await registrarLogSistema({
      categoria: "Ação concluída",
      oQueAconteceu: `Correção de Código único em ${plano.length} músicas (coluna Z de Musicas + D1), autorizada pelo usuário em 2026-11-18 (fonte: EDIÇÃO CHARTS). Códigos antigos no detalhe técnico.`,
      onde: "adminCorrigirCodigosMusicasController",
      detalheTecnico: JSON.stringify(plano),
    });
    const gravou = await googleSheetsService.principal.updateValuesBatch(
      plano.map((p) => ({ sheetName: "Musicas", range: `Z${p.linha}`, values: [[p.para]] })),
    );
    if (!gravou) return json({ success: false, error: "Falha ao gravar na planilha (D1 não alterado). Rode de novo." }, 500);

    const stmts = [];
    for (const p of plano) {
      stmts.push(
        db.prepare(
          `UPDATE musicas SET codigo_unico = ?1,
             chave = CASE WHEN chave LIKE 'c:%' THEN 'c:' || ?1 || '|' || trim(titulo) ELSE chave END,
             atualizado_em = datetime('now')
           WHERE chave = ?2`,
        ).bind(p.para, p.chave),
      );
      if (p.chave.startsWith("t:")) {
        stmts.push(db.prepare("UPDATE comentarios_musicas SET musica_id = ? WHERE id_topico = ?").bind(p.para, p.chave.slice(2)));
      }
    }
    for (let i = 0; i < stmts.length; i += 50) await db.batch(stmts.slice(i, i + 50));

    // Confirma relendo as duas fontes.
    const depois = await readValuesFresh("principal", "Musicas", "A:Z");
    const naoPlanilha = plano.filter((p) => normalizeText(depois[p.linha - 1]?.[25]) !== p.para).map((p) => p.titulo);
    const naoD1: string[] = [];
    for (const p of plano) {
      const r = await db
        .prepare("SELECT count(*) AS n FROM musicas WHERE codigo_unico = ? AND (chave = ? OR chave LIKE ?)")
        .bind(p.para, p.chave, `c:${p.para}|%`)
        .all<{ n: number }>();
      if (!Number(r.results?.[0]?.n)) naoD1.push(p.titulo);
    }
    return json({ success: !naoPlanilha.length && !naoD1.length, aplicadas: plano.length, jaCorretas: jaCorretas.length, naoConfirmadasPlanilha: naoPlanilha, naoConfirmadasD1: naoD1 });
  } catch (err) {
    return json({ success: false, error: (err as Error).message }, 500);
  }
}
