import { googleSheetsService, normalizeComparison } from "../services/googleSheetsService";

// Reparo pontual (2026-11-12): álbum novo da Amanda Brokne ("todo bugado",
// reportado pelo admin). Causa raiz real já corrigida no código-fonte (ver
// adminForumActionsController.ts/limparLinhaEdicaoCharts e
// adminFixDuplicataItsOverController.ts — escreviam "" em cima da coluna BD
// de EDIÇÃO CHARTS, que é um ARRAYFORMULA, quebrando o spill do código
// único pra sempre a partir dali). Este endpoint REPARA o estrago já feito:
//
// 1) Acha toda linha de EDIÇÃO CHARTS com título preenchido (B) mas código
//    vazio (BD) — candidatas a "bloqueio" do spill — e faz um clear de
//    VERDADE (values:clear, não updateValues com "") pra devolver a célula
//    ao estado vazio que deixa o ARRAYFORMULA voltar a cobrir a linha.
//    Repete em rodadas (uma rodada pode destravar a próxima) até não achar
//    mais nenhuma, ou até MAX_RODADAS.
// 2) Copia o código recém-recalculado de EDIÇÃO CHARTS!BD pra Musicas!Z em
//    toda linha da Amanda Brokne (e qualquer outra que esteja sem código em
//    Musicas mas já tenha em EDIÇÃO CHARTS).
// 3) Corrige o título da faixa "Lighthouse (French Version)" pra "Lighthouse
//    (French Remix)" e credita o participante "JOE" (faltava).
// 4) Corrige a célula corrompida de "Counting Stars" (Musicas!Z tinha o
//    texto literal "Data" em vez de um código).
//
// Sempre em modo dry-run por padrão (só relata o que faria) — passe
// ?confirmar=1 pra gravar de verdade.
//
// GET /api/gestao/admin/fix-album-amanda-brokne[?confirmar=1]

const MAX_RODADAS_DESBLOQUEIO = 15;

function colLetterToIndex0Based(letter: string): number {
  let idx = 0;
  for (const ch of letter) idx = idx * 26 + (ch.toUpperCase().charCodeAt(0) - 64);
  return idx - 1;
}

async function desbloquearSpillCodigoUnico(confirmar: boolean): Promise<{
  rodadas: { linha: number; titulo: string }[];
  linhasAindaBloqueadas: number;
}> {
  const rodadas: { linha: number; titulo: string }[] = [];

  for (let rodada = 0; rodada < MAX_RODADAS_DESBLOQUEIO; rodada++) {
    const rows = await googleSheetsService.edicaoCharts.readValues("EDIÇÃO CHARTS", "A2:BD20000");
    let linhaBloqueada = -1;
    let tituloBloqueado = "";
    for (let i = 0; i < rows.length; i++) {
      const titulo = (rows[i]?.[1] || "").trim();
      const codigo = (rows[i]?.[55] || "").trim();
      if (titulo && !codigo) {
        linhaBloqueada = i + 2;
        tituloBloqueado = titulo;
        break;
      }
    }
    if (linhaBloqueada === -1) {
      return { rodadas, linhasAindaBloqueadas: 0 };
    }
    rodadas.push({ linha: linhaBloqueada, titulo: tituloBloqueado });
    if (confirmar) {
      await googleSheetsService.edicaoCharts.clearValues("EDIÇÃO CHARTS", `BD${linhaBloqueada}:BD${linhaBloqueada}`);
    } else {
      // Dry-run: não há como simular o recálculo real do Sheets sem
      // limpar de verdade — só reporta a PRIMEIRA bloqueada (as próximas
      // só existem de fato depois que essa for liberada).
      return { rodadas, linhasAindaBloqueadas: -1 };
    }
  }
  return { rodadas, linhasAindaBloqueadas: 1 };
}

export async function adminFixAlbumAmandaBrokneController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const confirmar = url.searchParams.get("confirmar") === "1";
  const acoes: string[] = [];

  // --- 1) Desbloquear o spill do ARRAYFORMULA em EDIÇÃO CHARTS!BD ---
  const desbloqueio = await desbloquearSpillCodigoUnico(confirmar);
  if (confirmar) {
    for (const r of desbloqueio.rodadas) {
      acoes.push(`EDIÇÃO CHARTS linha ${r.linha} ("${r.titulo}"): BD limpa de verdade (values:clear) pra devolver o spill do ARRAYFORMULA.`);
    }
  }

  // --- 2) Copiar código recalculado de EDIÇÃO CHARTS!BD pra Musicas!Z ---
  const bate = (texto: string) => normalizeComparison(texto || "").includes("brokne");
  const musicasRows = await googleSheetsService.principal.readValues("Musicas");
  // Lê sempre (mesmo em dry-run) — a causa real (confirmado ao vivo,
  // 2026-11-12) não é o ARRAYFORMULA bloqueado (ele está funcionando
  // normalmente), é só a cópia EDIÇÃO CHARTS!BD -> Musicas!Z que falhou
  // silenciosamente pra essas faixas (mesma classe de falha parcial já
  // vista no álbum da Samantha Cooper) — então dry-run já mostra o
  // preview real da cópia, sem precisar confirmar antes.
  const edicaoRows = await googleSheetsService.edicaoCharts.readValues("EDIÇÃO CHARTS", "A2:BD20000");
  // título em EDIÇÃO CHARTS já vem como "Artista - Título" — mesmo formato
  // usado em Musicas!H quando concatenado com ACT PRINCIPAL (ver
  // tituloMusicaComArtista em editController.ts/gestaoController.ts).
  const codigoPorTituloEdicao = new Map<string, string>();
  for (const row of edicaoRows) {
    const titulo = normalizeComparison(row[1] || "");
    const codigo = (row[55] || "").trim();
    if (titulo && codigo) codigoPorTituloEdicao.set(titulo, codigo);
  }

  const copiasCodigo: { linha: number; titulo: string; codigo: string }[] = [];
  for (let i = 1; i < musicasRows.length; i++) {
    const row = musicasRows[i];
    const titulo = row[7] || "";
    const actPrincipal = row[13] || "";
    const participantes = row.slice(14, 19);
    const relacionada = bate(titulo) || bate(actPrincipal) || participantes.some((p) => bate(p));
    if (!relacionada) continue;
    const codigoAtual = (row[25] || "").trim();
    const codigoCorrompido = codigoAtual && !/^EMP/i.test(codigoAtual);
    if (codigoAtual && !codigoCorrompido) continue; // já tem código válido — nada a fazer
    const tituloComArtista = normalizeComparison(
      titulo.includes(" - ") ? titulo : `${actPrincipal} - ${titulo}`,
    );
    const codigoNovo = codigoPorTituloEdicao.get(tituloComArtista);
    if (codigoNovo) {
      copiasCodigo.push({ linha: i + 1, titulo, codigo: codigoNovo });
      if (confirmar) {
        await googleSheetsService.principal.updateValues("Musicas", `Z${i + 1}`, [[codigoNovo]]);
      }
    }
  }
  for (const c of copiasCodigo) {
    acoes.push(
      `Musicas linha ${c.linha} ("${c.titulo}"): código único ${confirmar ? "copiado" : "seria copiado"} de EDIÇÃO CHARTS -> "${c.codigo}".`,
    );
  }

  // --- 3) Corrigir título + participante faltando de "Lighthouse" ---
  const TITULO_ERRADO = "Lighthouse (French Version)";
  let linhaLighthouse = -1;
  for (let i = 1; i < musicasRows.length; i++) {
    // Musicas!H já vem como "Artista - Título" completo (confirmado no dump
    // real: "Amanda Brokne - Lighthouse (French Version)") — comparação
    // exata contra só o título (sem artista) nunca batia, por isso o
    // dry-run não reportava essa correção. Usa includes().
    if (normalizeComparison(musicasRows[i][7] || "").includes(normalizeComparison(TITULO_ERRADO))) {
      linhaLighthouse = i + 1;
      break;
    }
  }
  if (linhaLighthouse > 0) {
    const row = musicasRows[linhaLighthouse - 1];
    const tituloCompletoAtual = row[7] || "";
    const tituloCompletoNovo = tituloCompletoAtual.replace(/French Version/i, "French Remix");
    const participantes = row.slice(14, 19);
    const temJoe = participantes.some((p) => normalizeComparison(p || "") === "joe");
    acoes.push(
      `Musicas linha ${linhaLighthouse}: título "${tituloCompletoAtual}" ${confirmar ? "corrigido" : "seria corrigido"} para "${tituloCompletoNovo}"${temJoe ? "" : `, participante "JOE" ${confirmar ? "creditado" : "seria creditado"}`}.`,
    );
    if (confirmar) {
      await googleSheetsService.principal.updateValues("Musicas", `H${linhaLighthouse}`, [[tituloCompletoNovo]]);
      if (!temJoe) {
        const idxVazio = participantes.findIndex((p) => !(p || "").trim());
        if (idxVazio >= 0) {
          const colLetra = String.fromCharCode("O".charCodeAt(0) + idxVazio);
          await googleSheetsService.principal.updateValues("Musicas", `${colLetra}${linhaLighthouse}`, [["JOE"]]);
        }
      }
      // Espelha o título corrigido em EDIÇÃO CHARTS (coluna B) — mesmo
      // padrão já usado em updateReleaseController (editController.ts).
      for (let i = 0; i < edicaoRows.length; i++) {
        if (normalizeComparison(edicaoRows[i][1] || "").includes(normalizeComparison(TITULO_ERRADO))) {
          const novoTitulo = (edicaoRows[i][1] || "").replace(/French Version/i, "French Remix");
          await googleSheetsService.edicaoCharts.updateValues("EDIÇÃO CHARTS", `B${i + 2}`, [[novoTitulo]]);
          break;
        }
      }
    }
  }

  // --- 4) Corrigir célula corrompida de "Counting Stars" (Musicas!Z = "Data") ---
  let linhaCountingStars = -1;
  for (let i = 1; i < musicasRows.length; i++) {
    if (
      normalizeComparison(musicasRows[i][7] || "").includes("counting stars") &&
      bate(musicasRows[i][13] || "")
    ) {
      linhaCountingStars = i + 1;
      break;
    }
  }
  if (linhaCountingStars > 0) {
    const codigoAtual = (musicasRows[linhaCountingStars - 1][25] || "").trim();
    if (codigoAtual && !/^EMP/i.test(codigoAtual)) {
      acoes.push(
        `Musicas linha ${linhaCountingStars} ("Counting Stars"): célula de código corrompida ("${codigoAtual}") já tratada pela cópia do passo 2 (se um código válido foi encontrado em EDIÇÃO CHARTS) — confira a lista acima.`,
      );
    }
  }

  // --- 5) NÃO remove "Amanda Brokne" de "Hayley Wonderwall - Valley Girls" ---
  // Decisão: reportar só, sem alterar — ver observação no relatório final
  // (ambiguidade real: pode ser um feat. legítimo não documentado na lista
  // que o admin passou, que cobria só o lançamento novo, não o catálogo
  // histórico da artista).
  const linhaHayley = musicasRows.findIndex(
    (row) => normalizeComparison(row[7] || "").includes("valley girls") && bate(row.slice(14, 19).join(" ")),
  );
  if (linhaHayley >= 0) {
    acoes.push(
      `Musicas linha ${linhaHayley + 1} ("Hayley Wonderwall - Valley Girls"): tem "Amanda Brokne" como participante — NÃO alterado (ambiguidade real, decisão do admin).`,
    );
  }

  return new Response(
    JSON.stringify(
      {
        success: true,
        confirmar,
        nota: confirmar ? undefined : "Dry-run — nada foi gravado. Rode com ?confirmar=1 pra aplicar as ações listadas.",
        rodadasDesbloqueio: desbloqueio.rodadas.length,
        linhasAindaBloqueadas: desbloqueio.linhasAindaBloqueadas,
        acoes,
      },
      null,
      2,
    ),
    { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
}
