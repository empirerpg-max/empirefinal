import { googleSheetsService, normalizeComparison } from "../services/googleSheetsService";
import { mirrorMusicaRowParaD1 } from "./gestaoController";

// Varredura geral (não mais pontual por faixa): acha TODA linha de
// Musicas que ficou no mesmo estado "marcar como pendente" pela metade
// — confirmado ao vivo em várias faixas do álbum "Hayley Wonderwall -
// Overhated" (He, Kids, ♥...), vindo de testes que rodaram direto em
// cima do dado real durante a implementação do recurso, não de cliques
// do admin: coluna X (pendente) já "Sim", B (idTopico) já em branco,
// MAS F (comentariosPara) ainda com o ID do tópico antigo — sinal claro
// de que a 1ª metade da escrita (Sheets) rodou mas a 2ª metade (reespelhar
// pro D1 + apagar os comentários do tópico antigo) nunca completou,
// deixando o D1 desatualizado (pendente=0, tópico "vivo") enquanto a
// planilha já diz pendente. Essa combinação (X=Sim + B="" + F≠"") não
// acontece em nenhum fluxo normal do app — é só esse estado quebrado.
//
// GET /api/empire-play/admin/fix-varredura-pendentes-d1?dryRun=1
export async function adminFixVarreduraPendentesD1Controller(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const dryRun = url.searchParams.get("dryRun") === "1";

  const rows = await googleSheetsService.principal.readValues("Musicas");
  const achadas: { linha: number; titulo: string; idTopicoAntigo: string }[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    const pendente = normalizeComparison((row[23] || "").trim());
    const idTopico = (row[1] || "").trim();
    const comentariosPara = (row[5] || "").trim();
    if (pendente === "sim" && !idTopico && comentariosPara) {
      achadas.push({ linha: i + 1, titulo: (row[7] || "").trim(), idTopicoAntigo: comentariosPara });
    }
  }

  if (dryRun) {
    return new Response(JSON.stringify({ success: true, dryRun: true, achadas }, null, 2), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  const corrigidas: { linha: number; titulo: string; comentariosApagados: number }[] = [];
  for (const { linha, titulo, idTopicoAntigo } of achadas) {
    await googleSheetsService.principal.updateValues("Musicas", `F${linha}`, [[""]]);
    await mirrorMusicaRowParaD1(linha);

    const comentarios = await googleSheetsService.principal.readValues("Comentarios_Musicas").catch(() => []);
    const idNorm = normalizeComparison(idTopicoAntigo);
    const linhasComentario: number[] = [];
    for (let i = 1; i < comentarios.length; i++) {
      if (normalizeComparison(comentarios[i]?.[0] || "") === idNorm) linhasComentario.push(i + 1);
    }
    if (linhasComentario.length > 0) {
      await googleSheetsService.principal.deleteRows("Comentarios_Musicas", linhasComentario);
    }
    corrigidas.push({ linha, titulo, comentariosApagados: linhasComentario.length });
  }

  return new Response(JSON.stringify({ success: true, corrigidas }, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
