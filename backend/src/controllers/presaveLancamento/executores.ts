// Executores dos passos do lançamento em passos do pre-save. Cada passo grava
// UMA coisa e devolve o que gravou (vai para resultado_json no D1). Se o
// passo tem procurarAntes=true (já falhou antes, ou é reconciliação de
// campanha antiga), procura primeiro na planilha e, se achar, devolve o
// achado SEM gravar — é isso que impede duplicata quando uma execução cai
// entre "gravou" e "anotou".
//
// As operações de planilha chegam por `deps` (as reais por padrão) — os
// testes usam planilhas falsas em memória (scripts/helpers/fakePlanilhas.ts).
import type { GoogleSheetRow } from "../../services/googleSheetsService";
import type { PreSaveCampanha } from "../preSaveController";
import type { Passo } from "../../services/presaveLancamentoDb";
import type { TrackItemPayload } from "../gestaoController";
import {
  acharAlbumNaEdicaoChartsAlbuns,
  acharAlbumPorTopico,
  acharFaixaEmEdicaoCharts,
  acharFaixaEmMusicas,
  acharNoRegistro,
  existeExtraDoAlbum,
} from "./busca";

type PlanilhaChave = "principal" | "edicaoCharts" | "registrosCharts";

export interface DepsEscrita {
  readFresh(planilha: PlanilhaChave, aba: string, range?: string): Promise<string[][]>;
  updateValues(planilha: PlanilhaChave, aba: string, range: string, values: GoogleSheetRow[]): Promise<boolean>;
  gravarLinhaAlbumEmAlbuns(p: {
    dataFormatada: string;
    albumTopicId: string;
    capaUrl: string;
    jogadorId: string;
    nomeJogador: string;
    albumFullTitle: string;
    encartesStr: string;
    tipoAlbum: string;
  }): Promise<number>;
  registrarAlbumNaEdicaoChartsAlbuns(p: {
    artistaAlbum: string;
    albumFullTitle: string;
    tipoAlbum: string;
    dataFormatada: string;
    numeroSemanas: number;
    numeroFaixas: number;
    albumRowIndexEmAlbuns?: number | null;
  }): Promise<string>;
  appendRowMusicasSeguro(values: GoogleSheetRow): Promise<number>;
  registrarNaEdicaoCharts(p: {
    dataFormatada: string;
    fullTitle: string;
    tipoSingle: string;
    tipoMusica: string;
    album?: string;
    artistaPrincipal: string;
    participantes?: string[];
  }): Promise<number | null>;
  lerCodigoUnicoGerado(linha: number): Promise<string>;
  registrarInfosMusicas(p: { fullTitle: string; capaUrl: string }): Promise<void>;
  registrarNoRegistroDeMusica(p: {
    songTitle: string;
    tipoSingle: string;
    tipoMusica: string;
    album: string;
    artistaPrincipal: string;
    participantes: string[];
  }): Promise<void>;
  vincularFaixaExistenteAoAlbum(
    titulo: string,
    albumFullTitle: string,
    ordem: number,
    artistaAlbum: string,
    jogadorId: string,
    dataFormatada: string,
  ): Promise<{ musicasOk: boolean; edicaoChartsOk: boolean; criada: boolean }>;
  mirrorMusicaRowParaD1(linha: number): Promise<boolean>;
  salvarExtra(body: { codigoUnico: string; tipo: "album"; shop: unknown[]; info: string; arte: unknown[] }): Promise<boolean>;
  somarPrestigio(jogadorId: string, nomeJogador: string): Promise<void>;
}

export function depsReais(): DepsEscrita {
  const gestao = () => import("../gestaoController");
  const sheets = () => import("../../services/googleSheetsService");
  return {
    async readFresh(planilha, aba, range) {
      return (await sheets()).readValuesFresh(planilha, aba, range);
    },
    async updateValues(planilha, aba, range, values) {
      return (await sheets()).updateValues(planilha, aba, range, values);
    },
    async gravarLinhaAlbumEmAlbuns(p) {
      return (await gestao()).gravarLinhaAlbumEmAlbuns(p);
    },
    async registrarAlbumNaEdicaoChartsAlbuns(p) {
      return (await gestao()).registrarAlbumNaEdicaoChartsAlbuns(p);
    },
    async appendRowMusicasSeguro(values) {
      return (await gestao()).appendRowMusicasSeguro(values);
    },
    async registrarNaEdicaoCharts(p) {
      return (await gestao()).registrarNaEdicaoCharts(p);
    },
    async lerCodigoUnicoGerado(linha) {
      return (await gestao()).lerCodigoUnicoGerado(linha);
    },
    async registrarInfosMusicas(p) {
      return (await gestao()).registrarInfosMusicas(p);
    },
    async registrarNoRegistroDeMusica(p) {
      return (await gestao()).registrarNoRegistroDeMusica(p);
    },
    async vincularFaixaExistenteAoAlbum(...args) {
      return (await gestao()).vincularFaixaExistenteAoAlbum(...args);
    },
    async mirrorMusicaRowParaD1(linha) {
      return (await gestao()).mirrorMusicaRowParaD1(linha);
    },
    async salvarExtra(body) {
      const { saveExtraMaterialController } = await import("../extraMaterialController");
      const res = await saveExtraMaterialController(
        new Request("https://internal.empire/api/gestao/extra", { method: "POST", body: JSON.stringify(body) }),
      );
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean };
      return res.ok && !!json.ok;
    },
    async somarPrestigio(jogadorId, nomeJogador) {
      const { somarPrestigio } = await import("../../services/prestigioService");
      await somarPrestigio({ telegramId: jogadorId, usuario: nomeJogador }, "publicar_lancamento");
    },
  };
}

export interface ContextoLancamento {
  c: PreSaveCampanha;
  albumFullTitle: string;
  /** "DD/MM/AAAA" do DIA D (nunca "hoje": a retomada pode ser dias depois). */
  dataFormatada: string;
  passos: Map<string, Passo>;
}

export function criarContexto(c: PreSaveCampanha, passos: Map<string, Passo>): ContextoLancamento {
  const titulo = c.albumTituloFull.startsWith(`${c.artista} - `)
    ? c.albumTituloFull
    : `${c.artista} - ${c.albumTituloFull}`;
  const [ano, mes, dia] = c.dataLancamento.split("-");
  return { c, albumFullTitle: titulo, dataFormatada: `${dia}/${mes}/${ano}`, passos };
}

function resultadoDe(ctx: ContextoLancamento, chave: string): Record<string, unknown> {
  const p = ctx.passos.get(chave);
  if (!p || p.estado !== "feito" || !p.resultado) {
    throw new Error(`Dependência pendente: o passo "${chave}" ainda não foi feito.`);
  }
  return p.resultado;
}

function faixaDoNum(ctx: ContextoLancamento, num: number) {
  const f = ctx.c.faixas.find((x) => x.num === num);
  if (!f) throw new Error(`Faixa #${num} não existe na campanha ${ctx.c.id}.`);
  return f;
}

function comoPayload(f: PreSaveCampanha["faixas"][number]): TrackItemPayload {
  return {
    num: f.num,
    inedita: f.inedita,
    titulo: f.titulo,
    tipoSingle: f.tipoSingle,
    tipoMusica: f.tipoMusica,
    participantes: f.participantes,
    mediaUrl: f.mediaUrl,
    letra: f.letra,
    abrirTopico: f.abrirTopico,
  };
}

function exigir(ok: boolean, msg: string): void {
  if (!ok) throw new Error(msg);
}

// Revisão C2: uma leitura que caiu no fallback GViz devolve o cabeçalho da
// aba ("Código único", "Data de lançamento"...) no lugar do valor — nunca
// aceitar como Código único algo fora do formato real.
const CODIGO_FAIXA = /^EMP\d+$/i;
const CODIGO_ALBUM = /^EMPALBM\d+$/i;
function exigirCodigo(codigo: string, re: RegExp, onde: string): string {
  const c = String(codigo || "").trim();
  exigir(re.test(c), `Código único inválido em ${onde}: "${c}".`);
  return c;
}

async function passoAlbum(ctx: ContextoLancamento, p: Passo, deps: DepsEscrita) {
  const { c } = ctx;
  if (p.procurarAntes) {
    const achado = await acharAlbumPorTopico(deps, c.albumTopicId);
    if (achado) {
      // Revisão I1: Albuns!L preenchido não garante a linha em EDIÇÃO CHARTS
      // ÁLBUMS (a escrita lá pode ter falhado) — confere lá, pelo nome.
      const naEca = await acharAlbumNaEdicaoChartsAlbuns(deps, ctx.albumFullTitle);
      let codigo: string;
      if (naEca && CODIGO_ALBUM.test(naEca.codigoUnicoAlbum)) {
        codigo = naEca.codigoUnicoAlbum;
        if (achado.codigoUnicoAlbum !== codigo) {
          exigir(
            await deps.updateValues("principal", "Albuns", `L${achado.linhaAlbuns}`, [[codigo]]),
            "Falha ao copiar o Código único do álbum para Albuns!L.",
          );
        }
      } else {
        codigo = await registrarNaEca(ctx, deps, achado.linhaAlbuns);
      }
      return { linhaAlbuns: achado.linhaAlbuns, codigoUnicoAlbum: codigo, albumTopicId: c.albumTopicId };
    }
  }
  const linhaAlbuns = await deps.gravarLinhaAlbumEmAlbuns({
    dataFormatada: ctx.dataFormatada,
    albumTopicId: c.albumTopicId,
    capaUrl: c.capaUrl,
    jogadorId: c.jogadorId,
    nomeJogador: c.jogadorNome,
    albumFullTitle: ctx.albumFullTitle,
    encartesStr: c.encartesUrls.join(", "),
    tipoAlbum: c.tipoAlbum,
  });
  const codigoUnicoAlbum = await registrarNaEca(ctx, deps, linhaAlbuns);
  await deps.somarPrestigio(c.jogadorId, c.jogadorNome).catch(() => {});
  return { linhaAlbuns, codigoUnicoAlbum, albumTopicId: c.albumTopicId };
}

async function registrarNaEca(ctx: ContextoLancamento, deps: DepsEscrita, linhaAlbuns: number): Promise<string> {
  const codigo = await deps.registrarAlbumNaEdicaoChartsAlbuns({
    artistaAlbum: ctx.c.artista,
    albumFullTitle: ctx.albumFullTitle,
    tipoAlbum: ctx.c.tipoAlbum,
    dataFormatada: ctx.dataFormatada,
    numeroSemanas: 1,
    numeroFaixas: ctx.c.faixas.length,
    albumRowIndexEmAlbuns: linhaAlbuns,
  });
  return exigirCodigo(codigo, CODIGO_ALBUM, "EDIÇÃO CHARTS ÁLBUMS");
}

async function passoFaixaMusicas(ctx: ContextoLancamento, num: number, p: Passo, deps: DepsEscrita) {
  const f = faixaDoNum(ctx, num);
  if (p.procurarAntes) {
    const achado = await acharFaixaEmMusicas(deps, ctx.albumFullTitle, num);
    if (achado) return { linha: achado.linha, songTitle: achado.songTitle, pendente: !f.abrirTopico };
  }
  const { montarLinhaMusicasFaixaInedita } = await import("../gestaoController");
  const trackTopicId = f.abrirTopico
    ? `musica_${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${f.num}`
    : "";
  const { songTitle, linha, pendente } = montarLinhaMusicasFaixaInedita({
    dataFormatada: ctx.dataFormatada,
    faixa: comoPayload(f),
    artistaAlbum: ctx.c.artista,
    albumFullTitle: ctx.albumFullTitle,
    capaUrl: ctx.c.capaUrl,
    jogadorId: ctx.c.jogadorId,
    trackTopicId,
  });
  const linhaGravada = await deps.appendRowMusicasSeguro(linha);
  return { linha: linhaGravada, songTitle, pendente, trackTopicId };
}

async function passoFaixaCharts(ctx: ContextoLancamento, num: number, p: Passo, deps: DepsEscrita) {
  const f = faixaDoNum(ctx, num);
  const songTitle = String(resultadoDe(ctx, `faixa:${num}:musicas`).songTitle);
  if (p.procurarAntes) {
    const achado = await acharFaixaEmEdicaoCharts(deps, songTitle, ctx.albumFullTitle);
    if (achado) {
      const codigoAchado = exigirCodigo(achado.codigoUnico, CODIGO_FAIXA, `EDIÇÃO CHARTS linha ${achado.linha}`);
      return { linhaCharts: achado.linha, codigoUnico: codigoAchado, preexistente: true };
    }
  }
  const linhaCharts = await deps.registrarNaEdicaoCharts({
    dataFormatada: ctx.dataFormatada,
    fullTitle: songTitle,
    tipoSingle: f.tipoSingle || "TRACKLIST ALBUM",
    tipoMusica: f.tipoMusica || "SOLO",
    album: ctx.albumFullTitle,
    artistaPrincipal: ctx.c.artista,
    participantes: (f.participantes || []).filter(Boolean),
  });
  exigir(!!linhaCharts, `Falha ao gravar "${songTitle}" em EDIÇÃO CHARTS.`);
  const codigoUnico = exigirCodigo(
    await deps.lerCodigoUnicoGerado(linhaCharts as number),
    CODIGO_FAIXA,
    `EDIÇÃO CHARTS linha ${linhaCharts}`,
  );
  return { linhaCharts, codigoUnico };
}

async function passoFaixaCodigo(ctx: ContextoLancamento, num: number, p: Passo, deps: DepsEscrita) {
  const musicas = resultadoDe(ctx, `faixa:${num}:musicas`);
  const charts = resultadoDe(ctx, `faixa:${num}:charts`);
  const linha = Number(musicas.linha);
  const codigoUnico = String(charts.codigoUnico);
  if (p.procurarAntes) {
    // Código já copiado = este passo já rodou (INFOS MÚSICAS incluso): só
    // garante o espelho no D1, sem regravar nada na planilha.
    const z = await deps.readFresh("principal", "Musicas", `Z${linha}:Z${linha}`);
    if (String(z?.[0]?.[0] || "").trim() === codigoUnico) {
      exigir(await deps.mirrorMusicaRowParaD1(linha), `Falha ao espelhar Musicas linha ${linha} no D1.`);
      return { codigoUnico, linha, jaCopiado: true };
    }
  }
  exigir(
    await deps.updateValues("principal", "Musicas", `Z${linha}`, [[codigoUnico]]),
    `Falha ao copiar o Código único para Musicas!Z${linha}.`,
  );
  if (musicas.pendente === false) {
    await deps.registrarInfosMusicas({ fullTitle: String(musicas.songTitle), capaUrl: ctx.c.capaUrl });
  }
  exigir(await deps.mirrorMusicaRowParaD1(linha), `Falha ao espelhar Musicas linha ${linha} no D1.`);
  return { codigoUnico, linha };
}

async function passoFaixaRegistro(ctx: ContextoLancamento, num: number, p: Passo, deps: DepsEscrita) {
  const f = faixaDoNum(ctx, num);
  const songTitle = String(resultadoDe(ctx, `faixa:${num}:musicas`).songTitle);
  if (p.procurarAntes) {
    // Reconciliação: faixa que já estava na EDIÇÃO CHARTS já foi registrada.
    if (p.resultado?.reconciliacao && resultadoDe(ctx, `faixa:${num}:charts`).preexistente) {
      return { songTitle, jaNosCharts: true };
    }
    if (await acharNoRegistro(deps, songTitle, ctx.albumFullTitle)) return { songTitle, achado: true };
  }
  await deps.registrarNoRegistroDeMusica({
    songTitle,
    tipoSingle: f.tipoSingle || "TRACKLIST ALBUM",
    tipoMusica: f.tipoMusica || "SOLO",
    album: ctx.albumFullTitle,
    artistaPrincipal: ctx.c.artista,
    participantes: (f.participantes || []).filter(Boolean),
  });
  return { songTitle };
}

async function passoVinculo(ctx: ContextoLancamento, num: number, deps: DepsEscrita) {
  const f = faixaDoNum(ctx, num);
  const r = await deps.vincularFaixaExistenteAoAlbum(
    f.titulo,
    ctx.albumFullTitle,
    f.num,
    ctx.c.artista,
    ctx.c.jogadorId,
    ctx.dataFormatada,
  );
  exigir(r.musicasOk, `Não consegui vincular "${f.titulo}" ao álbum em Musicas.`);
  const { normalizeComparison: norm } = await import("../../services/googleSheetsService");
  const rows = await deps.readFresh("principal", "Musicas", "A1:Z50000");
  const linhas: number[] = [];
  const comCodigo: number[] = [];
  for (let i = 1; i < rows.length; i++) {
    if (norm(rows[i]?.[7]) !== norm(f.titulo)) continue;
    linhas.push(i + 1);
    // Revisão I2: linha sem Código único (ex.: pendente criada pelo vínculo)
    // não tem chave no D1 — não é falha, só não há o que espelhar ainda.
    if (CODIGO_FAIXA.test(String(rows[i]?.[25] || "").trim())) comCodigo.push(i + 1);
  }
  for (const l of comCodigo) {
    exigir(await deps.mirrorMusicaRowParaD1(l), `Falha ao espelhar Musicas linha ${l} no D1.`);
  }
  return { linhas };
}

async function passoTracklist(ctx: ContextoLancamento, p: Passo, deps: DepsEscrita) {
  const album = resultadoDe(ctx, "album");
  const linha = Number(album.linhaAlbuns);
  // Campanha do fluxo antigo: o álbum ficou com outro tópico (não o reservado).
  const topico = String(album.albumTopicId || ctx.c.albumTopicId);
  // Confere que a linha é mesmo deste álbum antes de gravar (erro real de
  // 23/11: tracklist gravada na linha do álbum vizinho).
  const conf = await deps.readFresh("principal", "Albuns", `B${linha}:M${linha}`);
  exigir(
    String(conf?.[0]?.[0] || "").trim() === topico,
    `Albuns linha ${linha} não é do álbum ${topico} — tracklist NÃO gravada.`,
  );
  // Já existe tracklist (ex.: reordenada pelo jogador depois): não sobrescreve.
  if (p.procurarAntes && String(conf?.[0]?.[11] || "").trim()) return { linhaAlbuns: linha, mantida: true };
  const { construirTracklistEntries } = await import("../gestaoController");
  const tracklist = construirTracklistEntries(ctx.c.faixas.map(comoPayload), ctx.c.artista);
  exigir(
    await deps.updateValues("principal", "Albuns", `M${linha}`, [[JSON.stringify(tracklist)]]),
    "Falha ao gravar a tracklist em Albuns!M.",
  );
  return { linhaAlbuns: linha, faixas: tracklist.length };
}

async function passoExtra(ctx: ContextoLancamento, p: Passo, deps: DepsEscrita) {
  const codigoUnico = String(resultadoDe(ctx, "album").codigoUnicoAlbum);
  // Já gravado (talvez editado depois pelo jogador): não sobrescreve.
  if (p.procurarAntes && (await existeExtraDoAlbum(deps, codigoUnico))) return { codigoUnico, mantido: true };
  const e = JSON.parse(ctx.c.extraMaterialJson || "{}") as {
    shopAtivo?: boolean;
    shop?: unknown[];
    infoAtivo?: boolean;
    info?: string;
    visualAtivo?: boolean;
    arte?: unknown[];
  };
  exigir(
    await deps.salvarExtra({
      codigoUnico,
      tipo: "album",
      shop: e.shopAtivo ? e.shop || [] : [],
      info: e.infoAtivo ? e.info || "" : "",
      arte: e.visualAtivo ? e.arte || [] : [],
    }),
    "Falha ao salvar o material extra do álbum.",
  );
  return { codigoUnico };
}

async function passoBonus(ctx: ContextoLancamento, p: Passo, deps: DepsEscrita) {
  const codigo = String(resultadoDe(ctx, "album").codigoUnicoAlbum);
  const valor = Number(p.resultado?.valor ?? 0);
  const { normalizeComparison: norm } = await import("../../services/googleSheetsService");
  const rows = await deps.readFresh("edicaoCharts", "EDIÇÃO CHARTS ÁLBUMS", "A1:T20000");
  let col = (rows[0] || []).findIndex((h) => norm(h) === "pre save" || norm(h) === "presave" || norm(h) === "pre-save");
  if (col < 0) col = 18;
  let linha = -1;
  for (let i = 1; i < rows.length; i++) if (norm(rows[i]?.[17]) === norm(codigo)) linha = i + 1;
  exigir(linha > 0, `Álbum ${codigo} não encontrado em EDIÇÃO CHARTS ÁLBUMS (bônus não gravado).`);
  const atual = String(rows[linha - 1]?.[col] ?? "").trim();
  // Bônus já gravado (talvez corrigido à mão): não sobrescreve.
  if (p.procurarAntes && atual) return { valor: Number(atual.replace(/\D/g, "")) || atual, linha, mantido: true };
  const letra = String.fromCharCode(65 + col);
  exigir(
    await deps.updateValues("edicaoCharts", "EDIÇÃO CHARTS ÁLBUMS", `${letra}${linha}`, [[String(Math.round(valor))]]),
    "Falha ao gravar o bônus PRE-SAVE.",
  );
  return { valor, linha };
}

async function passoFechar(ctx: ContextoLancamento, deps: DepsEscrita) {
  const codigo = String(resultadoDe(ctx, "album").codigoUnicoAlbum);
  const linha = ctx.c._rowIndex;
  const conf = await deps.readFresh("principal", "PreSave_Album", `A${linha}:A${linha}`);
  exigir(
    String(conf?.[0]?.[0] || "").trim() === ctx.c.id,
    `PreSave_Album linha ${linha} não é da campanha ${ctx.c.id} — código NÃO gravado.`,
  );
  exigir(
    await deps.updateValues("principal", "PreSave_Album", `Q${linha}`, [[codigo]]),
    "Falha ao gravar o Código único do álbum na campanha.",
  );
  return { codigoUnicoAlbum: codigo };
}

export async function executarPasso(
  ctx: ContextoLancamento,
  p: Passo,
  deps: DepsEscrita = depsReais(),
): Promise<Record<string, unknown>> {
  const faixa = p.passo.match(/^faixa:(\d+):(musicas|charts|codigo|registro)$/);
  if (faixa) {
    const num = Number(faixa[1]);
    if (faixa[2] === "musicas") return passoFaixaMusicas(ctx, num, p, deps);
    if (faixa[2] === "charts") return passoFaixaCharts(ctx, num, p, deps);
    if (faixa[2] === "codigo") return passoFaixaCodigo(ctx, num, p, deps);
    return passoFaixaRegistro(ctx, num, p, deps);
  }
  const vinculo = p.passo.match(/^vinculo:(\d+)$/);
  if (vinculo) return passoVinculo(ctx, Number(vinculo[1]), deps);
  switch (p.passo) {
    case "album":
      return passoAlbum(ctx, p, deps);
    case "tracklist":
      return passoTracklist(ctx, p, deps);
    case "extra":
      return passoExtra(ctx, p, deps);
    case "bonus":
      return passoBonus(ctx, p, deps);
    case "fechar":
      return passoFechar(ctx, deps);
    default:
      throw new Error(`Passo desconhecido: ${p.passo}`);
  }
}
