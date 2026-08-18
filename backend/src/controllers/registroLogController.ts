import { googleSheetsService, normalizeComparison, normalizeText } from "../services/googleSheetsService";

// Aba REGISTRO (planilha registrosCharts) — layout confirmado ao vivo:
// A não é usada (fica sempre em branco); B = "NOME DO OFF" (nome do
// jogador); C = "CONTEÚDO PARA REGISTRO" (dropdown — precisa bater
// exatamente com o nome canônico usado no chart, senão fica com valor de
// dropdown inválido); D = "TIPO DO REGISTRO" (dropdown); E = "VALOR" é
// calculado pela própria planilha a partir de D — nunca escrevemos nela.
//
// O nome "canônico" (código único) de música/vídeo vem da coluna B de
// "EDIÇÃO CHARTS"; de álbum vem da coluna D de "EDIÇÃO CHARTS ÁLBUMS"
// (prefixado com "(ALBUM) - "), na planilha edicaoCharts — confirmado
// pelo usuário. Buscamos por título normalizado; se não achar (ex: chart
// ainda não editado com o lançamento), caímos pro título recebido mesmo,
// pra nunca bloquear o registro por causa de uma busca sem match.
async function buscarNomeCanonico(tituloOriginal: string, isAlbum: boolean): Promise<string> {
  const alvo = normalizeComparison(tituloOriginal);
  try {
    if (isAlbum) {
      const rows = await googleSheetsService.edicaoCharts.readValues("EDIÇÃO CHARTS ÁLBUMS");
      for (let i = 1; i < rows.length; i++) {
        if (normalizeComparison(rows[i]?.[3]) === alvo) return normalizeText(rows[i][3]);
      }
    } else {
      const rows = await googleSheetsService.edicaoCharts.readValues("EDIÇÃO CHARTS");
      for (let i = 1; i < rows.length; i++) {
        if (normalizeComparison(rows[i]?.[1]) === alvo) return normalizeText(rows[i][1]);
      }
    }
  } catch (err) {
    console.warn("[registroLog] Erro ao buscar nome canônico:", err);
  }
  return tituloOriginal;
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
}): Promise<void> {
  const { nomeJogador, titulo, tipo, isAlbum } = params;
  try {
    const nomeCanonico = await buscarNomeCanonico(titulo, !!isAlbum);
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
