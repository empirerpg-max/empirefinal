// Validação "nenhum dado perdido" da migração de vídeos pro D1 — compara a
// planilha (lida AO VIVO) com o que está no D1, LINHA A LINHA e CÉLULA A
// CÉLULA, nas duas tabelas (videos e comentarios_videos). Funções puras
// (sem Sheets/D1 dentro) — usadas tanto pelo endpoint admin
// (adminValidarVideosD1Controller.ts) quanto pelo script local que roda a
// migração inteira contra o CSV exportado num SQLite de verdade
// (scripts/validar-migracao-videos-local.ts).
//
// Só aprova (`ok: true`) quando: mesma quantidade de linhas com dado dos
// dois lados, nenhuma linha faltando no D1, nenhuma sobrando no D1 e
// nenhuma célula diferente (comparação exata de string, sem trim).
import { VIDEOS_COLUNAS, chaveDoVideo, colunasExtra, linhaEmBranco, videoD1ParaCelulas } from "./videosDbService";
import { COMENTARIOS_VIDEOS_COLUNAS, comentarioVideoD1ParaCelulas } from "./comentariosVideosDbService";

const MAX_DETALHES = 200;

export interface Divergencia {
  chave: string;
  coluna: string;
  planilha: string;
  d1: string;
}

export interface RelatorioTabela {
  ok: boolean;
  linhasComDadoPlanilha: number;
  linhasD1: number;
  celulasConferidas: number;
  faltandoNoD1: string[];
  sobrandoNoD1: string[];
  totalDivergencias: number;
  divergencias: Divergencia[];
  /** Por coluna: [células preenchidas na planilha, no D1, soma de caracteres planilha, D1] */
  resumoPorColuna: Record<string, [number, number, number, number]>;
}

function letra(i: number): string {
  let s = "";
  let n = i + 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function compararGenerico(params: {
  planilha: Map<string, { celulas: string[]; extras: string | null }>;
  d1: Map<string, { celulas: string[]; extras: string | null }>;
  nomesColunas: string[];
}): RelatorioTabela {
  const { planilha, d1, nomesColunas } = params;
  const rel: RelatorioTabela = {
    ok: false,
    linhasComDadoPlanilha: planilha.size,
    linhasD1: d1.size,
    celulasConferidas: 0,
    faltandoNoD1: [],
    sobrandoNoD1: [],
    totalDivergencias: 0,
    divergencias: [],
    resumoPorColuna: {},
  };
  const nomes = [...nomesColunas, "colunas extras"];
  for (const n of nomes) rel.resumoPorColuna[n] = [0, 0, 0, 0];

  const somar = (lado: 0 | 1, celulas: string[], extras: string | null) => {
    [...celulas, extras ?? ""].forEach((v, i) => {
      if (v !== "") {
        rel.resumoPorColuna[nomes[i]][lado] += 1;
        rel.resumoPorColuna[nomes[i]][lado + 2] += v.length;
      }
    });
  };

  for (const [chave, p] of planilha) {
    somar(0, p.celulas, p.extras);
    const d = d1.get(chave);
    if (!d) {
      rel.faltandoNoD1.push(chave);
      continue;
    }
    const pares: [string, string, string][] = p.celulas.map((v, i) => [nomes[i], v, d.celulas[i] ?? ""]);
    pares.push(["colunas extras", p.extras ?? "", d.extras ?? ""]);
    for (const [coluna, vp, vd] of pares) {
      rel.celulasConferidas++;
      if (vp !== vd) {
        rel.totalDivergencias++;
        if (rel.divergencias.length < MAX_DETALHES) rel.divergencias.push({ chave, coluna, planilha: vp, d1: vd });
      }
    }
  }
  for (const [chave, d] of d1) {
    somar(1, d.celulas, d.extras);
    if (!planilha.has(chave)) rel.sobrandoNoD1.push(chave);
  }
  rel.ok =
    rel.linhasComDadoPlanilha === rel.linhasD1 &&
    rel.faltandoNoD1.length === 0 &&
    rel.sobrandoNoD1.length === 0 &&
    rel.totalDivergencias === 0;
  return rel;
}

/** Vídeos: chave = message_thread_id (F). */
export function validarVideos(
  rowsPlanilha: string[][],
  linhasD1: Record<string, unknown>[],
): RelatorioTabela {
  const header = rowsPlanilha[0] || [];
  const planilha = new Map<string, { celulas: string[]; extras: string | null }>();
  for (let i = 1; i < rowsPlanilha.length; i++) {
    const row = rowsPlanilha[i];
    if (linhaEmBranco(row)) continue;
    const celulas = VIDEOS_COLUNAS.map((_, c) => String(row[c] ?? ""));
    // F repetida na planilha: a 2ª ocorrência entra com chave própria pra
    // aparecer como "faltando no D1" (nunca é escondida pela 1ª).
    let chave = `F=${chaveDoVideo(celulas[5], i + 1)}`;
    if (planilha.has(chave)) chave = `${chave} (linha ${i + 1}, repetida)`;
    planilha.set(chave, { celulas, extras: colunasExtra(header, row, VIDEOS_COLUNAS.length) });
  }
  const d1 = new Map<string, { celulas: string[]; extras: string | null }>();
  for (const r of linhasD1) {
    d1.set(`F=${String(r.id_topico ?? "")}`, videoD1ParaCelulas(r));
  }
  return compararGenerico({
    planilha,
    d1,
    nomesColunas: VIDEOS_COLUNAS.map((c, i) => `${letra(i)} ${c.header}`),
  });
}

/** Comentários: chave = número da linha na planilha (linha_planilha no D1). */
export function validarComentariosVideos(
  rowsPlanilha: string[][],
  linhasD1: Record<string, unknown>[],
): RelatorioTabela {
  const header = rowsPlanilha[0] || [];
  const planilha = new Map<string, { celulas: string[]; extras: string | null }>();
  for (let i = 1; i < rowsPlanilha.length; i++) {
    const row = rowsPlanilha[i];
    if (linhaEmBranco(row)) continue;
    planilha.set(`linha ${i + 1}`, {
      celulas: COMENTARIOS_VIDEOS_COLUNAS.map((_, c) => String(row[c] ?? "")),
      extras: colunasExtra(header, row, COMENTARIOS_VIDEOS_COLUNAS.length),
    });
  }
  const d1 = new Map<string, { celulas: string[]; extras: string | null }>();
  for (const r of linhasD1) d1.set(`linha ${r.linha_planilha}`, comentarioVideoD1ParaCelulas(r));
  return compararGenerico({
    planilha,
    d1,
    nomesColunas: COMENTARIOS_VIDEOS_COLUNAS.map((c, i) => `${letra(i)} ${c.header ?? "ID do comentário-pai"}`),
  });
}

/**
 * Informativo (não bloqueia nada): comentários cujo "ID do tópico" não
 * existe em "Music Videos" — migrados mesmo assim, listados aqui pra
 * decisão manual depois.
 */
export function listarComentariosOrfaos(
  rowsVideos: string[][],
  rowsComentarios: string[][],
): { linha: number; idTopico: string; jogador: string; inicio: string; data: string }[] {
  const ids = new Set<string>();
  for (let i = 1; i < rowsVideos.length; i++) {
    if (!linhaEmBranco(rowsVideos[i])) ids.add(String(rowsVideos[i][5] ?? ""));
  }
  const orfaos: { linha: number; idTopico: string; jogador: string; inicio: string; data: string }[] = [];
  for (let i = 1; i < rowsComentarios.length; i++) {
    const r = rowsComentarios[i];
    if (linhaEmBranco(r)) continue;
    const id = String(r[0] ?? "");
    if (!ids.has(id)) {
      orfaos.push({
        linha: i + 1,
        idTopico: id,
        jogador: String(r[2] ?? r[1] ?? ""),
        inicio: String(r[3] ?? "").slice(0, 60),
        data: String(r[4] ?? ""),
      });
    }
  }
  return orfaos;
}
