-- ============================================================
-- Empire Play — Migration completa do catálogo
-- Gerado em: 2026-07-28
-- ============================================================

-- ------------------------------------------------------------
-- Tabelas de ranking (Top 50)
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "Top_50_Spotify" (
  id                bigserial PRIMARY KEY,
  created_at        timestamptz DEFAULT now(),
  posicao           int,
  nome_musica       text,
  capa_musica       text,
  link_audio        text,
  telegram_topic_id bigint
);

CREATE TABLE IF NOT EXISTS "Top_Songs_Apple_Music" (
  id                bigserial PRIMARY KEY,
  created_at        timestamptz DEFAULT now(),
  posicao           int,
  nome_musica       text,
  capa_musica       text,
  link_audio        text,
  telegram_topic_id bigint
);

CREATE TABLE IF NOT EXISTS "Top_Videos_YT" (
  id                bigserial PRIMARY KEY,
  created_at        timestamptz DEFAULT now(),
  posicao           int,
  nome_video        text,
  thumb             text,
  link_audio        text,
  telegram_topic_id bigint
);

-- ------------------------------------------------------------
-- Tabelas de comentários
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "Comentarios_Musicas" (
  id                bigserial PRIMARY KEY,
  created_at        timestamptz DEFAULT now(),
  telegram_topic_id bigint,
  id_jogador        text,
  nome_jogador      text,
  comentario        text
);

CREATE TABLE IF NOT EXISTS "Comentarios_Videos" (
  id                bigserial PRIMARY KEY,
  created_at        timestamptz DEFAULT now(),
  telegram_topic_id bigint,
  id_usuario        text,
  autor             text,
  texto             text,
  data              text,
  reacoes           text
);

CREATE TABLE IF NOT EXISTS "Comentarios_Albuns" (
  id                bigserial PRIMARY KEY,
  created_at        timestamptz DEFAULT now(),
  telegram_topic_id bigint,
  id_jogador        text,
  nome_jogador      text,
  comentario        text,
  data              text
);

-- ------------------------------------------------------------
-- RLS + policies de leitura pública em todas as tabelas novas
-- ------------------------------------------------------------

ALTER TABLE "Top_50_Spotify"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Top_Songs_Apple_Music" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Top_Videos_YT"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Comentarios_Musicas"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Comentarios_Videos"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Comentarios_Albuns"   ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  -- Top_50_Spotify
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'Top_50_Spotify' AND policyname = 'leitura publica'
  ) THEN
    CREATE POLICY "leitura publica" ON "Top_50_Spotify" FOR SELECT USING (true);
  END IF;

  -- Top_Songs_Apple_Music
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'Top_Songs_Apple_Music' AND policyname = 'leitura publica'
  ) THEN
    CREATE POLICY "leitura publica" ON "Top_Songs_Apple_Music" FOR SELECT USING (true);
  END IF;

  -- Top_Videos_YT
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'Top_Videos_YT' AND policyname = 'leitura publica'
  ) THEN
    CREATE POLICY "leitura publica" ON "Top_Videos_YT" FOR SELECT USING (true);
  END IF;

  -- Comentarios_Musicas
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'Comentarios_Musicas' AND policyname = 'leitura publica'
  ) THEN
    CREATE POLICY "leitura publica" ON "Comentarios_Musicas" FOR SELECT USING (true);
  END IF;

  -- Comentarios_Videos
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'Comentarios_Videos' AND policyname = 'leitura publica'
  ) THEN
    CREATE POLICY "leitura publica" ON "Comentarios_Videos" FOR SELECT USING (true);
  END IF;

  -- Comentarios_Albuns
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'Comentarios_Albuns' AND policyname = 'leitura publica'
  ) THEN
    CREATE POLICY "leitura publica" ON "Comentarios_Albuns" FOR SELECT USING (true);
  END IF;
END $$;
