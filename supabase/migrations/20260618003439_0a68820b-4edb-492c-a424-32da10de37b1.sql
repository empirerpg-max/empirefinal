
CREATE TABLE public.tv_chat_messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  programa_id TEXT NOT NULL,
  user_name TEXT NOT NULL,
  text TEXT NOT NULL CHECK (length(text) BETWEEN 1 AND 500),
  reply_to JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX tv_chat_messages_programa_created_idx
  ON public.tv_chat_messages (programa_id, created_at);

GRANT SELECT, INSERT ON public.tv_chat_messages TO anon, authenticated;
GRANT ALL ON public.tv_chat_messages TO service_role;

ALTER TABLE public.tv_chat_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read chat" ON public.tv_chat_messages
  FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "Anyone can post chat" ON public.tv_chat_messages
  FOR INSERT TO anon, authenticated WITH CHECK (
    length(user_name) BETWEEN 1 AND 60 AND length(text) BETWEEN 1 AND 500
  );

ALTER PUBLICATION supabase_realtime ADD TABLE public.tv_chat_messages;
ALTER TABLE public.tv_chat_messages REPLICA IDENTITY FULL;
