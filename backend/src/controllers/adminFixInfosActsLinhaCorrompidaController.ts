import { googleSheetsService, normalizeComparison, normalizeText } from "../services/googleSheetsService";

// Causa raiz real (achada ao vivo em 2026-11-06, caso Ashley Spring/Paris
// Godwin — "mandei a biografia 5 vezes e nada aparece", artista "não foi
// criado" em INFOS ACTS): NÃO é o artista sem linha nenhuma — são VÁRIAS
// linhas, uma por tentativa, mas o appendRow (:append nativo do Sheets, com
// range "A:ZZ"/"A:G"/"A:E") deixa a própria API decidir em que COLUNA
// começar a escrever, olhando o "formato de tabela" que ela detecta na
// aba — e como "INFOS ACTS" é extremamente esparsa (cada artista só
// preenche as colunas que usou: C/G foto, E bio, R/S capa...), essa
// detecção erra e escreve cada vez mais PRA DIREITA, nunca na coluna A.
// Resultado: a coluna A (nome) fica em branco em toda tentativa, e todo
// código que procura o artista por "normalizeComparison(row[0]) === nome"
// (leitura E escrita) nunca encontra essas linhas — cada nova tentativa
// de salvar cria outra linha corrompida, em vez de atualizar a de antes.
// Confirmado ao vivo: linhas 587-594 e 599 de 600 todas com "Ashley
// Spring" em colunas entre G e BB (nunca A), e o mesmo padrão em OUTROS
// artistas recentes (Lexie Summers, Back Miller, Zaira, Nicholas Cook) —
// bug sistêmico, não isolado desses dois. A correção definitiva
// (separada desta, já aplicada em artistasController.ts) troca o
// appendRow nessas 4 escritas por updateValues num range EXPLÍCITO
// (A{linha}:X{linha}), que nunca deixa o Sheets "adivinhar" coluna.
//
// Esta ferramenta é só pra CONSERTAR o que já está corrompido: varre TODA
// a aba (não só a coluna A) procurando qualquer célula que bata com um
// dos nomes pedidos, separa o que parece foto (link do Drive) do que
// parece biografia (texto longo) pegando a ÚLTIMA ocorrência de cada (a
// mais recente, já que :append sempre escreve no fim da planilha), e
// grava UMA linha nova, limpa, com nome na coluna A — sem mexer/apagar as
// linhas corrompidas antigas (ficam inofensivas, invisíveis pra qualquer
// busca por nome).
//
// GET /api/empire-play/admin/fix-infos-acts-linha-corrompida?nomes=Ashley Spring,Paris Godwin&confirmar=1
const INFOS_ACTS_SHEET = "INFOS ACTS";

export async function adminFixInfosActsLinhaCorrompidaController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const confirmar = url.searchParams.get("confirmar") === "1";
  const nomesParam = url.searchParams.get("nomes") || url.searchParams.get("nome") || "";
  const nomesAlvo = nomesParam.split(",").map((n) => n.trim()).filter(Boolean);

  if (nomesAlvo.length === 0) {
    return new Response(JSON.stringify({ success: false, error: "nomes é obrigatório (separados por vírgula)." }), {
      status: 400,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  const rows = await googleSheetsService.registrosCharts.readValues(INFOS_ACTS_SHEET).catch(() => []);

  const resultado: Record<
    string,
    {
      jaTemLinhaLimpa: boolean;
      linhasCorrompidasEncontradas: number[];
      fotoEncontrada: string;
      biografiaEncontrada: string;
      linhaNovaGravada: number | null;
    }
  > = {};

  const entradasParaGravar: { sheetName: string; range: string; values: string[][] }[] = [];
  let proximaLinhaLivre = rows.length + 1;

  for (const nomeAlvo of nomesAlvo) {
    const normAlvo = normalizeComparison(nomeAlvo);

    // Já existe uma linha "limpa" (nome na coluna A)? Se sim, não mexe —
    // essa ferramenta é só pra quando a linha nunca foi encontrada por
    // estar corrompida.
    const jaTemLinhaLimpa = rows.slice(1).some((r) => normalizeComparison(r[0]) === normAlvo);

    const linhasCorrompidas: number[] = [];
    let fotoEncontrada = "";
    let biografiaEncontrada = "";

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row) continue;
      // Só interessa a linha corrompida: nome em QUALQUER coluna != A.
      const temNomeForaDaColunaA = row.some((cell, c) => c > 0 && normalizeComparison(cell) === normAlvo);
      if (!temNomeForaDaColunaA) continue;
      linhasCorrompidas.push(i + 1);

      for (const cell of row) {
        const valor = normalizeText(cell);
        if (!valor || normalizeComparison(valor) === normAlvo) continue;
        if (/^https?:\/\/drive\.google\.com/i.test(valor)) {
          fotoEncontrada = valor; // última ocorrência vence (sobrescreve a anterior)
        } else if (valor.length > 150) {
          biografiaEncontrada = valor; // idem — texto longo = biografia
        }
      }
    }

    let linhaNovaGravada: number | null = null;
    if (!jaTemLinhaLimpa && linhasCorrompidas.length > 0 && confirmar) {
      linhaNovaGravada = proximaLinhaLivre;
      entradasParaGravar.push({
        sheetName: INFOS_ACTS_SHEET,
        range: `A${linhaNovaGravada}:E${linhaNovaGravada}`,
        values: [[nomeAlvo, "", fotoEncontrada, "", biografiaEncontrada]],
      });
      proximaLinhaLivre += 1;
    }

    resultado[nomeAlvo] = {
      jaTemLinhaLimpa,
      linhasCorrompidasEncontradas: linhasCorrompidas,
      fotoEncontrada,
      biografiaEncontrada,
      linhaNovaGravada,
    };
  }

  if (confirmar && entradasParaGravar.length > 0) {
    await googleSheetsService.registrosCharts.updateValuesBatch(entradasParaGravar);
  }

  return new Response(JSON.stringify({ success: true, confirmar, resultado }, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
