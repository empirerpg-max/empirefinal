# Comparativo completo: app de hoje (versão anterior) × Beta test

> Data: 2026-11-25 · Complementa o design
> (`2026-11-25-reorganizacao-do-app-design.md`) e a cobertura
> (`2026-11-25-cobertura-funcionalidades.md`).
>
> **Status:** ✅ igual (tela de hoje mantida, só muda o caminho) ·
> 🔁 redesenhada (mesma função, tela nova) · ➕ novo · ⚠️ risco que precisa
> de cuidado na implementação · ❌ sai (por decisão do usuário).

## 1. Como foi feito

1. **Inventário mecânico do app de hoje:** as 54 rotas, os 83 arquivos de
   tela/componente com elementos clicáveis (676 botões, links e ações),
   todas as chamadas à API (funções do `api.ts` + ~170 `fetch` diretos),
   todas as janelas/painéis internos, listas fixas de opções, links
   diretos (`?tab=`, `?id=`, `?postId=`…) e fontes.
2. **Leitura direta do código** das telas maiores (Início, Social, Empire
   TV, Perfil, Fórum, Gestão, Charts).
3. **Teste automático do protótipo Beta:** um robô tocou em **681 botões**
   de 23 telas. Nenhum erro de script. 3 pareceram sem efeito e foram
   conferidos: só rolam a tela ou já estavam selecionados (falsos
   positivos).
4. Comparação item a item, abaixo.

## 2. Rotas (54)

| Rota de hoje | O que é | No Beta | |
|---|---|---|---|
| `/` | Início | Início › Para você | 🔁 |
| `/tv` | Empire TV | Início › Empire TV (mesma URL) | ✅ |
| `/tours`, `/tours/$nome` (`?id=`) | Turnês | Início › Turnês (mesmas URLs) | ✅ |
| `/acervo` | Acervo | Social › Imprensa (mesma URL) | 🔁 |
| `/awards`, `/awards/$nome` | Awards | Início › Premiações › Resultados (mesmas URLs) | 🔁 |
| `/charts` (`?tab=`) | Charts | aba Charts; `tab=live` = painel do Catálogo | 🔁 (só tela) |
| `/social` (`?postId=&artist=`) | Social | aba Social | 🔁 |
| `/perfil` | Perfil | Meu Império (mesma URL) | 🔁 |
| `/artistas` (`?filter=`) | lista de artistas | Catálogo › Buscar › Artistas (mesma URL) | ✅ |
| `/artistas/$nome` | página do artista | formato de hoje, abas presas no topo | ✅ |
| `/empire-play` | Catálogo › Início (painel) | Catálogo › Início novo; painel → Charts › Ao vivo | 🔁 |
| `/empire-play/musicas`, `/videos`, `/albuns` | listas | Catálogo › Buscar (filtros), com redirecionamento | 🔁 |
| `/empire-play/albuns-antigos`, `/$id` | material antigo | Buscar › Material antigo + página do lançamento | 🔁 |
| `/empire-play/playlists`, `/nova`, `/$id`, `/$id/editar` | playlists do jogador | Catálogo › Biblioteca; editor e tela iguais | ✅ |
| `/empire-play/forum` (`?tab=&id=`) | Fórum | aba Fórum; `?tab&id` abre a página do lançamento | 🔁 ⚠️ |
| `/empire-play/gestao` (`?tab=&nome=`) | Gestão | Criar (formulários iguais) | ✅ |
| `/empire-play/gestao/album-antigo` (`?id=`) | álbum antigo | Criar › Material antigo; Meus lançamentos | ✅ |
| `/empire-play/gestao-presave` | Gestão Pre save | Criar › Pre-save; Meus lançamentos › Pre-save | ✅ |
| `/empire-play/presave/$id` | página pública | igual | ✅ |
| `/ponto`, `/ponto/distribuir`, `/ponto/distribuir/planilha`, `/ponto/playlists`, `/ponto/playlists/planilha`, `/ponto/valores` | Ponto | telas iguais; entradas: Pra fazer hoje, Charts › Meu Ponto, Meu Império, barra lateral | ✅ |
| `/market`, `/market/leilao`, `/market/regras` | Market | telas iguais; Meu Império › Economia | ✅ |
| `/premiacoes`, `/premiacoes/indicar`, `/premiacoes/votacao`, `/festivais/inscricao` | premiações | telas iguais; Início › Premiações + atalhos | ✅ |
| `/acesso-rapido`, `/tutorial` | canais, guia | Meu Império › App; tutorial novo "Como usar" | ✅ / 🔁 |
| `/acoes/cinema` | "em breve" | igual (Criar e página do artista) | ✅ |
| `/albuns`, `/album/$id`, `/album/$id/editar`, `/acoes/album`, `/acoes/tour` | sistema antigo (órfão) | redirecionam (design 5.1) | 🔁 ⚠️ |
| `/empire-play/gestao` + `/empire-play/gestao/index`, `/market` (layout), `/ponto/distribuir` (layout), `/ponto/playlists` (layout), `/empire-play/albuns-antigos` (layout), `/empire-play` (layout) | rotas de layout sem tela | mantidas | ✅ |
| (nova) `/empire-play/buscar`, `/empire-play/biblioteca`, `/empire-play/album/$id`, `/meus-lancamentos`, `/social/perfil/$artista` | — | telas novas | ➕ |

## 3. Telas e componentes, um por um

| Arquivo (hoje) | O que faz | No Beta | |
|---|---|---|---|
| `__root.tsx` | topo (busca, sino, recarregar, ☰), barra de 10 itens, popups, modal de vincular/criar artista, modal "ID Telegram" | topo (logo, beta, ＋, sino, foto), barra de 5, popups iguais, Gerenciar artistas em Meu Império; Recarregar → puxar; ☰ → Meu Império; modal "ID Telegram" sai: nenhuma tela o abre hoje (`setShowIdModal(true)` não é chamado em lugar nenhum), o login por usuário e senha já substituiu | 🔁 ⚠️ |
| `index.tsx` (Início) | Olá {nome}, banners, ticker, Meus artistas, Lançamentos, Global 100 #1, Top por plataforma, Próximos eventos, Últimas publicações, Revistas & Entrevistas | Para você: Olá, banners no topo, faixa Ao vivo, cronômetro, Pra fazer hoje, as mesmas seções; "Da Imprensa" no lugar de Revistas & Entrevistas | 🔁 |
| `BuscaRapida` | busca global | Catálogo › Buscar (celular) / campo no topo (computador), resultados agrupados iguais | 🔁 |
| `NotificationBell` | lista, marcar lidas, push, preferências | igual + "Marcar todas" e "Configurar" visíveis | ✅ |
| `InstallPrompt`, aviso de versão nova, `RouteErrorScreen`, `LoadErrorState` | instalação, atualização, erro | iguais; 404 em português | ✅ |
| `LoginScreen` | login, troca de senha, "entrar como" (admin) | igual; faixa "Vendo como" em todas as telas | ✅ ➕ |
| `VmaNominationPopup`, `VotacaoReminderPopup`, `FestivalNominationPopup` | lembretes diários | um componente só, mesmo comportamento | 🔁 |
| `PlaylistsInicio`, `TelaPlaylist`, `VitrineClipes`, `DynamicCoverCard` | painel de playlists ao vivo | Charts › Ao vivo, **sem mudar nada** (fontes Fjalla One e Poppins mantidas) | ✅ |
| `AlbumList`, `empire-play.musicas/videos` | listas do catálogo | Catálogo › Buscar | 🔁 |
| `Forum.tsx` | categorias, filtros, tópico (player, letra, letra sincronizada, faixas com letra, disco, encarte, Shop/Info/Visual, selos, comentários, reações, respostas, editar, pendente, excluir, editar tópico) | lista do Fórum + página do lançamento com **tudo isso** | 🔁 ⚠️ |
| `CommentModal` | Metacritic & Comentário / Likes & Comentário | igual; nota de música/álbum continua invisível no Fórum | ✅ |
| `ReactionBar`, `EmojiPicker`, `RichTextToolbar` | reações e texto rico | iguais | ✅ |
| `ExtraMaterial` | Shop, Info, Visual | iguais, na página do lançamento | ✅ |
| `EncarteViewer` | encarte | igual | ✅ |
| `MusicPlayer`, `VideoPlayer`, `TvMiniPlayer`, `PlayerContext` | players persistentes | iguais; mini player acima da barra; player expandido | ✅ |
| `AddToPlaylistSheet` | salvar / playlist | menu ⋯ das faixas | ✅ |
| `PlaylistEditor` | criar/editar playlist (catálogo, upload, link) | igual | ✅ |
| `Gestao.tsx` | Nova música/vídeo/álbum, material antigo, sincronizar letra, faixa de álbum, Performance Award, Banners (admin), Empire TV (admin), Meus Spotlight Banners, Painel D1 | folha Criar abre **os mesmos formulários**; banners/painel/TV em Meu Império › Admin | ✅ |
| `EditModal` | editar materiais | Meus lançamentos (3 entradas) | 🔁 |
| `LancarFaixaAlbumModal`, `PerformanceAwardModal`, `SyncStudioModal` | lançamentos específicos | iguais, pelo Criar | ✅ |
| `GestaoPreSave`, `PreSavePublicPage`, `PreSaveBannerCarousel`, `PreSaveCounterBadge` | pre-save | Criar › Pre-save; Meus lançamentos › Pre-save; banner no topo do Início | ✅ |
| `BannersManager`, `GestaoEmpireTv`, `PainelCatalogoD1`, `MeusSpotlightBanners` | admin e banners | Meu Império › Admin / Estúdio | ✅ |
| `BannerCarousel`, `SpotlightBannerCarousel` | banners | Catálogo › Início e Início (topo) | ✅ |
| `charts.tsx` | Ao vivo (Mundo/Por país), categorias, Global/Por país/Artistas do mês, datas, estilo, busca, perfil do artista do mês | Ao vivo = painel; categorias em formato de playlist, **mesmos dados e mesma API** | 🔁 (só tela) |
| `social.tsx` | Feed (stories, carrossel, áudio com som/sem som), Tá na Mídia, Perfis (3 redes), News, Config, Interagir como, Blackout, comentários, curtir, editar/excluir, Siga também | mesmas funções; News → Imprensa; Config → Configurar meus perfis; + Repostar, Seguir real, filtro de rede, paginação; Mensagem sai | 🔁 ➕ ❌ ⚠️ |
| `SocialPostComposer` | postar (rede, Feed/Story, mídia, música, Normal/Blackout) | igual, pelo Criar | ✅ |
| `tv.tsx` | Início (carrossel "Assistir agora" com anterior/próximo, canais Kick), Grade, Arquivo; sala: Chat (GIF, responder, negrito/itálico, mensagens antigas), **Red Carpet** (postar, curtir, ranking da sala), Participantes, Sobre; enquete; presença; minimizar; ativar som | igual (corrigido nesta análise: Red Carpet volta para dentro da sala) + sininho Lembrar na Grade | ✅ ➕ |
| `tours.index.tsx`, `tours.$nome.tsx`, `CreateTourSheet` | turnês | iguais | ✅ |
| `acervo.tsx` | Revistas, Entrevistas, Forbes, Metacritic, Empirefork, Awards | Social › Imprensa (sem Awards) | 🔁 |
| `awards.*` | resultados | Início › Premiações › Resultados | 🔁 |
| `artistas.$nome.index.tsx` | página do artista (abas, Gestão, rescisão) | igual, abas presas no topo | ✅ |
| `perfil.tsx` | perfil, nível, Meus artistas, Salvos, Minhas playlists, Premiações, Festivais, entrar como, Sair | Meu Império (todos os grupos) | 🔁 |
| `market.*`, `ponto.*`, `premiacoes*`, `festivais_.inscricao` | economia e premiações | telas iguais | ✅ |
| `ImageCropModal`, `use-image-crop` | recorte de imagem | igual | ✅ |
| `acesso-rapido.tsx`, `tutorial.tsx` | canais e guia | Meu Império › App; "Como usar" (2 versões) | ✅ / 🔁 |
| `PlanilhaGrid`, `src/services/api.ts`, `ScrollArrows` | sem uso hoje | saem na limpeza | ❌ |

## 4. Coisas que não têm botão, mas precisam continuar

| Item | Situação no Beta |
|---|---|
| Login salvo, `tg_user_cache`, heartbeat diário (prestígio de login) | igual; nada renomeado |
| Popups diários (VMA, votação, festival) com "lembrar depois"/"já fiz" | iguais |
| Players continuam ao trocar de tela | iguais, inclusive ao trocar de versão |
| Push e preferências de notificação | iguais |
| Aviso de versão nova (service worker) e recarregamento de pedaços antigos (`staleChunk`) | iguais; cuidado ao trocar de versão (ver riscos) |
| Captura de erros (`error-capture`, `/api/log-error`) | igual; também alimenta o "Reportar problema" |
| Agendamentos a cada 10 min (`triggers.crons`) | iguais; ganham o envio dos lembretes |
| Apps Script e planilhas lidas por fora (Empirefork, Metacritic, charts) | **não mudam** |

## 5. O que pode quebrar, e como evitar

| ⚠️ Risco | Onde | Como evitar | Teste |
|---|---|---|---|
| Link antigo abrir tela errada ou vazia | todas as rotas da seção 2, links `?tab=&id=` | tabela de redirecionamentos única; `?tab&id` do Fórum abre a página do lançamento | teste que abre cada rota e link e confere a tela |
| Versão anterior quebrar por mudança feita para o Beta | backend compartilhado | toda mudança de backend serve as duas versões; nada de remover campo ou rota usada pela anterior | rodar as telas da versão anterior em cada entrega |
| **Social no D1** perder ou duplicar posts, curtidas, comentários | migração da planilha | carga única + conferência de contagens; planilha continua recebendo cópia pela fila de backup; a versão anterior lê do mesmo lugar | contagens iguais antes e depois; abrir posts antigos nas duas versões |
| Contagem de curtidas mudar | `likes` × `likedBy` | base = `analytics.likes` | comparar números de 20 posts antes/depois |
| Charts mudarem | tela nova | **nenhuma mudança** de backend, API ou cálculo | comparar a tela nova com a de hoje, posição por posição, numa semana fechada |
| Algo do tópico do Fórum ficar de fora na página nova | `Forum.tsx` | checklist da seção 5.3.4 do design, item por item | abrir 1 álbum, 1 música, 1 vídeo e 1 material antigo e conferir cada item |
| Nota de música/álbum aparecer no Fórum | página do lançamento | regra das notas (design 5.3.4) | conferir que só vídeo mostra nota |
| Trocar de versão perder música tocando ou texto digitado | troca anterior ↔ Beta | trocar sem recarregar o player; perguntar antes se houver rascunho | trocar no meio de uma música e de um comentário |
| Pedaços antigos em cache depois da troca | service worker | mesma lógica do `staleChunk` | instalar como app, trocar de versão, conferir |
| Cronômetro errado em celular com relógio errado | aparelho | corrigir pela hora do servidor (cabeçalho `Date`) | adiantar o relógio do celular e conferir |
| Lembrete chegar atrasado | agendamento de 10 min | opções em múltiplos de 10 min; texto "por volta de" | criar lembrete e conferir a chegada |
| Medição estourar o grátis | `/api/uso` | envio em lote, contadores somados, ajuste de intervalo | acompanhar escritas/dia no painel da Cloudflare na 1ª semana |
| Modo claro deixar o escuro diferente | ~2.800 cores escritas direto | trocar por tokens tela a tela, comparando capturas antes/depois | captura de cada tela no escuro antes/depois |
| Texto cortado / sobreposto em celular pequeno | topo, abas | regras U1–U4 e R4 | checagem automática em 320, 360 e 390px |
| Admin esquecer que está "vendo como" | Beta | faixa fixa em todas as telas | entrar como e navegar |
| Telas lentas por carregar tudo | Social, home, artista | paginação e pedidos filtrados no servidor | medir tempo de abrir o Social antes/depois |

## 6. Erros encontrados nesta análise (já corrigidos)

1. **Red Carpet estava no lugar errado** no protótipo: no app de hoje ele é
   uma aba **dentro da sala da TV** (Chat · Red Carpet · Participantes ·
   Sobre), com o ranking dos looks daquela sala. Corrigido.
2. **Saudação "Olá, {nome}"** do Início de hoje faltava. Corrigida.
3. **Carrossel "Assistir agora"** da TV (anterior/próximo) faltava.
   Corrigido.
4. **Fontes:** Fjalla One (Charts e painel de playlists) e Poppins (capas)
   não estavam no protótipo. Corrigidas.

## 7. Resultado

- **Nada do que funciona hoje ficou sem lugar no Beta.** O que sai é por
  decisão do usuário (Mensagem) ou por não ter uso (código morto).
- **A versão anterior continua inteira** enquanto o Beta existir, com uma
  faixa no topo.
- **Os maiores riscos** estão em três pontos, e cada um tem teste próprio:
  a página do lançamento (que substitui o tópico do Fórum), a migração do
  Social para o D1 e a convivência das duas versões.
