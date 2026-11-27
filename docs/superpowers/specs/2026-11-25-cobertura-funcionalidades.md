# Cobertura de funcionalidades — app atual → nova navegação (caminho A)

> Data: 2026-11-25 · Complementa `2026-11-25-mapa-do-app.md`.
> Fonte: todas as ações de `src/lib/api.ts`, todas as rotas `/api/*`
> chamadas pelo front e os botões das telas. Cada linha diz onde a ação
> fica no projeto novo.
>
> Legenda: **P** = desenhada no protótipo · **D** = definida aqui, ainda
> não desenhada · **!** = decisão pendente.

## Conta e app
| Ação hoje | Onde fica | |
|---|---|---|
| Login, troca de senha no primeiro acesso | igual (tela de login) | D |
| Editar nome, foto, aniversário (Perfil) | Meu Império › Editar | P |
| Nível e prestígio | Meu Império (topo) | P |
| Sair (☰ e Perfil) | Meu Império › Sair | P |
| Admin: entrar como usuário / voltar pra admin | Meu Império › Admin | P |
| Notificações push e preferências (sino) | sino + Meu Império › Notificações | P |
| Instalar app, aviso de versão nova | igual (global) | D |
| Recarregar | puxar a tela pra baixo | D |
| Busca rápida (artistas, músicas, vídeos, álbuns) | Catálogo › Buscar (no computador, campo no topo) | P |
| Popups VMA / votação / festival | iguais (um componente só) + "Pra fazer hoje" | P |
| Acesso Rápido (canais), Guia de Sobrevivência | Meu Império › Canais oficiais / Guia | P |

## Lançamentos (Gestão, Gestão Pre save, EditModal)
| Ação hoje | Onde fica | |
|---|---|---|
| Nova música / novo vídeo / novo álbum | Criar | P |
| Material antigo (álbum antigo) | Criar | P |
| Sincronizar letra (Sync Studio) | Criar + editor do lançamento | P |
| Lançar faixa de álbum | Criar | P |
| Performance Award (quando pendente) | Criar + "Pra fazer hoje" | P |
| **Editar meus materiais** (`EditModal`): editar mídia e capa, foco do lançamento, tipo, reordenar tracklist, encarte (adicionar/mover/remover), material extra, publicar faixa (abre tópico), letra e letra sincronizada | **3 entradas:** Criar › Editar lançamentos · Meu Império › Estúdio › Meus lançamentos · botão "Editar" na página do álbum/faixa (só pro dono e admin) | P |
| Pre-save: criar campanha | Criar › Pre-save | P |
| Pre-save: missão do dia | "Pra fazer hoje" | P |
| Pre-save: editar faixa, cancelar campanha | Meus lançamentos › aba Pre-save | P |
| Pre-save: página pública + banners na home | Início (banner) → página do pre-save | D |
| Meus Spotlight Banners (ver, excluir) | Meu Império › Estúdio › Meus banners | P |
| Admin: Banners, Programação da Empire TV, Painel do catálogo D1 | Meu Império › Admin (+ atalho no Criar só pra admin) | P |

## Catálogo, players, playlists
| Ação hoje | Onde fica | |
|---|---|---|
| Início do Catálogo (painel de playlists dos charts) | **Charts › Ao vivo** (sem mudança); Catálogo › Início ganha conteúdo próprio | P |
| Listas de Músicas / Vídeos / Álbuns | Catálogo › Buscar (filtros) | P |
| Álbuns antigos (lista e detalhe) | Catálogo › Buscar › **Álbuns** (junto dos outros, ano real; faixas em Músicas) + discografia do artista + página do lançamento | P |
| Minhas playlists: criar, editar, excluir | Catálogo › Biblioteca | P |
| Salvos / adicionar à playlist (`AddToPlaylistSheet`) | ⋯ de cada faixa + Biblioteca › Salvos | P |
| Player de música e vídeo persistentes, mini player da TV | mini player acima da barra | P |
| Reportar conteúdo errado / problema no vídeo | ⋯ do player, da faixa e do vídeo | P |
| Encarte, letra, material extra | página do álbum/tópico | P |

## Fórum
| Ação hoje | Onde fica | |
|---|---|---|
| Categorias Músicas/Vídeos/Álbuns, busca, filtros | aba Fórum (filtros) | P |
| "Só tópicos que não comentei" | filtro "Não comentei" | P |
| Tópico: ouvir, letra, encarte, faixas | página única do lançamento (é o tópico), aberta pelo Fórum e pelo Catálogo | P |
| Comentar, responder | tópico | P |
| Editar comentário, reações | tópico (⋯ do comentário) | P |
| Excluir tópico (admin) | ⋯ do tópico | P |
| Atividade recente (ticker) | Início › Pra você | D |

## Artistas
| Ação hoje | Onde fica | |
|---|---|---|
| Lista de artistas (todos / meus) | Catálogo › Buscar › Artistas · Meu Império › Meus artistas | P |
| Vincular / criar artista | Meu Império › Meus artistas › Gerenciar | P |
| Painel: visão geral, discografia, músicas, vídeos, charts, awards, turnês e projetos, social | página do artista (atalhos para cada seção) | P |
| Dono: trocar foto, capa, biografia | página do artista › Editar artista | P |
| Dono: rescisão | página do artista › Editar artista | P |
| Ações rápidas Álbum / Turnê | Criar | P |
| Cinema ("em breve") | Criar › Cinema (em breve) + página do artista › Turnês e projetos | P |

## Charts
| Ação hoje | Onde fica | |
|---|---|---|
| Ao vivo, Global 100, Paradas, Spotify, Apple, YouTube, Álbuns, Sales | aba Charts | P |
| Filtros de estilo e país | aba Charts | P |
| Artistas do mês: seletor de ano e mês, perfil do artista do mês com números | Charts › Spotify/Apple/YouTube › Artistas do mês | P |

## Social
| Ação hoje | Onde fica | |
|---|---|---|
| Feed, Tá na Mídia, Perfis, News | aba Social | P |
| Config (perfil social: avatar, bio, handle por rede) | Social › Perfis › Meu perfil | P |
| Postar (foto, vídeo, áudio, story, "interagir como") | Criar › Post no Social | P |
| Curtir, comentar, repostar | posts | P |
| Editar/excluir post e comentário | ⋯ do post | P |
| News: criar, editar, excluir | Social › News › Publicar notícia + ⋯ | P |

## Empire TV, Turnês, Acervo
| Ação hoje | Onde fica | |
|---|---|---|
| TV: início, grade, arquivo | Início › Empire TV | P |
| TV ao vivo: chat, GIFs, participantes, sobre, enquete (nota secreta) | sala nova da TV (6.19): chat embaixo do vídeo; Participantes, Enquete e Sobre em folhas; enquete fixada no topo do chat | P |
| Red Carpet: postar (várias fotos), curtir, ranking, excluir o seu, pílula "chegou ao Red Carpet" no chat | sala da TV › folha Red Carpet (só nos tipos de evento que têm, como hoje) | P |
| Turnês: criar (com simulação) | Criar › Nova turnê | P |
| Turnês: central, em andamento, finalizadas, mais rentáveis | Início › Turnês | P |
| Turnê: ação do dia, calendário, arrecadação, notícias, comentar, editar post, editar turnê, capa | página da turnê | P |
| Acervo: revistas, entrevistas, Forbes, Metacritic, awards | Início › Acervo | P |
| Acervo: criar/editar revista e entrevista | Início › Acervo › Publicar (quem tem permissão) | P |
| **Empirefork**: Best New Track, Top Artist, edições por mês (Arquivo), curtir, comentar | Início › Acervo › **Empirefork** (nome e aba de hoje) | P |
| Metacritic: ranking semanal com Destaques, Ranking, Artistas, Recentes, Estilo, Ano | Início › Acervo › **Metacritic** | P |

## Economia e premiações
| Ação hoje | Onde fica | |
|---|---|---|
| Ponto: distribuir (aleatório/manual), playlists, valores | Pra fazer hoje · Charts › Meu Ponto · Meu Império › Economia · barra lateral (computador) | P |
| Market: produtos, Spotlight Banner, leilão, regras | Meu Império › Market / Leilão / Como ganhar prestígio | P |
| Premiações: retroativo, indicar, votação (termo, nota, performance) | Meu Império › Premiações + "Pra fazer hoje" | P |
| Festivais: inscrição | Meu Império › Premiações e festivais | P |

## Rotas antigas
`/albuns`, `/album/$id`, `/album/$id/editar`, `/acoes/album`,
`/acoes/tour`: viram redirecionamentos para a página de álbum e para
Criar. Nenhuma URL atual deixa de abrir.

## Encontrados na 2ª conferência (chamadas montadas com variável e componentes)
| Ação hoje | Onde fica | |
|---|---|---|
| Home: carrossel de Spotlight Banners e de Pre-save | Início › Para você (topo, abaixo do "Ao vivo") | P |
| Home: ticker de atividade recente | Início › Para você | P |
| Home: Meus Artistas, "Top por plataforma", Global 100 #1, Próximos eventos (liga/desliga por `homeFlags`) | Início › Para você | P |
| Catálogo: carrossel de banners do Social (`BannerCarousel`) | Catálogo › Início (topo) | P |
| Catálogo: trocar plataforma das playlists (Spotify / Apple / YouTube) | Catálogo › Início › Por plataforma | P |
| Tela da playlist: buscar dentro da lista, salvar / adicionar à playlist | página da playlist | P |
| Vitrine de clipes do YouTube (por cima da playlist) | página da playlist › Playlist de clipes | P |
| Player de música: expandir, ver letra, "Ver no Fórum" | player expandido (mini player → toque) | P |
| Player de vídeo: mini player (popup), vídeos relacionados, "Ver no Fórum" | player de vídeo | D |
| Comentários e reações direto na mídia (`CommentModal`, `ReactionBar`) | player e tópico | D |
| Nota/score dos vídeos (`ScoreBadge`), selo verificado, selo de award | onde aparecem hoje (capas, nomes) | D |
| Pre-save: contador público, selo no Fórum, ranking (leaderboard) | página do pre-save + tópico + Meus lançamentos › Pre-save | D |
| Material antigo: editar e excluir álbum antigo (dono) | Meus lançamentos › Álbuns | D |
| Turnês: missões (`/api/turnes/missoes`) | Início › Turnês + "Pra fazer hoje" | D |
| Nova turnê: simulação de lucro (mínimo e máximo), escolha de locais | Criar › Nova turnê (tela atual) | D |
| Empire TV: canais ao vivo da Kick | Início › Empire TV (cartão "Ao vivo") | D |
| Empire TV: presença (tempo assistido vira prestígio) | automático com a sala aberta ou o mini player, entre Início e Término marcados pelo admin; soma das sessões no D1 (6.19.1); faixas, REGISTRO e prestígio iguais; mensagens não contam | D (fase 0b) |
| Empire TV: subir GIF, responder mensagem no chat, negrito/itálico | sala da TV › caixa de mensagem (GIF, Aa) e arrastar/segurar a mensagem | P |
| Social: postar como artista **ou como fã anônimo** (nome aleatório) | Criar › Post no Social (tela atual) | D |
| Social: escolher rede (Instagram, TikTok, Twitter), anexar música, modo de publicação, texto rico com emoji | Criar › Post no Social (tela atual) | D |
| Social: seguir perfis, ver stories | Social › Perfis e Feed | P |
| Página de award (`/awards/$nome`) | Início › Premiações › Awards → página do award (visual de hoje) | D |
| Notificações: marcar como lidas | sino | D |
| Instalar o app (aviso) | igual | D |
| Registro de erros, heartbeat do login | automático (sem tela) | D |

## Encontrados na 3ª conferência (todos os 676 elementos clicáveis)
Método: script que lê a árvore do código (TypeScript) e lista o texto de
todo `button`, `Link`, `a`, `label` e todo elemento com `onClick`, em
todas as telas e componentes. Cada um foi cruzado com esta lista.

| Ação hoje | Onde fica | |
|---|---|---|
| **Playlists da Comunidade** (aba "Comunidade" × "Minhas") | Catálogo › Início (prateleira) + Catálogo › Biblioteca | P |
| Editor de playlist: adicionar faixa do Catálogo, por **upload de áudio** ou por **link** | editor de playlist (tela atual) | D |
| Nova música: participantes (feat 2 a 6), **substituir música existente**, vincular comentários a música já lançada, botões do tópico, letra | Criar › Nova música (tela atual) | D |
| Novo vídeo: categoria, músicas vinculadas, **lançar num programa da Empire TV da semana**, participantes, capa/thumb | Criar › Novo vídeo (tela atual) | D |
| Novo álbum: **Registrar** ou **Substituir nos Charts** (troca capa, encarte, adiciona faixas), álbum retroativo, quantidade de faixas, revisar e confirmar | Criar › Novo álbum (tela atual) | D |
| Editor de lançamento: adicionar faixa ao álbum (existente ou nova, com upload), trocar áudio, nova descrição, categoria, trocar thumb/capa, botões do tópico | Meus lançamentos › Editar | P |
| Material extra: abas Shop (adicionar produto, comprar), Info e Visual; blocos de imagem, texto e HTML | editor de lançamento + página do álbum | D |
| Sync Studio: marcar linha, adiantar/atrasar 0,2s, desfazer, adicionar/remover linha, pré-visualizar | Criar › Sincronizar letra e editor | D |
| Pre-save: "Contador em 0? Verificar/corrigir", Top (ranking), calendário de missões (aleatório), missão com perguntas e respostas, Post TikTok, vídeo real (Fórum), publicar por um perfil de "Tá na Mídia" | Meus lançamentos › Pre-save + missão | P (Top, contador) / D |
| Fórum: **marcar como pendente** (admin), filtros por artista e por data (de/até), "só tópicos que eu ainda não comentei", capa em tela cheia | aba Fórum › Filtros e tópico | P |
| "Avaliar & Comentar": comentário com o **nome do jogador logado (fixo, não editável)** + nota em faixa (Metacritic: 45-60, 61-75, 76-90, 91-100; ou intervalo de Likes) | tópico do Fórum | D |
| Admin › Painel do catálogo: ligar/desligar D1, enviar fila agora, conferir backup | Meu Império › Admin | P |
| Admin › Empire TV: abrir arquivo do vídeo, vincular música, publicar tópico | Meu Império › Admin | P |
| Admin › Banners: imagem, link de destino, legenda | Meu Império › Admin | P |
| Charts: **Mundo / Por país**, **Artistas do mês**, "#1 agora", busca dentro do chart | aba Charts | P |
| Acervo: o nome é **Empirefork** (não Pitchfork); editor de revista por páginas (+ imagem, + texto), entrevista com perguntas, "Ler revista", Metacritic com "Ver música" e "Ver artista", filtro por artista | Início › Acervo | P (nome) / D |
| Market: tipos eCoin, boost de música, boost de álbum; Resgatar; Ativar | Meu Império › Market (tela atual) | D |
| Leilão: substituir lance | Meu Império › Leilão (tela atual) | D |
| Votação: salvar pra mais tarde, visitar fórum (com aviso de não salvo), termo de voto, nota de 5 a 10, "Me arrependi, quero performar" | Meu Império › Premiações › Votação (tela atual) | D |
| Social: carrossel de fotos, stories (anterior/próximo), perfil do artista por rede (Instagram, Twitter, TikTok), Seguir, "Ler matéria" (Exclusivo) | aba Social | P (parcial) / D |
| Composer do Social: modo **Normal** ou **Blackout** (só no Social: posta com outro nome), Feed ou Story, Foto/Vídeo ou Música, com ou sem som | Criar › Post no Social (tela atual) | D |
| Empire TV: carrossel "Assistir agora", ativar som, **minimizar (continua tocando)**, negrito/itálico no chat, Red Carpet com Feed e **Ranking**, várias fotos por look | Início › Empire TV + sala | P (ranking, minimizar) / D |
| Mini player da TV: expandir, fechar | mini player | D |
| Turnês (lista): "Ver mais", comentar direto no card | Início › Turnês | D |
| Recorte de imagem: "Usar original" | igual em todo upload | D |
| Artistas: alternar Todos / Meus | Catálogo › Buscar › Artistas + Meu Império | P |

### Botão que não funciona hoje
**Social › perfil do artista › "Mensagem"**: o botão existe, mas não tem
ação nenhuma (`src/routes/social.tsx`, perto das linhas 2373 e 2661).
**!** Decidir: tirar o botão ou criar mensagens diretas (projeto novo).

## 4ª conferência: janelas internas, listas de opções e botões mortos
Método: (1) todo estado que abre janela, folha ou painel
(`set…Open/Modal/Show/Viewer…`); (2) toda lista fixa de opções no código;
(3) script que acha todo `<button>` sem ação nenhuma.

### Itens que faltavam
| Ação hoje | Onde fica | |
|---|---|---|
| Fórum: **Editar tópico (admin)** (`setShowAdminEditModal`) | ⋯ do tópico (admin) | D |
| Fórum: capa em tela cheia (`setCoverExpanded`) | tópico | D |
| Acervo: editor de **blocos de texto** da revista (`setTextoModal`) | Início › Acervo › editar revista | D |
| Social: **visualizador de TikTok em tela cheia** (`setTiktokViewer`), com rolagem vertical | Social › Vídeos | P |
| Social: perfil por rede com layout nativo: Instagram (grade), Twitter (lista), TikTok (grade de vídeos) + "Siga também" | Social › perfil do artista | P |
| Composer: escolher faixa de álbum, anexar música/álbum, escolher áudio (`setAlbumTrackPicker`, `setIsMaterialPickerOpen`, `setIsAudioPickerOpen`) | Criar › Post no Social | D |
| Composer Blackout: nome gerado de "fã, insider, leak, anônimo, ghost, fonte" + número | Criar › Post no Social | D |
| Tipos de música: Solo, Parceria, Dueto, Conjunto | Criar › Nova música e editor | D |
| Tipos de álbum: EP, Álbum, Deluxe, Edição Especial | Criar › Novo álbum | D |
| Gravadoras: King & Queen, Crown, Independent | Meu Império › Meus artistas › Criar | D |
| Ponto: categorias Geral, Extra, Featuring e as tabelas de % por plataforma | Meu Império › Ponto (tela atual) | D |
| Reações com emoji (12) e seletor de emoji do texto rico | Fórum e Social | D |

### Botões que aparecem mas não fazem nada hoje (todos no Social)
| Botão | Onde (`src/routes/social.tsx`) |
|---|---|
| Compartilhar (feed e TikTok em tela cheia) | ~410, ~1965 |
| Repostar (mostra sempre "0", não é botão) | ~2611 |
| Mensagem (perfil Instagram e TikTok) | ~2373, ~2661 |
| Abas do perfil Instagram: Reels, Marcados (só a grade funciona) | ~2438–2444 |
| Abas do perfil Twitter: Respostas, Mídia, Curtidas (só Posts funciona) | ~2546 |
| Abas do perfil TikTok: Curtidos; botão de perfil | ~2664, ~2686–2689 |

**Seguir / Seguindo:** só muda na tela (estado local). Não salva e volta
ao normal quando o app recarrega. O número de seguidores vem fixo da
planilha (`SOCIAL_PERFIS.seguidores`).

Como não funcionam hoje, nenhum desses entra na regra de "nada fica de
fora". Mas são decisões: tirar, ou fazer funcionar. A proposta para cada
um está na análise dos perfis do Social.

### Correções no protótipo
- Repostar e Compartilhar apareciam funcionando: agora estão marcados
  **NOVO** (proposta).
- "Na Mídia" aparecia como lista de matérias. O correto é a **grade de
  perfis de mídia** (perfis compartilhados, `telegram_id = "Todos"`), que
  qualquer jogador pode usar pra postar e interagir. As matérias são a aba
  **News**.
- "Seguindo / Para você", "Lembrar" (na grade da TV) e "Pra fazer hoje":
  propostas novas, marcadas **NOVO**.

## Decisões do usuário (2026-11-25)
- **Repostar:** passa a existir nas 3 redes. Quem reposta é o artista do
  "Interagindo como". O post volta ao topo do feed (ordem por última
  atividade = data do post ou do repost mais recente) com "Fulano
  repostou". Desfazer o repost devolve a ordem anterior. *(Rede e desfazer:
  call meu.)*
- **Mensagem:** sai do app (os 2 botões de `social.tsx`).
- **Seguir:** passa a ser de verdade, **entre artistas**: quem segue é o
  artista do "Interagindo como", em cada rede. Perfis de mídia
  (compartilhados) não seguem ninguém. *(Call meu.)* **!** Falta decidir o
  que acontece com o número de seguidores que hoje vem da planilha.
- **Charts › Ao vivo:** passa a ser o painel que hoje é o Início do
  Catálogo, sem mudança (destaque "Mais quente agora", Top 100 ao vivo por
  plataforma, Top 50 por país, playlists da semana). Ele substitui o "Ao
  vivo" atual. Nada se perde: "Mundo" = Top 100 ao vivo por plataforma;
  "Por país" = Top 50 por país (mesmos dados, mesmo intervalo de 30 s).
- **Outros charts:** formato de playlist + recursos de chart (semana com
  setas, movimento, pico, semanas, filtros de movimento, detalhe com
  histórico de 8 semanas e números por plataforma). Mantém tudo o que
  existe hoje: Global / Por país / Artistas do mês, semana, estilo, busca.
- **Catálogo › Início:** ganha conteúdo próprio (Continue ouvindo,
  Lançamentos da semana, Mais comentados no Fórum, Playlists da
  comunidade, Clipes novos, atalho para Charts ao vivo).

## Encontrados na revisão do design (2026-11-25)
| Ação hoje | Onde fica | |
|---|---|---|
| **Config do Social: campo "Seguindo" digitado à mão** (grava na coluna H de `SOCIAL_PERFIS`) | substituído pela contagem real de quem o artista segue (decisão do usuário: "o seguindo pode ser a quantidade real") | **!** confirmar o que acontece com o número digitado |
| Seguidores exibidos da coluna G de `SOCIAL_PERFIS` (a tela diz "calculados automaticamente pela coluna G"); perfis de mídia com 10.000.000 | substituído pela fórmula de seguidores | **!** confirmar se a coluna G já tem fórmula e o que fazer com os perfis de mídia |

## Fora deste projeto
**Bolsa e Empresas** (`historicoBolsa`, `listarEmpresas`, `minhasEmpresas`
no `api.ts`): ainda não foram lançadas e entram depois, no projeto
**EmpireVerse**. Não ganham lugar na navegação agora. As três funções
saem do `api.ts` na etapa de limpeza de código. Antes disso, é preciso
confirmar se o backend das três tem algo que o EmpireVerse vá
reaproveitar.

## Correções desta lista
- 2026-11-25: a 3ª conferência dizia que dava pra "comentar como OFF" no
  Fórum. **Errado.** O rótulo do campo é "Nome do Jogador / OFF", mas o
  campo é somente leitura e sempre mostra o jogador logado. **Não existe
  comentário anônimo no Fórum**, nem vai existir no projeto novo.

## 5ª conferência (2026-11-25, protótipo versão 11)
Cruzamento das linhas marcadas **P** com o protótipo. Faltavam e foram
desenhados: carrosséis de banner (Início e Catálogo), ticker, Meus
artistas, Top por plataforma e Próximos eventos no Início; filtro
alternância **Todos / Meus artistas** em Buscar (o filtro Material antigo saiu: catálogo único);
ano/mês em Artistas do mês; busca, salvar e **Playlist de clipes** na tela
de playlist; grupo **Biblioteca** no Meu Império; **Top** e **Contador em
0?** no Pre-save; **player expandido** (letra, Ver no Fórum, ⋯); Responder
no chat da TV; nome **"Tá na Mídia"** (era "Na Mídia" no protótipo).
Linhas desatualizadas pelas decisões (Ao vivo, Empirefork, Metacritic,
página única do lançamento) foram reescritas acima.

## 6ª conferência (2026-11-25, protótipo versão 13)
Ângulo: coerência entre o documento de design e o protótipo depois das
últimas decisões. Corrigido no documento: nome "Tá na Mídia", filtro de
rede como botão "Redes ▾", ♡ e ⋯ no cabeçalho da página do lançamento,
"Não comentei" na fileira do Fórum, ordem do Início (U8), D3 aprovada.
Faltavam no protótipo e foram desenhados: resultados agrupados da busca ao
digitar; "Marcar todas como lidas" e "Configurar" nas notificações.
Encontrado e registrado: página 404 em inglês. Não coberto ainda:
**layout de computador/tablet** (o protótipo e o documento só tratam o
celular) — ver próximos passos.

## 7ª conferência: regras do tutorial do usuário (2026-11-25)
Regras de uso que já existem e precisam continuar iguais (vieram do
tutorial em Google Docs):
| Regra hoje | Onde fica | |
|---|---|---|
| Vídeo: só a categoria **Music Video** conta para charts, **um por single** | Criar › Novo vídeo (tela atual) | D |
| Vídeo: link de **Drive, YouTube ou Vimeo**, com compartilhamento público; upload direto possível (menos indicado) | Criar › Novo vídeo (tela atual) | D |
| Vídeo: a música vinculada precisa já estar publicada | Criar › Novo vídeo (tela atual) | D |
| Música: título só com nome e tags ([REMIX] etc.), featuring em campo próprio | Criar › Nova música (tela atual) | D |
| Capa do artista com medidas diferentes para computador e celular, com explicação na tela | Página do artista › Gestão › Capa do perfil | P |
| Retroativo pede data aproximada do lançamento real | Criar › Novo álbum › Retroativo (tela atual) | D |
| Vincular artista: só moderação | Meu Império › Meus artistas › Gerenciar | P |

## Decisão do usuário: Acervo → Imprensa (Social) e Premiações (Início) (2026-11-25)
| Ação hoje | Onde fica agora | |
|---|---|---|
| Acervo: Revistas, Entrevistas, Forbes, Metacritic, Empirefork (tudo o que já estava listado) | **Social › Imprensa** (mesmos nomes e conteúdo) | P |
| Social › News (matérias, publicar, editar, excluir) | **Social › Imprensa › News** | P |
| Acervo › Awards (vitrine de pôsteres e `/awards/$nome` com capa, segmentos, anos, vencedor com moldura dourada e indicados) | **Início › Premiações › Awards**, mesma vitrine e mesma página | P |
| Perfil › Premiações (Retroativo, Indicar, Votação) e Festivais (Inscrição) | **Início › Premiações** (Abertas agora, Seus prêmios) + atalhos em Meu Império | P |
| Seção "Revistas & Entrevistas" da home | Início › Para você › **Da Imprensa** | P |

## 8ª conferência: links diretos, fontes e estados visíveis (2026-11-25)
| Achado | Onde fica |
|---|---|
| Links `?tab=&id=` do Fórum usados por notificações, home, player, Imprensa e banners | abrem direto a página do lançamento (design 5.1) |
| `/social?postId`, `/social?artist`, `/charts?tab`, `/tours/$nome?id`, `/artistas?filter`, `gestao?tab&nome`, `album-antigo?id`, `/acoes/*?nome` | listados no design 5.1, com teste |
| Banners com link externo (abrem em nova aba) | iguais |
| Fontes Fjalla One (Charts e painel) e Poppins (capas dinâmicas) | mantidas (design 6.17); protótipo corrigido |
| Aviso "Vendo como … — Voltar a ser admin" | faixa fixa em todas as telas no Beta (design 6.18) |
| Press Start 2P carregada sem uso | sai na limpeza |

## 9ª conferência — sala da Empire TV (2026-11-25)

Conferido contra `src/routes/tv.tsx` (`WatchView`, `ChatPanel`,
`EnqueteBanner`, `RedCarpetPanel`, `RedCarpetComposer`,
`ParticipantesPanel`, `SobrePanel`) e `backend/src/controllers/tvController.ts`.

| Função de hoje | Na sala nova | Status |
|---|---|---|
| Voltar, minimizar (continua tocando) | ⌄ no canto do vídeo; voltar do celular fecha folha → sala → tela anterior | P |
| Ativar som | "Toque para assistir com som" (D5, teste em `/tv-teste-som`) | pendente do teste |
| Abas Chat · Red Carpet · Participantes · Sobre | chat fixo + fileira rolável que abre folhas | P |
| Enquete por nota da planilha (notaMin–notaMax, voto secreto, "Você votou N", atualiza a cada 20 s) | continua igual, fixada no topo do chat; também pode ser criada pelo admin na sala como tipo "Nota" | P |
| Carregar mensagens mais antigas | carrega sozinho ao rolar para o topo | P (muda o gatilho) |
| Responder, cancelar resposta, citação | arrastar para a esquerda ou segurar › Responder; barra "Respondendo a…" com ✕ | P |
| Negrito `*texto*`, itálico `_texto_` | botão Aa | P |
| GIFs: escolher, enviar, subir novo (fica para todos), abas Mais usados e Recentes, contagem de uso | botão GIF › folha; ordem muda ao vivo (6.19.3) | P |
| Pílula "Fulano chegou ao Red Carpet" que abre o look | igual, no meio do chat | P |
| Mensagens pendentes (meia opacidade até confirmar) | igual | D |
| Red Carpet: postar com várias fotos, carrossel de fotos, curtir, ranking, excluir o seu | folha Red Carpet | P |
| Participantes | folha, com a **mesma %** que será creditada | P (número muda: 6.19.1) |
| Sobre | folha (toque no nome do programa) | P |
| Presença a cada 30 s | só tempo com a sala aberta ou o mini player entre Início e Término do admin; minutos enviados a cada 5 min (D1, uma linha por pessoa); mensagens não contam | D (fase 0b) |
| — | enquetes criadas pelo admin no chat (única/múltipla), resultado no chat, arquivo 📊 Enquetes; botões Início/Término do evento (admin); reações com emoji, "↓ N novas", celular deitado com chat lateral, círculo da sua participação | **NOVO** |

## 10ª conferência — o que entrou na `main` depois do início (2026-11-26)

Merge de `origin/main` (fonte única de artistas, commits `9aa001d`…`56b6838`)
na branch do projeto. Conferido em `src/routes/artistas.$nome.index.tsx`,
`src/components/EmpirePlay/AvisoPerfilArtistas.tsx`, `Gestao.tsx`,
`PainelCatalogoD1.tsx` e `LoginScreen.tsx`.

| Função nova | No Beta | Status |
|---|---|---|
| Nacionalidade do artista (escolher uma vez; travada depois; admin troca) | página do artista › Gestão › Perfil do artista | D |
| Estilo principal (lista fechada, troca quando quiser) | página do artista › Gestão › Perfil do artista | D |
| Admin: "Atualizar a partir da planilha" (um artista) | página do artista › Gestão › Só admin | D |
| Admin: "Atualizar todos os artistas a partir da planilha" | Meu Império › Admin › Painel do catálogo | D |
| Aviso "Complete o perfil de {artista}" na Gestão | Criar › Gestão (igual) + Início › Pra fazer hoje + Meu Império › Meus artistas | P |
| Link `/artistas/$nome?aba=gestao` | tabela 5.1 | D |
| `isAdminLogin` (critério único de admin) | base do `useIsAdmin` (fase 0) | D |
| Perfil, prêmios, votação e charts lendo o espelho D1 `artistas` | sem mudança de tela | D |
| — | **NOVO:** nacionalidade (bandeira) e estilo visíveis para todos abaixo do nome (tocáveis: charts do país, página do gênero) e "Ficha do artista" no começo da Visão Geral | página do artista | **NOVO** |
| Chart Runs na aba Charts do artista (pico + semanas, top 10, só Global 100) | aba Charts do artista: sequência de posições de cada música, Peak, 4 charts | P (mais completo) |
| — | **NOVO:** ouvintes mensais (Spotify) abaixo do nome e Ranking do mês (Spotify, Apple, YouTube) na Visão Geral, da planilha mensal | página do artista | **NOVO** |

## 11ª conferência — textos de botões do código × protótipo e documentos (2026-11-26)

Varredura automática: 387 rótulos de botões, abas, links e `aria-label` em
`src/routes` e `src/components` comparados com o protótipo e os documentos.
47 não tinham correspondência escrita; conferidos um a um. **Todos ficam,
dentro das mesmas telas de hoje** (nenhuma lógica muda):

| Rótulo(s) no app de hoje | Onde está hoje | No Beta |
|---|---|---|
| Continente, Africano, Asiático, Europeu, Norte-Americano, Sul-Americano, Oceania, Arena, Estádio | `acoes.tour.tsx` (criar turnê) | Criar › Nova turnê (tela de hoje) |
| Gerar automático, Por espaçamento | `CreateTourSheet.tsx` | Criar › Nova turnê (tela de hoje) |
| Sold Outs, Sorteio de ingressos VIP, Colab surpresa | `tours.$nome.tsx`, `tours.index.tsx` | Início › Turnês › página da turnê |
| Aumentar/Diminuir quantidade de faixas, Música Referenciada | `Gestao.tsx` | Criar › Novo álbum / Novo vídeo |
| Contracapa (opcional) | `acoes.album.tsx`, `album.$id.editar.tsx` | Criar › Novo álbum e Meus lançamentos › Editar |
| Gerar (data do material antigo) | `gestao.album-antigo.tsx` | Criar › Material antigo |
| Desafio de som, Making of, Post de anúncio, Capa alternativa, status Cancelada | `GestaoPreSave.tsx` | Criar › Pre-save (missões, tela de hoje) |
| Desfazer última marcação, Limpar marcação | `SyncStudioModal.tsx` | Criar › Sincronizar letra / Meus lançamentos |
| Sublinhado (barra de formatação) | `RichTextToolbar.tsx` (comentário do Fórum) | página do lançamento › Avaliar & Comentar |
| Rostos, Gestos, Corações, Música & Estrelas, Objetos & Comemoração | `EmojiPicker.tsx` (Fórum, reações) | página do lançamento e Social (mesmo seletor) |
| Gerar nome aleatório | `SocialPostComposer.tsx` (post como fã) | Criar › Post no Social |
| Selecionar artista | `charts.tsx` (Artistas do mês) | Charts › Artistas do mês |
| Entenda os prestígios | `market.index.tsx` → `/market/regras` | Meu Império › Market › Entenda os prestígios (mesma URL) |
| Desativar neste aparelho | `NotificationBell.tsx` (push) | Meu Império › Notificações |
| Já indiquei, Já me inscrevi, Já votei | popups diários | iguais (encadeados) |
| PRÓXIMA ATRAÇÃO | `tv.tsx` | Início › Empire TV (grade) |
| Vincule seu primeiro artista (estado vazio) | `perfil.tsx` | Meu Império › Meus artistas (estado vazio) |
| Tentar novamente | `LoadErrorState.tsx` | todas as telas com erro de carga |
| Vamos lá! | `tutorial.tsx` | Meu Império › Como usar |
| Conectar (modal do ID do Telegram) | `__root.tsx` | sai, como já decidido na seção 7 do design |
| Salvando…/Salvar Alterações, Enviando…/Publicar Comentário | `EditModal.tsx`, `CommentModal.tsx` | iguais |

## 12ª conferência — todas as ações de criar e editar (2026-11-26)

Levantadas pelo código (`Gestao.tsx`, `EditModal.tsx`, `GestaoPreSave.tsx`,
`ExtraMaterial.tsx`, `acervo.tsx`, `social.tsx`, `tours.$nome.tsx`,
`CreateTourSheet.tsx`, `market.index.tsx`, playlists, premiações, perfil) e
pelas rotas de gravação do servidor (`backend/src/routes/api.ts`).

| Ação de hoje | Onde está hoje | No Beta | Status |
|---|---|---|---|
| Nova música | Gestão › Músicas | Criar › Nova música | P |
| Novo vídeo (link ou upload) | Gestão › Vídeos | Criar › Novo vídeo | P |
| Álbum: Registrar novo / Substituir nos Charts / Retroativo | Gestão › Álbuns | Criar › Novo álbum › 3 opções | P (era só um botão; corrigido) |
| Material antigo | Gestão (topo) | Criar › Material antigo | P |
| Lançar faixa de álbum (pendentes) | Gestão (topo) | Criar › Faixa de álbum | P |
| Sincronizar letra | Gestão (topo) + EditModal | Criar › Sincronizar letra + Meus lançamentos | P |
| Performance Award (pendente) | Gestão (topo) | Criar › Performance Award (só com pendência) | P |
| Pre-save: nova campanha (com/sem missões, material extra) | Gestão Pre save | Criar › Pre-save › Nova campanha | P (sub-opções desenhadas) |
| Pre-save: completar missão, editar faixa, ranking, cancelar | Gestão Pre save | Criar › Pre-save › Minhas campanhas + Meus lançamentos › Pre-save | P |
| Editar meus materiais (título, capa/thumb, áudio, descrição, categoria, letra, feat, foco, tracklist ▲▼, adicionar faixa, encarte, publicar faixa, tipo ao publicar, material extra) | Gestão › Editar meus materiais | Criar › Editar meus lançamentos (e página do lançamento) | P (＋ Adicionar faixa desenhado agora) |
| Material antigo: editar e excluir | EditModal | Meus lançamentos › Álbuns | D |
| Post no Social (como artista ou fã anônimo, "Gerar nome aleatório"), editar, excluir | Social | Criar › Post no Social + ⋯ do post | P |
| Comentar, editar comentário (Social) | Social | post | P |
| Notícia (News): publicar, editar, excluir | Social › News (＋) | Social › Imprensa › News + **Criar › Notícia** | P (atalho novo) |
| Revista (páginas + Imagem/+ Texto), editar a sua | Acervo (＋) | Social › Imprensa › Revistas + **Criar › Revista** | P (atalho novo) |
| Entrevista (perguntas) | Acervo (＋) | Social › Imprensa › Entrevistas + **Criar › Entrevista** | P (atalho novo) |
| Comentar e curtir no Empirefork | Acervo › Empirefork | Social › Imprensa › Empirefork | D |
| Nova turnê (continente, local, simular, gerar automático, por espaçamento) | Tours › Criar | Criar › Nova turnê | P |
| Editar turnê (nome, capa) e ação do dia; editar ação (título, capa, resumo, texto, foto); comentar | página da turnê | página da turnê + Pra fazer hoje | P |
| Nova playlist, editar (adicionar faixa por catálogo/upload/link), excluir | Catálogo › Playlists | Catálogo › Biblioteca + **Criar › Nova playlist** | P (atalho novo) |
| Salvar / adicionar à playlist | ⋯ da faixa | ⋯ da faixa + Biblioteca | P |
| Criar artista, vincular (moderação) | Perfil › Gerenciar | Meu Império › Meus artistas + **Criar › Novo artista** | P (atalho novo) |
| Artista: foto, capa, biografia, nacionalidade, estilo, rescindir | página do artista › Gestão | igual | P |
| Editar perfil (nome em OFF, foto), trocar senha | Perfil / login | Meu Império › Perfil / login | P |
| Social › Config (@, foto, bio por rede) | Social › Config | Meu Império › Perfil no Social | P |
| Red Carpet: postar look (várias fotos), excluir o seu | sala da TV | sala da TV › Red Carpet | P |
| Enviar GIF novo no chat | sala da TV | sala da TV › GIF | P |
| Fórum: avaliar e comentar, editar comentário, reagir | tópico | página do lançamento | P |
| Premiações: preencher retroativo, indicar (e **remover indicação** em "Suas indicações"), votar (nota, termo), inscrição em festival | Perfil › Premiações / Festivais | Início › Premiações (telas de hoje) | P (remover indicação: D, tela de hoje) |
| Ponto: distribuir (aleatório/manual, limpar), playlists (iniciar, investir, limpar) | /ponto | Meu Império › Economia › Ponto (telas de hoje) | P |
| Market: comprar, lance no leilão, **Spotlight Banner** (comprar com imagem) | Market | Meu Império › Market (telas de hoje) | P |
| Reportar problema no player (vídeo/conteúdo errado) | players | players | D |
| Admin: banners, programação/publicar vídeo da TV, painel do catálogo, atualizar artistas, excluir/restaurar tópico, marcar pendente, enquete e Início/Término na sala | vários | Criar › Só admin + Meu Império › Admin + sala da TV | P |

**Rotas de gravação sem botão no app hoje (conferido, não é perda):**
- `/api/acervo/metacritic/atualizar`: força o ranking semanal do Metacritic
  na hora. O ranking já é gerado **sozinho pelo cron toda semana**; a rota
  é só para forçar. No Beta ganha um botão de admin: **Meu Império › Admin
  › Metacritic: atualizar agora**.
- `/api/presave/vincular-faixa-existente`: conserto pontual de um bug já
  corrigido (faixa de pre-save cadastrada como inédita porque a busca de
  "Música existente" falhava). O jeito normal de vincular música existente
  continua no formulário do pre-save. Fica como ferramenta manual, igual às
  rotas `admin/diag*`/`fix*`.
| Destaque de comentários (cartão com o último comentário) na página do lançamento | removido a pedido do usuário; fica o botão fixo "Avaliar & Comentar" e a lista de comentários | P |

## 13ª conferência — o que entrou depois da 12ª (2026-11-27)

Conferido: `main` até `e5cbbcd` (já juntada na branch), os commits da sala da
Empire TV desta branch (PR #956) e todas as 58 rotas de `src/routes` contra
este documento e o documento de design. Nenhuma rota ficou sem lugar no Beta.
O que faltava foi colocado no protótipo (versão 36) e no documento de design.

| Função | Onde estava faltando | No Beta | Status |
|---|---|---|---|
| **Gestão de usuários** (admin): buscar por nome ou ID, filtro "Só bloqueados", Deslogar (todos os aparelhos), Bloquear e Desbloquear, sempre com confirmação | protótipo e documentos | Meu Império › Admin › Gestão de usuários | **P** (novo no protótipo) |
| Quem for deslogado/bloqueado volta para o login na próxima ação (sem checagem periódica) | documentos | comportamento global (fase 0) | D |
| Player do app na sala: "Ativar som" com um toque, troca ⇄ "Player Kick"/"Player do app" (salva no aparelho), tela cheia, volta automática para a Kick | protótipo | sala da TV › vídeo | **P** (novo no protótipo) |
| Enquete: **voto anônimo ou público** escolhido por quem cria; "Ver quem votou" na pública (nunca com "resultado só no fim" ainda aberta) | protótipo tinha "Voto secreto" fixo | sala da TV › Nova enquete / cartão da enquete | **P** (corrigido) |
| Enquete: encerrar sozinho em **2, 5, 10 ou 15 min** (relógio do servidor) | protótipo só tinha "5 min" | sala da TV › Nova enquete | **P** (corrigido) |
| Enquete: baixar CSV (com a coluna Votantes nas públicas) | — | sala da TV › 📊 Enquetes (admin) | P |
| Chat: botão "↑ Ver mensagens anteriores" (além de carregar sozinho ao rolar) | protótipo tinha só o texto | sala da TV › chat | **P** (corrigido) |
| Sala no endereço (`/tv?sala=`): recarregar volta para a mesma sala; com a sala aberta o app não recarrega sozinho (pílula "Atualizar") | documentos | comportamento da sala | D |
| Participação pelo tempo com a sala ou o mini player aberto; botões de admin Início/Término | — | sala da TV › faixa "Só admin" e círculo de % | P |
| Páginas escondidas de diagnóstico (`/tv-teste-som`, `/tv-teste-hls`) | — | só admin, sem lugar no menu (ficam como hoje) | D |

## 14ª conferência — revisão final antes de começar a migração (2026-11-27)

Varredura automática repetida: 735 rótulos de botões, abas, links e
`aria-label` em `src/routes` e `src/components`, comparados com a 11ª
conferência. **61 rótulos novos**, todos conferidos:

| Rótulos novos | De onde vêm | No Beta |
|---|---|---|
| Completar (aviso "Complete o perfil"), Salvar estilo, Salvar nacionalidade, Confirmar, Atualizar a partir da planilha, Atualizar todos os artistas | fonte única de artistas (10ª) | página do artista › Gestão; Admin › Painel do catálogo (D) |
| Gestão de usuários (admin), Todos/Bloqueados, Deslogar, Bloquear, Desbloquear | `gestao-usuarios.tsx`, `perfil.tsx` (13ª) | Meu Império › Admin › Gestão de usuários (P) |
| Início do evento, Término, Nova enquete, Publicar no chat, Escolha única/Múltipla escolha, Voto anônimo, Resultado só no fim, Adicionar opção, Votar, **Mudar voto**, Encerrar, Ver quem votou/Ocultar, Baixar planilha (CSV), Atualizar | sala da TV (PR #956) | sala da TV (P). "Mudar voto" entrou no protótipo nesta conferência |
| Ativar som, Tela cheia, Player Kick/Player do app | player do app (D5) | sala da TV › vídeo (P) |
| Responder, Copiar texto, ↓ novas, ↑ Ver mensagens anteriores, Tentar de novo, Sobre a transmissão, avisos 📊/🏁 de enquete | chat da sala (PR #956) | sala da TV › chat (P) |
| "Nova versão disponível — atualizar agora" (pílula Atualizar) | `tv.tsx` (sala não recarrega sozinha) | sala da TV (D: comportamento) |
| Expandir transmissão | `TvMiniPlayer.tsx` | mini player (P) |
| Canal da Kick, Carregar, Recarregar, Link .m3u8 | `/tv-teste-som`, `/tv-teste-hls` | páginas escondidas de diagnóstico, só admin, sem lugar no menu (ficam como hoje) |
| Next/Previous slide, Toggle Sidebar | `ui/carousel.tsx`, `ui/sidebar.tsx` (biblioteca, inglês) | componentes de base; textos em português se aparecerem para o jogador |

Também conferido nesta rodada:
- **Story sem legenda:** o servidor recusava post sem texto (Story, Feed e
  TikTok só com mídia). Corrigido no app de hoje (`81c9a97`). No Beta vale a
  mesma regra: legenda, mídia OU material.
- **Enquete antiga da planilha** (`EnqueteBanner`, aba ENQUETES): desligada
  por decisão do usuário; as enquetes do chat a substituem. **Não é perda:**
  a mesma função existe no chat, com mais opções.
- **Compartilhar do chart** (6.22): função nova do Beta, fase 2.
- **Enquete tipo Nota**: função nova do Beta, fase 1b.

**Resultado:** nada do app de hoje fica sem lugar no Beta.
