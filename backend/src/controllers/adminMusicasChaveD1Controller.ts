// Correção da chave da tabela `musicas` (2026-11-17) — ver musicasRekeyD1.ts.
//
// GET /api/empire-play/admin/musicas-chave-d1                         -> estado (só leitura)
// GET /api/empire-play/admin/musicas-chave-d1?acao=migrar&confirmar=1 -> recria as tabelas (backup antes)
// GET /api/empire-play/admin/musicas-chave-d1?acao=restaurar          -> simula a restauração (lista o que entraria)
// GET /api/empire-play/admin/musicas-chave-d1?acao=restaurar&confirmar=1 -> insere as versões que faltam
import { getCatalogoDb } from "../services/catalogoDbService";
import { contagens, migrarChaveMusicas, restaurarMusicasDaPlanilha } from "../services/musicasRekeyD1";
import { registrarLogSistema } from "../services/logSistemaService";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });
}

export async function adminMusicasChaveD1Controller(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const acao = url.searchParams.get("acao") || "";
  const confirmar = url.searchParams.get("confirmar") === "1";
  const db = getCatalogoDb();
  if (!db) return json({ success: false, error: "sem D1" }, 500);
  try {
    if (acao === "migrar") {
      if (!confirmar) return json({ success: true, simulacao: true, atual: await contagens(db) });
      const r = await migrarChaveMusicas(db);
      const ok = r.antes.musicas === r.depois.musicas && r.antes.comentarios === r.depois.comentarios;
      await registrarLogSistema({
        categoria: ok ? "Ação concluída" : "Falha de escrita",
        oQueAconteceu: `Tabela musicas (D1): chave trocada do Código único pela identidade da música (autorizado pelo usuário em 2026-11-17). Músicas ${r.antes.musicas} -> ${r.depois.musicas}, comentários ${r.antes.comentarios} -> ${r.depois.comentarios}. Backup: bkp_musicas_20261117 / bkp_comentarios_musicas_20261117.`,
        onde: "adminMusicasChaveD1Controller (migrar)",
        detalheTecnico: JSON.stringify(r),
      }).catch(() => {});
      return json({ success: ok, ...r });
    }
    if (acao === "restaurar") {
      const r = await restaurarMusicasDaPlanilha(db, confirmar);
      if (confirmar) {
        await registrarLogSistema({
          categoria: r.faltandoDepois === 0 ? "Ação concluída" : "Falha de escrita",
          oQueAconteceu: `Músicas restauradas no D1 a partir da planilha: ${r.restauradas.length} versões inseridas, ${r.promovidas.length} faixas promovidas (ganharam tópico). Faltando depois: ${r.faltandoDepois}.`,
          onde: "adminMusicasChaveD1Controller (restaurar)",
          detalheTecnico: JSON.stringify(r).slice(0, 45000),
        }).catch(() => {});
      }
      return json({ success: !confirmar || r.faltandoDepois === 0, simulacao: !confirmar, ...r, total: { restauradas: r.restauradas.length, promovidas: r.promovidas.length } });
    }
    return json({ success: true, atual: await contagens(db) });
  } catch (err) {
    return json({ success: false, error: (err as Error).message }, 500);
  }
}
