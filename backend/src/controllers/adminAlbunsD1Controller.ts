// Fase 3 da migração dos ÁLBUNS (2026-11-14): comparação em produção e
// chave de leitura pelo D1 — ver albunsD1Leitura.ts / espelhoAbasD1.ts.
//
// GET /api/empire-play/admin/comparar-albuns-d1
//   Pra cada álbum (2 formas de ID: o do tópico e o sintético album_N),
//   compara os comentários que o Fórum mostra HOJE (aba inteira da planilha
//   + 3 abas legadas) com os do caminho novo (D1, só o tópico, sem legado).
//   Registro de TÓPICO DE MÚSICA nas abas legadas (tem nome_da_musica) não
//   conta: só "casava" porque o número do tópico coincide.
// GET /api/empire-play/admin/leitura-albuns-d1?ativar=1|0
//   Liga SÓ se a comparação (rodada na hora) der zero diferença.
// GET /api/empire-play/admin/apagar-teste-bot-album?confirmar=1
//   Apaga de Comentarios_Albuns a mensagem de teste do bot no tópico 494
//   (autorizado pelo usuário em 2026-11-14), com backup no LOGS antes.
import {
  googleSheetsService,
  linhasParaObjetos,
  normalizeComparison,
  readValuesFresh,
  type SheetRecord,
} from "../services/googleSheetsService";
import { buildCleanItem, comentarioPertenceAoTopico, objetosComRowIndex } from "./empirePlayController";
import { linhasPorBuscaD1, validarAba } from "../services/espelhoAbasD1";
import { definirLeituraAlbunsD1, leituraAlbunsD1Ativa } from "../services/albunsD1Leitura";
import { registrarLogSistema } from "../services/logSistemaService";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });
}

const ALIAS_TOPICO = ["id_do_topico", "id_topico", "topico_id", "id_media", "id_do_item", "id", "topico", "comentarios_para", "message_thread_id"];
const ALIAS_TITULO = ["titulo", "title", "titulo_media", "nome", "info"];

async function compararAlbuns() {
  const [albunsRows, comentariosRows, l1, l2, l3] = await Promise.all([
    readValuesFresh("principal", "Albuns", "A:ZZ"),
    readValuesFresh("principal", "Comentarios_Albuns", "A:ZZ"),
    googleSheetsService.principal.readSheetObjects("Comentarios"),
    googleSheetsService.principal.readSheetObjects("Comentarios_EmpirePlay"),
    googleSheetsService.principal.readSheetObjects("Topicos_EmpirePlay"),
  ]);
  // O espelho tem que estar idêntico à planilha antes de qualquer coisa.
  const [vA, vC] = await Promise.all([validarAba("Albuns", albunsRows), validarAba("Comentarios_Albuns", comentariosRows)]);

  const albuns = linhasParaObjetos("Albuns", albunsRows);
  const comentariosPlanilha = objetosComRowIndex("Comentarios_Albuns", comentariosRows).map(
    ({ rec, rowIndex }) => ({ ...rec, __rowIndex: String(rowIndex) }) as SheetRecord,
  );
  const legados = [...l1, ...l2, ...l3];

  // Índice dos legados (filtro registro x álbum direto estoura a CPU do Worker).
  const porValor = new Map<string, number[]>();
  const titulos: { t: string; i: number }[] = [];
  legados.forEach((r, i) => {
    const vals = new Set<string>();
    for (const v of Object.values(r)) if (typeof v === "string" && v.length > 0 && v.length <= 100) vals.add(normalizeComparison(v));
    for (const a of ALIAS_TOPICO) {
      const v = (r[a] || "").trim();
      if (v) {
        vals.add(normalizeComparison(v));
        break;
      }
    }
    for (const v of vals) (porValor.get(v) || porValor.set(v, []).get(v)!).push(i);
    for (const a of ALIAS_TITULO) {
      const v = (r[a] || "").trim();
      if (v) {
        titulos.push({ t: normalizeComparison(v), i });
        break;
      }
    }
  });

  const diferencas: { album: string; busca: string; soNaPlanilha: string[]; soNoD1: string[] }[] = [];
  const legadoReal: { album: string; jogador: string; inicio: string }[] = [];
  let intrusosDeMusica = 0;
  let comparacoes = 0;
  for (let idx = 0; idx < albuns.length; idx++) {
    const rec = albuns[idx];
    const item = buildCleanItem("Album", rec, idx);
    if (!item.title && !item.telegramTopicId) continue; // linha em branco
    const mediaTopicId = item.telegramTopicId || item.id;
    const normMediaTopicId = normalizeComparison(mediaTopicId);
    const normTitulo = normalizeComparison(item.title);
    for (const busca of new Set([normMediaTopicId, normalizeComparison(item.id)])) {
      if (!busca) continue;
      comparacoes++;
      const doTopico = (r: SheetRecord) => comentarioPertenceAoTopico(r, normMediaTopicId, busca, normTitulo);
      const planilha = comentariosPlanilha.filter(doTopico).map((r) => r.__rowIndex);
      const linhasD1 = await linhasPorBuscaD1("Comentarios_Albuns", [busca, normMediaTopicId]);
      const d1 = linhasD1
        ? objetosComRowIndex("Comentarios_Albuns", linhasD1)
            .map(({ rec: r, rowIndex }) => ({ ...r, __rowIndex: String(rowIndex) }) as SheetRecord)
            .filter(doTopico)
            .map((r) => r.__rowIndex)
        : ["(D1 indisponível)"];
      const soNaPlanilha = planilha.filter((l) => !d1.includes(l));
      const soNoD1 = d1.filter((l) => !planilha.includes(l));
      if (soNaPlanilha.length || soNoD1.length) diferencas.push({ album: mediaTopicId, busca, soNaPlanilha, soNoD1 });

      const candidatos = new Set<number>([...(porValor.get(normMediaTopicId) || []), ...(porValor.get(busca) || [])]);
      if (normTitulo) for (const { t, i } of titulos) if (t.includes(normTitulo) || normTitulo.includes(t)) candidatos.add(i);
      for (const i of candidatos) {
        if (!doTopico(legados[i])) continue;
        if ((legados[i]["nome_da_musica"] || "").trim()) {
          intrusosDeMusica++;
          continue;
        }
        if (legadoReal.length < 30)
          legadoReal.push({
            album: mediaTopicId,
            jogador: legados[i]["nome_do_jogador"] || legados[i]["jogador"] || "",
            inicio: (legados[i]["comentario"] || legados[i]["texto"] || JSON.stringify(legados[i])).slice(0, 80),
          });
      }
    }
  }
  const ok = vA.ok && vC.ok && diferencas.length === 0 && legadoReal.length === 0;
  return {
    ok,
    espelhoIdentico: { Albuns: vA.ok, Comentarios_Albuns: vC.ok },
    albuns: albuns.length,
    comparacoes,
    diferencas: diferencas.slice(0, 30),
    legadoReal,
    intrusosDeMusicaIgnorados: intrusosDeMusica,
  };
}

export async function adminCompararAlbunsD1Controller(): Promise<Response> {
  try {
    const r = await compararAlbuns();
    return json({ success: r.ok, leituraAtiva: await leituraAlbunsD1Ativa(), ...r });
  } catch (err) {
    return json({ success: false, error: (err as Error).message }, 500);
  }
}

export async function adminLeituraAlbunsD1Controller(request: Request): Promise<Response> {
  const ativar = new URL(request.url).searchParams.get("ativar");
  try {
    if (ativar === "0") return json({ success: await definirLeituraAlbunsD1(false), leituraAtiva: false });
    if (ativar === "1") {
      const r = await compararAlbuns();
      if (!r.ok) return json({ success: false, mensagem: "Comparação com diferença — NÃO liguei.", ...r }, 409);
      return json({ success: await definirLeituraAlbunsD1(true), leituraAtiva: true, comparacoes: r.comparacoes });
    }
    return json({ success: true, leituraAtiva: await leituraAlbunsD1Ativa() });
  } catch (err) {
    return json({ success: false, error: (err as Error).message }, 500);
  }
}

const ehTesteDoBot = (r: string[] | undefined) =>
  !!r && r[0] === "494" && (r[2] || "").trim() === "Empire Registros" && (r[3] || "").includes("Abigail - album 4");

export async function adminApagarTesteBotAlbumController(request: Request): Promise<Response> {
  const confirmar = new URL(request.url).searchParams.get("confirmar") === "1";
  try {
    const rows = await readValuesFresh("principal", "Comentarios_Albuns", "A:ZZ");
    const alvos = rows.map((r, i) => ({ linha: i + 1, row: r })).filter((x) => ehTesteDoBot(x.row));
    if (alvos.length !== 1) return json({ success: false, mensagem: `Esperava 1 linha, achei ${alvos.length} — nada alterado.`, alvos }, 409);
    const alvo = alvos[0];
    if (!confirmar) return json({ success: true, simulacao: true, alvo });
    await registrarLogSistema({
      categoria: "Ação concluída",
      oQueAconteceu: `Mensagem de teste do bot (tópico 494, "Abigail - album 4") apagada de Comentarios_Albuns, linha ${alvo.linha} (autorizado pelo usuário em 2026-11-14). Backup no detalhe técnico.`,
      onde: "adminAlbunsD1Controller.apagarTesteBotAlbum",
      detalheTecnico: JSON.stringify({ backup: alvo }),
    });
    const apagou = await googleSheetsService.principal.deleteRows("Comentarios_Albuns", [alvo.linha]);
    const depois = await readValuesFresh("principal", "Comentarios_Albuns", "A:ZZ");
    const sobrou = depois.some((r) => ehTesteDoBot(r));
    const espelho = await validarAba("Comentarios_Albuns", depois);
    return json({ success: !!apagou && !sobrou, apagou, linhas: depois.length, espelhoIdentico: espelho.ok });
  } catch (err) {
    return json({ success: false, error: (err as Error).message }, 500);
  }
}
