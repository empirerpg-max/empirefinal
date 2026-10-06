-- Empire Catálogo — schema D1 (SQLite)
-- Fase 0 da migração Google Sheets -> Cloudflare D1. Cobre só o Fórum/
-- Catálogo (Musicas/Music Videos/Albuns + seus comentários), que foi onde
-- os bugs de hoje aconteceram. Nada aqui está em produção ainda — é só o
-- schema alvo, validado contra o volume real medido (759+300+98 mídias,
-- ~2078 comentários, ~1.9MB no total).

-- Músicas, vídeos e álbuns compartilham uma única tabela de "mídia" com um
-- campo `tipo` — simplifica o join de comentários (uma tabela de comentário
-- só, com FK pra cá) e deixa o ID verdadeiramente único por design (coisa
-- que o Sheets nunca garantiu e foi causa raiz de pelo menos 2 bugs hoje).
CREATE TABLE midia (
  id TEXT PRIMARY KEY,                 -- ex: "musica_1790212898368_ixpgp6" (preserva o formato atual pra não quebrar links já compartilhados)
  tipo TEXT NOT NULL CHECK (tipo IN ('musica', 'video', 'album')),
  titulo TEXT NOT NULL,
  artista TEXT NOT NULL,
  feat_artistas TEXT,                  -- JSON array, ex: '["SA5M"]'
  album_id TEXT REFERENCES midia(id),  -- faixa -> álbum (só quando tipo='musica' e pertence a um álbum)
  capa_url TEXT,
  audio_url TEXT,
  video_url TEXT,
  video_source TEXT,
  letra TEXT,
  letra_sincronizada TEXT,
  data_lancamento TEXT,                -- formato BR (DD/MM/AAAA), como já é exibido
  data_lancamento_iso TEXT,            -- YYYY-MM-DD, pra ordenar/filtrar
  codigo_unico TEXT,                   -- chave de cruzamento com EDIÇÃO CHARTS (continua no Sheets por enquanto)
  metacritic_avg REAL,
  descricao TEXT,
  categoria TEXT,                      -- tipo de vídeo (Music Video, Live, etc.)
  genero TEXT,
  track_order INTEGER,
  pendente INTEGER NOT NULL DEFAULT 0, -- 0/1 — substitui "Pendente? Sim/Não"
  criado_em TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_midia_tipo ON midia(tipo);
CREATE INDEX idx_midia_album ON midia(album_id);
CREATE INDEX idx_midia_data ON midia(data_lancamento_iso);
CREATE INDEX idx_midia_codigo_unico ON midia(codigo_unico);

-- Comentário — uma tabela só pros 3 tipos (antes eram 3 abas com schema
-- ligeiramente diferente cada, causa raiz de boa parte da confusão de hoje:
-- "reações" e "replyTo" em colunas diferentes dependendo da aba).
CREATE TABLE comentario (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  midia_id TEXT NOT NULL REFERENCES midia(id) ON DELETE CASCADE,
  jogador_id TEXT NOT NULL,
  jogador_nome TEXT NOT NULL,
  texto TEXT NOT NULL,
  nota INTEGER,                        -- "nota rolada" (score aleatório no intervalo escolhido)
  reply_to INTEGER REFERENCES comentario(id) ON DELETE SET NULL,  -- coluna PRÓPRIA, nunca mais divide espaço com reações
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_comentario_midia ON comentario(midia_id);
CREATE INDEX idx_comentario_jogador ON comentario(jogador_id);
CREATE INDEX idx_comentario_reply_to ON comentario(reply_to);

-- Reação (emoji) a um comentário — antes era um JSON solto numa célula;
-- agora cada reação é uma linha, com UNIQUE garantindo que a mesma pessoa
-- nunca reage duas vezes com o mesmo emoji (constraint de verdade, não
-- lógica repetida em cada endpoint).
CREATE TABLE reacao (
  comentario_id INTEGER NOT NULL REFERENCES comentario(id) ON DELETE CASCADE,
  jogador_id TEXT NOT NULL,
  emoji TEXT NOT NULL,
  criado_em TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (comentario_id, jogador_id, emoji)
);

CREATE INDEX idx_reacao_comentario ON reacao(comentario_id);
