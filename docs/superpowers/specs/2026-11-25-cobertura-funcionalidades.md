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
| Álbuns antigos (lista e detalhe) | Catálogo › Buscar › **Material antigo** + discografia do artista + página do lançamento | P |
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
**Material antigo** e alternância **Todos / Meus artistas** em Buscar;
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
