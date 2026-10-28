import { googleSheetsService, normalizeComparison, normalizeText, dedupeHeaders, normalizeHeader } from "../services/googleSheetsService";

// Só leitura. Compara byte a byte o "id" de um usuário (aba Usuários,
// planilha "usuarios") contra o "id_usuario" (dono) cadastrado em ARTISTAS
// pra ele — usado pra investigar "meus artistas" sumindo pro jogador sem
// nenhum erro visível (telegramId que parece igual mas não bate).
//
// GET /api/empire-play/admin/diagnostico-usuario-artista?usuario=daniel
export async function adminDiagUsuarioArtistaController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const alvo = normalizeComparison(url.searchParams.get("usuario") || "");
  if (!alvo) {
    return new Response(JSON.stringify({ success: false, error: "usuario é obrigatório." }), {
      status: 400,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  const usuariosRaw = await googleSheetsService.usuarios.readValues("Usuários").catch(() => []);
  const uHeaders = dedupeHeaders("Usuários", usuariosRaw[0]?.map((h, i) => normalizeHeader(h) || `coluna_${i + 1}`) || []);
  const uUsuarioCol = uHeaders.indexOf("usuario");
  const uNomeCol = uHeaders.indexOf("nome");
  const uIdCol = uHeaders.indexOf("id");

  const linhasUsuario = usuariosRaw.slice(1).filter((r) => {
    const u = normalizeComparison(r[uUsuarioCol] || "");
    const n = normalizeComparison(r[uNomeCol] || "");
    return u === alvo || n === alvo || u.includes(alvo) || n.includes(alvo);
  }).map((r) => ({
    usuario: r[uUsuarioCol] || "",
    nome: r[uNomeCol] || "",
    id_raw: r[uIdCol] || "",
    id_charCodes: Array.from(String(r[uIdCol] || "")).map((c) => c.charCodeAt(0)),
  }));

  const artistasRaw = await googleSheetsService.usuarios.readValues("ARTISTAS").catch(() => []);
  const aHeaders = dedupeHeaders("ARTISTAS", artistasRaw[0]?.map((h, i) => normalizeHeader(h) || `coluna_${i + 1}`) || []);
  const aNomeCol = aHeaders.indexOf("nome");
  const aOwnerCol = aHeaders.indexOf("id_usuario");

  const idsDeUsuario = new Set(linhasUsuario.map((l) => normalizeText(l.id_raw)));
  const artistasBatendo = artistasRaw.slice(1)
    .filter((r) => idsDeUsuario.has(normalizeText(r[aOwnerCol] || "")))
    .map((r) => ({ nome: r[aNomeCol] || "", id_usuario_raw: r[aOwnerCol] || "" }));

  // Amostra de alguns donos reais em ARTISTAS (pra ver o formato geral do
  // campo, independente do usuário buscado).
  const amostraDonos = artistasRaw.slice(1, 15).map((r) => ({
    nome: r[aNomeCol] || "",
    id_usuario_raw: r[aOwnerCol] || "",
    id_usuario_charCodes: Array.from(String(r[aOwnerCol] || "")).map((c) => c.charCodeAt(0)),
  }));

  return new Response(
    JSON.stringify({ success: true, linhasUsuario, artistasBatendo, amostraDonos }, null, 2),
    { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
}
