// Espelho D1 da aba ARTISTAS da planilha: schema, mapeamento linha -> Artista
// e leitura em cache. Nesta fase só leitura; a carga vem da planilha em outra tarefa.
import type { D1DatabaseLike } from "./catalogoDbService";
import { semAcentoMaiusculo } from "./chartsD1/artistas";

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

  const nome = col("Nome");
  if (!nome) return null;
  const idUsuario = col("ID Usuário");
  const idUnico = col("ID_unico") ?? `${nome}${idUsuario ?? ""}`;
  return {
    idUnico,
    nome,
    idUsuario,
    gravadora: col("Gravadora"),
    fotoUrl: col("FOTO", "Foto"),
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
