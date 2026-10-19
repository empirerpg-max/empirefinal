import { googleSheetsService, normalizeText } from "../services/googleSheetsService";
import { getCatalogoDb, buildMusicaUpsertStatement } from "../services/musicasDbService";

// Correção retroativa pontual: "nostalgic traveller" (TED, código único
// EMP945) foi lançada em 17/10/2026 via "Lançar Música" (createSongController)
// antes do fix aplicado agora nesse controller — o appendRow em Musicas
// falhou (causa não identificada: rede/rate-limit transitório na API do
// Sheets) e, como esse erro era só logado (não abortava o resto do fluxo),
// a música seguiu sendo registrada em EDIÇÃO CHARTS, REGISTRO DE MÚSICA,
// INFOS MÚSICAS e no D1 normalmente — só NUNCA ganhou linha em Musicas.
// Como a tela "Lançamentos Recentes" e o tópico do Fórum (ainda lidos
// direto da planilha, nunca migrados pro D1) dependem dessa linha pra
// achar a música, ela ficou invisível nos dois (e o comentário do jogador
// Daniel, de verdade gravado em Comentarios_Musicas, nunca aparecia porque
// a página do tópico inteira dava 404).
//
// O D1 já tem o registro completo (confirmado via
// /admin/diagnostico-musica-d1?codigoUnico=EMP945) — essa correção usa ele
// como fonte pra recriar a linha que faltou em Musicas, sem precisar pedir
// os dados de novo pro jogador.
//
// GET /api/empire-play/admin/fix-faixa-ted-nostalgic-traveller
const CODIGO_UNICO = "EMP945";
const TOPIC_ID = "musica_1792252409065_63282h";
const TITULO_CORRETO = "TED - nostalgic traveller";

export async function adminFixFaixaTedController(): Promise<Response> {
  const resultado: Record<string, unknown> = {};

  const db = getCatalogoDb();
  if (!db) {
    return new Response(
      JSON.stringify({ success: false, error: "Binding CATALOGO_DB não disponível." }),
      { status: 500, headers: { "Content-Type": "application/json; charset=utf-8" } },
    );
  }

  const d1Result = await db
    .prepare("SELECT * FROM musicas WHERE codigo_unico = ?")
    .bind(CODIGO_UNICO)
    .all<Record<string, unknown>>()
    .catch(() => null);
  const d1Row = d1Result?.results?.[0] || null;
  if (!d1Row) {
    return new Response(
      JSON.stringify({ success: false, error: `Nenhuma linha no D1 com código único "${CODIGO_UNICO}".` }),
      { status: 404, headers: { "Content-Type": "application/json; charset=utf-8" } },
    );
  }
  resultado.d1Row = d1Row;

  // 1. Procura a linha por código único. BUG REAL encontrado ao vivo rodando
  // esse diagnóstico (ver adminDiagFaixaPendenteController?codigoUnico=):
  // a linha 776 EXISTE e já tem "EMP945" na coluna Z, mas todo o resto da
  // linha (nome, data, capa, áudio, letra...) está VAZIO. Não foi o
  // appendRow que lançou e foi pulado — ele voltou um rowIndex válido (daí
  // o passo seguinte, que copia o Código único pra Musicas!Z, ter rodado
  // normalmente), só que os valores da própria linha nunca foram
  // persistidos de verdade pela API do Sheets (mesma classe de anomalia
  // documentada antes nesta sessão: leitura de range de 1 linha devolvendo
  // texto de cabeçalho — aqui parece ser uma escrita "fantasma", que
  // reserva a linha mas não grava o conteúdo). Por isso a correção
  // preenche essa linha existente em vez de criar outra (evita um Código
  // único duplicado em duas linhas de Musicas).
  const musicasRows = await googleSheetsService.principal.readValues("Musicas", "A:AE").catch(() => []);
  let linhaExistente = -1;
  for (let i = 1; i < musicasRows.length; i++) {
    if (normalizeText(musicasRows[i]?.[25]) === CODIGO_UNICO) {
      linhaExistente = i + 1;
      break;
    }
  }
  if (linhaExistente > 0 && normalizeText(musicasRows[linhaExistente - 1]?.[7])) {
    return new Response(
      JSON.stringify({ success: true, jaExistia: true, mensagem: "Linha já existe em Musicas E JÁ TEM título, nada a fazer." }),
      { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
    );
  }

  // 2. Preenche a linha (existente-vazia ou nova) com os dados já
  // confirmados no D1.
  const novaLinha: string[] = [
    String(d1Row.data_lancamento || ""), // A
    TOPIC_ID, // B
    String(d1Row.audio_url || ""), // C
    String(d1Row.capa_url || ""), // D
    String(d1Row.letra || ""), // E
    TOPIC_ID, // F
    String(d1Row.id_criador || ""), // G
    TITULO_CORRETO, // H
    String(d1Row.tipo_single || "LEAD SINGLE"), // I
    String(d1Row.tipo_musica || "SOLO"), // J
    "", // K
    "1", // L - WEEKS
    "", // M
    "TED", // N - ACT PRINCIPAL
    "", "", "", "", "", // O-S
    "", // T
    "", // U
    "", // V
    "", // W
    "Não", // X - Pendente?
    "", // Y
    CODIGO_UNICO, // Z
  ];
  if (linhaExistente > 0) {
    await googleSheetsService.principal.updateValues(
      "Musicas",
      `A${linhaExistente}:Z${linhaExistente}`,
      [novaLinha],
    );
    resultado.linhaPreenchida = linhaExistente;
  } else {
    const novaRowIndex = await googleSheetsService.principal.appendRow("Musicas", novaLinha);
    resultado.linhaCriada = novaRowIndex;
  }

  // 3. Re-espelha pro D1 — só pra preencher data_lancamento_iso/weeks, que
  // estavam nulos no registro original (mesmo bug de dataLancamentoIso
  // faltando, corrigido agora em createSongController).
  const parseDateIso = (br: string): string | null => {
    const m = br.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
  };
  await buildMusicaUpsertStatement(db, {
    codigoUnico: CODIGO_UNICO,
    idTopico: TOPIC_ID,
    titulo: TITULO_CORRETO,
    artista: "TED",
    album: null,
    capaUrl: (d1Row.capa_url as string) || null,
    audioUrl: (d1Row.audio_url as string) || null,
    letra: (d1Row.letra as string) || null,
    letraSincronizada: (d1Row.letra_sincronizada as string) || null,
    tipoSingle: (d1Row.tipo_single as string) || "LEAD SINGLE",
    tipoMusica: (d1Row.tipo_musica as string) || "SOLO",
    dataLancamento: (d1Row.data_lancamento as string) || "",
    dataLancamentoIso: parseDateIso((d1Row.data_lancamento as string) || ""),
    weeks: 1,
    comentariosPara: TOPIC_ID,
    pendente: false,
  })
    .run()
    .then(() => {
      resultado.d1Atualizado = true;
    })
    .catch((err) => {
      resultado.d1Erro = err instanceof Error ? err.message : String(err);
    });

  return new Response(JSON.stringify({ success: true, ...resultado }, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
