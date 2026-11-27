# Mapa do Empire Hub — levantamento para o brainstorming

> Data: 2026-11-25 · Status: **levantamento**, ainda não é um design aprovado.
> Base: leitura de `src/routes/*` (54 arquivos de rota, ~23,6 mil linhas),
> `src/components/*` (~31,7 mil linhas) e `backend/src/*` (210 controllers).

---

## 1. Como o app funciona

**Plataforma.** App web (PWA instalável) feito em TanStack Start + React,
rodando no **Cloudflare Workers** (`wrangler.jsonc`, `src/server.ts`). O
Worker serve as telas e também a API (`/api/...`), que vive em
`backend/src/` (roteador único em `backend/src/routes/api.ts`, 2,7 mil
linhas, e ~210 controllers).

**Dados.** Três fontes convivem:
- **Cloudflare D1** (SQLite) — catálogo (músicas, vídeos, álbuns), charts,
  playlists, pre-save. A migração "D1 primeiro" está em andamento
  (`docs/superpowers/specs/2026-11-18-catalogo-d1-primeiro-design.md`).
- **Google Sheets / Drive** (via service account) — planilhas legadas
  (charts, ponto, market, usuários) e upload de imagens/áudio.
- **Supabase** — tempo real do chat da Empire TV e algumas tabelas.

**Entrada.** `__root.tsx` → `AuthGate`: sem login salvo, mostra
`LoginScreen` (usuário + senha; no primeiro acesso força troca de senha).
Com login, grava o "id do jogador" em `tg_user_cache` (nome herdado da
época do Telegram) e chama `authHeartbeat` (credita o prestígio de login
diário).

**Casca do app (sempre visível).**
- **Barra de cima:** logo "Empire Hub" (→ Início) · 🔍 Busca rápida ·
  🔔 Notificações · ⟳ Recarregar · ☰ Menu.
- **Barra de baixo (rolável):** Início · Catálogo · Tour · Empire TV ·
  Charts · Ponto · Social · Acervo · Perfil · **＋** (Criar → Gestão).
- **Players persistentes:** player de música, player de vídeo e mini
  player da TV ficam montados na raiz — tocam em qualquer tela.
- **Popups diários** (encadeados, 1 por vez): lembrete de indicação do
  VMA → lembrete de votação → lembrete de inscrição em festival.
- **Aviso de nova versão** (service worker) com botão "Atualizar".

**Papéis.** Jogador comum; **dono** de um artista (vê edição/gestão do
próprio artista); **Admin** (`tipoPerfil === "Admin"` ou o id fixo
`810141686`) — vê Banners e Empire TV na Gestão, pode "entrar como"
outro usuário no Perfil, edita qualquer playlist/álbum.

**Economia/progressão.** Prestígio (pontos por ações: login diário,
comentar, curtir, postar, publicar lançamento, ação de turnê…) → **Nível**
do jogador (Perfil). Cada artista tem **saldo em eCoin** gasto no Market
(produtos, leilão, Spotlight Banner). **Ponto** é a distribuição semanal
de pontos/streams nas plataformas e playlists.

---

## 2. Todas as rotas

Legenda: ✅ alcançável por menu · 🔗 só por link interno · 👻 órfã (só
digitando a URL) · ↪ layout/redirect sem tela própria.

### Início e utilidades
| Rota | O que é | Como chega |
|---|---|---|
| `/` | Home: banners Spotlight e Pre-save, Meus Artistas, Acervo recente, Global 100 #1, Top por plataforma, Lançamentos recentes, Próximos eventos (turnês/TV), Últimas publicações do Social | ✅ barra de baixo / logo |
| `/acesso-rapido` | Lista de 8 canais oficiais **no Telegram** (News, Social, Vídeos, Álbuns, Singles, Eventos, Avisos, Central de Ajuda) | ✅ menu ☰ |
| `/tutorial` | "Guia de Sobrevivência" — texto estático | ✅ menu ☰ |

### Catálogo (Empire Play) — layout com banner + barra de abas
| Rota | O que é | Como chega |
|---|---|---|
| `/empire-play` ↪ | Layout: `BannerCarousel` + `TabNav` | — |
| `/empire-play/` | Início do Catálogo: destaque "Ao vivo / Mais quente agora" + prateleiras de playlists geradas dos charts (Spotify/Apple/YouTube); abre playlist por cima (`TelaPlaylist`) | ✅ barra de baixo "Catálogo" |
| `/empire-play/musicas` | Lista de músicas com busca, tocar, "adicionar à playlist", ir pro fórum | ✅ aba |
| `/empire-play/videos` | Lista de vídeos | ✅ aba |
| `/empire-play/albuns` | Grade de álbuns → **abre no Fórum** (`/empire-play/forum?tab=albuns&id=`) | ✅ aba e menu ☰ "Discografia" |
| `/empire-play/albuns-antigos/` | Lista de álbuns "material antigo" | 🔗 da página do artista |
| `/empire-play/albuns-antigos/$id` | Detalhe de álbum antigo (tocar, editar se dono) | 🔗 |
| `/empire-play/playlists/` | Minhas playlists + "Criar" | ✅ aba e menu ☰ |
| `/empire-play/playlists/nova` | Editor de playlist (`PlaylistEditor`) | 🔗 |
| `/empire-play/playlists/$id` | Ver playlist (tocar, editar, excluir) | 🔗 |
| `/empire-play/playlists/$id/editar` | Editor de playlist | 🔗 |
| `/empire-play/forum` | Fórum: tópicos de Músicas / Vídeos / Álbuns, comentários, letra, encarte, filtros (`?tab=&id=`) | ✅ aba |
| `/empire-play/gestao/` | Central do gravador (lançar música/vídeo/álbum etc. — ver §4) | ✅ aba e botão ＋ |
| `/empire-play/gestao/album-antigo` | Cadastrar/editar álbum antigo | 🔗 da Gestão |
| `/empire-play/gestao-presave` | Gestão Pre-save: campanhas com contagem + missões diárias | ✅ aba |
| `/empire-play/presave/$id` | Página pública do pre-save | 🔗 do banner da home |

### Artistas
| Rota | O que é | Como chega |
|---|---|---|
| `/artistas` | Lista de artistas (`?filter=all|mine`) | ✅ aba "Artistas" do Catálogo, menu ☰ "Empire Artists", Perfil |
| `/artistas/$nome` | Painel do artista (abas na §4) | 🔗 de quase tudo |

### Turnês, TV, Charts, Social, Acervo
| Rota | O que é | Como chega |
|---|---|---|
| `/tours` | Turnês: Criar · Central · Em andamento · Finalizados · Mais Rentáveis | ✅ barra "Tour" |
| `/tours/$nome` | Turnê do artista: calendário, ação do dia, notícias, arrecadação | 🔗 |
| `/tv` | Empire TV: Início · Grade · Arquivo · Red Carpet; ao assistir: Chat · Participantes · Sobre; enquetes | ✅ barra |
| `/charts` | Charts: Ao vivo · Global 100 · Paradas Oficiais · Spotify · Apple · YouTube · Álbuns · Sales (`?tab=`) | ✅ barra |
| `/social` | Empire Social: Feed · Tá na Mídia · Perfis · News · Config (`?postId=&artist=`) | ✅ barra |
| `/acervo` | Acervo: Revistas · Entrevistas · Forbes · Metacritic · Pitchfork · (link) Awards; dentro, Destaques/Ranking/Artistas/Recentes/Estilo/Ano | ✅ barra |
| `/awards/` | Lista de awards | 🔗 do Acervo |
| `/awards/$nome` | Resultado de um award | 🔗 |

### Ponto
| Rota | O que é | Como chega |
|---|---|---|
| `/ponto/` | 3 cartões: Distribuir pontos · Aplicar playlists · O que vale ponto | ✅ barra |
| `/ponto/distribuir/` | Escolha: aleatório ou manual | 🔗 |
| `/ponto/distribuir/planilha` | Planilha manual de pontos | 🔗 |
| `/ponto/playlists/` | Intro → planilha | 🔗 |
| `/ponto/playlists/planilha` | Investir pontos em playlists | 🔗 |
| `/ponto/valores` | Tabela Geral / Extra / Featuring | 🔗 |

### Market
| Rota | O que é | Como chega |
|---|---|---|
| `/market/` | Produtos por categoria, Spotlight Banner, comprar | ✅ só pelo menu ☰ "Negócios" |
| `/market/leilao` | Leilão atual + lance | 🔗 |
| `/market/regras` | "Entenda os prestígios" | 🔗 |

### Perfil, premiações, festivais
| Rota | O que é | Como chega |
|---|---|---|
| `/perfil` | Dados do jogador + nível, Meus Artistas, Curtidas, Minhas Playlists, Premiações, Festivais, Todos os Artistas, admin "entrar como", Sair | ✅ barra |
| `/premiacoes` | "Retroativo": registrar prêmios já ganhos | 🔗 Perfil |
| `/premiacoes/indicar` | Indicar material próprio às categorias | 🔗 Perfil, popup VMA |
| `/premiacoes/votacao` | Votar / dar nota aos indicados | 🔗 Perfil, popup votação |
| `/festivais/inscricao` | Inscrição em festival | 🔗 Perfil, popup festival |

### Sistema antigo (órfão)
| Rota | O que é | Como chega |
|---|---|---|
| `/albuns` | Lista "Produção Fonográfica" (API antiga) | 👻 |
| `/album/$id` | Álbum antigo com player próprio | 👻 (só de `/albuns`) |
| `/album/$id/editar` | Editor do álbum antigo | 👻 |
| `/acoes/album` | Formulário antigo de lançar álbum | 👻 |
| `/acoes/tour` | Formulário antigo de comprar turnê (Indie/Arena/Estádio) | 👻 |
| `/acoes/cinema` | "Em breve" | 🔗 só do artista (botão Cinema) |

---

## 3. Menus globais, botão a botão

### Barra de cima
| Botão | Faz |
|---|---|
| Logo Empire Hub | vai pra `/` |
| 🔍 Busca rápida | abre busca em artistas, músicas, vídeos, álbuns (`api.buscar`) e leva ao item |
| 🔔 Notificações | lista (comentários e curtidas no Social, comentários no Fórum) → abre `/social` ou `/empire-play/forum`; config "O que receber no celular" (push) |
| ⟳ Recarregar | recarrega a tela |
| ☰ Menu | abre o menu em tela cheia (abaixo) |

### Menu ☰
| Item | Destino |
|---|---|
| **Acesso Rápido** — "Canais oficiais Telegram" | `/acesso-rapido` |
| **Empire Studio** ▸ Empire Artists | `/artistas?filter=all` |
| Empire Studio ▸ Discografia | `/empire-play/albuns` |
| Empire Studio ▸ Playlists | `/empire-play/playlists` |
| **Negócios** ▸ Market | `/market` (único caminho até o Market) |
| Guia de Sobrevivência | `/tutorial` |
| Sair | apaga login e recarrega |

### Barra de baixo
Início `/` · Catálogo `/empire-play` · Tour `/tours` · Empire TV `/tv` ·
Charts `/charts` · Ponto `/ponto` · Social `/social` · Acervo `/acervo` ·
Perfil `/perfil` · **＋** `/empire-play/gestao`.

### Modais globais
- **Gerenciar Artistas** (`GlobalLinkModal`): abas Vincular / Criar Novo
  (nome, foto com recorte, gravadora: King & Queen, Crown, Independent).
  Aberto via `window.setShowLinkModal` (Perfil ▸ Gerenciar).
- **Identidade Imperial**: digitar "ID Telegram" manualmente — resto do
  login antigo.

---

## 4. Menus internos das telas principais

**Catálogo — barra de abas:** Início · Artistas (sai do Catálogo, perde
a barra) · Músicas · Vídeos · Álbuns · Playlists · Fórum · Gestão ·
Gestão Pre save.

**Gestão (central do gravador):** cabeçalho com "Editar meus materiais"
(abre `EditModal`: Músicas / Vídeos / Álbuns). Ações: **Nova Música** ·
**Novo Vídeo** · **Novo Álbum** · Material Antigo
(→ `/empire-play/gestao/album-antigo`) · Sincronizar Letra (Sync Studio) ·
Lançar Faixa de Álbum · Performance Award (só se pendente) · Banners
(admin) · Empire TV (admin). Também mostra "Meus Spotlight Banners".
Cada formulário: artista, título, tipo de single/música, foco do
lançamento, objetivo no chart (Registrar / Substituir), capa, encartes,
programa da Empire TV, revisar → confirmar e publicar.

**Gestão Pre save:** criar campanha (Só contagem / Contagem + missões),
missões por dia (Revelar faixa, Trecho de letra, Bastidores, Making of,
Entrevista, Enquete, Capa alternativa, Desafio de som, Post de anúncio,
Post TikTok…), tracklist, cancelar campanha, "Abrir compositor do Social".

**Fórum:** categorias Músicas / Vídeos / Álbuns, busca, Filtros
(período, "só tópicos que eu ainda não comentei"), tópico com player,
letra/letra sincronizada, encarte, faixas do álbum, comentar/responder;
admin pode excluir tópico.

**Artista (`/artistas/$nome`):** abas Visão Geral · Discografia · Músicas
· Vídeos · Charts · Awards · Turnês & Projetos · Social · Gestão (dono).
Dono vê ações rápidas Álbum (→ Gestão aba álbum) · Turnê (→ `/tours`) ·
Cinema (→ "em breve"), troca de foto/capa/biografia, rescisão.

**Turnês:** Criar (sheet `CreateTourSheet`) · Central (minhas turnês) ·
Em andamento · Finalizados · Mais Rentáveis. Na turnê: ação do dia
(8 tipos: Foto + resumo, Entrevista rápida, Live, Bastidores, Interação
com fã, Sorteio VIP, Colab surpresa, Evento especial), calendário,
central de notícias, editar turnê.

**Empire TV:** Início · Grade · Arquivo · Red Carpet; assistindo: Chat
(GIFs/stickers) · Participantes · Sobre; enquete.

**Charts:** Ao vivo · Global 100 · Paradas Oficiais · Spotify Global ·
Apple Music · YouTube · Álbuns · Sales (filtro de estilo, país, mês).

**Social:** Feed · Tá na Mídia · Perfis · News · Config; compositor de
post (foto, vídeo, áudio, story, "interagir como" artista), comentários,
curtidas, seguir.

**Acervo:** Revistas · Entrevistas · Forbes · Metacritic · Pitchfork ·
Awards; ranking com Destaques/Ranking/Artistas/Recentes/Estilo/Ano.

**Market:** categorias de produtos, Spotlight Banner, Leilão, Regras.

**Ponto:** Distribuir pontos · Aplicar playlists · O que vale ponto.

**Perfil:** editar nome/foto/aniversário, nível e prestígio, Meus
Artistas (Gerenciar), Curtidas, Minhas Playlists, Premiações (Retroativo,
Indicar, Votação), Festivais (Inscrição), Todos os Artistas, admin
"Entrar como usuário"/"Voltar pra admin", Sair.

---

## 5. O que se repete e dá pra unificar

### Navegação / telas
1. **Dois sistemas de álbum.** `/albuns`, `/album/$id`, `/album/$id/editar`
   e `/acoes/album` (antigos, órfãos) × Catálogo › Álbuns + Fórum +
   Gestão › Novo Álbum + Álbuns Antigos. Os antigos podem sair.
2. **Três jeitos de ver um álbum:** Fórum (`?tab=albuns&id=`),
   `/empire-play/albuns-antigos/$id` e `/album/$id`. Um único "detalhe de
   álbum" serviria aos três.
3. **Músicas/Vídeos/Álbuns aparecem duas vezes** no Catálogo: nas abas
   próprias e dentro do Fórum (que tem as mesmas três categorias).
4. **"Discografia" e "Playlists" duplicados** no menu ☰ e nas abas do
   Catálogo; "Empire Artists" duplicado com a aba Artistas e com Perfil.
5. **Duas Gestões**: Gestão e Gestão Pre save são abas irmãs; Pre-save é
   um tipo de lançamento e poderia ser uma ação dentro da Gestão. Além
   disso, "Gestão" aparece também como aba no painel do artista.
6. **Turnê em dois lugares**: `/acoes/tour` (antigo, órfão) ×
   `/tours` › Criar.
7. **Market escondido**: só pelo ☰, enquanto Ponto (também economia)
   está na barra de baixo. Market + Ponto + regras de prestígio são o
   mesmo assunto ("economia").
8. **Barra de baixo com 10 itens** rolável + menu ☰ com só 5 itens.
9. **Restos de Telegram** visíveis: "Acesso Rápido — Canais oficiais
   Telegram", modal "DIGITE SEU ID TELEGRAM", Ponto "Abra o app pelo
   Telegram", toast "Conecte seu Telegram".

### Componentes / código
10. **3 popups quase idênticos** (`VmaNominationPopup`,
    `VotacaoReminderPopup`, `FestivalNominationPopup`) + 3 blocos de
    estado iguais no `__root.tsx` → um `LembreteDiarioPopup`.
11. **3 carrosséis de banner** (`BannerCarousel`,
    `SpotlightBannerCarousel`, `PreSaveBannerCarousel`).
12. **Checagem de admin copiada em ~10 arquivos** (front) e 4 (back) com o
    id fixo `810141686` → um `useIsAdmin()` / `isAdmin()` único.
13. **Login lido de 3 jeitos** (`useTelegramUser`, `getStoredLogin`,
    `tg_user_cache`) em ~30 lugares.
14. **118 `fetch("/api/...")` diretos em 38 arquivos** convivendo com
    `src/lib/api.ts` (2,3 mil linhas). `src/services/api.ts` (cliente do
    Google Apps Script) e `src/components/PlanilhaGrid.tsx` não são
    usados por ninguém.
15. **Duas planilhas do Ponto** (`ponto.distribuir.planilha` e
    `ponto.playlists.planilha`, ~500 linhas cada) com a mesma estrutura.
16. **Editor de playlist** usado por `/nova` e `/$id/editar` (ok), mas
    existem 3 tipos de "playlist" (do jogador, geradas dos charts, do
    Ponto) com nomes iguais.
17. **"Voltar = tela anterior"**: ~61 overlays `fixed inset-0`, só ~5
    seguem o padrão (`use-back-close` em Forum, CommentModal, EditModal +
    playlist/clipe).
18. **33 de ~45 componentes `ui/*` (shadcn) sem uso.**
19. **Backend:** 71 controllers `adminDiag*` + ~18 `admin*` de backfill/
    correção pontual — muitos de investigações já encerradas (Follia,
    Alchimia, Amanda Brokne…). 3 serviços de comentários
    (álbuns/músicas/vídeos) com a mesma forma.
20. **Telas gigantes**: `social.tsx` (3,5 mil), `Gestao.tsx` (3,4 mil),
    `Forum.tsx` (2,4 mil), `tv.tsx` (2,4 mil), `acervo.tsx` (2 mil),
    `GestaoPreSave.tsx` (2 mil), `EditModal.tsx` (1,9 mil).
