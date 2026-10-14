// Acesso à tabela D1 dedicada `musicas` — parte da reestruturação pedida
// pelo usuário em 2026-10-14: uma tabela por tipo (musicas/videos/albuns),
// em vez da tabela genérica `midia` compartilhada da Fase 1 (schema antigo,
// ver d1/schema.sql). Mesmo binding CATALOGO_DB (getCatalogoDb,
// catalogoDbService.ts) — só o schema/SQL é próprio daqui.
//
// Como cada tipo agora tem sua própria tabela, o "ID do tópico" pode ser
// usado como PK direto, SEM o namespace musica_legado_X/video_legado_X que
// a tabela `midia` compartilhada precisava (colisão só acontecia entre
// tipos diferentes competindo pela mesma PK global — não existe mais isso
// aqui).
import { getCatalogoDb, type D1DatabaseLike, type D1PreparedStatement } from "./catalogoDbService";

export { getCatalogoDb };

export const MUSICAS_CREATE_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS musicas (
    codigo_unico TEXT PRIMARY KEY,
    id_topico TEXT,
    titulo TEXT NOT NULL,
    artista TEXT NOT NULL,
    artista_2 TEXT,
    artista_3 TEXT,
    artista_4 TEXT,
    artista_5 TEXT,
    artista_6 TEXT,
    album TEXT,
    album_2 TEXT,
    album_3 TEXT,
    album_4 TEXT,
    album_5 TEXT,
    capa_url TEXT,
    audio_url TEXT,
    letra TEXT,
    letra_sincronizada TEXT,
    genero TEXT,
    tipo_single TEXT,
    tipo_musica TEXT,
    data_lancamento TEXT,
    data_lancamento_iso TEXT,
    weeks INTEGER,
    weeks_video INTEGER,
    ordem INTEGER,
    id_criador TEXT,
    comentarios_para TEXT,
    metacritic_por_jogador TEXT,
    metacritic_media REAL,
    pendente INTEGER NOT NULL DEFAULT 0,
    reportado_incorreto INTEGER NOT NULL DEFAULT 0,
    shop_json TEXT,
    loja_info TEXT,
    arte_extra_json TEXT,
    criado_em TEXT NOT NULL DEFAULT (datetime('now')),
    atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  "CREATE INDEX IF NOT EXISTS idx_musicas_id_topico ON musicas(id_topico)",
  "CREATE INDEX IF NOT EXISTS idx_musicas_artista ON musicas(artista)",
  "CREATE INDEX IF NOT EXISTS idx_musicas_data ON musicas(data_lancamento_iso)",
];

const MUSICAS_UPSERT_SQL = `INSERT INTO musicas (
    codigo_unico, id_topico, titulo, artista, artista_2, artista_3, artista_4, artista_5, artista_6,
    album, album_2, album_3, album_4, album_5, capa_url, audio_url, letra, letra_sincronizada,
    genero, tipo_single, tipo_musica, data_lancamento, data_lancamento_iso, weeks, weeks_video,
    ordem, id_criador, comentarios_para, metacritic_por_jogador, metacritic_media, pendente,
    reportado_incorreto, shop_json, loja_info, arte_extra_json, atualizado_em
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  ON CONFLICT(codigo_unico) DO UPDATE SET
    id_topico = excluded.id_topico, titulo = excluded.titulo, artista = excluded.artista,
    artista_2 = excluded.artista_2, artista_3 = excluded.artista_3, artista_4 = excluded.artista_4,
    artista_5 = excluded.artista_5, artista_6 = excluded.artista_6,
    album = excluded.album, album_2 = excluded.album_2, album_3 = excluded.album_3,
    album_4 = excluded.album_4, album_5 = excluded.album_5,
    capa_url = excluded.capa_url, audio_url = excluded.audio_url,
    letra = excluded.letra, letra_sincronizada = excluded.letra_sincronizada,
    genero = excluded.genero, tipo_single = excluded.tipo_single, tipo_musica = excluded.tipo_musica,
    data_lancamento = excluded.data_lancamento, data_lancamento_iso = excluded.data_lancamento_iso,
    weeks = excluded.weeks, weeks_video = excluded.weeks_video, ordem = excluded.ordem,
    id_criador = excluded.id_criador, comentarios_para = excluded.comentarios_para,
    metacritic_por_jogador = excluded.metacritic_por_jogador, metacritic_media = excluded.metacritic_media,
    pendente = excluded.pendente, reportado_incorreto = excluded.reportado_incorreto,
    shop_json = excluded.shop_json, loja_info = excluded.loja_info, arte_extra_json = excluded.arte_extra_json,
    atualizado_em = datetime('now')`;

export interface MusicaUpsert {
  codigoUnico: string;
  idTopico?: string | null;
  titulo: string;
  artista: string;
  artista2?: string | null;
  artista3?: string | null;
  artista4?: string | null;
  artista5?: string | null;
  artista6?: string | null;
  album?: string | null;
  album2?: string | null;
  album3?: string | null;
  album4?: string | null;
  album5?: string | null;
  capaUrl?: string | null;
  audioUrl?: string | null;
  letra?: string | null;
  letraSincronizada?: string | null;
  genero?: string | null;
  tipoSingle?: string | null;
  tipoMusica?: string | null;
  dataLancamento?: string | null;
  dataLancamentoIso?: string | null;
  weeks?: number | null;
  weeksVideo?: number | null;
  ordem?: number | null;
  idCriador?: string | null;
  comentariosPara?: string | null;
  metacriticPorJogador?: string | null;
  metacriticMedia?: number | null;
  pendente?: boolean;
  reportadoIncorreto?: boolean;
  shopJson?: string | null;
  lojaInfo?: string | null;
  arteExtraJson?: string | null;
}

export function buildMusicaUpsertStatement(db: D1DatabaseLike, m: MusicaUpsert): D1PreparedStatement {
  return db.prepare(MUSICAS_UPSERT_SQL).bind(
    m.codigoUnico,
    m.idTopico ?? null,
    m.titulo,
    m.artista,
    m.artista2 ?? null,
    m.artista3 ?? null,
    m.artista4 ?? null,
    m.artista5 ?? null,
    m.artista6 ?? null,
    m.album ?? null,
    m.album2 ?? null,
    m.album3 ?? null,
    m.album4 ?? null,
    m.album5 ?? null,
    m.capaUrl ?? null,
    m.audioUrl ?? null,
    m.letra ?? null,
    m.letraSincronizada ?? null,
    m.genero ?? null,
    m.tipoSingle ?? null,
    m.tipoMusica ?? null,
    m.dataLancamento ?? null,
    m.dataLancamentoIso ?? null,
    m.weeks ?? null,
    m.weeksVideo ?? null,
    m.ordem ?? null,
    m.idCriador ?? null,
    m.comentariosPara ?? null,
    m.metacriticPorJogador ?? null,
    m.metacriticMedia ?? null,
    m.pendente ? 1 : 0,
    m.reportadoIncorreto ? 1 : 0,
    m.shopJson ?? null,
    m.lojaInfo ?? null,
    m.arteExtraJson ?? null,
  );
}
