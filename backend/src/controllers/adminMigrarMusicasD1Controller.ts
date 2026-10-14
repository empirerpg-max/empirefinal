import { googleSheetsService, normalizeText, normalizeComparison } from "../services/googleSheetsService";
import {
  getCatalogoDb,
  buildMusicaUpsertStatement,
  type MusicaUpsert,
} from "../services/musicasDbService";
import { executarEmLotes, type ItemComRotulo } from "../services/catalogoDbService";

// Migração Musicas (Sheets) + Extra_Musicas (Shop/Info/Arte) -> tabela D1
// dedicada `musicas` (ver musicasDbService.ts) — primeira leva da
// reestruturação "uma tabela por tipo" pedida pelo usuário em 2026-10-14.
// Lê as colunas A:AE de "Musicas" (30 colunas confirmadas contra o TSV
// exportado da aba) e casa com Extra_Musicas por "Código único" (coluna A
// de Extra_Musicas = coluna Z de Musicas). Idempotente (ON CONFLICT(id) DO
// UPDATE); roda de novo sem duplicar.
//
// GET /api/empire-play/admin/migrar-musicas-d1
function parseDateToIso(dataBR: string | null): string | null {
  if (!dataBR) return null;
  const m = dataBR.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function parseIntOrNull(v: string | null): number | null {
  if (!v) return null;
  const n = parseInt(v.replace(/\D/g, ""), 10);
  return Number.isNaN(n) ? null : n;
}

function parseFloatOrNull(v: string | null): number | null {
  if (!v) return null;
  const n = parseFloat(v.replace(",", "."));
  return Number.isNaN(n) ? null : n;
}

export async function adminMigrarMusicasD1Controller(): Promise<Response> {
  const db = getCatalogoDb();
  if (!db) {
    return new Response(JSON.stringify({ success: false, error: "Binding CATALOGO_DB não disponível." }), {
      status: 500,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  const resultado = {
    lidas: 0,
    migradas: 0,
    puladas: [] as { linha: number; motivo: string; titulo: string }[],
    falhas: [] as { rotulo: string; erro: string }[],
  };

  // --- Extra_Musicas: mapa codigo_unico -> {shop, info, arte} ---
  const extraRows = await googleSheetsService.principal.readValues("Extra_Musicas", "A:D").catch(() => []);
  const extraPorCodigo = new Map<string, { shop: string | null; info: string | null; arte: string | null }>();
  for (let i = 1; i < extraRows.length; i++) {
    const row = extraRows[i];
    if (!row) continue;
    const codigo = normalizeText(row[0]);
    if (!codigo) continue;
    extraPorCodigo.set(normalizeComparison(codigo), {
      shop: normalizeText(row[1]) || null,
      info: normalizeText(row[2]) || null,
      arte: normalizeText(row[3]) || null,
    });
  }

  // --- Musicas: colunas A:AE (31 colunas, índices 0-30) confirmadas contra
  // o TSV exportado em 2026-10-14 — ver mapeamento completo no schema
  // (musicasDbService.ts) e na conversa de aprovação desse mapeamento.
  const musicasRows = await googleSheetsService.principal.readValues("Musicas", "A:AE").catch(() => []);
  const itens: ItemComRotulo[] = [];

  for (let i = 1; i < musicasRows.length; i++) {
    const row = musicasRows[i];
    if (!row || !row.some((c) => normalizeText(c))) continue;
    resultado.lidas++;

    const topicId = normalizeText(row[1]); // B — ID do tópico
    const titulo = normalizeText(row[7]); // H — Nome da música
    if (!topicId || !titulo) {
      resultado.puladas.push({
        linha: i + 1,
        motivo: !topicId ? "Sem ID do tópico (coluna B)" : "Sem título (coluna H)",
        titulo: titulo || "(sem título)",
      });
      continue;
    }

    const codigoUnico = normalizeText(row[25]) || null; // Z
    const extra = codigoUnico ? extraPorCodigo.get(normalizeComparison(codigoUnico)) : undefined;
    const dataLancamento = normalizeText(row[0]) || null; // A

    const item: MusicaUpsert = {
      id: topicId,
      codigoUnico,
      titulo,
      artista: normalizeText(row[13]) || "", // N — ACT PRINCIPAL
      artista2: normalizeText(row[14]) || null, // O
      artista3: normalizeText(row[15]) || null, // P
      artista4: normalizeText(row[16]) || null, // Q
      artista5: normalizeText(row[17]) || null, // R
      artista6: normalizeText(row[18]) || null, // S
      album: normalizeText(row[10]) || null, // K
      album2: normalizeText(row[26]) || null, // AA
      album3: normalizeText(row[27]) || null, // AB
      album4: normalizeText(row[28]) || null, // AC
      album5: normalizeText(row[29]) || null, // AD
      capaUrl: normalizeText(row[3]) || null, // D
      audioUrl: normalizeText(row[2]) || null, // C — ID do arquivo
      letra: normalizeText(row[4]) || null, // E
      letraSincronizada: normalizeText(row[30]) || null, // AE
      genero: normalizeText(row[19]) || null, // T
      tipoSingle: normalizeText(row[8]) || null, // I
      tipoMusica: normalizeText(row[9]) || null, // J
      dataLancamento,
      dataLancamentoIso: parseDateToIso(dataLancamento),
      weeks: parseIntOrNull(normalizeText(row[11])), // L
      weeksVideo: parseIntOrNull(normalizeText(row[12])), // M
      ordem: parseIntOrNull(normalizeText(row[20])), // U
      idCriador: normalizeText(row[6]) || null, // G
      comentariosPara: normalizeText(row[5]) || null, // F
      metacriticPorJogador: normalizeText(row[21]) || null, // V
      metacriticMedia: parseFloatOrNull(normalizeText(row[22])), // W
      pendente: normalizeComparison(normalizeText(row[23])) === "sim", // X
      reportadoIncorreto: normalizeComparison(normalizeText(row[24])) === "sim", // Y
      shopJson: extra?.shop ?? null,
      lojaInfo: extra?.info ?? null,
      arteExtraJson: extra?.arte ?? null,
    };

    itens.push({
      statement: buildMusicaUpsertStatement(db, item),
      rotulo: `${topicId} — ${titulo}`,
    });
  }

  const { executados, falhas } = await executarEmLotes(db, itens);
  resultado.migradas = executados;
  resultado.falhas = falhas;

  return new Response(JSON.stringify({ success: falhas.length === 0, ...resultado }, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
