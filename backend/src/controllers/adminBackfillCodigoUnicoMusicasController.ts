import { googleSheetsService, normalizeText } from "../services/googleSheetsService";

// Backfill de "Código único" (Musicas!Z) pras linhas que nunca tiveram —
// confirmado no código (gestaoController.ts, createSongController/
// processarFaixasDoAlbum): toda música, pendente ou não, deveria ganhar um
// Código único na criação via registro em EDIÇÃO CHARTS; as ~296 linhas
// sem código são lacuna histórica de dados (linhas antigas, ou falha
// silenciosa na cópia), não comportamento pretendido.
//
// Gera um código com prefixo PRÓPRIO ("GEN", não "EMP") pra nunca colidir
// com um código real gerado depois por gerarProximoCodigoUnico (que só
// escaneia EDIÇÃO CHARTS, nunca vê esses "GEN" gravados só em Musicas) —
// se a música um dia for publicada/registrada de verdade nos charts, o
// fluxo normal (createSongController/publicarFaixaPendenteController)
// sobrescreve Musicas!Z com o código EMP real, sem conflito.
//
// GET /api/empire-play/admin/backfill-codigo-unico-musicas
export async function adminBackfillCodigoUnicoMusicasController(): Promise<Response> {
  const rows = await googleSheetsService.principal.readValues("Musicas", "A:AE").catch(() => []);

  const resultado = {
    lidas: 0,
    jaTinhamCodigo: 0,
    semTitulo: 0,
    geradas: 0,
    falhas: [] as { linha: number; erro: string }[],
  };

  let proximoNumero = 1;
  const escritas: { linha: number; codigo: string }[] = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !row.some((c) => normalizeText(c))) continue;
    resultado.lidas++;

    const titulo = normalizeText(row[7]); // H
    const codigoAtual = normalizeText(row[25]); // Z

    if (codigoAtual) {
      resultado.jaTinhamCodigo++;
      continue;
    }
    if (!titulo) {
      // Linha quebrada (sem nem título) — já excluída da migração de
      // qualquer forma, não faz sentido gerar código pra ela.
      resultado.semTitulo++;
      continue;
    }

    const codigo = `GEN${String(proximoNumero).padStart(4, "0")}`;
    proximoNumero++;
    escritas.push({ linha: i + 1, codigo });
  }

  // Em lotes via values:batchUpdate (uma viagem de rede por lote de 100,
  // em vez de uma por linha) — uma escrita de cada vez pra ~296 linhas
  // estoura os 280s do admin-call.yml (mesma lição já confirmada em
  // adminBackfillTopicIdsController.ts).
  const tamanhoLote = 100;
  for (let i = 0; i < escritas.length; i += tamanhoLote) {
    const lote = escritas.slice(i, i + tamanhoLote);
    const ok = await googleSheetsService.principal.updateValuesBatch(
      lote.map(({ linha, codigo }) => ({ sheetName: "Musicas", range: `Z${linha}`, values: [[codigo]] })),
    );
    if (ok) {
      resultado.geradas += lote.length;
    } else {
      for (const { linha } of lote) {
        resultado.falhas.push({ linha, erro: "batchUpdate falhou nesse lote" });
      }
    }
  }

  return new Response(JSON.stringify({ success: resultado.falhas.length === 0, ...resultado }, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
