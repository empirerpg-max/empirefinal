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
| Busca rápida (artistas, músicas, vídeos, álbuns) | lupa no topo → Catálogo › Buscar | P |
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
| Início do Catálogo (playlists dos charts) | Catálogo › Início | P |
| Listas de Músicas / Vídeos / Álbuns | Catálogo › Buscar (filtros) | P |
| Álbuns antigos (lista e detalhe) | discografia do artista + mesma página de álbum | P |
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
| Tópico: ouvir, letra, encarte, faixas | tópico + "Ver no Catálogo" | P |
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
| Filtro de mês, foco por país | aba Charts | P (mês) / D (foco) |

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
| TV ao vivo: chat, GIFs, participantes, sobre, enquete | sala da TV | P |
| Red Carpet: postar, curtir, ranking, excluir | Início › Empire TV › Red Carpet | P |
| Turnês: criar (com simulação) | Criar › Nova turnê | P |
| Turnês: central, em andamento, finalizadas, mais rentáveis | Início › Turnês | P |
| Turnê: ação do dia, calendário, arrecadação, notícias, comentar, editar post, editar turnê, capa | página da turnê | P |
| Acervo: revistas, entrevistas, Forbes, Metacritic, awards | Início › Acervo | P |
| Acervo: criar/editar revista e entrevista | Início › Acervo › Publicar (quem tem permissão) | P |
| Pitchfork: edições por mês, curtir, comentar | Início › Acervo › Críticas | P |
| Ranking (destaques, ranking, artistas, recentes, estilo, ano) | Início › Acervo › Ranking | P |

## Economia e premiações
| Ação hoje | Onde fica | |
|---|---|---|
| Ponto: distribuir (aleatório/manual), playlists, valores | Meu Império › Ponto | P |
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
| Home: carrossel de Spotlight Banners e de Pre-save | Início › Para você (topo, abaixo do "Ao vivo") | D |
| Home: ticker de atividade recente | Início › Para você | D |
| Home: "Top por plataforma" e Global 100 #1 (liga/desliga por `homeFlags`) | Início › Para você | P (#1) / D (top) |
| Catálogo: carrossel de banners do Social (`BannerCarousel`) | Catálogo › Início (topo) | D |
| Catálogo: trocar plataforma das playlists (Spotify / Apple / YouTube) | Catálogo › Início › Por plataforma | P |
| Tela da playlist: buscar dentro da lista, salvar / adicionar à playlist | página da playlist | D |
| Vitrine de clipes do YouTube (por cima da playlist) | página da playlist › Clipes | D |
| Player de música: expandir, ver letra, "Ver no Fórum" | player expandido (mini player → toque) | D |
| Player de vídeo: mini player (popup), vídeos relacionados, "Ver no Fórum" | player de vídeo | D |
| Comentários e reações direto na mídia (`CommentModal`, `ReactionBar`) | player e tópico | D |
| Nota/score dos vídeos (`ScoreBadge`), selo verificado, selo de award | onde aparecem hoje (capas, nomes) | D |
| Pre-save: contador público, selo no Fórum, ranking (leaderboard) | página do pre-save + tópico + Meus lançamentos › Pre-save | D |
| Material antigo: editar e excluir álbum antigo (dono) | Meus lançamentos › Álbuns | D |
| Turnês: missões (`/api/turnes/missoes`) | Início › Turnês + "Pra fazer hoje" | D |
| Nova turnê: simulação de lucro (mínimo e máximo), escolha de locais | Criar › Nova turnê (tela atual) | D |
| Empire TV: canais ao vivo da Kick | Início › Empire TV (cartão "Ao vivo") | D |
| Empire TV: presença (tempo assistido vira prestígio) | automático na sala | D |
| Empire TV: subir GIF, responder mensagem no chat | sala da TV › Chat | P (GIF) / D (responder) |
| Social: postar como artista **ou como fã anônimo** (nome aleatório) | Criar › Post no Social (tela atual) | D |
| Social: escolher rede (Instagram, TikTok, Twitter), anexar música, modo de publicação, texto rico com emoji | Criar › Post no Social (tela atual) | D |
| Social: seguir perfis, ver stories | Social › Perfis e Feed | P |
| Página de award (`/awards/$nome`) | Início › Acervo › Awards → página do award | D |
| Notificações: marcar como lidas | sino | D |
| Instalar o app (aviso) | igual | D |
| Registro de erros, heartbeat do login | automático (sem tela) | D |

## Fora deste projeto
**Bolsa e Empresas** (`historicoBolsa`, `listarEmpresas`, `minhasEmpresas`
no `api.ts`): ainda não foram lançadas e entram depois, no projeto
**EmpireVerse**. Não ganham lugar na navegação agora. As três funções
saem do `api.ts` na etapa de limpeza de código. Antes disso, é preciso
confirmar se o backend das três tem algo que o EmpireVerse vá
reaproveitar.
