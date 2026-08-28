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
 * IMPORTANTE (achado via debug ao vivo): o endpoint `:append` do Sheets (usado
 * por `appendRow`, com OVERWRITE ou INSERT_ROWS, tanto faz — os dois foram
 * testados e falham igual) calcula sozinho a "próxima linha livre" olhando
 * pra planilha inteira, não só pro range B:D pedido. A coluna E é protegida
 * (fórmula "VALOR"), e a partir de uma certa linha (quando E já tem fórmula
 * ocupando aquela linha, mesmo com B:D vazios) o `:append` esbarra nela e
 * devolve 400 "You are trying to edit a protected cell or object" — mesmo a
 * gente nunca mandando valor pra coluna E. Testado e confirmado: escrever
 * direto numa célula específica de B, C ou D com `values.update` (PUT)
 * funciona sempre, em qualquer linha — só o cálculo automático do `:append`
 * que quebra. Por isso aqui a gente mesmo acha a próxima linha livre (lendo
 * B:D e pegando a última linha com conteúdo + 1) e escreve com
 * `updateValues`/PUT numa célula explícita, contornando o bug do `:append`.
 *
 * Isso reintroduz, em teoria, a mesma condição de corrida que o comentário
 * antigo deste arquivo descrevia (dois registros quase simultâneos podem ler
 * a mesma "próxima linha vazia" e um sobrescrever o outro) — mas é a única
 * forma confirmada de gravar em REGISTRO sem cair no erro de proteção.
 *
 * CONFIRMADO ao vivo (comentários do jogador Lucas B., 28/08/2026): a grande
 * maioria dos comentários dele nunca gerou linha em REGISTRO — gap grande
 * demais pra ser só colisão ocasional. Pra fechar a lacuna, cada escrita
 * agora RELÊ a própria linha logo depois de escrever; se o conteúdo não bate
 * com o que acabou de mandar (outra chamada colidiu na mesma linha), recalcula
 * a próxima linha livre e tenta de novo, até 3 vezes — nunca lança, o audit
 * log continua best-effort e jamais pode derrubar o comentário em si.
 */
export async function registrarAuditLog(params: {
  nomeJogador: string;
  titulo: string;
  tipo: string;
  isAlbum?: boolean;
  codigoUnico?: string;
}): Promise<void> {
  const { nomeJogador, titulo, tipo, isAlbum, codigoUnico } = params;
  const MAX_TENTATIVAS = 3;
  try {
    // As duas leituras não dependem uma da outra até a escrita final — rodar
    // em paralelo em vez de sequencial corta uma ida inteira à API do Sheets
    // do tempo total.
    const [nomeCanonico, rowsIniciais] = await Promise.all([
      buscarNomeCanonico({ titulo, isAlbum: !!isAlbum, codigoUnico }),
      googleSheetsService.registrosCharts.readValues("REGISTRO"),
    ]);
    const conteudo = isAlbum ? `(ALBUM) - ${nomeCanonico}` : nomeCanonico;
    const valoresGravados = [nomeJogador, conteudo, tipo];

    const acharProximaLinhaLivre = (rows: string[][]): number => {
      let ultimaLinhaComConteudo = 1; // linha 1 = cabeçalho, nunca escrevemos nela
      for (let i = 0; i < rows.length; i++) {
        if (rows[i]?.some((c) => normalizeText(c))) ultimaLinhaComConteudo = i + 1;
      }
      return ultimaLinhaComConteudo + 1;
    };

    let rows = rowsIniciais;
    for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa++) {
      const proximaLinha = acharProximaLinhaLivre(rows);
      await googleSheetsService.registrosCharts.updateValues(
        "REGISTRO",
        `B${proximaLinha}:D${proximaLinha}`,
        [valoresGravados],
      );

      // Relê a mesma linha pra confirmar que ninguém colidiu escrevendo nela
      // entre a leitura e a escrita (a condição de corrida documentada acima).
      const confirmacao = await googleSheetsService.registrosCharts.readValues(
        "REGISTRO",
        `B${proximaLinha}:D${proximaLinha}`,
      );
      const linhaConfirmada = confirmacao?.[0] || [];
      const bateu = valoresGravados.every((v, i) => normalizeText(linhaConfirmada[i]) === normalizeText(v));
      if (bateu) return;

      console.warn(
        `[registroLog] Colisão detectada na linha ${proximaLinha} (tentativa ${tentativa}/${MAX_TENTATIVAS}) — recalculando e tentando de novo.`,
      );
      rows = await googleSheetsService.registrosCharts.readValues("REGISTRO");
    }

    console.warn("[registroLog] Não foi possível gravar em REGISTRO após retries — colisão persistente.");
  } catch (err) {
    console.warn("[registroLog] Erro ao gravar em REGISTRO:", err);
  }
}
