import { googleSheetsService, normalizeComparison } from "../services/googleSheetsService";

// Causa raiz REAL do Shop do DERBY mostrando produtos do Follia (não era
// cache de navegador nem colisão de código — confirmado via API ao vivo
// que EMPALBM093 e EMPALBM090 têm Códigos únicos e URLs de Drive
// DIFERENTES): os arquivos do Google Drive vinculados ao Shop do DERBY
// (Extra_Albuns, linha do EMPALBM093) são, de fato, as artes do Follia —
// alguém vinculou os arquivos errados ao configurar o Shop da campanha de
// pre-save do Cowboy Fresh (provável reaproveitamento acidental do
// upload do Follia). Isso é CONTEÚDO errado, não um bug de código — não
// dá pra "adivinhar" quais seriam as imagens certas do Cowboy Fresh.
//
// Esse endpoint limpa (zera) o Shop da linha de EMPALBM093 em
// Extra_Albuns, deixando o álbum sem Shop ativo até o usuário subir as
// imagens certas de novo pela Gestão.
//
// GET /api/empire-play/admin/limpar-shop-errado-derby?confirmar=1
export async function adminLimparShopErradoDerbyController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const confirmar = url.searchParams.get("confirmar") === "1";
  const CODIGO_DERBY = "empalbm093";

  const rows = await googleSheetsService.principal.readValues("Extra_Albuns", "A:D").catch(() => []);
  let linhaAlvo = -1;
  let shopAtual = "";
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    if (normalizeComparison(row[0]) === CODIGO_DERBY) {
      linhaAlvo = i + 1;
      shopAtual = row[1] || "";
      break;
    }
  }

  if (linhaAlvo < 0) {
    return new Response(JSON.stringify({ success: false, error: "Linha do EMPALBM093 não encontrada em Extra_Albuns." }), {
      status: 404,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  if (!confirmar) {
    return new Response(JSON.stringify({ success: true, confirmar, linhaAlvo, shopAtual }, null, 2), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  const gravado = await googleSheetsService.principal.updateValues("Extra_Albuns", `B${linhaAlvo}:B${linhaAlvo}`, [["[]"]]);

  return new Response(JSON.stringify({ success: true, confirmar, linhaAlvo, shopAnterior: shopAtual, gravado }, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
