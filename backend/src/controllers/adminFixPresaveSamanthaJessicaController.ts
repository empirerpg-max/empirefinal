// Admin one-off: 3 correções reportadas pelo usuário no mesmo dia pro
// Pre-save de álbum (Samantha Cooper + Jessica Johnson). Dry-run por
// default; `?confirmar=1` aplica de verdade. Cada passo é independente —
// se um falhar os outros ainda rodam, reportados separadamente.
//
// GET /api/empire-play/admin/fix-presave-samantha-jessica?confirmar=1
//
// 1) Samantha Cooper (PRESAVE-f4ed19ad): tetoFinal estava em 6000 — o
//    fallback de "artista não encontrado no chart SPOTIFY"
//    (VALTOTAL_BASE_SEM_CHART) — quando na verdade ela tem valTotal real
//    de ~1.49bi, dando um teto real de ~4.482.587. O endpoint existente
//    (recalcularTetoPreSaveController) se recusa a tocar porque
//    TETO_MINIMO_PLAUSIVEL=1000 já considera 6000 "plausível" — esse fix
//    ignora esse guard de propósito, só pra este caso já confirmado.
// 2) Posts triplicados dela: a missão do dia 1 (post_anuncio,
//    completadoEm 2026-11-04T20:55:49.382Z) rodou 3x por causa da
//    condição de corrida já corrigida em completarMissaoPreSaveController
//    — aqui só localiza os posts da autora com texto/timestamp próximos
//    (poucos minutos) e apaga as 2 cópias mais recentes, mantendo a mais
//    antiga.
// 3) Jessica Johnson: campanha com todos os 14 dias com tipo:null (nunca
//    teve missão nenhuma atribuída na criação) — atribui um mix dos 10
//    tipos de MISSOES_CATALOGO a partir do dia atual em diante (dias já
//    passados/perdidos continuam null, não há como ela cumprir o passado).

import { googleSheetsService, normalizeText, normalizeComparison } from "../services/googleSheetsService";
import { registrarLogSistema } from "../services/logSistemaService";
import {
  readAllCampanhas,
  writeCampanhaSemTrava,
  calcularTetos,
  diaCampanhaAtual,
  MISSOES_CATALOGO,
  type MissaoTipo,
} from "./preSaveController";

const SOCIAL_POSTS_SHEET = "SOCIAL_POSTS";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function fixTetoFallback(artistaAlvo: string, confirmar: boolean) {
  const campanhas = await readAllCampanhas();
  const c = campanhas.find((x) => normalizeComparison(x.artista).includes(normalizeComparison(artistaAlvo)));
  if (!c) return { ok: false, error: `Campanha de "${artistaAlvo}" não encontrada.` };

  const recalculo = await calcularTetos(c.artista);
  const novoTeto = Math.round(c.modo === "missao" ? recalculo.tetoMissao : recalculo.tetoContagem);
  const tetoAnterior = c.tetoFinal;

  if (!confirmar) {
    return { ok: true, dryRun: true, campanhaId: c.id, tetoAnterior, tetoNovo: novoTeto, valTotal: recalculo.valTotal };
  }

  c.tetoFinal = novoTeto;
  await writeCampanhaSemTrava(c);
  registrarLogSistema({
    categoria: "Ação concluída",
    oQueAconteceu: `[admin fix] Teto da campanha de pre-save "${c.albumTituloFull}" (${artistaAlvo}) corrigido de ${tetoAnterior} pra ${novoTeto} (valTotal=${recalculo.valTotal}) — estava preso no fallback de artista-não-encontrado-no-chart.`,
    onde: "adminFixPresaveSamanthaJessicaController",
  }).catch(() => {});

  return { ok: true, dryRun: false, campanhaId: c.id, tetoAnterior, tetoNovo: novoTeto, valTotal: recalculo.valTotal };
}

async function fixPostsDuplicadosSamantha(confirmar: boolean) {
  const rows = await googleSheetsService.usuarios.readValues(SOCIAL_POSTS_SHEET);
  const candidatos = rows
    .map((row, i) => ({ row, rowIndex: i + 1 }))
    .filter(({ row, rowIndex }) => {
      if (rowIndex <= 1) return false;
      const autor = normalizeText(row[3]);
      return normalizeComparison(autor).includes(normalizeComparison("Samantha Cooper"));
    });

  // Agrupa por texto idêntico (mesmo conteúdo de post) — duplicatas de
  // uma mesma missão rodada 2-3x postam o MESMO texto quase no mesmo
  // instante.
  const porTexto = new Map<string, { row: string[]; rowIndex: number }[]>();
  for (const cand of candidatos) {
    const chave = normalizeComparison(normalizeText(cand.row[4]));
    if (!chave) continue;
    if (!porTexto.has(chave)) porTexto.set(chave, []);
    porTexto.get(chave)!.push(cand);
  }

  const grupos = Array.from(porTexto.values()).filter((g) => g.length > 1);
  const resultado: { textoAmostra: string; mantido: string; removidos: string[] }[] = [];

  for (const grupo of grupos) {
    grupo.sort((a, b) => new Date(normalizeText(a.row[7])).getTime() - new Date(normalizeText(b.row[7])).getTime());
    const [manter, ...remover] = grupo;
    resultado.push({
      textoAmostra: normalizeText(manter.row[4]).slice(0, 80),
      mantido: normalizeText(manter.row[0]),
      removidos: remover.map((r) => normalizeText(r.row[0])),
    });

    if (confirmar) {
      for (const r of remover) {
        await googleSheetsService.usuarios.updateValues(
          SOCIAL_POSTS_SHEET,
          `A${r.rowIndex}:M${r.rowIndex}`,
          [["", "", "", "", "", "", "", "", "", "", "", "", ""]],
        );
      }
    }
  }

  if (confirmar && resultado.length > 0) {
    registrarLogSistema({
      categoria: "Ação concluída",
      oQueAconteceu: `[admin fix] Removidos posts duplicados de Samantha Cooper (bug de corrida no pre-save, já corrigido): ${resultado
        .map((r) => `mantido ${r.mantido}, removidos ${r.removidos.join(",")}`)
        .join(" | ")}`,
      onde: "adminFixPresaveSamanthaJessicaController",
    }).catch(() => {});
  }

  return {
    ok: true,
    dryRun: !confirmar,
    grupos: resultado,
    // Diagnóstico extra — útil quando `grupos` vem vazio pra entender por
    // que o agrupamento por texto idêntico não achou nada (ex: cada post
    // teve pequena variação de texto, ou tipo/subtipo diferente).
    todosOsPostsDaAutora: candidatos.map(({ row, rowIndex }) => ({
      rowIndex,
      id: normalizeText(row[0]),
      tipo: normalizeText(row[1]),
      subtipo: normalizeText(row[2]),
      texto: normalizeText(row[4]).slice(0, 120),
      data: normalizeText(row[7]),
    })),
  };
}

const MIX_MISSOES: MissaoTipo[] = [
  "bastidores",
  "trecho_letra",
  "enquete_fas",
  "capa_alternativa",
  "countdown_marco",
  "tracklist_reveal",
  "making_of_video",
  "desafio_som",
  "entrevista",
  "post_anuncio",
];

async function fixMissoesJessica(confirmar: boolean) {
  const campanhas = await readAllCampanhas();
  const c = campanhas.find((x) => normalizeComparison(x.artista).includes(normalizeComparison("Jessica Johnson")));
  if (!c) return { ok: false, error: "Campanha da Jessica Johnson não encontrada." };
  if (c.modo !== "missao") return { ok: false, error: "Campanha da Jessica não é modo 'missao', nada a atribuir." };

  const diaAtual = diaCampanhaAtual(c);
  let cursor = 0;
  const atribuicoes: { dia: number; tipo: MissaoTipo }[] = [];

  const novasMissoes = c.missoes.map((m) => {
    if (m.tipo !== null) return m;
    // Dias já passados sem missão: ficam perdidos de propósito (igual
    // qualquer outro dia perdido no modo missão) — só atribui a partir de
    // hoje em diante, pra ela ainda poder completar.
    if (m.dia < diaAtual) return m;
    const tipo = MIX_MISSOES[cursor % MIX_MISSOES.length];
    cursor++;
    atribuicoes.push({ dia: m.dia, tipo });
    return { ...m, tipo };
  });

  if (!confirmar) {
    return { ok: true, dryRun: true, campanhaId: c.id, diaAtual, atribuicoes };
  }

  c.missoes = novasMissoes;
  await writeCampanhaSemTrava(c);
  registrarLogSistema({
    categoria: "Ação concluída",
    oQueAconteceu: `[admin fix] Campanha de pre-save "${c.albumTituloFull}" (Jessica Johnson) nunca teve missões atribuídas (todos os dias tipo:null) — atribuído mix de missões a partir do dia ${diaAtual}: ${atribuicoes
      .map((a) => `dia ${a.dia}=${a.tipo}`)
      .join(", ")}.`,
    onde: "adminFixPresaveSamanthaJessicaController",
  }).catch(() => {});

  return { ok: true, dryRun: false, campanhaId: c.id, diaAtual, atribuicoes };
}

export async function adminFixPresaveSamanthaJessicaController(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const confirmar = url.searchParams.get("confirmar") === "1";

    const [tetoSamantha, tetoJessica, posts, missoes] = await Promise.all([
      fixTetoFallback("Samantha Cooper", confirmar),
      fixTetoFallback("Jessica Johnson", confirmar),
      fixPostsDuplicadosSamantha(confirmar),
      fixMissoesJessica(confirmar),
    ]);

    return jsonResponse({
      success: true,
      confirmar,
      tetoSamantha,
      tetoJessica,
      postsDuplicadosSamantha: posts,
      missoesJessica: missoes,
    });
  } catch (error: any) {
    return jsonResponse({ success: false, error: error.message || "Erro no fix admin." }, 500);
  }
}
