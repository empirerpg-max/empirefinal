import { googleSheetsService, normalizeComparison, normalizeText } from "../services/googleSheetsService";

// Aba REGISTRO (planilha registrosCharts) — layout confirmado ao vivo:
// A não é usada (fica sempre em branco); B = "NOME DO OFF" (nome do
// jogador); C = "CONTEÚDO PARA REGISTRO" (dropdown — precisa bater
// exatamente com o nome canônico usado no chart, senão fica com valor de
// dropdown inválido); D = "TIPO DO REGISTRO" (dropdown); E = "VALOR" é
// calculado pela própria planilha a partir de D — nunca escrevemos nela.
//
// Colunas de "Código único" (confirmadas pelo usuário) — é por AQUI que a
// busca do nome canônico deveria sempre passar, não por texto de título:
//   EDIÇÃO CHARTS (músicas/vídeos) ......... coluna BD (índice 55)
//   EDIÇÃO CHARTS ÁLBUMS ................... coluna R  (índice 17)
//   Musicas ................................ coluna Z  (índice 25)
//   Music Videos ............................ coluna U  (índice 20) — usa os
//     mesmos títulos/códigos de EDIÇÃO CHARTS (não tem aba própria de edição)
//   Albuns .................................. coluna L  (índice 11)
const COL_CODIGO_EDICAO_CHARTS = 55; // BD
const COL_CODIGO_EDICAO_CHARTS_ALBUNS = 17; // R
const COL_TITULO_EDICAO_CHARTS = 1; // B
const COL_TITULO_EDICAO_CHARTS_ALBUNS = 3; // D

/**
 * Acha o nome "canônico" (o valor exato que precisa cair no dropdown da
 * coluna C de REGISTRO) casando pelo Código único — a mesma chave gravada
 * em Musicas (Z) / Albuns (L) / Music Videos (U) do lado do tópico, e em
 * EDIÇÃO CHARTS (BD) / EDIÇÃO CHARTS ÁLBUMS (R) do lado do chart. Só cai
 * pra comparação de título (frágil — duas abas diferentes, qualquer
 * diferença de espaço/acentuação/"feat." já quebra o match) quando o
 * código não veio ou não bateu com nenhuma linha, pra nunca bloquear o
 * registro por causa de uma linha antiga sem código preenchido ainda.
 */
async function buscarNomeCanonico(params: {
  titulo: string;
  isAlbum: boolean;
  codigoUnico?: string;
}): Promise<string> {
  const { titulo, isAlbum, codigoUnico } = params;
  const codigoNorm = codigoUnico ? normalizeComparison(codigoUnico) : "";
  const alvoTitulo = normalizeComparison(titulo);

  try {
    const sheetName = isAlbum ? "EDIÇÃO CHARTS ÁLBUMS" : "EDIÇÃO CHARTS";
    const colCodigo = isAlbum ? COL_CODIGO_EDICAO_CHARTS_ALBUNS : COL_CODIGO_EDICAO_CHARTS;
    const colTitulo = isAlbum ? COL_TITULO_EDICAO_CHARTS_ALBUNS : COL_TITULO_EDICAO_CHARTS;
    const rows = await googleSheetsService.edicaoCharts.readValues(sheetName);

    if (codigoNorm) {
      for (let i = 1; i < rows.length; i++) {
        if (normalizeComparison(rows[i]?.[colCodigo]) === codigoNorm) {
          const nome = normalizeText(rows[i][colTitulo]);
          if (nome) return nome;
        }
      }
    }

    // Fallback: comparação por título (comportamento antigo).
    for (let i = 1; i < rows.length; i++) {
      if (normalizeComparison(rows[i]?.[colTitulo]) === alvoTitulo) return normalizeText(rows[i][colTitulo]);
    }
  } catch (err) {
    console.warn("[registroLog] Erro ao buscar nome canônico:", err);
  }
  return titulo;
}

/**
 * Grava uma linha de audit log na aba REGISTRO — só em B (jogador), C
 * (conteúdo, nome canônico do chart) e D (tipo). Nunca escreve em A ou E.
 *
 * Usa `appendRow` com o range restrito a "B:D" e insertDataOption=OVERWRITE
 * (não INSERT_ROWS): a própria API do Sheets acha e ocupa a próxima linha
 * vazia OLHANDO SÓ pras colunas B:D, de forma atômica do lado do Google —
 * ao contrário do jeito antigo (ler a coluna B, calcular a linha aqui, e só
 * depois escrever), que tinha uma condição de corrida real: dois
 * comentários publicados perto um do outro liam a MESMA "próxima linha
 * vazia" antes de qualquer um escrever, e o segundo `updateValues` sobrescrevia
 * silenciosamente o primeiro — sem erro nenhum, só um registro "sumido". Como
 * o range aqui nunca inclui a coluna E (protegida, calculada por fórmula), a
 * gravação não esbarra na proteção mesmo com OVERWRITE.
 */
export async function registrarAuditLog(params: {
  nomeJogador: string;
  titulo: string;
  tipo: string;
  isAlbum?: boolean;
  codigoUnico?: string;
}): Promise<void> {
  const { nomeJogador, titulo, tipo, isAlbum, codigoUnico } = params;
  try {
    const nomeCanonico = await buscarNomeCanonico({ titulo, isAlbum: !!isAlbum, codigoUnico });
    const conteudo = isAlbum ? `(ALBUM) - ${nomeCanonico}` : nomeCanonico;

    const linha = await googleSheetsService.registrosCharts.appendRow(
      "REGISTRO",
      [nomeJogador, conteudo, tipo],
      "B:D",
      "OVERWRITE",
    );
    if (linha === null) {
      console.warn("[registroLog] Gravação em REGISTRO falhou após todas as tentativas.");
    }
  } catch (err) {
    console.warn("[registroLog] Erro ao gravar em REGISTRO:", err);
  }
}
