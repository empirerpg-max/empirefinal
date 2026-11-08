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
const ACERVO_ENTREVISTAS_SHEET = "ACERVO_ENTREVISTAS";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

// IMPORTANTE — lido e escrito UMA VEZ por campanha, nunca em paralelo com
// outro fix que toque a MESMA campanha: bug real encontrado nesta sessão
// (primeira versão deste arquivo rodava fixTetoFallback e fixMissoesJessica
// num Promise.all) — cada função lia sua PRÓPRIA cópia de `c` via
// readAllCampanhas() e escrevia a linha A:U inteira de volta; como as duas
// leituras aconteciam antes de qualquer escrita, a que escrevia por último
// (o teto) sobrescrevia TODA a linha com sua cópia antiga das missões,
// apagando de volta a atribuição que a outra função acabara de gravar —
// "lost update" clássico. O teto da Jessica saiu certo (4062230) mas as
// 14 missões voltaram todas a tipo:null. Fix: o controller principal lê a
// campanha de cada artista UMA vez, aplica todas as mutações daquele
// artista no mesmo objeto em memória, e só então escreve uma vez.

type CampanhaMap = Awaited<ReturnType<typeof readAllCampanhas>>;
type Campanha = CampanhaMap[number];

function calcularFixTeto(c: Campanha, novoTeto: number, valTotal: number) {
  const tetoAnterior = c.tetoFinal;
  c.tetoFinal = novoTeto;
  return { tetoAnterior, tetoNovo: novoTeto, valTotal };
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

// A entrevista "Samantha Cooper - iHeartRadio" (missão do dia 3, completada
// 2026-11-07T01:51:54.372Z) apareceu triplicada em ACERVO_ENTREVISTAS, não
// em SOCIAL_POSTS — createAcervoEntrevistaController (acervoController.ts)
// é o caminho de publicação real de uma missão tipo "entrevista", e essa
// chamada aconteceu em 2026-11-07, ANTES da trava por campanha inteira
// (completarMissaoPreSaveController) ter sido deployada hoje — por isso o
// fix de posts sociais não achava nada: o conteúdo duplicado real estava
// numa aba completamente diferente. ACERVO_ENTREVISTAS: A id | B artista |
// C titulo | D capa | E perguntas(JSON) | F data | G telegram_id |
// H musicas(JSON).
async function fixEntrevistasDuplicadasSamantha(confirmar: boolean) {
  const rows = await googleSheetsService.usuarios.readValues(ACERVO_ENTREVISTAS_SHEET);
  const candidatos = rows
    .map((row, i) => ({ row, rowIndex: i + 1 }))
    .filter(({ row, rowIndex }) => {
      if (rowIndex <= 1) return false;
      return normalizeComparison(normalizeText(row[1])).includes(normalizeComparison("Samantha Cooper"));
    });

  const porTitulo = new Map<string, { row: string[]; rowIndex: number }[]>();
  for (const cand of candidatos) {
    const chave = normalizeComparison(normalizeText(cand.row[2]));
    if (!chave) continue;
    if (!porTitulo.has(chave)) porTitulo.set(chave, []);
    porTitulo.get(chave)!.push(cand);
  }

  const grupos = Array.from(porTitulo.values()).filter((g) => g.length > 1);
  const resultado: { titulo: string; mantido: string; removidos: string[] }[] = [];

  for (const grupo of grupos) {
    grupo.sort((a, b) => new Date(normalizeText(a.row[5])).getTime() - new Date(normalizeText(b.row[5])).getTime());
    const [manter, ...remover] = grupo;
    resultado.push({
      titulo: normalizeText(manter.row[2]),
      mantido: normalizeText(manter.row[0]),
      removidos: remover.map((r) => normalizeText(r.row[0])),
    });

    if (confirmar) {
      for (const r of remover) {
        await googleSheetsService.usuarios.updateValues(
          ACERVO_ENTREVISTAS_SHEET,
          `A${r.rowIndex}:H${r.rowIndex}`,
          [["", "", "", "", "", "", "", ""]],
        );
      }
    }
  }

  if (confirmar && resultado.length > 0) {
    registrarLogSistema({
      categoria: "Ação concluída",
      oQueAconteceu: `[admin fix] Removidas entrevistas duplicadas de Samantha Cooper em ACERVO_ENTREVISTAS (triplicação real da missão de pre-save do dia 3, anterior à trava por campanha): ${resultado
        .map((r) => `mantido ${r.mantido}, removidos ${r.removidos.join(",")}`)
        .join(" | ")}`,
      onde: "adminFixPresaveSamanthaJessicaController",
    }).catch(() => {});
  }

  return {
    ok: true,
    dryRun: !confirmar,
    grupos: resultado,
    todasAsEntrevistasDaArtista: candidatos.map(({ row, rowIndex }) => ({
      rowIndex,
      id: normalizeText(row[0]),
      titulo: normalizeText(row[2]),
      data: normalizeText(row[5]),
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

function calcularFixMissoesJessica(c: Campanha) {
  if (c.modo !== "missao") return { ok: false as const, error: "Campanha da Jessica não é modo 'missao', nada a atribuir." };

  const diaAtual = diaCampanhaAtual(c);
  let cursor = 0;
  const atribuicoes: { dia: number; tipo: MissaoTipo }[] = [];

  c.missoes = c.missoes.map((m) => {
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

  return { ok: true as const, diaAtual, atribuicoes };
}

// Compensação retroativa (pedido explícito do usuário): os dias 1-4 da
// Jessica nunca tiveram missão nenhuma atribuída (o mesmo bug de criação
// que deixou os 14 dias com tipo:null) — já passaram, então ela nunca
// teve CHANCE de completá-los, diferente de um dia perdido normal (onde o
// jogador tinha a missão disponível e não completou a tempo). Credita
// esses dias como se tivessem sido completados: atribui um tipo (mesma
// rotação de MIX_MISSOES, continuando de onde a atribuição dos dias
// futuros parou) e marca status "completa" direto — calcularAcumulado só
// olha status+tipo pra somar o valor (peso/100 * teto/duracaoDias), não
// depende de completadoEm nem de nenhum post/entrevista real ter
// acontecido, então isso credita o valor sem fabricar nenhum post/conteúdo
// falso em Social ou Acervo.
function calcularCompensacaoRetroativaJessica(c: Campanha, diaAtual: number, cursorInicial: number) {
  let cursor = cursorInicial;
  const compensados: { dia: number; tipo: MissaoTipo }[] = [];

  c.missoes = c.missoes.map((m) => {
    if (m.tipo !== null || m.status !== "pendente" || m.dia >= diaAtual) return m;
    const tipo = MIX_MISSOES[cursor % MIX_MISSOES.length];
    cursor++;
    compensados.push({ dia: m.dia, tipo });
    return {
      ...m,
      tipo,
      status: "completa" as const,
      completadoEm: new Date().toISOString(),
      dados: { compensacaoRetroativa: true, motivo: "Dias sem missão atribuída por bug de criação da campanha, já passados quando o bug foi corrigido." },
    };
  });

  return { compensados };
}

async function fixCampanhaSamanthaEJessica(confirmar: boolean) {
  const campanhas = await readAllCampanhas();
  const samantha = campanhas.find((x) => normalizeComparison(x.artista).includes(normalizeComparison("Samantha Cooper")));
  const jessica = campanhas.find((x) => normalizeComparison(x.artista).includes(normalizeComparison("Jessica Johnson")));

  const resultado: {
    tetoSamantha: unknown;
    tetoJessica: unknown;
    missoesJessica: unknown;
    compensacaoRetroativaJessica: unknown;
  } = {
    tetoSamantha: { ok: false, error: 'Campanha de "Samantha Cooper" não encontrada.' },
    tetoJessica: { ok: false, error: 'Campanha de "Jessica Johnson" não encontrada.' },
    missoesJessica: { ok: false, error: "Campanha da Jessica Johnson não encontrada." },
    compensacaoRetroativaJessica: { ok: false, error: "Campanha da Jessica Johnson não encontrada." },
  };

  if (samantha) {
    const recalculo = await calcularTetos(samantha.artista);
    const novoTeto = Math.round(samantha.modo === "missao" ? recalculo.tetoMissao : recalculo.tetoContagem);
    const fixInfo = calcularFixTeto(samantha, novoTeto, recalculo.valTotal);
    resultado.tetoSamantha = { ok: true, dryRun: !confirmar, campanhaId: samantha.id, ...fixInfo };
    if (confirmar) {
      await writeCampanhaSemTrava(samantha);
      registrarLogSistema({
        categoria: "Ação concluída",
        oQueAconteceu: `[admin fix] Teto da campanha de pre-save "${samantha.albumTituloFull}" (Samantha Cooper) corrigido de ${fixInfo.tetoAnterior} pra ${fixInfo.tetoNovo} (valTotal=${fixInfo.valTotal}) — estava preso no fallback de artista-não-encontrado-no-chart.`,
        onde: "adminFixPresaveSamanthaJessicaController",
      }).catch(() => {});
    }
  }

  if (jessica) {
    const recalculo = await calcularTetos(jessica.artista);
    const novoTeto = Math.round(jessica.modo === "missao" ? recalculo.tetoMissao : recalculo.tetoContagem);
    const fixTetoInfo = calcularFixTeto(jessica, novoTeto, recalculo.valTotal);
    const fixMissoesInfo = calcularFixMissoesJessica(jessica);
    resultado.tetoJessica = { ok: true, dryRun: !confirmar, campanhaId: jessica.id, ...fixTetoInfo };
    resultado.missoesJessica = fixMissoesInfo.ok
      ? { ok: true, dryRun: !confirmar, campanhaId: jessica.id, diaAtual: fixMissoesInfo.diaAtual, atribuicoes: fixMissoesInfo.atribuicoes }
      : fixMissoesInfo;

    // Compensação dos dias já passados (1 até diaAtual-1) que também
    // nunca tiveram missão — continua a rotação de tipos de onde a
    // atribuição dos dias futuros parou, pra não repetir o mesmo tipo
    // logo em seguida sem necessidade.
    const cursorContinuacao = fixMissoesInfo.ok ? fixMissoesInfo.atribuicoes.length : 0;
    const compensacao = fixMissoesInfo.ok
      ? calcularCompensacaoRetroativaJessica(jessica, fixMissoesInfo.diaAtual, cursorContinuacao)
      : { compensados: [] };
    resultado.compensacaoRetroativaJessica = { ok: true, dryRun: !confirmar, campanhaId: jessica.id, compensados: compensacao.compensados };

    if (confirmar) {
      // UMA escrita só, com teto, missões futuras E compensação retroativa
      // já aplicados no mesmo objeto — nunca duas escritas concorrentes na
      // mesma campanha (ver comentário acima sobre o "lost update" da
      // primeira versão deste arquivo).
      await writeCampanhaSemTrava(jessica);
      registrarLogSistema({
        categoria: "Ação concluída",
        oQueAconteceu: `[admin fix] Campanha de pre-save "${jessica.albumTituloFull}" (Jessica Johnson): teto corrigido de ${fixTetoInfo.tetoAnterior} pra ${fixTetoInfo.tetoNovo} (valTotal=${fixTetoInfo.valTotal}); missões nunca atribuídas (todos os dias tipo:null) — atribuído mix a partir do dia ${fixMissoesInfo.ok ? fixMissoesInfo.diaAtual : "?"}: ${
          fixMissoesInfo.ok ? fixMissoesInfo.atribuicoes.map((a) => `dia ${a.dia}=${a.tipo}`).join(", ") : "(falhou)"
        }; e compensação retroativa (dias já passados sem missão por causa do mesmo bug, creditados como completos): ${
          compensacao.compensados.map((a) => `dia ${a.dia}=${a.tipo}`).join(", ") || "(nenhum)"
        }.`,
        onde: "adminFixPresaveSamanthaJessicaController",
      }).catch(() => {});
    }
  }

  return resultado;
}

export async function adminFixPresaveSamanthaJessicaController(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const confirmar = url.searchParams.get("confirmar") === "1";

    const [campanhaFixes, posts, entrevistas] = await Promise.all([
      fixCampanhaSamanthaEJessica(confirmar),
      fixPostsDuplicadosSamantha(confirmar),
      fixEntrevistasDuplicadasSamantha(confirmar),
    ]);

    return jsonResponse({
      success: true,
      confirmar,
      tetoSamantha: campanhaFixes.tetoSamantha,
      tetoJessica: campanhaFixes.tetoJessica,
      postsDuplicadosSamantha: posts,
      entrevistasDuplicadasSamantha: entrevistas,
      missoesJessica: campanhaFixes.missoesJessica,
      compensacaoRetroativaJessica: campanhaFixes.compensacaoRetroativaJessica,
    });
  } catch (error: any) {
    return jsonResponse({ success: false, error: error.message || "Erro no fix admin." }, 500);
  }
}
