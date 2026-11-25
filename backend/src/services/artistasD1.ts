// Espelho D1 da aba ARTISTAS da planilha: schema, mapeamento linha -> Artista,
// leitura em cache, importação única (com complemento da INFOS ACTS),
// reconciliação do cron, atualização pelo admin e gravação do perfil.
import type { D1DatabaseLike, D1PreparedStatement } from "./catalogoDbService";
import { semAcentoMaiusculo } from "./chartsD1/artistas";
import { googleSheetsService } from "./googleSheetsService";

export const ARTISTAS_SCHEMA: string[] = [
  `CREATE TABLE IF NOT EXISTS artistas (
    id_unico TEXT PRIMARY KEY,
    nome TEXT NOT NULL,
    nome_chave TEXT NOT NULL,
    id_usuario TEXT,
    gravadora TEXT,
    foto_url TEXT,
    capa_perfil_url TEXT,
    capa_perfil_mobile_url TEXT,
    biografia TEXT,
    genero_principal TEXT,
    pais TEXT,
    pais_definido_em TEXT,
    ano_inicio TEXT,
    sexo TEXT,
    artista_base TEXT,
    linha_planilha INTEGER,
    atualizado_em TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_artistas_nome_chave ON artistas (nome_chave)`,
];

export interface Artista {
  idUnico: string;
  nome: string;
  idUsuario: string | null;
  gravadora: string | null;
  fotoUrl: string | null;
  capaPerfilUrl: string | null;
  capaPerfilMobileUrl: string | null;
  biografia: string | null;
  generoPrincipal: string | null;
  pais: string | null;
  paisDefinidoEm: string | null;
  anoInicio: string | null;
  sexo: string | null;
  artistaBase: string | null;
  linhaPlanilha: number | null;
}

/** Garante o schema (idempotente). */
export async function garantirSchemaArtistas(db: D1DatabaseLike): Promise<void> {
  for (const sql of ARTISTAS_SCHEMA) await db.prepare(sql).run();
}

/**
 * Converte uma linha da aba ARTISTAS em Artista, casando colunas pelo nome
 * exato normalizado (sem acento/caixa) — há "Foto"/"FOTO" e "GÊNERO"/"GÊNERO PRINCIPAL".
 */
export function registroDaLinha(cabecalho: string[], linha: string[], linhaPlanilha: number): Artista | null {
  const indice = new Map<string, number>();
  cabecalho.forEach((c, i) => {
    const k = semAcentoMaiusculo(String(c ?? ""));
    if (k && !indice.has(k)) indice.set(k, i);
  });
  // Primeiro nome de coluna que existir e tiver valor
  const col = (...nomes: string[]): string | null => {
    for (const n of nomes) {
      const i = indice.get(semAcentoMaiusculo(n));
      if (i === undefined) continue;
      const v = String(linha[i] ?? "").trim();
      if (v) return v;
    }
    return null;
  };

  // Casa o cabeçalho BRUTO (com caixa): "Foto" e "FOTO" normalizam igual
  const colBruta = (nomeExato: string): string | null => {
    const i = cabecalho.findIndex((c) => String(c ?? "").trim() === nomeExato);
    if (i < 0) return null;
    return String(linha[i] ?? "").trim() || null;
  };

  const nome = col("Nome");
  if (!nome) return null;
  const idUsuario = col("ID Usuário");
  const idUnico = col("ID_unico") ?? `${nome}${idUsuario ?? ""}`;
  return {
    idUnico,
    nome,
    idUsuario,
    gravadora: col("Gravadora"),
    fotoUrl: colBruta("FOTO") ?? colBruta("Foto"),
    capaPerfilUrl: col("CAPA PERFIL"),
    capaPerfilMobileUrl: col("CAPA PERFIL MOBILE"),
    biografia: col("BIOGRAFIA"),
    generoPrincipal: col("GÊNERO PRINCIPAL"),
    pais: col("PAÍS"),
    paisDefinidoEm: null,
    anoInicio: col("ANO EM QUE INICIOU A CARREIRA"),
    sexo: col("GÊNERO"),
    artistaBase: col("ARTISTA BASE"),
    linhaPlanilha,
  };
}

interface LinhaD1 {
  id_unico: string;
  nome: string;
  nome_chave: string;
  id_usuario: string | null;
  gravadora: string | null;
  foto_url: string | null;
  capa_perfil_url: string | null;
  capa_perfil_mobile_url: string | null;
  biografia: string | null;
  genero_principal: string | null;
  pais: string | null;
  pais_definido_em: string | null;
  ano_inicio: string | null;
  sexo: string | null;
  artista_base: string | null;
  linha_planilha: number | null;
}

function artistaDaLinhaD1(r: LinhaD1): Artista {
  return {
    idUnico: r.id_unico,
    nome: r.nome,
    idUsuario: r.id_usuario,
    gravadora: r.gravadora,
    fotoUrl: r.foto_url,
    capaPerfilUrl: r.capa_perfil_url,
    capaPerfilMobileUrl: r.capa_perfil_mobile_url,
    biografia: r.biografia,
    generoPrincipal: r.genero_principal,
    pais: r.pais,
    paisDefinidoEm: r.pais_definido_em,
    anoInicio: r.ano_inicio,
    sexo: r.sexo,
    artistaBase: r.artista_base,
    linhaPlanilha: r.linha_planilha,
  };
}

const TTL_MS = 5 * 60 * 1000;
let cache: { db: D1DatabaseLike; em: number; promessa: Promise<Map<string, Artista>> } | null = null;

export function limparCacheArtistas(): void {
  cache = null;
}

async function lerArtistas(db: D1DatabaseLike): Promise<Map<string, Artista>> {
  const mapa = new Map<string, Artista>();
  try {
    await garantirSchemaArtistas(db);
    const { results } = await db.prepare("SELECT * FROM artistas ORDER BY linha_planilha").all<LinhaD1>();
    for (const r of results) {
      // Em colisão de nome_chave, vale a primeira linha da planilha
      if (!mapa.has(r.nome_chave)) mapa.set(r.nome_chave, artistaDaLinhaD1(r));
    }
  } catch (e) {
    if (/no such table/i.test(String((e as Error)?.message ?? e))) return mapa;
    throw e;
  }
  return mapa;
}

/** Todos os artistas por nome_chave; cache de módulo de 5 min (promessa compartilhada). */
export function carregarArtistas(db: D1DatabaseLike): Promise<Map<string, Artista>> {
  const agora = Date.now();
  if (cache && cache.db === db && agora - cache.em < TTL_MS) return cache.promessa;
  const promessa = lerArtistas(db);
  const entrada = { db, em: agora, promessa };
  cache = entrada;
  // Rejeição não fica em cache
  promessa.catch(() => {
    if (cache === entrada) cache = null;
  });
  return promessa;
}

export async function buscarArtista(db: D1DatabaseLike, nome: string): Promise<Artista | null> {
  const mapa = await carregarArtistas(db);
  return mapa.get(semAcentoMaiusculo(nome)) ?? null;
}

// ---------------------------------------------------------------------------
// Escrita: importação, reconciliação, atualização pelo admin e perfil
// ---------------------------------------------------------------------------

const ABA_ARTISTAS = "ARTISTAS";
const ABA_INFOS_ACTS = "INFOS ACTS";
const MARCA_IMPORTADO = "artistas_d1_importado";
const LOTE = 50;

/** Célula a escrever na aba ARTISTAS (coluna pelo nome do cabeçalho). */
export interface CelulaArtistas {
  linha: number;
  coluna: string;
  valor: string;
}

/** Data (AAAA-MM-DD, UTC) usada em pais_definido_em. */
function dataDe(agora: Date): string {
  return agora.toISOString().slice(0, 10);
}

async function garantirConfig(db: D1DatabaseLike): Promise<void> {
  await db.prepare("CREATE TABLE IF NOT EXISTS chart_config (chave TEXT PRIMARY KEY, valor TEXT)").run();
}

/** A importação única já rodou? (marca em chart_config; libera reconciliação e desliga os fallbacks antigos) */
export async function importacaoFeita(db: D1DatabaseLike): Promise<boolean> {
  await garantirConfig(db);
  const { results } = await db
    .prepare("SELECT valor FROM chart_config WHERE chave = ?")
    .bind(MARCA_IMPORTADO)
    .all<{ valor: string }>();
  return results[0]?.valor === "1";
}

/** Linhas da aba (com cabeçalho) -> Artistas; ID_unico repetido: vale a primeira linha. */
function artistasDasLinhas(linhas: string[][]): Artista[] {
  const cabecalho = linhas[0] ?? [];
  const vistos = new Set<string>();
  const lista: Artista[] = [];
  for (let i = 1; i < linhas.length; i++) {
    const a = registroDaLinha(cabecalho, linhas[i] ?? [], i + 1);
    if (!a || vistos.has(a.idUnico)) continue;
    vistos.add(a.idUnico);
    lista.push(a);
  }
  return lista;
}

const SQL_UPSERT = `INSERT OR REPLACE INTO artistas (
  id_unico, nome, nome_chave, id_usuario, gravadora, foto_url, capa_perfil_url,
  capa_perfil_mobile_url, biografia, genero_principal, pais, pais_definido_em,
  ano_inicio, sexo, artista_base, linha_planilha, atualizado_em
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

function upsert(db: D1DatabaseLike, a: Artista, atualizadoEm: string): D1PreparedStatement {
  return db
    .prepare(SQL_UPSERT)
    .bind(
      a.idUnico, a.nome, semAcentoMaiusculo(a.nome), a.idUsuario, a.gravadora, a.fotoUrl, a.capaPerfilUrl,
      a.capaPerfilMobileUrl, a.biografia, a.generoPrincipal, a.pais, a.paisDefinidoEm,
      a.anoInicio, a.sexo, a.artistaBase, a.linhaPlanilha, atualizadoEm,
    );
}

async function rodarEmLotes(db: D1DatabaseLike, stmts: D1PreparedStatement[]): Promise<void> {
  for (let i = 0; i < stmts.length; i += LOTE) await db.batch(stmts.slice(i, i + LOTE));
}

async function lerTodosPorId(db: D1DatabaseLike): Promise<Map<string, Artista>> {
  const { results } = await db.prepare("SELECT * FROM artistas").all<LinhaD1>();
  return new Map(results.map((r) => [r.id_unico, artistaDaLinhaD1(r)]));
}

/** Fontes reais da importação (a INFOS ACTS só é lida aqui, na estreia). */
export function fontesDaPlanilha(): { artistas(): Promise<string[][]>; infosActs(): Promise<string[][]> } {
  return {
    artistas: () => googleSheetsService.usuarios.readValues(ABA_ARTISTAS),
    infosActs: () => googleSheetsService.registrosCharts.readValues(ABA_INFOS_ACTS),
  };
}

/**
 * Importação única ARTISTAS -> D1. Onde país/foto/biografia/capa estiverem
 * vazios na ARTISTAS e a INFOS ACTS tiver (casando o nome sem acento/caixa),
 * usa o da INFOS ACTS e devolve as células para completar a ARTISTAS.
 * INFOS ACTS: A nome | C foto exibida | E biografia | G upload do dono |
 * N nacionalidade | R capa | S capa mobile. Foto: C, senão G (mesma
 * prioridade de exibição do getArtistInfoController). Marca a importação em
 * chart_config, liberando a reconciliação.
 */
export async function importarArtistas(
  db: D1DatabaseLike,
  fontes: { artistas(): Promise<string[][]>; infosActs(): Promise<string[][]> } = fontesDaPlanilha(),
  agora: Date = new Date(),
): Promise<{ total: number; complementados: number; celulas: CelulaArtistas[] }> {
  await garantirSchemaArtistas(db);
  await garantirConfig(db);
  const [linhas, infos] = await Promise.all([fontes.artistas(), fontes.infosActs()]);
  const artistas = artistasDasLinhas(linhas);

  // INFOS ACTS por nome normalizado; nome repetido: vale a primeira linha
  const porNome = new Map<string, string[]>();
  for (const l of infos.slice(1)) {
    const k = semAcentoMaiusculo(String(l?.[0] ?? ""));
    if (k && !porNome.has(k)) porNome.set(k, l);
  }
  const cel = (l: string[], i: number): string | null => String(l[i] ?? "").trim() || null;

  const hoje = dataDe(agora);
  const celulas: CelulaArtistas[] = [];
  let complementados = 0;
  for (const a of artistas) {
    const info = porNome.get(semAcentoMaiusculo(a.nome));
    if (info && a.linhaPlanilha !== null) {
      const linha = a.linhaPlanilha;
      const antes = celulas.length;
      const completar = (atual: string | null, valor: string | null, colunas: string[]): string | null => {
        if (atual || !valor) return atual;
        for (const coluna of colunas) celulas.push({ linha, coluna, valor });
        return valor;
      };
      a.pais = completar(a.pais, cel(info, 13), ["PAÍS"]);
      a.fotoUrl = completar(a.fotoUrl, cel(info, 2) ?? cel(info, 6), ["FOTO", "Foto"]);
      a.biografia = completar(a.biografia, cel(info, 4), ["BIOGRAFIA"]);
      a.capaPerfilUrl = completar(a.capaPerfilUrl, cel(info, 17), ["CAPA PERFIL"]);
      a.capaPerfilMobileUrl = completar(a.capaPerfilMobileUrl, cel(info, 18), ["CAPA PERFIL MOBILE"]);
      if (celulas.length > antes) complementados++;
    }
    a.paisDefinidoEm = a.pais ? hoje : null;
  }

  const atualizadoEm = agora.toISOString();
  await rodarEmLotes(db, artistas.map((a) => upsert(db, a, atualizadoEm)));
  await db
    .prepare("INSERT OR REPLACE INTO chart_config (chave, valor) VALUES (?, '1')")
    .bind(MARCA_IMPORTADO)
    .run();
  limparCacheArtistas();
  return { total: artistas.length, complementados, celulas };
}

/** Campos que a planilha continua mandando depois da importação (o jogador não edita). */
const CAMPOS_DA_PLANILHA = ["nome", "idUsuario", "gravadora", "anoInicio", "sexo", "artistaBase", "linhaPlanilha"] as const;

/**
 * Reconciliação do cron (só depois da importação): cria quem está na
 * planilha e não no D1 e atualiza APENAS nome, dono, gravadora, ano, sexo,
 * artista base e linha — foto/bio/capa/gênero/país são do D1. Grava só o
 * que mudou; devolve quantos artistas foram criados ou atualizados.
 */
export async function reconciliarArtistas(db: D1DatabaseLike, linhasArtistas: string[][], agora: Date = new Date()): Promise<number> {
  if (!(await importacaoFeita(db))) return 0;
  await garantirSchemaArtistas(db);
  const existentes = await lerTodosPorId(db);
  const atualizadoEm = agora.toISOString();
  const stmts: D1PreparedStatement[] = [];
  for (const a of artistasDasLinhas(linhasArtistas)) {
    const atual = existentes.get(a.idUnico);
    if (!atual) {
      a.paisDefinidoEm = a.pais ? dataDe(agora) : null;
      stmts.push(upsert(db, a, atualizadoEm));
      continue;
    }
    if (CAMPOS_DA_PLANILHA.every((c) => atual[c] === a[c])) continue;
    stmts.push(
      db
        .prepare(
          `UPDATE artistas SET nome = ?, nome_chave = ?, id_usuario = ?, gravadora = ?, ano_inicio = ?,
            sexo = ?, artista_base = ?, linha_planilha = ?, atualizado_em = ? WHERE id_unico = ?`,
        )
        .bind(a.nome, semAcentoMaiusculo(a.nome), a.idUsuario, a.gravadora, a.anoInicio, a.sexo, a.artistaBase, a.linhaPlanilha, atualizadoEm, a.idUnico),
    );
  }
  await rodarEmLotes(db, stmts);
  if (stmts.length) limparCacheArtistas();
  return stmts.length;
}

/** Rótulos (para o admin) dos campos comparados em atualizarDaPlanilha. */
const ROTULOS: [keyof Artista, string][] = [
  ["nome", "Nome"],
  ["idUsuario", "Dono"],
  ["gravadora", "Gravadora"],
  ["fotoUrl", "Foto"],
  ["capaPerfilUrl", "Capa"],
  ["capaPerfilMobileUrl", "Capa mobile"],
  ["biografia", "Biografia"],
  ["generoPrincipal", "Estilo"],
  ["pais", "País"],
  ["anoInicio", "Ano de início"],
  ["sexo", "Sexo"],
  ["artistaBase", "Artista base"],
];

/**
 * Botão do admin "Atualizar a partir da planilha": sobrescreve TODOS os
 * campos do espelho com a linha da ARTISTAS (de um artista, por ID_unico,
 * ou de todos). País vazio na planilha destrava a nacionalidade. Devolve,
 * por artista, os rótulos dos campos que mudaram.
 */
export async function atualizarDaPlanilha(
  db: D1DatabaseLike,
  linhasArtistas: string[][],
  idUnico?: string,
  agora: Date = new Date(),
): Promise<{ id: string; campos: string[] }[]> {
  await garantirSchemaArtistas(db);
  const existentes = await lerTodosPorId(db);
  const atualizadoEm = agora.toISOString();
  const alvo = artistasDasLinhas(linhasArtistas).filter((a) => idUnico === undefined || a.idUnico === idUnico);
  const stmts: D1PreparedStatement[] = [];
  const resultado: { id: string; campos: string[] }[] = [];
  for (const a of alvo) {
    const atual = existentes.get(a.idUnico);
    const campos = ROTULOS.filter(([k]) => (atual ? atual[k] : null) !== a[k]).map(([, r]) => r);
    // Mesmo país: mantém a data em que foi definido; país novo: hoje; vazio: null
    a.paisDefinidoEm = !a.pais ? null : atual && atual.pais === a.pais ? atual.paisDefinidoEm ?? dataDe(agora) : dataDe(agora);
    if (campos.length || !atual || atual.linhaPlanilha !== a.linhaPlanilha) stmts.push(upsert(db, a, atualizadoEm));
    resultado.push({ id: a.idUnico, campos });
  }
  await rodarEmLotes(db, stmts);
  if (stmts.length) limparCacheArtistas();
  return resultado;
}

export type CamposEditaveis = {
  fotoUrl?: string;
  capaPerfilUrl?: string;
  capaPerfilMobileUrl?: string;
  biografia?: string;
  generoPrincipal?: string;
  pais?: string;
};

export const ERRO_PAIS_DEFINIDO = "A nacionalidade já foi definida. Peça à administração para alterar.";

/** Campo editável -> coluna do D1 e coluna(s) da aba ARTISTAS (foto vai nas duas). */
const COLUNAS_EDITAVEIS: [keyof CamposEditaveis, string, string[]][] = [
  ["fotoUrl", "foto_url", ["FOTO", "Foto"]],
  ["capaPerfilUrl", "capa_perfil_url", ["CAPA PERFIL"]],
  ["capaPerfilMobileUrl", "capa_perfil_mobile_url", ["CAPA PERFIL MOBILE"]],
  ["biografia", "biografia", ["BIOGRAFIA"]],
  ["generoPrincipal", "genero_principal", ["GÊNERO PRINCIPAL"]],
  ["pais", "pais", ["PAÍS"]],
];

/** País na grafia de pais_peso (comparação sem acento/caixa), ou null se não existir. */
async function paisValido(db: D1DatabaseLike, pais: string): Promise<string | null> {
  try {
    const { results } = await db.prepare("SELECT DISTINCT pais FROM pais_peso").all<{ pais: string }>();
    const k = semAcentoMaiusculo(pais);
    return results.find((r) => semAcentoMaiusculo(r.pais) === k)?.pais ?? null;
  } catch (e) {
    if (/no such table/i.test(String((e as Error)?.message ?? e))) return null;
    throw e;
  }
}

/**
 * Edição do perfil pelo dono/admin (a checagem de dono é da rota): grava
 * primeiro no D1, limpa os caches de artistas e de charts (a nacionalidade
 * muda o recorte por país) e manda a cópia para a ARTISTAS via `copiar`
 * (falha só é logada, não desfaz a edição). País já preenchido só o admin troca.
 */
export async function gravarPerfil(
  db: D1DatabaseLike,
  idUnico: string,
  campos: CamposEditaveis,
  ehAdmin: boolean,
  copiar: (celulas: { coluna: string; valor: string }[], linha: number) => Promise<void>,
  agora: Date = new Date(),
): Promise<{ ok: true; artista: Artista } | { ok: false; status: 400 | 404 | 409; erro: string }> {
  await garantirSchemaArtistas(db);
  const lerAtual = async () => {
    const { results } = await db.prepare("SELECT * FROM artistas WHERE id_unico = ?").bind(idUnico).all<LinhaD1>();
    return results[0] ? artistaDaLinhaD1(results[0]) : null;
  };
  const atual = await lerAtual();
  if (!atual) return { ok: false, status: 404, erro: "Artista não encontrado." };

  const sets: string[] = [];
  const valores: (string | null)[] = [];
  const celulas: { coluna: string; valor: string }[] = [];
  let semMudanca = false;
  for (const [campo, colunaD1, colunasPlanilha] of COLUNAS_EDITAVEIS) {
    const bruto = campos[campo];
    if (bruto === undefined) continue;
    let valor: string | null = String(bruto).trim() || null;
    if (campo === "pais") {
      if (atual.pais && !ehAdmin) {
        // Mesmo país já salvo (sem acento/caixa): nada a mudar nesse campo, sem 409
        if (valor && semAcentoMaiusculo(valor) === semAcentoMaiusculo(atual.pais)) {
          semMudanca = true;
          continue;
        }
        return { ok: false, status: 409, erro: ERRO_PAIS_DEFINIDO };
      }
      if (valor) {
        valor = await paisValido(db, valor);
        if (!valor) return { ok: false, status: 400, erro: "País inválido." };
      }
      sets.push("pais_definido_em = ?");
      valores.push(valor ? dataDe(agora) : null);
    }
    sets.push(`${colunaD1} = ?`);
    valores.push(valor);
    for (const coluna of colunasPlanilha) celulas.push({ coluna, valor: valor ?? "" });
  }
  if (!sets.length) {
    if (semMudanca) return { ok: true, artista: atual };
    return { ok: false, status: 400, erro: "Nada para salvar." };
  }

  await db
    .prepare(`UPDATE artistas SET ${sets.join(", ")}, atualizado_em = ? WHERE id_unico = ?`)
    .bind(...valores, agora.toISOString(), idUnico)
    .run();
  limparCacheArtistas();
  try {
    // Import dinâmico: chartsController vai ler deste módulo (evita ciclo)
    const { limparCacheCharts } = await import("../controllers/chartsController");
    limparCacheCharts();
  } catch (e) {
    console.warn("[gravarPerfil] Falha ao limpar cache de charts:", e);
  }

  if (atual.linhaPlanilha !== null) {
    try {
      await copiar(celulas, atual.linhaPlanilha);
    } catch (e) {
      console.warn(`[gravarPerfil] Cópia para a ARTISTAS falhou (${idUnico}):`, e);
    }
  }
  const artista = (await lerAtual()) as Artista;
  return { ok: true, artista };
}

function letraDaColuna(n: number): string {
  let s = "";
  for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/**
 * Escreve células na aba ARTISTAS casando a coluna pelo cabeçalho exato
 * (há "Foto" e "FOTO"), senão sem acento/caixa. Coluna inexistente (ex.:
 * "CAPA PERFIL MOBILE") ganha o cabeçalho no fim da linha 1, como no
 * fortunaChartsController. Uma chamada batch; lança se o Google recusar.
 */
export async function copiarCelulasArtistas(celulas: CelulaArtistas[]): Promise<void> {
  if (!celulas.length) return;
  // Cabeçalho lido sem cache: coluna recém-criada por outra gravação não pode ser sobrescrita
  const cabecalho = ((await googleSheetsService.usuarios.readValuesFresh(ABA_ARTISTAS, "1:1"))[0] ?? []).map((c) =>
    String(c ?? "").trim(),
  );
  const indiceDe = async (coluna: string): Promise<number> => {
    let i = cabecalho.indexOf(coluna);
    if (i < 0) i = cabecalho.findIndex((c) => semAcentoMaiusculo(c) === semAcentoMaiusculo(coluna));
    if (i >= 0) return i;
    i = cabecalho.length;
    const ok = await googleSheetsService.usuarios.updateValues(ABA_ARTISTAS, `${letraDaColuna(i + 1)}1`, [[coluna]]);
    if (!ok) throw new Error(`Não foi possível criar a coluna "${coluna}" na ARTISTAS.`);
    cabecalho.push(coluna);
    return i;
  };
  const entradas: { sheetName: string; range: string; values: string[][] }[] = [];
  for (const c of celulas) {
    const i = await indiceDe(c.coluna);
    entradas.push({ sheetName: ABA_ARTISTAS, range: `${letraDaColuna(i + 1)}${c.linha}`, values: [[c.valor]] });
  }
  const ok = await googleSheetsService.updateValuesBatch("usuarios", entradas);
  if (!ok) throw new Error("O Google recusou a gravação na ARTISTAS.");
}

/** `copiar` padrão do gravarPerfil: escreve as células na linha do artista. */
export function copiarParaArtistas(celulas: { coluna: string; valor: string }[], linha: number): Promise<void> {
  return copiarCelulasArtistas(celulas.map((c) => ({ ...c, linha })));
}

/**
 * Artista recém-criado pelo app (criarArtistaController): nasce no espelho
 * na hora, sem esperar a reconciliação. Nunca sobrescreve uma linha que já
 * exista (mesmo ID_unico).
 */
export async function registrarArtistaNovo(
  db: D1DatabaseLike,
  dados: { idUnico: string; nome: string; idUsuario: string; gravadora: string; fotoUrl: string | null; linhaPlanilha: number | null },
  agora: Date = new Date(),
): Promise<void> {
  await garantirSchemaArtistas(db);
  await db
    .prepare(
      `INSERT INTO artistas (id_unico, nome, nome_chave, id_usuario, gravadora, foto_url, linha_planilha, atualizado_em)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id_unico) DO NOTHING`,
    )
    .bind(dados.idUnico, dados.nome, semAcentoMaiusculo(dados.nome), dados.idUsuario, dados.gravadora, dados.fotoUrl, dados.linhaPlanilha, agora.toISOString())
    .run();
  limparCacheArtistas();
}

/**
 * Lista fechada de estilos (gênero principal): distintos do espelho ∪
 * distintos de musicas.genero, em caixa alta, sem repetição, ordenados.
 */
export async function listarGeneros(db: D1DatabaseLike): Promise<string[]> {
  const ler = async (sql: string): Promise<string[]> => {
    try {
      const { results } = await db.prepare(sql).all<{ g: string | null }>();
      return results.map((r) => String(r.g ?? ""));
    } catch (e) {
      if (/no such table/i.test(String((e as Error)?.message ?? e))) return [];
      throw e;
    }
  };
  await garantirSchemaArtistas(db);
  const todos = [
    ...(await ler("SELECT DISTINCT genero_principal AS g FROM artistas")),
    ...(await ler("SELECT DISTINCT genero AS g FROM musicas")),
  ];
  const unicos = new Set(todos.map((g) => g.trim().toUpperCase()).filter(Boolean));
  return [...unicos].sort((a, b) => a.localeCompare(b, "pt-BR"));
}
