// Motor do lançamento em passos do pre-save (design:
// docs/superpowers/specs/2026-11-23-presave-lancamento-em-passos-design.md).
//
// Roda no cron próprio do pre-save. Em cada execução:
// 1. cria a lista de passos das campanhas "ativa" que chegaram ao dia D;
// 2. para cada lançamento incompleto, sob trava por campanha, executa os
//    passos pendentes em ordem até o orçamento de chamadas acabar ou um
//    passo falhar (a próxima execução continua de onde parou);
// 3. a campanha vira "lancada" assim que o passo "album" fica feito.
import {
  calcularAcumulado,
  aplicarDiasPerdidos,
  readAllCampanhas,
  writeCampanha,
  type PreSaveCampanha,
} from "../preSaveController";
import * as DB from "../../services/presaveLancamentoDb";
import { chamadasRestantes, encerrarOrcamento, iniciarOrcamento } from "../../services/orcamentoChamadas";
import { jaFoiLancadaDeVerdade, marcarLancadaDeVerdade, withWriteLock } from "../../services/writeLockService";
import { montarPassosLancamento } from "./montarPassos";
import { criarContexto, depsReais, executarPasso, type DepsEscrita } from "./executores";
import { avisarPassoTravado } from "./protecoes";

export const ORCAMENTO_CHAMADAS_PRESAVE = 35;
/** Nunca começa um passo com menos chamadas que isso sobrando (um passo faz até ~6). */
const FOLGA_MINIMA = 10;
const DATA_ISO_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export interface DepsMotor {
  escrita: DepsEscrita;
  lerCampanhas(): Promise<PreSaveCampanha[]>;
  /** Grava status "lancada" na linha da campanha (PreSave_Album). */
  marcarCampanhaLancada(c: PreSaveCampanha): Promise<void>;
  avisarTravado(c: PreSaveCampanha, passo: string, erro: string): Promise<void>;
  log(mensagem: string, categoria: "Ação concluída" | "Falha de escrita"): void;
  /** Só para testes (simular queda entre gravar e anotar). */
  marcarFeito?: typeof DB.marcarFeito;
}

function depsMotorReais(): DepsMotor {
  return {
    escrita: depsReais(),
    lerCampanhas: readAllCampanhas,
    async marcarCampanhaLancada(c) {
      c.status = "lancada";
      await writeCampanha(c);
    },
    avisarTravado: (c, passo, erro) => avisarPassoTravado(c, passo, erro),
    log(mensagem, categoria) {
      import("../../services/logSistemaService")
        .then(({ registrarLogSistema }) =>
          registrarLogSistema({ categoria, oQueAconteceu: mensagem, onde: "presaveLancamento/motor" }),
        )
        .catch(() => {});
    },
  };
}

function tituloCompleto(c: PreSaveCampanha): string {
  return c.albumTituloFull.startsWith(`${c.artista} - `) ? c.albumTituloFull : `${c.artista} - ${c.albumTituloFull}`;
}

interface ResultadoCampanha {
  lancou: boolean;
  falhas: number;
  feitos: number;
  orcamentoEsgotado: boolean;
}

async function promoverParaLancada(c: PreSaveCampanha, deps: DepsMotor): Promise<void> {
  try {
    if (c.status === "ativa") {
      c.status = "lancada";
      await deps.marcarCampanhaLancada(c);
    }
    await marcarLancadaDeVerdade(c.id);
  } catch (err) {
    // Sem drama: a próxima execução vê "album" feito + status "ativa" e tenta de novo.
    deps.log(
      `Pre-save "${c.albumTituloFull}": álbum criado, mas não consegui gravar o status "lancada" agora (tento de novo no próximo ciclo): ${err instanceof Error ? err.message : err}`,
      "Falha de escrita",
    );
  }
}

async function processarCampanha(c: PreSaveCampanha, deps: DepsMotor): Promise<ResultadoCampanha> {
  const marcarFeito = deps.marcarFeito ?? DB.marcarFeito;
  const r: ResultadoCampanha = { lancou: false, falhas: 0, feitos: 0, orcamentoEsgotado: false };
  const passos = await DB.listarPassos(c.id);
  const mapa = new Map(passos.map((p) => [p.passo, p]));
  const ctx = criarContexto(c, mapa);

  if (mapa.get("album")?.estado === "feito" && c.status === "ativa") await promoverParaLancada(c, deps);

  for (const p of passos) {
    if (p.estado === "feito") continue;
    if (p.estado === "travado") return r;
    if (chamadasRestantes() < FOLGA_MINIMA) {
      r.orcamentoEsgotado = true;
      return r;
    }
    try {
      const resultado = await executarPasso(ctx, p, deps.escrita);
      await marcarFeito(c.id, p.passo, resultado);
      mapa.set(p.passo, { ...p, estado: "feito", resultado });
      r.feitos++;
      if (p.passo === "album") {
        r.lancou = true;
        await promoverParaLancada(c, deps);
      }
    } catch (err) {
      r.falhas++;
      const msg = err instanceof Error ? err.message : String(err);
      const estado = await DB.registrarFalha(c.id, p.passo, msg);
      if (estado === "travado") {
        await deps.avisarTravado(c, p.passo, msg).catch(() => {});
      } else {
        deps.log(`Pre-save "${c.albumTituloFull}": passo "${p.passo}" falhou (tento de novo no próximo ciclo): ${msg}`, "Falha de escrita");
      }
      return r;
    }
  }

  await DB.marcarCompleto(c.id);
  deps.log(`Pre-save "${c.albumTituloFull}" completo: todos os passos do lançamento foram gravados.`, "Ação concluída");
  return r;
}

export async function executarMotorLancamentos(opts?: {
  orcamento?: number;
  agora?: Date;
  deps?: DepsMotor;
}): Promise<{ lancados: number; falhas: number; passosFeitos: number }> {
  const deps = opts?.deps ?? depsMotorReais();
  const total = { lancados: 0, falhas: 0, passosFeitos: 0 };
  iniciarOrcamento(opts?.orcamento ?? ORCAMENTO_CHAMADAS_PRESAVE);
  try {
    const campanhas = await deps.lerCampanhas();
    const porId = new Map(campanhas.map((c) => [c.id, c]));
    const hoje = (opts?.agora ?? new Date()).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });

    // 1. Campanhas que chegaram ao dia D ganham a lista de passos.
    for (const c of campanhas) {
      if (c.status !== "ativa" || !DATA_ISO_REGEX.test(c.dataLancamento) || c.dataLancamento > hoje) continue;
      if (await DB.obterLancamento(c.id)) continue;
      // Campanha lançada pelo fluxo antigo (marca no D1): só entra pelo admin, em reconciliação.
      if (await jaFoiLancadaDeVerdade(c.id)) continue;
      aplicarDiasPerdidos(c);
      const bonus = c.modo === "missao" ? Math.round(calcularAcumulado(c)) : null;
      await DB.criarLancamento(
        { campanhaId: c.id, albumTitulo: tituloCompleto(c), albumTopicId: c.albumTopicId },
        montarPassosLancamento(c, { reconciliacao: false, bonusCongelado: bonus }),
      );
    }

    // 2. Executa os passos pendentes, campanha por campanha, dentro do orçamento.
    for (const l of await DB.lancamentosIncompletos()) {
      if (chamadasRestantes() < FOLGA_MINIMA) break;
      const c = porId.get(l.campanhaId);
      if (!c) continue;
      let r: ResultadoCampanha;
      try {
        r = await withWriteLock(`presave:lancamento:${c.id}`, () => processarCampanha(c, deps), {
          ttlMs: 5 * 60_000,
          maxTentativas: 1,
        });
      } catch (err) {
        // Outra execução já está trabalhando nesta campanha (ou o D1 falhou) — pula.
        console.warn(`[presave motor] campanha ${c.id} pulada nesta execução:`, err);
        continue;
      }
      if (r.lancou) total.lancados++;
      total.falhas += r.falhas;
      total.passosFeitos += r.feitos;
      if (r.orcamentoEsgotado) break;
    }
  } finally {
    encerrarOrcamento();
  }
  return total;
}
