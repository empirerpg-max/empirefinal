// Fila de vídeos pendentes da Empire TV — pedido explícito do usuário:
// nas categorias Music Video, Comercial e Performance, o jogador pode
// marcar "Lançar em um programa dessa semana?" em vez de publicar na hora.
// O vídeo some completamente (nenhum tópico/conteúdo visível) até um Admin
// revisar e clicar em "Publicar tópico" numa tela própria de gestão
// ("Gestão > Empire TV"). A publicação em si reaproveita exatamente a
// mesma lógica de sempre (criarVideoNoCatalogo, gestaoController.ts) —
// o Admin só aciona; o vídeo nasce em nome do JOGADOR/ARTISTA original
// guardado no payload, nunca do Admin. Nenhuma pontuação nova é criada
// por este fluxo — segue a mesma regra de hoje (só "Music Video" marca o
// boost no chart do YouTube; as outras categorias não geram ponto
// automático).
//
// Planilha: "VIDEOS_PENDENTES_EMPIRE_TV" (googleSheetsService.principal,
// mesma planilha de Musicas/Music Videos/Albuns). Colunas A..I:
//  A ID            — "VIDEOPEND-xxxxxxxx"
//  B JogadorId
//  C JogadorNome
//  D Artista
//  E Categoria     — Music Video | Comercial | Performance
//  F Titulo
//  G DataPrograma  — "YYYY-MM-DD" escolhida pelo jogador (só rótulo
//                    informativo, sem ligação com a agenda real de
//                    transmissões da Empire TV)
//  H CriadoEmISO
//  I PayloadJson   — CreateVideoPayload completo, reaproveitado ao
//                    publicar (evita reconstruir o payload a partir de
//                    colunas separadas e qualquer risco de perder campo)
//
// NUNCA usa appendRow (ver histórico de corrupção de linha em abas
// esparsas nesta planilha, documentado em vários outros controllers) —
// sempre linha calculada + updateValues com range explícito.

import { googleSheetsService, normalizeText, ensureSheetTab } from "../services/googleSheetsService";
import { requestProvesAdmin } from "../services/sessionService";
import { registrarLogSistema } from "../services/logSistemaService";
import { criarVideoNoCatalogo, type CreateVideoPayload } from "./gestaoController";

const SHEET = "VIDEOS_PENDENTES_EMPIRE_TV";
const HEADER = ["ID", "JogadorId", "JogadorNome", "Artista", "Categoria", "Titulo", "DataPrograma", "CriadoEmISO", "PayloadJson"];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function genId(): string {
  return `VIDEOPEND-${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;
}

async function ensureHeader(): Promise<void> {
  await ensureSheetTab("principal", SHEET);
  const existing = await googleSheetsService.principal.readValues(SHEET, "A1:I1").catch(() => []);
  if (!existing || existing.length === 0 || !normalizeText(existing[0]?.[0])) {
    await googleSheetsService.principal.updateValues(SHEET, "A1:I1", [HEADER]);
  }
}

export interface CriarVideoPendenteEmpireTvPayload extends CreateVideoPayload {
  dataPrograma: string;
}

export async function criarVideoPendenteEmpireTvController(request: Request): Promise<Response> {
  try {
    const body = (await request.json().catch(() => ({}))) as CriarVideoPendenteEmpireTvPayload;
    const { tituloVideo, artistaResponsavel, nomeJogador, dataPrograma } = body;

    if (!tituloVideo?.trim() || !artistaResponsavel?.trim() || !nomeJogador?.trim()) {
      return jsonResponse(
        { success: false, error: "Campos obrigatórios ausentes: tituloVideo, artistaResponsavel, nomeJogador." },
        400,
      );
    }
    if (!dataPrograma?.trim()) {
      return jsonResponse({ success: false, error: "Informe a data do programa." }, 400);
    }
    // Música vinculada vira OPCIONAL aqui — pedido explícito do usuário:
    // se o jogador marcou "Lançar em um programa dessa semana?" e não
    // selecionou (ou não tem a música pronta ainda), o Admin escolhe na
    // tela da Empire TV antes de publicar. criarVideoNoCatalogo (chamado
    // em publicarVideoEmpireTvController) continua exigindo pelo menos 1
    // na hora de publicar de verdade — só adia QUEM preenche, nunca deixa
    // passar sem música nenhuma.
    const musicasVinculadas = (
      body.musicasVinculadas && body.musicasVinculadas.length > 0
        ? body.musicasVinculadas
        : body.musicaVinculada
          ? [body.musicaVinculada]
          : []
    )
      .map((m) => m.trim())
      .filter(Boolean);

    await ensureHeader();
    const rows = await googleSheetsService.principal.readValues(SHEET, "A2:A20000");
    const linha = rows.length + 2;
    const id = genId();
    const tipo = body.tipoVideo || body.categoriaVideo || "Video";
    const fullTitle = tituloVideo.includes(" - ") ? tituloVideo : `${artistaResponsavel} - ${tituloVideo}`;

    await googleSheetsService.principal.updateValues(SHEET, `A${linha}:I${linha}`, [
      [
        id,
        normalizeText((body as any).jogadorId || ""),
        nomeJogador,
        artistaResponsavel,
        tipo,
        fullTitle,
        dataPrograma,
        new Date().toISOString(),
        JSON.stringify({ ...body, musicasVinculadas }),
      ],
    ]);

    registrarLogSistema({
      categoria: "Ação concluída",
      oQueAconteceu: `Vídeo "${fullTitle}" (${artistaResponsavel}) enviado pra fila de pendentes da Empire TV — programa de ${dataPrograma}.`,
      onde: "criarVideoPendenteEmpireTvController",
    }).catch(() => {});

    return jsonResponse({
      success: true,
      data: { id, titulo: fullTitle, mensagem: "Vídeo enviado! Fica pendente até o Admin da Empire TV liberar o tópico." },
    });
  } catch (error: any) {
    console.error("[criarVideoPendenteEmpireTvController] Erro:", error);
    return jsonResponse({ success: false, error: error.message || "Erro ao enviar vídeo pendente." }, 500);
  }
}

export async function getEmpireTvPendentesController(request: Request): Promise<Response> {
  if (!(await requestProvesAdmin(request))) {
    return jsonResponse({ success: false, error: "Acesso restrito ao admin." }, 403);
  }
  try {
    await ensureHeader();
    const rows = await googleSheetsService.principal.readValues(SHEET, "A2:I20000");
    const pendentes = rows
      .map((row, i) => ({ rowIndex: i + 2, row }))
      .filter(({ row }) => normalizeText(row[0]))
      .map(({ rowIndex, row }) => {
        const payload = JSON.parse(normalizeText(row[8]) || "{}") as CreateVideoPayload;
        return {
          id: normalizeText(row[0]),
          jogadorId: normalizeText(row[1]),
          jogadorNome: normalizeText(row[2]),
          artista: normalizeText(row[3]),
          categoria: normalizeText(row[4]),
          titulo: normalizeText(row[5]),
          dataPrograma: normalizeText(row[6]),
          criadoEmISO: normalizeText(row[7]),
          mediaUrl: payload.mediaUrl || "",
          capaUrl: payload.capaUrl || "",
          musicasVinculadas: payload.musicasVinculadas && payload.musicasVinculadas.length > 0 ? payload.musicasVinculadas : payload.musicaVinculada ? [payload.musicaVinculada] : [],
          rowIndex,
        };
      })
      .sort((a, b) => a.dataPrograma.localeCompare(b.dataPrograma));

    return jsonResponse({ success: true, data: pendentes });
  } catch (error: any) {
    console.error("[getEmpireTvPendentesController] Erro:", error);
    return jsonResponse({ success: false, error: error.message || "Erro ao listar pendentes." }, 500);
  }
}

export async function publicarVideoEmpireTvController(request: Request): Promise<Response> {
  if (!(await requestProvesAdmin(request))) {
    return jsonResponse({ success: false, error: "Acesso restrito ao admin." }, 403);
  }
  try {
    const body = (await request.json().catch(() => ({}))) as { id?: string; musicasVinculadas?: string[] };
    const id = normalizeText(body.id || "");
    if (!id) return jsonResponse({ success: false, error: "Informe o id do pendente." }, 400);

    await ensureHeader();
    const rows = await googleSheetsService.principal.readValues(SHEET, "A2:I20000");
    const idx = rows.findIndex((row) => normalizeText(row[0]) === id);
    if (idx === -1) return jsonResponse({ success: false, error: "Pendente não encontrado." }, 404);

    const row = rows[idx];
    const rowIndex = idx + 2;
    const payload = JSON.parse(normalizeText(row[8]) || "{}") as CreateVideoPayload;

    // O jogador pode ter deixado música vinculada em branco (marcou
    // "Lançar em um programa dessa semana?" sem preencher) — o Admin
    // escolhe aqui, na hora de publicar, só quando o payload ainda não
    // tem nenhuma. Nunca sobrescreve uma escolha que o próprio jogador já
    // tinha feito.
    const musicasDoAdmin = (body.musicasVinculadas || []).map((m) => m.trim()).filter(Boolean);
    const jaTinhaMusica = (payload.musicasVinculadas && payload.musicasVinculadas.length > 0) || !!payload.musicaVinculada;
    if (!jaTinhaMusica && musicasDoAdmin.length > 0) {
      payload.musicasVinculadas = musicasDoAdmin;
    }

    // Sempre em nome de quem está salvo no payload (jogador/artista
    // original) — o Admin nunca aparece como autor, só aciona a
    // publicação (pedido explícito do usuário).
    const resultado = await criarVideoNoCatalogo(payload);
    if (!resultado.success) {
      return jsonResponse({ success: false, error: resultado.error }, 400);
    }

    await googleSheetsService.principal.updateValues(SHEET, `A${rowIndex}:I${rowIndex}`, [
      ["", "", "", "", "", "", "", "", ""],
    ]);

    registrarLogSistema({
      categoria: "Ação concluída",
      oQueAconteceu: `[admin] Vídeo "${resultado.data.titulo}" (${resultado.data.artistaResponsavel}) publicado via fila da Empire TV.`,
      onde: "publicarVideoEmpireTvController",
    }).catch(() => {});

    return jsonResponse({ success: true, data: resultado.data });
  } catch (error: any) {
    console.error("[publicarVideoEmpireTvController] Erro:", error);
    return jsonResponse({ success: false, error: error.message || "Erro ao publicar vídeo." }, 500);
  }
}
