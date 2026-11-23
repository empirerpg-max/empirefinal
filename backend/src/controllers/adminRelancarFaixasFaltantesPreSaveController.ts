// Relançamento admin de um pre-save — agora pelo MOTOR em passos (design:
// docs/superpowers/specs/2026-11-23-presave-lancamento-em-passos-design.md).
//
// A versão antiga comparava títulos da campanha com Musicas e relançava o
// que "faltava" — frágil ("No Strings Atached" × "Attached") e duplicava
// quando a comparação errava. Agora:
// - campanha que já tem lista de passos → reabre os passos falhos/travados
//   (voltam a "pendente" com procurar-antes-de-gravar) e roda o motor;
// - campanha do fluxo antigo (sem lista) → cria a lista em modo
//   RECONCILIAÇÃO: o álbum nasce "feito" (achado em Albuns) e todo passo
//   procura antes de gravar, então nada que já existe é regravado.
//
// GET /api/gestao/admin/relancar-faixas-faltantes-presave?campanhaId=PRESAVE-xxxx[&confirmar=1]
import { calcularAcumulado, readAllCampanhas } from "./preSaveController";
import * as DB from "../services/presaveLancamentoDb";
import { montarPassosLancamento } from "./presaveLancamento/montarPassos";
import { acharAlbumParaReconciliar } from "./presaveLancamento/busca";
import { depsReais } from "./presaveLancamento/executores";
import { executarMotorLancamentos, type DepsMotor } from "./presaveLancamento/motor";

export async function relancarPresave(
  campanhaId: string,
  opts: { confirmar: boolean; motor?: DepsMotor; orcamento?: number },
): Promise<{ status: number; body: Record<string, unknown> }> {
  const lerCampanhas = opts.motor?.lerCampanhas ?? readAllCampanhas;
  const escrita = opts.motor?.escrita ?? depsReais();
  const c = (await lerCampanhas()).find((x) => x.id === campanhaId);
  if (!c) return { status: 404, body: { success: false, error: `Campanha ${campanhaId} não encontrada.` } };
  if (c.status === "cancelada") {
    return { status: 400, body: { success: false, error: `Campanha ${campanhaId} está cancelada.` } };
  }
  const rodarMotor = () => executarMotorLancamentos({ deps: opts.motor, orcamento: opts.orcamento });

  const existente = await DB.obterLancamento(campanhaId);
  if (existente) {
    if (!opts.confirmar) {
      const passos = await DB.listarPassos(campanhaId);
      return {
        status: 200,
        body: {
          success: true,
          dryRun: true,
          acao: "reabrir",
          aReabrir: passos.filter((p) => p.estado === "falhou" || p.estado === "travado").map((p) => p.passo),
          aviso: "Nada foi gravado. Repita com &confirmar=1.",
        },
      };
    }
    const reabertos = await DB.reabrirPassos(campanhaId);
    const motor = await rodarMotor();
    return { status: 200, body: { success: true, acao: "reabrir", reabertos, motor } };
  }

  if (c.status === "ativa") {
    return {
      status: 400,
      body: { success: false, error: "Campanha ainda ativa e sem lançamento: o cron do pre-save cria a lista no dia D." },
    };
  }

  const albumFullTitle = c.albumTituloFull.startsWith(`${c.artista} - `)
    ? c.albumTituloFull
    : `${c.artista} - ${c.albumTituloFull}`;
  const album = await acharAlbumParaReconciliar(escrita, c, albumFullTitle);
  if (!album || !album.codigoUnicoAlbum) {
    return {
      status: 400,
      body: {
        success: false,
        error: `Não achei o álbum "${albumFullTitle}" em Albuns (pelo tópico, pelo Código único ou pelo nome) — nada foi criado.`,
      },
    };
  }
  const bonus = c.modo === "missao" ? Math.round(calcularAcumulado(c)) : null;
  const passos = montarPassosLancamento(c, { reconciliacao: true, bonusCongelado: bonus, albumExistente: album });
  if (!opts.confirmar) {
    return {
      status: 200,
      body: {
        success: true,
        dryRun: true,
        acao: "reconciliar",
        albumExistente: album,
        totalPassos: passos.length,
        aviso: "Nada foi gravado. Repita com &confirmar=1.",
      },
    };
  }
  await DB.criarLancamento({ campanhaId, albumTitulo: albumFullTitle, albumTopicId: album.albumTopicId }, passos);
  const motor = await rodarMotor();
  return { status: 200, body: { success: true, acao: "reconciliar", albumExistente: album, motor } };
}

export async function adminRelancarFaixasFaltantesPreSaveController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const campanhaId = (url.searchParams.get("campanhaId") || "").trim();
  if (!campanhaId) {
    return new Response(JSON.stringify({ success: false, error: "Parâmetro 'campanhaId' é obrigatório." }), {
      status: 400,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }
  try {
    const r = await relancarPresave(campanhaId, { confirmar: url.searchParams.get("confirmar") === "1" });
    return new Response(JSON.stringify(r.body, null, 2), {
      status: r.status,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ success: false, error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { "Content-Type": "application/json; charset=utf-8" } },
    );
  }
}
