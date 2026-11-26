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
  // Fila de células a copiar para a aba ARTISTAS (edições do perfil e
  // complementos da importação). Uma linha por artista+coluna: o valor mais
  // novo substitui o anterior. Só sai daqui depois que o Google aceitar.
  `CREATE TABLE IF NOT EXISTS artistas_pendencias_planilha (
    id_unico TEXT NOT NULL,
    coluna TEXT NOT NULL,
    valor TEXT NOT NULL,
    criado_em TEXT NOT NULL,
    PRIMARY KEY (id_unico, coluna)
  )`,
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
  cacheFlagCharts = null;
  cacheInfoCharts = null;
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

/** Célula a escrever na aba ARTISTAS: artista (ID_unico) e coluna pelo nome do cabeçalho. */
export interface CelulaArtistas {
  idUnico: string;
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

/** Cabeçalho tem as colunas de identidade (Nome e ID_unico)? Sem elas não dá para casar linhas. */
function cabecalhoValido(cabecalho: string[]): boolean {
  const chaves = new Set(cabecalho.map((c) => semAcentoMaiusculo(String(c ?? ""))));
  return chaves.has(semAcentoMaiusculo("Nome")) && chaves.has(semAcentoMaiusculo("ID_unico"));
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

/**
 * Fontes reais da importação (a INFOS ACTS só é lida aqui, na estreia).
 * Leitura sem cache e sem fallback GViz (só a API v4): o resultado decide o
 * que vai para o D1 e para quais linhas a cópia volta.
 */
export function fontesDaPlanilha(): { artistas(): Promise<string[][]>; infosActs(): Promise<string[][]> } {
  return {
    artistas: () => googleSheetsService.usuarios.readValuesFresh(ABA_ARTISTAS),
    infosActs: () => googleSheetsService.registrosCharts.readValuesFresh(ABA_INFOS_ACTS),
  };
}

/** Cabeçalho normalizado como no EnvioD1.gs: minúsculo, sem acento, pontuação vira um espaço. */
function cabecalhoNormalizado(s: string): string {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Coluna de gênero da INFOS ACTS (mesma busca do lerArtistas_ do EnvioD1.gs); -1 se não houver. */
function colunaGeneroInfos(cabecalho: string[]): number {
  const normalizados = cabecalho.map(cabecalhoNormalizado);
  for (const nome of ["genero principal", "genero", "estilo", "genero musical"]) {
    const i = normalizados.indexOf(nome);
    if (i >= 0) return i;
  }
  return -1;
}

/**
 * Importação única ARTISTAS -> D1. Os jogadores VEEM hoje os valores da
 * INFOS ACTS (foto C, senão G; biografia E; capa R; capa mobile S;
 * nacionalidade N — via artista_info); as colunas da ARTISTAS são cópias
 * antigas. Por isso, casando o nome sem acento/caixa, o valor NÃO vazio da
 * INFOS ACTS VENCE o da ARTISTAS nesses campos, e as células que mudaram
 * voltam para a ARTISTAS (foto nas duas colunas, "FOTO" e "Foto"). O estilo
 * (coluna "Gênero"/"Estilo" da INFOS ACTS) só preenche GÊNERO PRINCIPAL
 * vazio. Recusa (lança, sem marcar) se a aba vier vazia ou sem as colunas
 * Nome/ID_unico. As células já entram na fila artistas_pendencias_planilha
 * (antes da marca). Marca a importação em chart_config, liberando a reconciliação.
 */
export async function importarArtistas(
  db: D1DatabaseLike,
  fontes: { artistas(): Promise<string[][]>; infosActs(): Promise<string[][]> } = fontesDaPlanilha(),
  agora: Date = new Date(),
): Promise<{ total: number; complementados: number; celulas: CelulaArtistas[] }> {
  await garantirSchemaArtistas(db);
  await garantirConfig(db);
  const [linhas, infos] = await Promise.all([fontes.artistas(), fontes.infosActs()]);
  if (!cabecalhoValido((linhas[0] ?? []).map((c) => String(c ?? "").trim()))) {
    throw new Error('Importação de artistas recusada: a aba ARTISTAS veio sem as colunas "Nome"/"ID_unico".');
  }
  const artistas = artistasDasLinhas(linhas);
  if (!artistas.length) throw new Error("Importação de artistas recusada: a aba ARTISTAS veio sem nenhum artista.");

  // INFOS ACTS por nome normalizado; nome repetido: vale a primeira linha
  const porNome = new Map<string, string[]>();
  for (const l of infos.slice(1)) {
    const k = semAcentoMaiusculo(String(l?.[0] ?? ""));
    if (k && !porNome.has(k)) porNome.set(k, l);
  }
  const iGenero = colunaGeneroInfos((infos[0] ?? []).map((c) => String(c ?? "")));
  const cel = (l: string[], i: number): string | null => (i < 0 ? null : String(l[i] ?? "").trim() || null);

  const hoje = dataDe(agora);
  const celulas: CelulaArtistas[] = [];
  let complementados = 0;
  for (const a of artistas) {
    const info = porNome.get(semAcentoMaiusculo(a.nome));
    if (info) {
      const antes = celulas.length;
      const idUnico = a.idUnico;
      // INFOS ACTS vence quando tem valor; a célula só volta se mudou
      const vencer = (atual: string | null, valor: string | null, colunas: string[]): string | null => {
        if (!valor || valor === atual) return atual;
        for (const coluna of colunas) celulas.push({ idUnico, coluna, valor });
        return valor;
      };
      a.pais = vencer(a.pais, cel(info, 13), ["PAÍS"]);
      a.fotoUrl = vencer(a.fotoUrl, cel(info, 2) ?? cel(info, 6), ["FOTO", "Foto"]);
      a.biografia = vencer(a.biografia, cel(info, 4), ["BIOGRAFIA"]);
      a.capaPerfilUrl = vencer(a.capaPerfilUrl, cel(info, 17), ["CAPA PERFIL"]);
      a.capaPerfilMobileUrl = vencer(a.capaPerfilMobileUrl, cel(info, 18), ["CAPA PERFIL MOBILE"]);
      // Estilo: só preenche o vazio
      if (!a.generoPrincipal) a.generoPrincipal = vencer(null, cel(info, iGenero), ["GÊNERO PRINCIPAL"]);
      if (celulas.length > antes) complementados++;
    }
    a.paisDefinidoEm = a.pais ? hoje : null;
  }

  // Espelho, fila de cópia e marca na mesma sequência de lotes, com a marca
  // por ÚLTIMO: se cair no meio, a importação roda de novo e nenhum valor
  // que veio da INFOS ACTS fica sem ir para a fila (quem chama só descarrega).
  const atualizadoEm = agora.toISOString();
  await rodarEmLotes(db, [
    ...artistas.map((a) => upsert(db, a, atualizadoEm)),
    ...celulas.map((c) => pendencia(db, c, atualizadoEm)),
    db.prepare("INSERT OR REPLACE INTO chart_config (chave, valor) VALUES (?, '1')").bind(MARCA_IMPORTADO),
  ]);
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
 * (falha só é logada, não desfaz a edição). País já preenchido só o admin
 * troca; estilo do jogador tem de estar na lista fechada (listarGeneros).
 */
export async function gravarPerfil(
  db: D1DatabaseLike,
  idUnico: string,
  campos: CamposEditaveis,
  ehAdmin: boolean,
  copiar: (celulas: { coluna: string; valor: string }[], idUnico: string) => Promise<void>,
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
    if (campo === "generoPrincipal" && !ehAdmin) {
      // Jogador: só estilos da lista fechada (grafia da lista); admin pode incluir novos
      const lista = await listarGeneros(db);
      valor = (valor && lista.find((g) => g === valor!.toUpperCase())) || null;
      if (!valor) return { ok: false, status: 400, erro: "Estilo inválido." };
    }
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

  try {
    await copiar(celulas, idUnico);
  } catch (e) {
    console.warn(`[gravarPerfil] Cópia para a ARTISTAS falhou (${idUnico}):`, e);
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
 * Escreve células na aba ARTISTAS. Linha: NUNCA a guardada no D1 às cegas —
 * lê a aba sem cache (API v4: cabeçalho e coluna ID_unico na mesma
 * leitura), acha a linha pelo ID_unico (mesma regra da importação),
 * atualiza `linha_planilha` no D1 se mudou e escreve lá. Artista que não
 * está mais na aba: a gravação dele é abortada (log) e ele volta em
 * `semLinha`. Coluna casada pelo cabeçalho exato (há "Foto" e "FOTO"),
 * senão sem acento/caixa; coluna inexistente (ex.: "CAPA PERFIL MOBILE")
 * ganha o cabeçalho no fim da linha 1. Uma chamada batch; lança se o
 * Google recusar.
 */
export async function copiarCelulasArtistas(
  db: D1DatabaseLike,
  celulas: CelulaArtistas[],
): Promise<{ escritas: number; semLinha: string[] }> {
  if (!celulas.length) return { escritas: 0, semLinha: [] };
  const linhas = await googleSheetsService.usuarios.readValuesFresh(ABA_ARTISTAS);
  const cabecalho = (linhas[0] ?? []).map((c) => String(c ?? "").trim());
  if (!cabecalhoValido(cabecalho)) throw new Error('A aba ARTISTAS veio sem as colunas "Nome"/"ID_unico".');
  const linhaPorId = new Map<string, number>();
  for (let i = 1; i < linhas.length; i++) {
    const a = registroDaLinha(cabecalho, linhas[i] ?? [], i + 1);
    if (a && !linhaPorId.has(a.idUnico)) linhaPorId.set(a.idUnico, i + 1);
  }

  const semLinha = [...new Set(celulas.map((c) => c.idUnico))].filter((id) => !linhaPorId.has(id));
  for (const id of semLinha) console.warn(`[artistasD1] "${id}" não está na aba ARTISTAS; cópia abortada.`);
  const alvo = celulas.filter((c) => linhaPorId.has(c.idUnico));
  if (!alvo.length) return { escritas: 0, semLinha };

  // Linha atual de cada artista no D1 (a planilha pode ter ganho/perdido linhas)
  await rodarEmLotes(
    db,
    [...new Set(alvo.map((c) => c.idUnico))].map((id) =>
      db
        .prepare("UPDATE artistas SET linha_planilha = ? WHERE id_unico = ? AND linha_planilha IS NOT ?")
        .bind(linhaPorId.get(id)!, id, linhaPorId.get(id)!),
    ),
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
  for (const c of alvo) {
    const i = await indiceDe(c.coluna);
    entradas.push({ sheetName: ABA_ARTISTAS, range: `${letraDaColuna(i + 1)}${linhaPorId.get(c.idUnico)}`, values: [[c.valor]] });
  }
  const ok = await googleSheetsService.updateValuesBatch("usuarios", entradas);
  if (!ok) throw new Error("O Google recusou a gravação na ARTISTAS.");
  return { escritas: alvo.length, semLinha };
}

/** Põe células na fila de cópia para a ARTISTAS (mesmo artista+coluna: o valor novo substitui). */
export async function enfileirarPendencias(db: D1DatabaseLike, celulas: CelulaArtistas[], agora: Date = new Date()): Promise<void> {
  if (!celulas.length) return;
  await garantirSchemaArtistas(db);
  const criadoEm = agora.toISOString();
  await rodarEmLotes(db, celulas.map((c) => pendencia(db, c, criadoEm)));
}

function pendencia(db: D1DatabaseLike, c: CelulaArtistas, criadoEm: string): D1PreparedStatement {
  return db
    .prepare("INSERT OR REPLACE INTO artistas_pendencias_planilha (id_unico, coluna, valor, criado_em) VALUES (?, ?, ?, ?)")
    .bind(c.idUnico, c.coluna, c.valor, criadoEm);
}

export interface ResultadoDescarga {
  /** Células aceitas pelo Google. */
  escritas: number;
  /** Células descartadas (artista não está mais na aba ARTISTAS). */
  descartadas: number;
  /** Células que continuam na fila (Google fora do ar/recusou ou valor novo chegou no meio). */
  restantes: number;
  erro?: string;
}

/**
 * Tenta copiar para a ARTISTAS as células pendentes (de alguns artistas ou
 * de todos), numa leitura + uma gravação batch. Sem pendência, não toca na
 * planilha. Só apaga da fila o que foi escrito/descartado e ainda tem o
 * mesmo valor (uma edição mais nova no meio do caminho continua na fila).
 */
export async function descarregarPendencias(db: D1DatabaseLike, idsUnicos?: string[]): Promise<ResultadoDescarga> {
  await garantirSchemaArtistas(db);
  const filtro = idsUnicos ? ` WHERE id_unico IN (${idsUnicos.map(() => "?").join(", ") || "NULL"})` : "";
  const ler = () =>
    db
      .prepare(`SELECT id_unico, coluna, valor FROM artistas_pendencias_planilha${filtro} ORDER BY criado_em`)
      .bind(...(idsUnicos ?? []))
      .all<{ id_unico: string; coluna: string; valor: string }>();
  const { results } = await ler();
  if (!results.length) return { escritas: 0, descartadas: 0, restantes: 0 };
  const celulas = results.map((r) => ({ idUnico: r.id_unico, coluna: r.coluna, valor: r.valor }));
  let r: { escritas: number; semLinha: string[] };
  try {
    r = await copiarCelulasArtistas(db, celulas);
  } catch (e) {
    return { escritas: 0, descartadas: 0, restantes: celulas.length, erro: String((e as Error)?.message ?? e) };
  }
  await rodarEmLotes(
    db,
    celulas.map((c) =>
      db
        .prepare("DELETE FROM artistas_pendencias_planilha WHERE id_unico = ? AND coluna = ? AND valor = ?")
        .bind(c.idUnico, c.coluna, c.valor),
    ),
  );
  const restantes = (await ler()).results.length;
  const semLinha = new Set(r.semLinha);
  return { escritas: r.escritas, descartadas: celulas.filter((c) => semLinha.has(c.idUnico)).length, restantes };
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

// ---------------------------------------------------------------------------
// Referências para charts/playlists (nacionalidade, foto e gênero por artista)
// ---------------------------------------------------------------------------

/** Mesmo formato que as consultas antigas em artista_info devolviam. */
export interface ReferenciaArtistaCharts {
  nome_upper: string;
  nacionalidade: string;
  foto: string;
  genero: string;
}

// Flag da importação em cache (5 min) — os leitores de charts rodam a cada
// requisição e não podem pagar uma leitura extra do D1 por vez.
let cacheFlagCharts: { db: D1DatabaseLike; em: number; promessa: Promise<boolean> } | null = null;

/**
 * Mesma pergunta de importacaoFeita, mas em cache (5 min) e só com SELECT —
 * para os caminhos quentes (perfil, prêmios, charts), que não podem pagar
 * CREATE TABLE + SELECT por requisição.
 */
export function importacaoFeitaEmCache(db: D1DatabaseLike): Promise<boolean> {
  const agora = Date.now();
  if (cacheFlagCharts && cacheFlagCharts.db === db && agora - cacheFlagCharts.em < TTL_MS) return cacheFlagCharts.promessa;
  // Só SELECT (sem CREATE TABLE): tabela ausente = importação não feita
  const promessa = db
    .prepare("SELECT valor FROM chart_config WHERE chave = ?")
    .bind(MARCA_IMPORTADO)
    .all<{ valor: string }>()
    .then((r) => r.results[0]?.valor === "1")
    .catch((e) => {
      if (/no such table/i.test(String((e as Error)?.message ?? e))) return false;
      throw e;
    });
  promessa.catch(() => {
    if (cacheFlagCharts?.promessa === promessa) cacheFlagCharts = null;
  });
  cacheFlagCharts = { db, em: agora, promessa };
  return promessa;
}

/** Chave nome_upper como artista_info sempre guardou: sem espaços nas pontas, CAIXA ALTA. */
const chaveNomeUpper = (nome: string): string => String(nome ?? "").trim().toUpperCase();

/** Leitura antiga (artista_info); tabela ausente -> []; banco sem a coluna genero -> gênero vazio. */
async function referenciasDeArtistaInfo(db: D1DatabaseLike): Promise<ReferenciaArtistaCharts[]> {
  const ler = async (sql: string) => (await db.prepare(sql).all<Record<string, string | null>>()).results;
  let rows: Record<string, string | null>[];
  try {
    try {
      rows = await ler("SELECT nome_upper, nacionalidade, foto, genero FROM artista_info");
    } catch (e) {
      if (!/no such column/i.test(String((e as Error)?.message ?? e))) throw e;
      rows = await ler("SELECT nome_upper, nacionalidade, foto FROM artista_info");
    }
  } catch (e) {
    if (/no such table/i.test(String((e as Error)?.message ?? e))) return [];
    throw e;
  }
  return rows.map((r) => ({
    nome_upper: String(r.nome_upper ?? ""),
    nacionalidade: String(r.nacionalidade ?? ""),
    foto: String(r.foto ?? ""),
    genero: String(r.genero ?? ""),
  }));
}

// artista_info em cache (5 min) para completar o espelho nos charts
let cacheInfoCharts: { db: D1DatabaseLike; em: number; promessa: Promise<ReferenciaArtistaCharts[]> } | null = null;

function referenciasDeArtistaInfoEmCache(db: D1DatabaseLike): Promise<ReferenciaArtistaCharts[]> {
  const agora = Date.now();
  if (cacheInfoCharts && cacheInfoCharts.db === db && agora - cacheInfoCharts.em < TTL_MS) return cacheInfoCharts.promessa;
  const promessa = referenciasDeArtistaInfo(db);
  const entrada = { db, em: agora, promessa };
  cacheInfoCharts = entrada;
  promessa.catch(() => {
    if (cacheInfoCharts === entrada) cacheInfoCharts = null;
  });
  return promessa;
}

/**
 * Única fonte dos leitores de charts/playlists: nacionalidade (pais), foto
 * (foto_url) e gênero (genero_principal) por nome_upper. Importação feita ->
 * espelho `artistas` (carregarArtistas, em cache) e, para nomes que o
 * espelho não tem (acts só da INFOS ACTS), a linha de artista_info — o
 * espelho vence nos nomes que ele tem. Antes da importação -> só
 * artista_info (transição segura). Ordem do espelho = linha da planilha
 * (determinístico); os de artista_info vêm depois.
 */
export async function referenciasArtistasParaCharts(db: D1DatabaseLike): Promise<ReferenciaArtistaCharts[]> {
  if (!(await importacaoFeitaEmCache(db))) return referenciasDeArtistaInfo(db);
  const [mapa, infos] = await Promise.all([carregarArtistas(db), referenciasDeArtistaInfoEmCache(db)]);
  const vistos = new Set<string>();
  const lista: ReferenciaArtistaCharts[] = [];
  for (const a of mapa.values()) {
    const nomeUpper = chaveNomeUpper(a.nome);
    if (!nomeUpper || vistos.has(nomeUpper)) continue;
    vistos.add(nomeUpper);
    lista.push({
      nome_upper: nomeUpper,
      nacionalidade: a.pais ?? "",
      foto: a.fotoUrl ?? "",
      genero: a.generoPrincipal ?? "",
    });
  }
  for (const r of infos) {
    const nomeUpper = chaveNomeUpper(r.nome_upper);
    if (!nomeUpper || vistos.has(nomeUpper)) continue;
    vistos.add(nomeUpper);
    lista.push({ ...r, nome_upper: nomeUpper });
  }
  return lista;
}
