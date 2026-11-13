import { googleSheetsService } from "../services/googleSheetsService";
import { registrarLogSistema } from "../services/logSistemaService";

// Correção dos comentários órfãos de Comentarios_MV (2026-11-13), SÓ dos
// casos confirmados pelo usuário:
//   - tópico "1685" (vídeo do Cowboy Fresh da era Telegram)
//       -> video_1789829384327_dmoybe ("El Club De Los Corazones Rotos (Official Music Vídeo)")
//   - video_1792668710470_e8nwqc (ID antigo do Alchimia; as notificações
//     desses comentários guardam o título "Max Gorghan - Alchimia")
//       -> video_1793150491662_k8usr6 ("Max Gorghan - Alchimia")
//   - 4 comentários de teste "TesteDebug" (ID do tópico vazio) -> apagados,
//     com backup completo das linhas no LOGS antes.
// Os mesmos IDs antigos também são trocados na aba Notificacoes (coluna
// "ID do tópico"), pra notificação desses comentários abrir o vídeo certo.
//
// Seguro por construção: confere que cada ID de destino existe em "Music
// Videos" e que as quantidades são exatamente as analisadas (3/3/4) — se a
// planilha mudou, aborta sem escrever nada. Confirma cada escrita relendo.
//
// GET /api/empire-play/admin/fix-comentarios-videos-orfaos             -> simulação
// GET /api/empire-play/admin/fix-comentarios-videos-orfaos?confirmar=1 -> aplica
// (&lote=2 pro segundo lote, ver abaixo)
//
// Lote 2 (?lote=2, confirmado pelo usuário em 2026-11-13):
//   - videos_idx215 (ID sintético; a notificação do mesmo minuto guarda
//     "Anníbal Páris - Bad Friend") -> video_1789042741749_eip913 (o clipe oficial)
//   - 1638 (ID da MENSAGEM do vídeo "Dagny - JULY", gravado no lugar do
//     tópico) -> 1637 (tópico real do Dagny - JULY)
//   - 1 mensagem automática do bot "Empire Registros" no tópico 1628
//     ("Abigail - video 34", vídeo que não existe) -> apagada com backup.
interface Lote {
  relinks: { de: string; para: string; esperado: number }[];
  apagar: (row: string[] | undefined) => boolean;
  apagarEsperado: number;
  descricaoApagar: string;
}
const LOTES: Record<string, Lote> = {
  "1": {
    relinks: [
      { de: "1685", para: "video_1789829384327_dmoybe", esperado: 3 },
      { de: "video_1792668710470_e8nwqc", para: "video_1793150491662_k8usr6", esperado: 3 },
    ],
    apagar: (row) => ehTeste(row),
    apagarEsperado: 4,
    descricaoApagar: 'comentário(s) de teste "TesteDebug"',
  },
  "2": {
    relinks: [
      { de: "videos_idx215", para: "video_1789042741749_eip913", esperado: 1 },
      { de: "1638", para: "1637", esperado: 1 },
    ],
    apagar: (row) =>
      !!row &&
      (row[0] || "") === "1628" &&
      (row[2] || "") === "Empire Registros" &&
      (row[3] || "").includes("Abigail - video 34"),
    apagarEsperado: 1,
    descricaoApagar: 'mensagem automática do bot "Empire Registros" (tópico 1628, "Abigail - video 34")',
  },
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function ehTeste(row: string[] | undefined): boolean {
  return (
    !!row &&
    (row[0] || "") === "" &&
    (row[1] || "") === "999999999DEBUGTESTE" &&
    (row[2] || "") === "TesteDebug" &&
    (row[3] || "") === "teste de diagnostico do bug, ignorar"
  );
}

export async function adminFixComentariosVideosOrfaosController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const confirmar = url.searchParams.get("confirmar") === "1";
  const lote = LOTES[url.searchParams.get("lote") || "1"];
  if (!lote) return json({ success: false, error: "Lote inválido (use lote=1 ou lote=2)." }, 400);
  const RELINKS = lote.relinks;
  const TESTES_ESPERADOS = lote.apagarEsperado;
  const ehAlvoApagar = lote.apagar;
  try {
    const [videos, comentarios, notif] = await Promise.all([
      googleSheetsService.principal.readValues("Music Videos", "A:U"),
      googleSheetsService.principal.readValues("Comentarios_MV", "A:G"),
      googleSheetsService.principal.readValues("Notificacoes", "A:Z"),
    ]);

    const erros: string[] = [];
    for (const r of RELINKS) {
      const n = videos.filter((row, i) => i > 0 && (row?.[5] || "") === r.para).length;
      if (n !== 1) erros.push(`Destino ${r.para}: ${n} linha(s) em "Music Videos" (esperado 1).`);
      if (videos.some((row, i) => i > 0 && (row?.[5] || "") === r.de)) {
        erros.push(`O ID antigo ${r.de} voltou a existir em "Music Videos" — não é mais órfão, abortado.`);
      }
    }

    const relinkComentarios = RELINKS.map((r) => ({
      ...r,
      linhas: comentarios.map((row, i) => ({ linha: i + 1, row })).filter(({ linha, row }) => linha > 1 && (row?.[0] || "") === r.de),
    }));
    for (const r of relinkComentarios) {
      if (r.linhas.length !== r.esperado) {
        erros.push(`Comentários com tópico ${r.de}: ${r.linhas.length} (esperado ${r.esperado}).`);
      }
    }
    const testes = comentarios.map((row, i) => ({ linha: i + 1, row })).filter(({ linha, row }) => linha > 1 && ehAlvoApagar(row));
    if (testes.length !== TESTES_ESPERADOS) {
      erros.push(`Linhas a apagar (${lote.descricaoApagar}): ${testes.length} (esperado ${TESTES_ESPERADOS}).`);
    }

    const header = notif[0] || [];
    const colNotifTopico = header.findIndex((h) => (h || "").trim() === "ID do tópico");
    if (colNotifTopico < 0) erros.push('Coluna "ID do tópico" não encontrada em Notificacoes.');
    const letraNotif = colNotifTopico >= 0 ? String.fromCharCode(65 + colNotifTopico) : "?";
    const relinkNotificacoes = RELINKS.map((r) => ({
      ...r,
      linhas:
        colNotifTopico < 0
          ? []
          : notif.map((row, i) => ({ linha: i + 1, row })).filter(({ linha, row }) => linha > 1 && (row?.[colNotifTopico] || "") === r.de),
    }));

    const plano = {
      comentarios: relinkComentarios.map((r) => ({
        de: r.de,
        para: r.para,
        linhas: r.linhas.map((l) => ({ linha: l.linha, autor: l.row[2], inicio: (l.row[3] || "").slice(0, 60) })),
      })),
      notificacoes: relinkNotificacoes.map((r) => ({ de: r.de, para: r.para, linhas: r.linhas.map((l) => l.linha) })),
      testesApagar: testes,
    };

    if (erros.length) return json({ success: false, mensagem: "Abortado — NADA foi alterado.", erros, plano }, 409);
    if (!confirmar) return json({ success: true, simulacao: true, plano });

    // 1. Backup das linhas de teste no LOGS ANTES de qualquer escrita.
    await registrarLogSistema({
      categoria: "Ação concluída",
      oQueAconteceu: `Fix comentários órfãos de vídeo: ${testes.length} ${lote.descricaoApagar} será(ão) apagado(s) de Comentarios_MV (autorizado pelo usuário em 2026-11-13). Backup completo no detalhe técnico.`,
      onde: "adminFixComentariosVideosOrfaosController",
      detalheTecnico: JSON.stringify({ backupComentariosTeste: testes, relinks: plano }),
    });

    // 2. Religar comentários e notificações (antes de apagar linhas — os
    // números de linha lidos acima continuam valendo).
    const entradas = [
      ...relinkComentarios.flatMap((r) =>
        r.linhas.map((l) => ({ sheetName: "Comentarios_MV", range: `A${l.linha}`, values: [[r.para]] })),
      ),
      ...relinkNotificacoes.flatMap((r) =>
        r.linhas.map((l) => ({ sheetName: "Notificacoes", range: `${letraNotif}${l.linha}`, values: [[r.para]] })),
      ),
    ];
    const gravou = await googleSheetsService.principal.updateValuesBatch(entradas);
    if (!gravou) {
      return json({ success: false, error: "Falha ao gravar os religamentos (nada apagado ainda). Rode de novo." }, 500);
    }

    // 3. Confirma relendo os religamentos antes de apagar qualquer coisa.
    const comentariosDepois = await googleSheetsService.principal.readValues("Comentarios_MV", "A:G");
    const naoReligados = relinkComentarios.flatMap((r) =>
      r.linhas.filter((l) => (comentariosDepois[l.linha - 1]?.[0] || "") !== r.para).map((l) => l.linha),
    );
    if (naoReligados.length) {
      return json({ success: false, error: "Religamento não confirmado na releitura — testes NÃO apagados.", naoReligados }, 500);
    }

    // 4. Apaga os testes (confere de novo, na releitura, que ainda são eles).
    const linhasTeste = testes.map((t) => t.linha).filter((l) => ehAlvoApagar(comentariosDepois[l - 1]));
    if (linhasTeste.length !== TESTES_ESPERADOS) {
      return json({ success: false, error: "Linhas de teste mudaram de lugar — não apaguei. Rode de novo.", religados: true }, 409);
    }
    await googleSheetsService.principal.deleteRows("Comentarios_MV", linhasTeste);

    const final = await googleSheetsService.principal.readValues("Comentarios_MV", "A:G");
    const restamOrfaosDosIds = final.filter((row, i) => i > 0 && RELINKS.some((r) => (row?.[0] || "") === r.de)).length;
    const restamTestes = final.filter((row, i) => i > 0 && ehAlvoApagar(row)).length;
    return json({
      success: restamOrfaosDosIds === 0 && restamTestes === 0,
      comentariosReligados: relinkComentarios.reduce((a, r) => a + r.linhas.length, 0),
      notificacoesReligadas: relinkNotificacoes.reduce((a, r) => a + r.linhas.length, 0),
      testesApagados: linhasTeste.length,
      restamOrfaosDosIds,
      restamTestes,
      linhasComentariosAntes: comentarios.length - 1,
      linhasComentariosDepois: final.length - 1,
      plano,
    });
  } catch (err) {
    return json({ success: false, error: (err as Error).message }, 500);
  }
}
