import { sheetsService } from "../services/sheetsService";
import { normalizeComparison } from "../services/googleSheetsService";

// "Lançamentos Recentes" ainda mostra o álbum FOLLIA com artista
// truncado pra "Max" — vem de buildCleanItem("Albuns", rec, idx), que lê
// o título via getValue(record, [...aliases]) e faz split em " - ".
// Dump do record BRUTO (como readSheetObjects devolve, com as chaves já
// normalizadas) pra linha do FOLLIA, pra ver com que chave o título de
// verdade está guardado e qual valor exato tem.
//
// GET /api/empire-play/admin/diagnostico-album-record-follia
export async function adminDiagAlbumRecordFolliaController(): Promise<Response> {
  const records = await sheetsService.readSheetObjects("Albuns").catch(() => []);
  const achado = records.find((rec) =>
    Object.values(rec).some((v) => typeof v === "string" && normalizeComparison(v).includes("follia")),
  );
  return new Response(JSON.stringify({ success: true, achado: achado || null }, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
