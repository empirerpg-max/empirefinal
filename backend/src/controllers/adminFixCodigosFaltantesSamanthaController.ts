import { googleSheetsService } from "../services/googleSheetsService";
import { registrarNaEdicaoCharts, lerCodigoUnicoGerado } from "./gestaoController";
import { registrarLogSistema } from "../services/logSistemaService";

// Fix pontual (2026-11-11): 2 faixas do álbum "Samantha Cooper - WELL, IT'S
// OVER" ficaram sem Código único em Musicas depois do relançamento das
// faixas faltantes (mesma falha transiente de Google Sheets já documentada
// no incidente) —
//   - linha 843 "LOST FREQUENCY": célula Z tem lixo ("Data" em vez de um
//     código) — a entrada em EDIÇÃO CHARTS EXISTE de verdade (linha 1004,
//     Código EMP1003, já corretamente ligada a esse álbum), só a cópia pra
//     Musicas!Z que falhou.
//   - linha 844 "(DON'T) LET ME GO": célula Z vazia E não existe NENHUMA
//     entrada em EDIÇÃO CHARTS pra essa faixa (nem o registro em si foi
//     criado) — precisa criar a entrada do zero.
//
// GET /api/gestao/admin/fix-codigos-faltantes-samantha?confirmar=1
export async function adminFixCodigosFaltantesSamanthaController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const confirmar = url.searchParams.get("confirmar") === "1";

  if (!confirmar) {
    return new Response(
      JSON.stringify({
        success: true,
        dryRun: true,
        plano: [
          "Musicas!Z843 (LOST FREQUENCY): corrigir de 'Data' pra 'EMP1003' (EDIÇÃO CHARTS linha 1004 já existe e já está ligada ao álbum certo).",
          "Musicas!Z844 ((DON'T) LET ME GO): criar entrada nova em EDIÇÃO CHARTS (não existe nenhuma ainda) e copiar o código único gerado.",
        ],
        aviso: "Dry-run — nada foi gravado. Repita com &confirmar=1 pra aplicar.",
      }, null, 2),
      { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
    );
  }

  const acoes: string[] = [];

  // 1. LOST FREQUENCY: só corrige a célula Z (a entrada em EDIÇÃO CHARTS já
  // existe e já está correta).
  await googleSheetsService.principal.updateValues("Musicas", "Z843", [["EMP1003"]]);
  acoes.push("Musicas!Z843 (LOST FREQUENCY) corrigido pra EMP1003.");

  // 2. (DON'T) LET ME GO: cria a entrada em EDIÇÃO CHARTS do zero (nunca
  // existiu) e copia o código gerado pra Musicas!Z844.
  const ALBUM_FULL_TITLE = "Samantha Cooper - WELL, IT’S OVER";
  const SONG_TITLE = "Samantha Cooper - (DON’T) LET ME GO";
  const edicaoChartsRowIndex = await registrarNaEdicaoCharts({
    dataFormatada: "11/11/2026",
    fullTitle: SONG_TITLE,
    tipoSingle: "TRACKLIST ALBUM",
    tipoMusica: "SOLO",
    album: ALBUM_FULL_TITLE,
    artistaPrincipal: "Samantha Cooper",
    participantes: [],
  });
  if (!edicaoChartsRowIndex) {
    return new Response(
      JSON.stringify({ success: false, error: "Falha ao criar entrada em EDIÇÃO CHARTS pra '(DON'T) LET ME GO'.", acoes }),
      { status: 500, headers: { "Content-Type": "application/json; charset=utf-8" } },
    );
  }
  acoes.push(`EDIÇÃO CHARTS linha ${edicaoChartsRowIndex} criada pra "(DON'T) LET ME GO".`);

  const codigoGerado = await lerCodigoUnicoGerado(edicaoChartsRowIndex);
  if (!codigoGerado) {
    return new Response(
      JSON.stringify({ success: false, error: "EDIÇÃO CHARTS criada, mas não consegui ler o Código único gerado.", acoes }),
      { status: 500, headers: { "Content-Type": "application/json; charset=utf-8" } },
    );
  }

  await googleSheetsService.principal.updateValues("Musicas", "Z844", [[codigoGerado]]);
  acoes.push(`Musicas!Z844 ((DON'T) LET ME GO) preenchido com ${codigoGerado}.`);

  registrarLogSistema({
    categoria: "Ação concluída",
    oQueAconteceu: `[admin fix] Códigos únicos faltantes do álbum "${ALBUM_FULL_TITLE}" corrigidos: LOST FREQUENCY (EMP1003, só a cópia pra Musicas faltava) e "(DON'T) LET ME GO" (entrada nova criada em EDIÇÃO CHARTS: ${codigoGerado}).`,
    onde: "adminFixCodigosFaltantesSamanthaController",
  }).catch(() => {});

  return new Response(JSON.stringify({ success: true, acoes }, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
