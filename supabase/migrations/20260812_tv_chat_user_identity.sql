-- Chat da Empire TV: guarda o ID do Telegram e a foto de quem mandou cada
-- mensagem, pra dar pra destacar as próprias mensagens de forma confiável
-- (em vez de comparar só pelo nome, que pode colidir) e mostrar avatar.
-- Colunas nullable — mensagens antigas continuam funcionando sem quebrar.

ALTER TABLE public.tv_chat_messages
  ADD COLUMN IF NOT EXISTS user_id TEXT,
  ADD COLUMN IF NOT EXISTS user_photo TEXT;

CREATE INDEX IF NOT EXISTS tv_chat_messages_user_id_idx
  ON public.tv_chat_messages (user_id);
