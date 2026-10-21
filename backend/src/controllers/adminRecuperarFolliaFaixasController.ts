import { getCatalogoDb } from "../services/musicasDbService";
import { googleSheetsService, normalizeText, normalizeComparison } from "../services/googleSheetsService";
import { withWriteLock } from "../services/writeLockService";

// Recuperação definitiva do incidente FOLLIA (Max Gorghan) em "Musicas":
//
// 1. GRAVA DO ZERO as 9 faixas reais da campanha (fonte de verdade: JSON
//    intacto em PreSave_Album, nunca tocado por nenhum bug) usando o
//    helper seguro (appendRowMusicasSeguro, já corrigido) — mais
//    confiável do que tentar reconstruir dado de linhas bagunçadas: a
//    varredura anterior achou só 3 das 9 faixas reais, mais 2 variantes
//    QUEBRADAS (título com erro de digitação/capitalização e campos com
//    lixo tipo "1111"/"111") que não podem virar catálogo de verdade.
// 2. VARRE um intervalo bem maior de linhas pra achar e ESVAZIAR toda
//    ocorrência deslocada (âncora = coluna ALBUM = "Max Gorghan -
//    FOLLIA", sempre 3 células depois do título, layout fixo A..X) —
//    sobra do appendRow antigo + seu próprio retry interno (3
//    tentativas) multiplicando cópias cada vez mais deslocadas. NUNCA
//    toca na coluna do Código único pré-existente de cada linha (não
//    relacionado a este incidente).
//
// ?dryRun=1 só mostra o plano.
// GET /api/empire-play/admin/recuperar-follia-faixas?dryRun=1
export async function adminRecuperarFolliaFaixasController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const dryRun = url.searchParams.get("dryRun") === "1";

  // ---- 1. Faixas reais, direto da fonte de verdade (campanha) ----
  const presaveRows = await googleSheetsService.principal.readValues("PreSave_Album", "A1:U2000").catch(() => []);
  let campanhaRow: string[] | null = null;
  for (let i = 1; i < presaveRows.length; i++) {
    if (normalizeText(presaveRows[i]?.[0]) === "PRESAVE-7da5f189") {
      campanhaRow = presaveRows[i];
      break;
    }
  }
  if (!campanhaRow) {
    return new Response(JSON.stringify({ success: false, error: "Campanha PRESAVE-7da5f189 não encontrada." }, null, 2), {
      status: 404,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }
  const artista = normalizeText(campanhaRow[3]);
  const albumFullTitle = normalizeText(campanhaRow[4]);
  const capaUrl = normalizeText(campanhaRow[5]);
  const jogadorId = normalizeText(campanhaRow[1]);
  const dataFormatada = "21/10/2026";
  let faixasCampanha: Record<string, unknown>[] = [];
  try {
    faixasCampanha = JSON.parse(normalizeText(campanhaRow[13]) || "[]");
  } catch {
    faixasCampanha = [];
  }

  // Só faixa INÉDITA com título real (exclui a "-" vazia e as
  // não-inéditas, que são vinculação de faixa já existente — tratadas
  // à parte, não aqui).
  const faixasValidas = faixasCampanha.filter(
    (f) => f.inedita && normalizeText(String(f.titulo || "")) && normalizeText(String(f.titulo || "")) !== "-",
  );

  const registrosParaGravar = faixasValidas.map((f) => {
    const participantes = Array.isArray(f.participantes) ? (f.participantes as string[]).filter(Boolean) : [];
    const tituloBruto = String(f.titulo || "");
    const songTitle = tituloBruto.includes(" - ") ? tituloBruto : `${artista} - ${tituloBruto}`;
    return [
      dataFormatada, // A
      "", // B topicId (abrirTopico sempre false aqui, confirmado no payload original)
      f.mediaUrl && String(f.mediaUrl) !== "-" ? String(f.mediaUrl) : "", // C
      capaUrl || "", // D
      f.letra ? String(f.letra) : "", // E
      "", // F
      jogadorId || "", // G
      songTitle, // H
      f.tipoSingle ? String(f.tipoSingle) : "TRACKLIST ALBUM", // I
      f.tipoMusica ? String(f.tipoMusica) : "SOLO", // J
      albumFullTitle, // K
      "", // L
      "", // M
      artista, // N
      participantes[0] || "", // O
      participantes[1] || "", // P
      participantes[2] || "", // Q
      participantes[3] || "", // R
      participantes[4] || "", // S
      "", // T
      String(f.num || ""), // U
      "", // V
      "", // W
      "Sim", // X
    ];
  });

  // ---- 2. Varredura ampla pra achar e limpar toda ocorrência deslocada ----
  const LINHA_INICIO = 760;
  const LINHA_FIM = 1100;
  const COL_FIM = "BZZ";
  const LOTE = 100; // lê em lotes pra não estourar timeout numa leitura só

  const linhasParaLimpar: { linha: number; colInicio: number }[] = [];
  for (let inicio = LINHA_INICIO; inicio <= LINHA_FIM; inicio += LOTE) {
    const fim = Math.min(inicio + LOTE - 1, LINHA_FIM);
    const rows = await googleSheetsService.principal
      .readValues("Musicas", `A${inicio}:${COL_FIM}${fim}`)
      .catch(() => []);
    for (let i = 0; i < rows.length; i++) {
      const linha = inicio + i;
      const row = rows[i];
      if (!row) continue;
      for (let c = 0; c < row.length; c++) {
        if (normalizeComparison(normalizeText(row[c])) !== normalizeComparison(albumFullTitle)) continue;
        const colInicioRegistro = c - 10; // K está 10 células depois de A no layout A..X
        // colInicio === 0 = registro começando na coluna A de verdade —
        // ou é uma faixa já bem formada (ex: as 9 recém-gravadas por
        // este mesmo endpoint, se rodado de novo) ou pertence a outra
        // função que já escreve certo. NUNCA trata como lixo — só o que
        // está deslocado (colInicio > 0) é sobra do bug.
        if (colInicioRegistro <= 0) continue;
        linhasParaLimpar.push({ linha, colInicio: colInicioRegistro });
      }
    }
  }

  if (dryRun) {
    return new Response(
      JSON.stringify(
        {
          success: true,
          dryRun: true,
          totalFaixasParaGravar: registrosParaGravar.length,
          titulosParaGravar: registrosParaGravar.map((r) => r[7]),
          totalOcorrenciasParaLimpar: linhasParaLimpar.length,
        },
        null,
        2,
      ),
      { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
    );
  }

  // 1. Grava as 9 faixas reais do zero, via escrita segura.
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

  // Idempotência: se rodado de novo, não duplica faixa que já está bem
  // formada (começando na coluna A de verdade) — usa o mesmo mapa de
  // ocorrências coletado acima pra saber quais títulos já existem limpos.
  const titulosJaCorretos = new Set<string>();
  for (let inicio = LINHA_INICIO; inicio <= LINHA_FIM; inicio += LOTE) {
    const fim = Math.min(inicio + LOTE - 1, LINHA_FIM);
    const rows = await googleSheetsService.principal.readValues("Musicas", `H${inicio}:K${fim}`).catch(() => []);
    for (const row of rows) {
      const titulo = normalizeText(row?.[0]);
      const album = normalizeText(row?.[3]);
      if (titulo && normalizeComparison(album) === normalizeComparison(albumFullTitle)) {
        titulosJaCorretos.add(normalizeComparison(titulo));
      }
    }
  }

  const gravadas: { titulo: string; linhaNova: number | null; pulada?: boolean }[] = [];
  for (const registro of registrosParaGravar) {
    const titulo = String(registro[7]);
    if (titulosJaCorretos.has(normalizeComparison(titulo))) {
      gravadas.push({ titulo, linhaNova: null, pulada: true });
      continue;
    }
    const linhaNova = await appendRowMusicasSeguro(registro);
    gravadas.push({ titulo, linhaNova });
    await new Promise((resolve) => setTimeout(resolve, 400));
  }

  // 2. Esvazia TODAS as ocorrências deslocadas encontradas — agora que as
  // faixas reais já estão gravadas limpas em linhas próprias, toda
  // ocorrência antiga (certa ou quebrada) é só lixo deixado pelo bug.
  let limposOk = 0;
  let limposFalha = 0;
  for (const l of linhasParaLimpar) {
    const vazio = Array(24).fill("");
    const primeiraCol = toColLetter(l.colInicio);
    const ultimaCol = toColLetter(l.colInicio + 23);
    const sucesso = await googleSheetsService.principal
      .updateValues("Musicas", `${primeiraCol}${l.linha}:${ultimaCol}${l.linha}`, [vazio])
      .catch(() => false);
    if (sucesso) limposOk++;
    else limposFalha++;
    await new Promise((resolve) => setTimeout(resolve, 350));
  }

  // 3. Confirma D1 — upsertMidiaD1/upsertMusicaD1 usam os campos em
  // memória direto (nunca leem de volta a linha do Sheets), então não
  // deveriam ter herdado o deslocamento.
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
        gravadas,
        limpeza: { ok: limposOk, falha: limposFalha, total: linhasParaLimpar.length },
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
