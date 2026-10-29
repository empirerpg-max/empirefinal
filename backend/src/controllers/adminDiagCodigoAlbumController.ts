import { googleSheetsService, normalizeComparison } from "../services/googleSheetsService";

// Só leitura. Investiga por que o álbum "Cowboy Fresh" mostra o mesmo Shop
// do álbum "Follia" (Max Gorghan) — hipótese: os dois têm o mesmo "Código
// único" (Albuns!L), que é a chave de cruzamento com Extra_Albuns pros
// botões Shop/Info/Visual (ver extraMaterialController.ts).
//
// GET /api/empire-play/admin/diag-codigo-album?nomes=Cowboy Fresh,Follia
export async function adminDiagCodigoAlbumController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const nomesParam = url.searchParams.get("nomes") || "";
  const nomes = nomesParam.split(",").map((s) => normalizeComparison(s.trim())).filter(Boolean);

  const albunsRecords = await googleSheetsService.principal.readSheetObjects("Albuns").catch(() => []);
  const extraAlbunsRows = await googleSheetsService.usuarios.readValues("Extra_Albuns").catch(() => []);

  const getValue = (rec: Record<string, string>, keys: string[]): string => {
    for (const k of keys) if (rec[k]) return rec[k];
    return "";
  };

  const encontrados = albunsRecords
    .map((rec, i) => ({
      linha: i + 2,
      nome: getValue(rec, ["nome_do_album", "titulo_do_album", "titulo", "album", "nome"]),
      codigoUnico: getValue(rec, ["codigo_unico"]),
    }))
    .filter((item) => nomes.some((n) => normalizeComparison(item.nome).includes(n)));

  const codigosEncontrados = new Set(encontrados.map((e) => normalizeComparison(e.codigoUnico)).filter(Boolean));
  const extraRelacionados = extraAlbunsRows.slice(1)
    .map((r, i) => ({ linha: i + 2, codigoUnico: r[0] || "", shopRaw: r[1] || "" }))
    .filter((item) => codigosEncontrados.has(normalizeComparison(item.codigoUnico)));

  return new Response(
    JSON.stringify({ success: true, encontrados, extraRelacionados }, null, 2),
    { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
}
