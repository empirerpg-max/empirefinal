-- ============================================================
-- Empire Play — Adiciona colunas faltantes + cria Comentarios_MV
-- Gerado em: 2026-07-28
-- ============================================================

-- data_lancamento em Albuns
ALTER TABLE "Albuns"
  ADD COLUMN IF NOT EXISTS data_lancamento text;

-- data_lancamento em Music Videos
ALTER TABLE "Music Videos"
  ADD COLUMN IF NOT EXISTS data_lancamento text;

-- telegram_message_id em Comentarios_Videos
ALTER TABLE "Comentarios_Videos"
  ADD COLUMN IF NOT EXISTS telegram_message_id bigint;

-- Cria Comentarios_MV (espelho de Comentarios_Musicas, para Music Videos)
CREATE TABLE IF NOT EXISTS "Comentarios_MV" (
  id                  bigserial PRIMARY KEY,
  created_at          timestamptz DEFAULT now(),
  telegram_topic_id   bigint,
  id_jogador          text,
  nome_jogador        text,
  comentario          text,
  data                text,
  telegram_message_id bigint
);

ALTER TABLE "Comentarios_MV" ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'Comentarios_MV' AND policyname = 'leitura publica'
  ) THEN
    CREATE POLICY "leitura publica" ON "Comentarios_MV" FOR SELECT USING (true);
  END IF;
END $$;
