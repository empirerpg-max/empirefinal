import { getCatalogoDb } from "../services/musicasDbService";
import { googleSheetsService, normalizeText, normalizeComparison } from "../services/googleSheetsService";
import { withWriteLock } from "../services/writeLockService";

// Recuperação definitiva: o fix retroativo das faixas do FOLLIA (antes de
// appendRowMusicasSeguro existir) usou o appendRow("Musicas") antigo, que
// deslocou cada escrita pra bem longe da coluna A (mesmo bug do :append já
// documentado) — e o PRÓPRIO retry interno do appendRow (3 tentativas)
// multiplicou isso em várias cópias deslocadas progressivamente mais pra
// direita, dentro de um campo muito maior de linhas "fantasma" (só com
// Código único na coluna Z, sem mais nada) que já existia antes de hoje.
//
// Estratégia: busca TODA ocorrência da âncora "Max Gorghan - FOLLIA" (a
// coluna ALBUM de cada faixa, sempre 3 células depois do título, pelo
// layout fixo A..X) num range largo de linhas/colunas, reconstrói o
// registro completo a partir de cada âncora, deduplica por TÍTULO (só a
// primeira ocorrência de cada título único é a "boa" — as repetidas são
// todas idênticas, puro efeito do retry), grava cada uma na posição
// certa via appendRowMusicasSeguro (agora seguro) e esvazia só a região
// de dado real deslocado em cada linha-origem (nunca a coluna do Código
// único pré-existente, que não tem nada a ver com isso).
//
// ?dryRun=1 só mostra o plano.
// GET /api/empire-play/admin/recuperar-follia-faixas?dryRun=1
export async function adminRecuperarFolliaFaixasController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const dryRun = url.searchParams.get("dryRun") === "1";

  const LINHA_INICIO = 760;
  const LINHA_FIM = 900;
  const COL_FIM = "BZZ"; // folga generosa — pior deslocamento visto ao vivo foi ~700 colunas

  const rows = await googleSheetsService.principal
    .readValues("Musicas", `A${LINHA_INICIO}:${COL_FIM}${LINHA_FIM}`)
    .catch(() => []);

  type Achado = {
    linha: number;
    colTitulo: number; // onde a reconstrução A..X começa (col do campo "Data")
    valores: string[]; // A..X reconstruído (24 campos)
  };
  const achados: Achado[] = [];

  for (let i = 0; i < rows.length; i++) {
    const linha = LINHA_INICIO + i;
    const row = rows[i];
    if (!row) continue;
    for (let c = 0; c < row.length; c++) {
      if (normalizeComparison(normalizeText(row[c])) !== normalizeComparison("Max Gorghan - FOLLIA")) continue;
      // c = coluna K (índice 10 relativo ao início do registro A..X) —
      // layout fixo de processarFaixasDoAlbum (gestaoController.ts).
      const colInicioRegistro = c - 10;
      if (colInicioRegistro < 0) continue;
      const valores = row.slice(colInicioRegistro, colInicioRegistro + 24).map((v) => normalizeText(v));
      achados.push({ linha, colTitulo: colInicioRegistro, valores });
    }
  }

  // Dedup por título (campo H, índice 7) — todas as cópias de uma mesma
  // faixa têm o MESMO conteúdo (confirmado ao vivo), então a primeira
  // encontrada já serve.
  const porTitulo = new Map<string, Achado>();
  for (const a of achados) {
    const titulo = a.valores[7];
    if (!titulo) continue;
    if (!porTitulo.has(titulo)) porTitulo.set(titulo, a);
  }

  const unicos = [...porTitulo.values()];
  const linhasParaLimpar = achados.map((a) => ({ linha: a.linha, colInicio: a.colTitulo }));

  if (dryRun) {
    return new Response(
      JSON.stringify(
        {
          success: true,
          dryRun: true,
          totalOcorrencias: achados.length,
          totalFaixasUnicas: unicos.length,
          faixasUnicas: unicos.map((a) => ({ linha: a.linha, titulo: a.valores[7], valores: a.valores })),
          linhasParaLimpar,
        },
        null,
        2,
      ),
      { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
    );
  }

  // 1. Grava cada faixa única numa linha de verdade, via a MESMA trava e
  // lógica de appendRowMusicasSeguro (gestaoController.ts) — replicada
  // aqui pra não criar ciclo de import entre os dois controllers.
  async function appendRowMusicasSeguro(values: string[]): Promise<number> {
    return withWriteLock("gestao:musicas-append", async () => {
      const r = await googleSheetsService.principal.readValues("Musicas", "H2:H50000");
      let ultimaLinha = 1;
      for (let i = 0; i < r.length; i++) {
        if ((r[i]?.[0] || "").trim()) ultimaLinha = i + 2;
      }
      const linhaAlvo = ultimaLinha + 1;
      await googleSheetsService.principal.updateValues("Musicas", `A${linhaAlvo}:X${linhaAlvo}`, [values]);
      return linhaAlvo;
    });
  }

  const gravadas: { titulo: string; linhaNova: number }[] = [];
  for (const a of unicos) {
    const linhaNova = await appendRowMusicasSeguro(a.valores);
    gravadas.push({ titulo: a.valores[7], linhaNova });
    await new Promise((resolve) => setTimeout(resolve, 400));
  }

  // 2. Esvazia SÓ a região de dado real deslocado em cada linha de
  // origem (24 colunas a partir de colInicio) — nunca mexe na coluna Z
  // pré-existente nem em nenhuma outra célula fora dessa janela.
  let limposOk = 0;
  let limposFalha = 0;
  for (const l of linhasParaLimpar) {
    const vazio = Array(24).fill("");
    const ultimaCol = toColLetter(l.colInicio + 23);
    const primeiraCol = toColLetter(l.colInicio);
    const sucesso = await googleSheetsService.principal
      .updateValues("Musicas", `${primeiraCol}${l.linha}:${ultimaCol}${l.linha}`, [vazio])
      .catch(() => false);
    if (sucesso) limposOk++;
    else limposFalha++;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }

  // 3. Checa D1 — upsertMidiaD1/upsertMusicaD1 usam os CAMPOS em memória
  // (não leem de volta a linha do Sheets), então não deveriam ter herdado
  // o deslocamento. Confirma mesmo assim: procura por "FOLLIA" no título
  // de qualquer linha de midia/musicas no D1.
  const db = getCatalogoDb();
  let d1Achados: unknown[] = [];
  if (db) {
    const r = await db
      .prepare("SELECT id, tipo, titulo FROM midia WHERE titulo LIKE '%Follia%' OR titulo LIKE '%FOLLIA%'")
      .all()
      .catch(() => null);
    d1Achados = r?.results || [];
  }

  return new Response(
    JSON.stringify(
      {
        success: true,
        dryRun: false,
        totalOcorrencias: achados.length,
        totalFaixasUnicas: unicos.length,
        gravadas,
        limpeza: { ok: limposOk, falha: limposFalha },
        d1Achados,
      },
      null,
      2,
    ),
    { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
}

function toColLetter(index0Based: number): string {
  let n = index0Based + 1;
  let letra = "";
  while (n > 0) {
    const resto = (n - 1) % 26;
    letra = String.fromCharCode(65 + resto) + letra;
    n = Math.floor((n - 1) / 26);
  }
  return letra;
}
