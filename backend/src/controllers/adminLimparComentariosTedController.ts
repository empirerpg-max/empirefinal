import { googleSheetsService, normalizeText } from "../services/googleSheetsService";

// Correção pontual pedida pelo usuário: no tópico de "nostalgic traveller"
// (TED, topicId musica_1792252409065_63282h), o comentário do Wesley e um
// dos dois do Daniel ficaram duplicados (reenvio por achar que não tinha
// ido, provavelmente por causa do 404 que o tópico dava antes da correção
// retroativa de Musicas) e tem um comentário de teste do Hugo ("Teste
// típico TED") sobrando.
//
// GET /api/empire-play/admin/limpar-comentarios-ted?dryRun=1 — só lista o
// que seria apagado, sem apagar.
// GET /api/empire-play/admin/limpar-comentarios-ted — apaga de verdade.
const TOPIC_ID = "musica_1792252409065_63282h";

export async function adminLimparComentariosTedController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const dryRun = url.searchParams.get("dryRun") === "1";

  const rows = await googleSheetsService.principal.readValues("Comentarios_Musicas").catch(() => []);
  const doTopico: { linha: number; jogadorId: string; nome: string; comentario: string }[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    if (normalizeText(row[0]) !== TOPIC_ID) continue;
    doTopico.push({
      linha: i + 1,
      jogadorId: normalizeText(row[1]),
      nome: normalizeText(row[2]),
      comentario: normalizeText(row[3]),
    });
  }

  // Duplicata = mesmo jogador + mesmo texto de comentário (trim) — mantém
  // SEMPRE a primeira ocorrência (mais antiga) e marca as seguintes pra
  // apagar. "Teste típico TED" do Hugo é removido por conteúdo, não por
  // duplicata (é um comentário de teste isolado, não repetido).
  const vistos = new Set<string>();
  const linhasParaApagar: number[] = [];
  const detalhe: Record<string, unknown>[] = [];
  for (const c of doTopico) {
    const chave = `${c.jogadorId}::${c.comentario}`;
    const ehTeste = /teste t[ií]pico ted/i.test(c.comentario);
    const ehDuplicata = vistos.has(chave);
    if (!ehDuplicata) vistos.add(chave);
    if (ehDuplicata || ehTeste) {
      linhasParaApagar.push(c.linha);
      detalhe.push({ ...c, motivo: ehTeste ? "comentário de teste" : "duplicata" });
    }
  }

  if (dryRun || linhasParaApagar.length === 0) {
    return new Response(
      JSON.stringify({ success: true, dryRun: true, totalDoTopico: doTopico.length, linhasParaApagar, detalhe }, null, 2),
      { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
    );
  }

  await googleSheetsService.principal.deleteRows("Comentarios_Musicas", linhasParaApagar);

  return new Response(
    JSON.stringify({ success: true, apagado: true, linhasApagadas: linhasParaApagar, detalhe }, null, 2),
    { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
}
