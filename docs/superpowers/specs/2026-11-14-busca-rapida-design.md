# Busca rápida no cabeçalho — design (curto)

## Por quê
Tem gente que não quer vários cliques (Empire Play → Fórum → aba → rolar)
pra achar algo. A busca leva direto ao item.

## O que é
- Botão de lupa no cabeçalho global (`src/routes/__root.tsx`), ao lado do
  sininho (`NotificationBell`), visível em todas as telas.
- Abre uma janela de busca (base: `src/components/ui/command.tsx`, já no
  projeto). Começa a buscar sozinha a partir da 2ª letra, enquanto digita.
- Resultados agrupados: **Músicas, Vídeos, Álbuns, Artistas**. Até 5 por
  grupo, com "ver todos" no grupo. Grupo sem resultado não aparece.
- Casa título e artistas (inclusive participações), sem diferenciar acento
  nem maiúscula ("follia" acha "FOLLIA" e "Abbiso di Follia").
- Item pendente/oculto no catálogo fica fora, igual ao catálogo.

## Para onde cada resultado leva
| Tipo    | Destino |
|---------|---------|
| Música  | `/empire-play/forum?tab=musicas&id=<id do tópico>` |
| Vídeo   | `/empire-play/forum?tab=videos&id=<id do tópico>` |
| Álbum   | `/empire-play/forum?tab=albuns&id=<id do tópico>` (mesmo destino dos banners/pré-save; a rota `/albuns` é outra coisa) — *decisão do Claude* |
| Artista | `/artistas/<nome>` |

## Abordagens consideradas
1. **Busca no servidor, lendo do D1** — ESCOLHIDA. Endpoint `GET /api/busca?q=`
   monta um índice compacto (título, artistas, link) a partir de `musicas`,
   `videos`, `abas_espelho` (Albuns) e da lista de artistas
   (`/api/artistas/listar-todos`, mesma fonte), reaproveitado por 1 min em
   memória do Worker; cada busca filtra esse índice (~1.300 itens). O celular
   baixa só os resultados.
2. Celular baixa o catálogo e busca localmente — descartada: primeira busca
   lenta no Telegram/4G e dados desatualizados até recarregar.
3. Índice de texto completo (FTS) no D1 — descartada por agora: sem ganho
   visível com ~1.300 itens e mais uma tabela pra sincronizar. Vira opção se a
   busca crescer (Social, Market…); a tela não muda.

## Fora do escopo (v1)
Playlists, tours, awards, Social, Market — entram depois, uma por vez.

## Deixado pro builder
- Ordem dentro do grupo: começa-com antes de contém; empate por mais recente.
- "Ver todos": mesma janela, expandindo o grupo (sem tela nova).
- Regras do CLAUDE.md pros botões/itens com texto (min-w-0, padding real,
  ícone shrink-0, truncate); o botão novo no cabeçalho tem que caber em tela
  estreita junto do sininho e do atualizar.
- Debounce (~250 ms) e cancelar a busca anterior ao digitar.
