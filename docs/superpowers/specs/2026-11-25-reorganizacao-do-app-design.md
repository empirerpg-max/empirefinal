# Reorganização do Empire Hub — design

> Data: 2026-11-25 · Status: **aguardando aprovação do usuário**
> Branch: `claude/nice-euler-1yslj3`
>
> Documentos que andam junto com este (leia antes de construir):
> - **Protótipo clicável:** https://claude.ai/artifact/XMEbpSJQP2xNnb1DJNjUGF
>   (cópia no repositório: `docs/superpowers/prototipos/2026-11-25-nova-navegacao.html`,
>   abre direto no navegador).
> - **Cobertura de funcionalidades** (lista obrigatória de conferência):
>   `docs/superpowers/specs/2026-11-25-cobertura-funcionalidades.md`.
> - **Mapa do app atual** (rotas, menus, duplicações):
>   `docs/superpowers/specs/2026-11-25-mapa-do-app.md`.
>
> Neste documento, **"call meu"** marca decisões que o autor do design tomou
> sem o usuário pedir. O usuário pode trocar qualquer uma delas.

---

## 1. Intenção e porquê

O app cresceu por acréscimo. Hoje são 54 rotas, uma barra de baixo com 10
itens (só 6 aparecem na tela do celular: **Perfil, Social, Acervo e o "+"
ficam escondidos**), um menu ☰ com 5 itens, várias telas que fazem a mesma
coisa (3 jeitos de abrir um álbum, Músicas/Vídeos/Álbuns duplicados no
Catálogo e no Fórum) e botões que não funcionam.

O usuário quer um **app perfeito**:

- **Menos caminhos:** tudo a no máximo 2 toques de qualquer tela.
- **Nada duplicado:** cada coisa tem um lugar só.
- **Catálogo como Spotify/Apple Music**, sem quebrar a lógica do Fórum.
- **Social como Instagram, Twitter e TikTok:** fluido, rápido, no padrão
  dessas redes para subir conteúdo, rolar, ler e descobrir.
- **Charts com aba própria.**
- **Modo claro**, além do escuro atual.
- **Troca de dados mais rápida e econômica.**

E duas condições inegociáveis:

1. **Nada que funciona hoje pode ficar de fora. ABSOLUTAMENTE NADA.**
2. **Nada pode quebrar**: nenhuma URL atual deixa de abrir, nenhum dado se
   perde, a identidade visual continua a mesma.

---

## 2. Regras do projeto (valem para toda fase)

| # | Regra | Como conferir |
|---|---|---|
| R1 | **Nada fica de fora.** Toda linha do documento de cobertura tem que estar no app novo, no lugar indicado. | Antes de fechar cada fase, percorrer a lista de cobertura e marcar cada linha da fase como "conferida no app". |
| R2 | **Nenhuma URL quebra.** Toda rota atual abre a tela certa ou redireciona para ela, com os mesmos parâmetros (`?tab=`, `?id=`, `?nome=`...). | Teste automático que abre cada rota da seção 5.1 e confere o destino. |
| R3 | **Voltar = tela anterior** (já no `CLAUDE.md`). Toda tela, folha ou janela aberta por cima empurra sua entrada no histórico e fecha só ela no voltar. | Teste manual em cada tela nova: abrir 2 níveis e voltar 2 vezes. |
| R4 | **Texto de botão, aba ou pílula nunca escapa** (já no `CLAUDE.md`). Fileira que não cabe **rola para o lado com seta** (seção 6.1), nunca vira duas linhas. | Checagem automática no celular de 360px: nenhum texto de aba sai do próprio botão. |
| R5 | **Identidade visual atual** é o modo escuro: fundo azul-marinho, roxo do logo, tipografia Inter preta e itálica em maiúsculas nos títulos de marca. | Comparar telas lado a lado com o protótipo. |
| R6 | **O app roda no Cloudflare, não no Telegram** (`CLAUDE.md`). Textos que falam de Telegram para o jogador saem (seção 9). | Busca por "Telegram" nos textos visíveis. |
| R7 | **Selo NOVO do protótipo** = funcionalidade que não existe hoje. Tudo sem o selo já existe e só muda de lugar. | — |

---

## 3. Objetivos, não-objetivos, anti-objetivos

**Objetivos**
- Barra de baixo com **5 abas que cabem na tela**: Início · Catálogo · Fórum · Charts · Social.
- **Criar** sempre a 1 toque (＋ no topo). **Meu Império** (foto do jogador) a 1 toque.
- Empire TV, Turnês e **Premiações** a **2 toques** (Início → aba); **Imprensa** (o antigo Acervo) a 2 toques (Social → aba).
- Catálogo único (Início, Buscar, Biblioteca), Fórum com aba própria, ligados
  por uma página única de cada lançamento (o tópico, com comentários em
  destaque), aberta pelos dois lados.
- Charts › Ao vivo = painel de playlists atual do Catálogo; demais charts em
  formato de playlist com recursos de chart.
- Social com perfil único por artista (3 redes), feed paginado, Repostar,
  Seguir de verdade entre artistas, seguidores calculados.
- Modo claro estilo Apple Music, com a cor do Empire.
- Camada de dados única no front (cache, menos requisições, paginação).

**Não-objetivos** (fora deste projeto)
- Bolsa e Empresas: entram no projeto **EmpireVerse**, mais tarde.
- Mensagens diretas.
- Mudar regras de jogo (prestígio, pontos, charts, premiações), salvo o
  cálculo novo de seguidores do Social (seção 5.6.6).
- Tarefas automáticas do servidor (agendamentos, sincronizações).

**Anti-objetivos** (seria fracasso mesmo funcionando)
- Qualquer função de hoje sumir ou ficar mais difícil de achar sem
  substituto claro.
- Link antigo abrindo tela em branco ou 404.
- Texto cortado no meio de aba ou botão sem seta para rolar.
- O app ficar mais lento ou gastar mais leituras de planilha.
- Perder a cara do Empire (virar "mais um app genérico").

---

## 4. Abordagens consideradas

| | Abordagem | Troca | Decisão |
|---|---|---|---|
| **A** | **5 abas + Criar no topo + Meu Império na foto.** TV, Turnês e Acervo como abas do Início. | Maior ganho de clareza; TV/Turnês/Acervo passam a 2 toques. | **Escolhida pelo usuário.** |
| B | 4 abas por intenção (Ouvir, Charts, Social, Meu Império); Fórum só dentro de cada lançamento. | Mais enxuto, mas perde o feed de discussões. | Descartada: o Fórum precisa de lugar próprio. |
| C | Manter os 10 itens, só reordenar e tirar duplicados. | Barato, pouco risco, mas não reduz caminhos. | Descartada: não atende o pedido. |

**Como entregar:** em fases (seção 8), sempre **dentro do Beta test**
(6.11). A versão anterior continua funcionando até o admin ligar o Beta
como obrigatório. Cada fase só entra no Beta com a lista de cobertura
conferida.

---

## 5. Design

### 5.1 Estrutura e rotas

#### Casca do app (sempre visível)

```
┌──────────────────────────────────────────────┐
│ [logo] EMPIRE HUB [beta]        [＋] [🔔] (RV) │  ← topo
├──────────────────────────────────────────────┤
│                                              │
│                conteúdo                      │
│                                              │
│ ┌──────────────────────────────────────────┐ │
│ │ ▣ Vidro Quebrado · Nova Valente   ⏸  ⋯  │ │  ← mini player (quando toca)
│ └──────────────────────────────────────────┘ │
├──────────────────────────────────────────────┤
│  Início  Catálogo  Fórum  Charts  Social     │  ← barra de baixo (5)
└──────────────────────────────────────────────┘
```

- **Topo (opção A refinada, escolhida pelo usuário):** logo (→ Início) com
  um selo **"beta"** discreto, neutro (contorno cinza, sem cor de destaque),
  que abre a folha do Beta (6.11) · Notificações · **foto do jogador** em
  cinza neutro, sem degradê (→ Meu Império, 5.8). Nada de pílulas
  coloridas no topo.
- **＋ Criar (decisão do usuário):** no topo, **ao lado do sino**, no mesmo
  molde dele: ícone ＋ simples, sem cor, num círculo com contorno fino.
  Abre a folha Criar (5.7). No computador, o Criar é o primeiro botão da
  barra lateral (e o ＋ do topo some, para não repetir).
- **Busca:** no celular e no tablet, em **Catálogo › Buscar** (e nas buscas
  do Fórum, do Social e dos Charts); no computador, campo aberto no topo.
- **Sai do topo:** o botão Recarregar. Vira **puxar para baixo para
  atualizar** em toda tela com lista (call meu; o recarregar de hoje recarrega
  a página inteira).
- **Sai:** o menu ☰. Cada item dele foi para outro lugar (tabela abaixo).
- **Barra de baixo:** 5 abas, ícone + texto, sempre cabe (testar em 320px).
  A aba ativa fica marcada; tocar na aba ativa volta ao topo da tela dela.
- **Mini player:** players de música, vídeo e TV continuam montados na raiz
  (já é assim). O mini player fica acima da barra de baixo.
- **Popups diários** (VMA, votação, festival): continuam, encadeados como
  hoje, mas viram **um componente só** (5.9).

#### Rotas: atual → novo

As URLs atuais **continuam** sempre que a tela continua. Só ganha
redirecionamento o que deixou de ser tela própria.

| URL atual | No app novo | Aba marcada |
|---|---|---|
| `/` | Início › Para você | Início |
| `/tv` | Início › Empire TV (mesma URL; a tela ganha a fileira de abas do Início em cima) | Início |
| `/tours`, `/tours/$nome` | Início › Turnês (mesma URL) | Início |
| `/acervo` | **Social › Imprensa** (mesma URL; a tela ganha a fileira de abas do Social) | Social |
| `/artistas/$nome?aba=gestao` | página do artista já na aba Gestão (aviso "Complete o perfil") | — |
| `/awards`, `/awards/$nome` | **Início › Premiações › Awards** (vitrine; mesmas URLs) | Início |
| `/empire-play` | Catálogo › Início (conteúdo novo, 5.3) | Catálogo |
| `/empire-play/musicas` | **redireciona** → `/empire-play/buscar?tipo=musicas` | Catálogo |
| `/empire-play/videos` | **redireciona** → `/empire-play/buscar?tipo=videos` | Catálogo |
| `/empire-play/albuns` | **redireciona** → `/empire-play/buscar?tipo=albuns` | Catálogo |
| `/empire-play/playlists` | **redireciona** → `/empire-play/biblioteca` | Catálogo |
| `/empire-play/playlists/nova`, `/$id`, `/$id/editar` | mesmas URLs (editor e tela de playlist) | Catálogo |
| `/empire-play/albuns-antigos`, `/$id` | página de álbum única (5.3.4); a lista **redireciona** para Catálogo › Buscar › Álbuns (catálogo único, sem filtro separado) | Catálogo |
| `/empire-play/forum` (`?tab=&id=`) | aba Fórum (mesma URL e parâmetros) | Fórum |
| `/charts` (`?tab=`) | aba Charts (mesma URL; `tab=live` = Ao vivo novo) | Charts |
| `/social` (`?postId=&artist=`) | aba Social (mesma URL e parâmetros) | Social |
| `/empire-play/gestao` (`?tab=&nome=`) | formulários de lançamento abertos pelo Criar (mesma URL) | — |
| `/empire-play/gestao/album-antigo` | Criar › Material antigo (mesma URL) | — |
| `/empire-play/gestao-presave` | Criar › Pre-save (mesma URL) | — |
| `/empire-play/presave/$id` | página pública do pre-save (mesma URL) | — |
| `/perfil` | **Meu Império** (mesma URL) | — |
| `/ponto/*`, `/market/*` | mesmas URLs, abertas a partir do Meu Império | — |
| `/premiacoes`, `/premiacoes/indicar`, `/premiacoes/votacao`, `/festivais/inscricao` | mesmas URLs, abertas a partir do Meu Império e do "Pra fazer hoje" | — |
| `/artistas`, `/artistas/$nome` | mesmas URLs (lista e página do artista) | Catálogo |
| `/acesso-rapido`, `/tutorial` | mesmas URLs, abertas a partir do Meu Império | — |
| `/albuns` (lista "Produção Fonográfica") | **redireciona** → `/empire-play/buscar?tipo=antigos` | Catálogo |
| `/album/$id` (lê `/api/albuns-antigos/`) | **redireciona** → página de álbum única com id de material antigo (`/empire-play/album/antigo-$id`) | Catálogo |
| `/album/$id/editar` | **redireciona** → editor do lançamento (5.7.2) | — |
| `/acoes/album` | **redireciona** → `/empire-play/gestao?tab=album&nome=` | — |
| `/acoes/tour` | **redireciona** → Criar › Nova turnê (`/tours?criar=1`) | — |
| `/acoes/cinema` | mesma URL ("em breve"), aberta por Criar e pela página do artista | — |

**Links diretos que não podem quebrar** (usados por notificações, home,
player, Imprensa/Empirefork, Charts e banners):
- `/empire-play/forum?tab=musicas|videos|albuns&id=…` → abre **direto a
  página do lançamento** (5.3.4) daquele item;
- `/social?postId=…` → abre o post; `/social?artist=…` → abre o perfil do
  artista no Social;
- `/charts?tab=…` (ex.: `hot100`) → abre aquele chart;
- `/tours/$nome?id=…` → abre a turnê certa;
- `/artistas?filter=all|mine`, `/empire-play/gestao?tab=…&nome=…`,
  `/empire-play/gestao/album-antigo?id=…`, `/acoes/*?nome=…`;
- links externos dos banners (`BannerCarousel`) continuam abrindo em nova
  aba.
Um teste abre cada um desses links e confere a tela certa (R2).

**Rotas novas** (call meu nos nomes): `/empire-play/buscar`,
`/empire-play/biblioteca`, `/empire-play/album/$id` (página de álbum
única), `/meus-lancamentos`, `/social/perfil/$artista?rede=`.

**Ids da página de álbum única:** álbum atual e material antigo vêm de
fontes diferentes (`/api/empire-play/albuns` e `/api/albuns-antigos/`) e
podem ter ids iguais. O `$id` leva um prefixo: `antigo-<id>` para material
antigo; sem prefixo para álbum atual (o id/topicId de hoje). Call meu.

**Aba marcada na barra:** definida por um mapa único "prefixo de rota →
aba", num arquivo só. Rotas sem aba (Meu Império, formulários) não marcam
nenhuma.

#### O que sai do menu ☰ e para onde vai

| Item do ☰ hoje | Vai para |
|---|---|
| Acesso Rápido (canais) | Meu Império › App › Canais oficiais |
| Empire Studio › Empire Artists | Catálogo › Buscar › Artistas |
| Empire Studio › Discografia | Catálogo › Buscar › Álbuns |
| Empire Studio › Playlists | Catálogo › Biblioteca |
| Negócios › Market | Meu Império › Economia › Market |
| Guia de Sobrevivência | Meu Império › App › Guia |
| Sair | Meu Império › Sair |

---

### 5.2 Início

Fileira de abas no topo (rolável com seta, 6.1): **Para você · Empire TV ·
Turnês · Premiações** (decisão do usuário: o Acervo saiu do Início e virou
Imprensa, no Social). Empire TV e Turnês são as telas atuais (`/tv`,
`/tours`) com essa fileira em cima.

**Para você** (de cima para baixo, decisão do usuário):

1. **Carrosséis de banner** que já existem, **no topo**: Spotlight Banner
   (Patrocinado) e Pre-save.
2. **Faixa "Ao vivo"** discreta, de uma linha (só quando há transmissão na
   Empire TV ou canal da Kick ao vivo): ponto vermelho, nome do programa,
   quantos assistem e **Entrar** (→ sala da TV). O cartão grande fica só na
   aba Empire TV.
3. **Cronômetro da semana** (6.14).
4. **"Pra fazer hoje"** *(NOVO)*: lista do que o jogador tem pendente hoje,
   montada a partir de dados que já existem:
   - ação do dia da turnê (`/api/turnes/missoes`);
   - missão do pre-save (`/api/presave/minhas-campanhas`);
   - Performance Award pendente (`listarPendenciasPerformance`);
   - pontos da semana ainda não distribuídos;
   - indicação/votação/festival abertos (mesmas checagens dos popups).
   Cada linha leva direto à tela. Some quando não há nada.
5. Seções que já existem hoje na home, na ordem de U8 e configuráveis por
   `homeFlags`: Meus Artistas, Lançamentos recentes, Global 100 #1, Top por
   plataforma, Próximos eventos, ticker de atividade, Últimas publicações do
   Social, **Da Imprensa** (as edições novas de revistas e entrevistas; leva
   ao Social › Imprensa).

**Premiações** *(aba nova, decisão do usuário)*: junta o que estava
espalhado.
- **Abertas agora:** Indicar (`/premiacoes/indicar`), Votação
  (`/premiacoes/votacao`) e Inscrição em festival (`/festivais/inscricao`),
  só quando o período estiver aberto (mesmas checagens dos popups diários).
- **Awards (vitrine):** a **vitrine de hoje, sem mudar o visual**: grade
  de pôsteres com a foto de cada premiação (2 por linha, nome em caixa
  alta sobre a foto) e "Ver todos" para a vitrine completa (`/awards`).
  Cada pôster abre a **página do award de hoje** (`/awards/$nome`): capa
  grande, edições e categorias, fileira de ícones dos segmentos (pula para
  o segmento), fileira de anos, e cada categoria com o **vencedor em
  destaque** (capa com moldura dourada e troféu) e os indicados em grade.
  Só as cores de fundo seguem o modo claro/escuro. (O antigo Acervo ›
  Awards.)
- **Seus prêmios:** Prêmios já ganhos (retroativo, `/premiacoes`).
- As telas de indicar, votar, retroativo e festival continuam as de hoje.
  Meu Império mantém atalhos para elas.

**Empire TV, Turnês:** as telas de hoje, inteiras (Início/Grade/
Arquivo/Red Carpet; Criar/Central/Em andamento/Finalizados/Mais
Rentáveis). Mudanças só de casca: fileira de abas do Início em cima, fileiras roláveis com seta,
"Criar turnê" também disponível no Criar. Na grade da TV, o botão
**Lembrar** *(NOVO)* virou o sininho de 6.16.

---

### 5.3 Catálogo

Fileira segmentada no topo: **Início · Buscar · Biblioteca**.

#### 5.3.1 Catálogo › Início (conteúdo novo)

O painel de playlists que está aqui hoje **vai para Charts › Ao vivo**
(5.5.1). O Início do Catálogo passa a ser sobre o jogador e o que é novo:

| Seção | Fonte de dados | Novo? |
|---|---|---|
| Carrossel de banners (`BannerCarousel`) | já existe | não |
| Continue ouvindo (4 últimos álbuns/playlists tocados) | histórico local do player (`localStorage`), call meu | **NOVO** |
| Lançamentos da semana | `/api/empire-play/lancamentos-recentes` (D1, já existe) | não (já existe na home) |
| Mais comentados no Fórum (7 dias) | `/api/forum/atividade-recente` agrupado por tópico | **NOVO** |
| Playlists da comunidade | aba "Comunidade" de `/empire-play/playlists` (já existe) | não |
| Clipes novos | vídeos D1 por data (já existe em `/api/empire-play/videos`) | não |
| Atalho "Charts ao vivo" | destaque "Mais quente agora" (mesma API do Ao vivo) | **NOVO** |

#### 5.3.2 Catálogo › Buscar

- Campo de busca (usa `/api/busca`, a mesma da Busca rápida de hoje). Ao
  digitar, mostra os resultados **agrupados** como a Busca rápida faz hoje
  (Artistas, Músicas, Vídeos, Álbuns, até 4 por grupo); sem resultado, diz
  "Nada encontrado para …" com uma dica.
- Filtros (fileira rolável com seta): **Tudo · Músicas · Vídeos · Álbuns ·
  Artistas**. Substituem as abas Músicas, Vídeos, Álbuns, a lista de
  Artistas e a lista de Álbuns antigos. As listas são as mesmas de hoje
  (mesmas APIs, mesma busca por texto).
- **Catálogo único (decisão do usuário):** não existe filtro nem botão
  separado de "Material antigo". Os álbuns lançados como material antigo
  (retroativo, `/api/albuns-antigos`) entram em **Álbuns** junto dos
  outros, com o **ano real** de lançamento; as faixas deles entram em
  **Músicas**. Em Álbuns, um seletor **Mais recentes · Por ano de
  lançamento**. Sem selo de "antigo": é tudo uma coisa só. Custo: a lista
  de álbuns antigos já lê todas as faixas para contar (`getAlbunsAntigosController`);
  devolver as faixas junto não faz leitura nova. Criar › Material antigo
  (o formulário) continua igual.
- Sem texto digitado em "Tudo": grade **"Navegar por gênero"**. Cada
  bloco abre a **página daquele gênero** *(NOVO)*, nunca uma lista geral:
  - **Top {gênero} da semana:** a playlist de gênero que o painel já monta
    hoje (`semana:genero:{GÊNERO}`, Global 100 filtrado por gênero). Só
    existe para gêneros com 10 ou mais músicas no Global 100. Quando não
    existe, a página diz isso em uma linha e segue com o resto;
  - **Lançamentos de {gênero}:** músicas do catálogo D1 com
    `musicas.genero` igual ao gênero, mais recentes primeiro (com "Ver
    todos");
  - **Álbuns, Artistas e Clipes de {gênero}:** derivados das mesmas músicas
    (álbum da faixa, artista da faixa, vídeos dessas músicas);
  - os gêneros da grade são os que existem em `musicas.genero`, com a mesma
    normalização que o painel usa (`normalizarGenero`: caixa alta, sem
    acento);
  - **nenhuma lógica de charts muda:** a página só lê o catálogo e reaproveita
    a playlist de gênero que já existe.
- Artistas: alternância Todos / Meus (como `/artistas?filter=`).

#### 5.3.3 Catálogo › Biblioteca

Minhas playlists · Playlists da comunidade salvas · Salvos (faixas
curtidas, `/api/salvos`) · Artistas · Álbuns · Vídeos, + "Nova playlist"
(editor atual, com faixa por Catálogo, upload ou link). "Tocadas
recentemente" usa o mesmo histórico do Continue ouvindo.

#### 5.3.4 Página do lançamento (álbum, música, vídeo) = tópico do Fórum

**Uma página só por lançamento**, aberta tanto pelo Fórum quanto pelo
Catálogo (e pelas rotas antigas redirecionadas). Ela **é o tópico do Fórum
de hoje**, com tudo o que ele faz, no visual Spotify/Apple Music e com os
comentários em destaque. Isso elimina os 3 jeitos de abrir um álbum e a
necessidade de um botão "Discussão" separado: a discussão está na própria
página.

**Regra:** antes de construir, listar tudo o que o tópico de hoje faz
(`src/components/EmpirePlay/Forum.tsx`, vista do `selectedTopic`) e
conferir item por item na página nova. A lista mínima está abaixo.

**Comum aos 3 tipos (de cima para baixo):**
1. Cabeçalho: capa grande (tocar = **capa em tela cheia**), título,
   artista(s) com **selo de verificado**, tipo, "Lançamento: dd/mm/aaaa"
   (`releaseDate`), nº de faixas (álbum). Fundo com degradê da cor da capa
   (call meu).
2. Selos, como hoje: **semanas no chart** (`semanasNoChart`), **prêmio**
   (`AwardBadge`), **contador de pre-save** (`PreSaveCounterBadge`, álbum)
   e, **só em vídeo**, a nota de Likes (`ScoreBadge variant="likes"`).

   > **Regra das notas (não mudar):** em **músicas e álbuns, a nota
   > (Metacritic) nunca aparece no Fórum**, nem a média, nem a nota de cada
   > comentário. O jogador dá a nota ao comentar, e ela só aparece no
   > **Imprensa › Metacritic** (ranking atualizado **semanalmente**, para
   > ninguém inferir quem deu nota para quem) e na **Imprensa › Empirefork**
   > (Best New Track usa a nota Metacritic). Em **vídeos**, a nota é de
   > Likes e aparece no Fórum (média e em cada comentário), como hoje.
3. Ações (U5): **Tocar** (álbum: toca as faixas com áudio em ordem;
   música: a faixa; vídeo: **Assistir**) e o 2º botão (Aleatório no álbum,
   Adicionar à playlist na música, Mini player no vídeo) ocupam a linha.
   **Salvar (♡)** e **⋯** ficam no cabeçalho da tela. O ⋯ tem Compartilhar,
   Reportar conteúdo errado, **Editar lançamento** (dono e admin) e
   **Editar tópico**, **Marcar como pendente** e **Excluir tópico** (admin,
   com a mesma confirmação de hoje).
4. **Botões do tópico: Shop · Info · Visual** (`ExtraMaterialButtons`), só
   os que existirem para aquele lançamento, como hoje. "Visual" troca a
   página pela arte (`VisualBlocosView`) e tem "Voltar ao normal".
5. **Cartão de comentários em destaque** (logo abaixo dos botões):
   - total de comentários e quando foi o último;
   - o comentário mais recente;
   - o botão de comentar da janela de hoje (`CommentModal`): nome do
     jogador fixo, a pergunta de nota e o texto. Música/álbum:
     **"Metacritic & Comentário"**, com "Para o Metacritic, qual nota você
     daria pra essa música/álbum?". Vídeo: **"Likes & Comentário"**, com
     "Em questão de Likes, qual o intervalo que você daria?". Os mesmos 4
     intervalos de hoje (45-60, 61-75, 76-90, 91-100);
   - em música/álbum, uma linha avisando que a nota vai para o Metacritic
     da Imprensa e não aparece no Fórum *(NOVO, só texto)*;
   - **Ver todos** (rola até a lista).
   - **Sem gráfico de notas** (ideia descartada: revelaria as notas).
6. Conteúdo do tipo (abaixo).
7. **Lista de comentários**: avatar, nome, verificado, tempo, nota dada
   **só em vídeo** ("N likes"), texto rico, **reações** (`ReactionBar`, os mesmos 12 emojis),
   **Responder** (respostas aninhadas), ⋯ (editar o próprio, excluir). Ordem
   como hoje.
8. Botão **Avaliar & Comentar fixo no rodapé** da página *(NOVO na
   posição; a ação já existe)*.

**Álbum:** **Faixas do álbum** como hoje: cabeçalho **"Disco N"** quando o
álbum tem mais de um disco; cada faixa com número, título, artista,
**tocar** (desabilitado e "Sem áudio no catálogo" quando não há áudio) e o
botão de **letra**, que abre a letra embaixo da faixa (**sincronizada,
acompanhando**, quando aquela faixa está tocando e foi sincronizada) com
**"Ver tópico"** da faixa. Depois, **Encarte** (miniaturas → visualizador
com anterior/próxima).

**Música:** **Letra** em destaque: sincronizada e acompanhando quando a
música toca; senão a letra normal ("Letra oficial em processamento..."
quando não há). Atalho **"Do álbum"** quando a faixa pertence a um álbum.

**Vídeo:** player no topo da página (como hoje, com controles nativos),
tipo do vídeo, título, artistas, data. Lista **"Mais vídeos"** (os
relacionados de hoje), que troca o vídeo no lugar.

**Faixas e vídeos avulsos** abertos fora da página (Buscar, Charts, mini
player) tocam no player como hoje, e o player mantém **"Ver no Fórum"**
(abre esta página).

### 5.4 Fórum (lista)

Mesma URL de hoje (`/empire-play/forum`, `?tab=&id=`), agora com aba própria
na barra. Abrir um tópico = abrir a página do lançamento (5.3.4).

- Filtros: **Tudo · Músicas · Vídeos · Álbuns** (substituem as 3 abas
  internas). Em **Vídeos**, a fileira de **tipo de vídeo** que existe hoje
  (Todos + os tipos presentes nos itens).
- **Pesquisar tópicos** (como hoje), botão **Filtros** (artista, lançado de,
  até, limpar filtros) **dentro do campo de busca**, e **"Não comentei"**
  como última opção da fileira de categorias (U7; hoje fica dentro de
  Filtros).
- Cada tópico mostra: capa, título, tipo, artista com verificado, **nota só
  em vídeo** (como hoje), **selo de prêmio**, **pre-save**, **último comentário** (autor + começo do
  texto) *(NOVO)*, nº de comentários, última atividade e "você ainda não
  comentou" quando for o caso *(NOVO, usa o mesmo dado do filtro)*.
- **Não existe comentário anônimo.** O campo "Nome do Jogador / OFF" é
  somente leitura e mostra o jogador logado; continua assim.

### 5.5 Charts

Fileira de abas (rolável com seta): **Ao vivo · Global 100 · Paradas ·
Spotify · Apple Music · YouTube · Álbuns · Sales**. Abre em **Ao vivo**.

#### 5.5.1 Ao vivo = o painel do Catálogo, sem mudança

O componente que hoje é o Início do Catálogo (`PlaylistsInicio` +
`TelaPlaylist` + `VitrineClipes`, rota `/api/empire-play/playlists`, design
em `2026-11-24-playlists-empire-play-design.md`) passa a ser o conteúdo de
**Charts › Ao vivo**, **exatamente como funciona hoje**:

- destaque "Mais quente agora" (30 s);
- Top 100 ao vivo de Spotify, Apple Music e YouTube;
- Top 50 por país, com seletor de plataforma;
- playlists da semana: Global 100, uma por parada oficial, por gênero, Hot;
- tela de playlist por cima (com voltar = fecha só ela) e vitrine de clipes.

**Ele substitui o "Ao vivo" atual dos Charts** (`ChartsRealTime`: Mundo /
Por país, 3 colunas de plataforma, "#1 agora"). Nada se perde:

| "Ao vivo" de hoje | Onde está no novo |
|---|---|
| Mundo: top de Spotify, Apple, YouTube | Top 100 ao vivo de cada plataforma |
| Por país | Top 50 {país} por plataforma |
| "#1 agora" e valor cheio | posição 1 e valor de cada faixa na playlist |
| Atualização a cada 30 s | mesmo intervalo (a API já usa 30 s) |

Antes de apagar o `ChartsRealTime`, conferir campo por campo que tudo o
que ele mostra aparece no painel (R1).

#### 5.5.2 Demais charts: só a aparência muda

**Regra do usuário: nenhuma lógica de charts é mexida.** O cálculo, a
ingestão, o D1, a planilha, as rotas e as respostas da API ficam
**exatamente como estão** (o trabalho de charts foi concluído e validado em
2026-11-25). A mudança é **só de tela**, no front, usando os mesmos dados
que a tela de hoje já recebe.

Para Global 100, Paradas, Spotify, Apple Music, YouTube, Álbuns e Sales:

1. **Cabeçalho de playlist:** capa (a da posição 1), nome do chart,
   "Atualiza toda quinta".
2. **Tocar · Aleatório:** toca as músicas do chart que têm áudio no
   catálogo, na ordem do chart, usando o mesmo cruzamento por título que o
   painel do Ao vivo já usa para tocar (`buscarNoCatalogo`). Sem áudio: a
   linha fica e é pulada ao tocar. *(Isso é tela, não cálculo: não muda
   posição, valor nem nada do chart.)*
3. **Visões, exatamente como hoje:** só Spotify, Apple Music e YouTube têm
   `Global | Por país | Artistas do mês`. Global 100, Álbuns e Sales não
   têm. Paradas abre direto na lista por país.
4. **Filtros de hoje, sem mudança:** seletor de semana (as datas de hoje),
   estilo (onde existe hoje) e busca.
5. **Linhas:** posição · movimento como hoje (▲ ▼ = NEW, o `st` que a API
   já devolve) · capa · título · artista · valor (o mesmo número de hoje).
   Tocar na linha toca a música (Álbuns: abre a página do álbum). ⋯ =
   Adicionar à playlist · Salvar · Abrir no Fórum · Compartilhar.
6. **Artistas do mês:** o cartão editorial e o ranking de hoje, no mesmo
   visual de lista.

Ideias que **ficaram fora** porque precisariam de dado novo da API
(conversadas e descartadas para não mexer na lógica): pico, semanas no
chart, filtros de estreias/altas/quedas, resumo da semana e histórico de 8
semanas. Se um dia o usuário quiser, viram um projeto próprio, só de
leitura.

---

### 5.6 Social

Mesma URL (`/social`, `?postId=&artist=`). Fileira de abas (rolável com
seta): **Feed · Vídeos · Tá na Mídia · Imprensa · Perfis**. A aba **News**
entra na **Imprensa** (decisão do usuário), e a aba **Config sai**
e vira "Configurar meus perfis" (5.6.3).

#### 5.6.1 "Interagindo como" sempre visível

Logo abaixo do título: `(foto) Interagindo como  Nova Valente  ›`. Abre uma
folha com os artistas do jogador + perfis de mídia compartilhados (a
mesma lista de `interagirComoOpcoes` de hoje). A escolha:

- vale para curtir, comentar, repostar, seguir e postar;
- usa o @ daquele artista **na rede do post** (como hoje);
- fica salva no aparelho (call meu).

#### 5.6.2 Página de perfil única por artista

Hoje: Perfis → artista → escolher rede → perfil. Para ver outra rede,
volta. **Novo:** `/social/perfil/$artista?rede=Instagram|Twitter|TikTok`.

- No topo, seletor **Instagram | Twitter | TikTok**: troca a rede sem sair
  da página. Abre na rede de onde o jogador veio (post tocado), senão na
  primeira configurada.
- Cabeçalho: foto, nº de posts, **seguidores** (5.6.6), **seguindo**
  (5.6.5), nome, @, bio, gravadora.
- Botões: **Seguir / Seguindo** (como o artista do "Interagindo como");
  **Ver artista** (página do artista no Catálogo). No perfil de um artista
  do próprio jogador: **Editar perfil desta rede**. Em perfil de mídia:
  **Interagir como**.
- **Mensagem: sai** (decisão do usuário).
- Conteúdo no visual nativo de cada rede (como hoje):
  - Instagram: grade 3 colunas · abas **Posts · Reels · Marcados**;
  - Twitter: lista · abas **Posts · Respostas · Mídia · Curtidas**;
  - TikTok: grade vertical 9:16 · abas **Vídeos · Curtidos**.
- **As abas que hoje não funcionam passam a funcionar**, com dados que já
  existem:

  | Aba | Conteúdo |
  |---|---|
  | Reels (IG) | posts de Instagram do artista com `media_tipo = video` |
  | Marcados (IG) | posts de qualquer rede cujo texto cita `@handle` |
  | Respostas (TW) | comentários feitos com o @ do artista no Twitter |
  | Mídia (TW) | posts de Twitter do artista com mídia |
  | Curtidas (TW) / Curtidos (TT) | posts curtidos pelo artista naquela rede (exige guardar *quem* curtiu como artista, ver 5.6.7) |

- **Siga também:** como hoje (mais seguidores primeiro, mesma rede).

#### 5.6.3 Configurar meus perfis

Uma tela só (de Perfis › "Configurar meus perfis", da página do perfil e
de Meu Império): escolhe o artista; para cada rede, @, foto e bio. Chave
**"Mesma foto e bio nas 3 redes"** *(NOVO)*, ligada por padrão para quem
ainda não personalizou. Rede sem perfil aparece como **"Não configurado"**
em vermelho. Mantém o recorte de foto em círculo e o "Usar original".

#### 5.6.4 Feed

- **Filtro por rede** *(NOVO)*: botão **"Redes ▾"** ao lado de "Interagindo como", que abre uma folha com Todas · Instagram · Twitter · TikTok (U6).
- Stories do Instagram no topo (como hoje, com visualizador).
- Cada post no visual da rede dele (como hoje): Instagram com mídia e
  carrossel de até 10 fotos, Twitter com texto em primeiro plano e música
  anexada, TikTok com o card vertical que abre a aba Vídeos em tela cheia.
- Ações: Curtir · Comentar · **Repostar** *(NOVO)* · **Compartilhar**
  *(hoje é botão morto; passa a copiar o link do post, `?postId=`)* · ⋯
  (editar/excluir para o dono, excluir para admin, copiar link).
- Posts do modo **Blackout** continuam como hoje.
- **Paginação** *(NOVO)*: carrega 20 posts e busca mais ao chegar perto do
  fim (cursor por data). Hoje carrega tudo de uma vez (`listarPostsSocial`
  sem limite). As outras telas que leem posts também passam a pedir só o
  que mostram, filtrado no servidor (call meu): a home (`index.tsx`, só
  os últimos N) e a página do artista (`artistas.$nome.index.tsx`, só os
  posts dele).
- **Ordem:** por **última atividade** = maior entre a data do post e a data
  do repost mais recente (5.6.5).

**Vídeos:** os TikToks em tela cheia, um por tela, deslizando para cima
(o visualizador `setTiktokViewer` que já existe), com som/sem som.
**Tá na Mídia:** grade dos perfis de mídia compartilhados (como hoje).
**Perfis:** busca por nome ou @ + lista de artistas → página do perfil.
**Imprensa** *(o antigo Acervo + a News, decisão do usuário)*: fileira
**News · Revistas · Entrevistas · Forbes · Metacritic · Empirefork**, com
os nomes e o conteúdo de hoje:
- **News:** matérias, com "Publicar notícia" e ⋯ para quem tem permissão
  (inclusive as notícias que vêm das ações de turnê, que continuam abrindo
  os comentários da turnê);
- **Revistas** e **Entrevistas:** edições, "Ler revista", editor por
  páginas e perguntas, "Publicar" para quem tem permissão;
- **Forbes**;
- **Metacritic:** ranking semanal (Destaques, Ranking, Artistas, Recentes,
  Estilo, Ano), "Ver música" e "Ver artista";
- **Empirefork:** Best New Track, Top Artist do mês, curtir, comentar e
  Arquivo por mês.
**Tá na Mídia** continua separada: são os perfis de mídia que postam no
feed. A Imprensa é o lugar de ler.

#### 5.6.5 Repostar e Seguir (decisões do usuário)

**Repostar**
- Existe nas 3 redes (call meu: o usuário não restringiu).
- Quem reposta é o artista do "Interagindo como". Um artista reposta um
  post uma vez; tocar de novo desfaz.
- O post **volta ao topo do feed** com a linha "🔁 Kai Moreau repostou ·
  há 3 min". Se vários repostaram, mostra o mais recente e "+N".
- Desfazer o repost: o post volta para a posição da atividade anterior.
- O contador mostra o nº real de reposts.
- Notificação para o dono do post (mesmo mecanismo de curtida, call meu).

**Seguir (entre artistas)**
- Quem segue é o **artista** do "Interagindo como", **numa rede**. Não é o
  jogador.
- Perfis de mídia compartilhados **não seguem** ninguém (call meu: são
  usados por qualquer jogador e virariam ruído).
- **"Seguindo"** no perfil = número digitado pelo jogador + quantidade real
  de perfis que aquele artista segue naquela rede (5.6.6).
- Hoje o "Seguir" é só visual (`followingSet` em memória) e some ao
  recarregar; passa a ser salvo.

#### 5.6.6 Seguidores e Seguindo (decisões do usuário)

**Seguidores = só a fórmula.** Calculado por perfil (artista + rede) a
partir do uso real, **sempre crescendo**. A planilha **não tem** fórmula
hoje (confirmado pelo usuário); o número antigo da coluna G **não é usado**
para artistas.

```
seguidores = P × posts_publicados
           + C × curtidas_recebidas
           + M × comentários_recebidos
           + R × reposts_recebidos
```

- **Desde sempre:** na primeira carga, os contadores são montados com todo
  o histórico existente (posts, `analytics.likes`, comentários).
- **Só cresce:** contadores acumulados; excluir post, descurtir ou apagar
  comentário não diminui (call meu, para cumprir o "sempre aumentando").
- **Pesos iniciais** (call meu, ajustáveis sem deploy numa tabela de
  configuração): `P = 120`, `C = 15`, `M = 40`, `R = 60`. Exemplo: 48
  posts, 900 curtidas, 210 comentários, 30 reposts →
  `5.760 + 13.500 + 8.400 + 1.800 = 29.460` ("29,4 mil").
- Exibição: até 9.999 por extenso; depois "12,4 mil", "1,2 mi".

**Perfis de mídia (uso geral: Pitchfork, TMZ, MTV...): não mudam.**
Continuam com o número da planilha (ex.: 10.000.000), sem fórmula
(decisão do usuário).

**Seguindo = número digitado + contagem real.**
- O número que o jogador digita no perfil continua existindo e vira o
  **ponto de partida**. Ele é pedido **na criação do perfil** de cada rede
  (e quem já tem perfil mantém o número digitado hoje, coluna H).
- Exibido: `seguindo = número digitado + quantos artistas aquele perfil
  segue de verdade` (5.6.5).
- O campo continua editável em "Configurar meus perfis" (call meu: hoje ele
  é editável sempre; manter evita tirar uma função que funciona).

#### 5.6.7 Dados do Social

Hoje o Social vive na planilha (abas `SOCIAL_POSTS`, `SOCIAL_PERFIS`,
`SOCIAL_COMMENTS`, `SOCIAL_NEWS`). Cada curtida lê a aba inteira e
reescreve uma célula de JSON. Não dá para paginar, ordenar por atividade
nem contar reposts e seguidores de forma barata.

**Recomendação (call meu, é a mesma estratégia já adotada no catálogo,
"D1 primeiro"):** o Social passa a ter **o D1 como fonte da verdade**, com
a planilha recebendo cópia pela fila de backup que já existe
(`fila_backup_planilha`). Tabelas novas (nomes são do construtor):

- `social_post` (todas as colunas de `SOCIAL_POSTS`, mais `ultima_atividade`);
- `social_perfil` (de `SOCIAL_PERFIS`; mantém `seguindo_digitado` e, só para
  perfis de mídia, `seguidores_fixo`);
- `social_comentario`;
- `social_curtida` (post, jogador, **artista + rede com que curtiu**,
  data); substitui o `likedBy` dentro do JSON. **Regra mantida: 1 curtida
  por jogador por post** (é o que impede inflar prestígio). A curtida fica
  registrada no artista que estava em "Interagindo como" (call meu).
- `social_repost` (post, artista, rede, data);
- `social_segue` (artista que segue, rede, artista seguido, data);
- `social_contador` (artista, rede, posts, curtidas, comentários, reposts;
  só cresce).

Migração: carga única da planilha para o D1, conferência de contagem
(posts, comentários, curtidas iguais nos dois), e só então as telas leem
do D1. Prestígio e notificações continuam disparando como hoje.

**Curtidas antigas** (call meu): o total de cada post continua sendo
`analytics.likes` (é o número que o jogador vê hoje, e é a base do
contador de seguidores). As linhas de `likedBy` viram registros em
`social_curtida` com o jogador e **sem artista/rede** (esse dado não
existia). Por isso as abas Curtidas/Curtidos mostram só curtidas feitas a
partir da troca. A conferência da migração compara `analytics.likes`.

---

### 5.7 Criar e Meus lançamentos

#### 5.7.1 Folha "Criar" (botão no topo)

```
Criar                                              [Fechar]
┌──────────────────────────────────────────────────────────┐
│ ✎  Editar meus lançamentos                            ›  │
└──────────────────────────────────────────────────────────┘
 LANÇAR MÚSICA E VÍDEO
 Nova música   Novo vídeo   Novo álbum ›   Faixa de álbum
 Material      Pre-save ›   Performance    Cinema
 antigo                     Award          (em breve)
 PUBLICAR
 Post no       Notícia      Revista        Entrevista
 Social        (News)
 TURNÊ, PLAYLIST E ARTISTA
 Nova turnê    Nova         Novo artista   Sincronizar
               playlist                    letra
 SÓ ADMIN
 Banners       Grade da TV  Painel do catálogo
```

- **Novo álbum ›** abre as três opções que a Gestão tem hoje: **Registrar
  novo**, **Substituir nos Charts** e **Retroativo**.
- **Pre-save ›** abre **Nova campanha** (com ou sem missões diárias,
  material extra) e **Minhas campanhas** (completar missão, editar faixas,
  ranking, cancelar).
- **Novos atalhos no Criar** (as ações já existem hoje em outras telas e
  **continuam lá também**): Notícia (Social › News, qualquer jogador com
  artista), Revista e Entrevista (Acervo/Imprensa, botão ＋, qualquer
  jogador com artista), Nova playlist (Catálogo › Playlists), Novo artista
  (Perfil › Gerenciar).
- **Ficam só onde estão hoje** (dependem do contexto) e a folha lembra
  disso no rodapé: look no Red Carpet (sala da TV), ação do dia da turnê
  (Pra fazer hoje / página da turnê), indicar e votar (Início ›
  Premiações), Spotlight Banner (Market), enquete na sala (admin).
- Rótulos longos quebram em 2 linhas, nunca cortam nem escapam (regra do
  `CLAUDE.md`); "Programação da TV" virou "Grade da TV" para caber.

#### 5.7.2 Meus lançamentos (`/meus-lancamentos`)

Junta o "Editar meus materiais" (`EditModal`) e a Gestão Pre save. Três
entradas: **Criar › Editar meus lançamentos**, **Meu Império › Estúdio ›
Meus lançamentos** e **"Editar lançamento"** na página do álbum/faixa (dono
e admin).

- Abas: **Músicas · Vídeos · Álbuns · Pre-save** (fileira rolável).
- Lista com **Editar** (ou **Publicar**, para faixa pendente sem tópico).
- Editor: **tudo o que o `EditModal` faz hoje** (capa, mídia/áudio,
  título, descrição, categoria, tipo, foco do lançamento, data, tracklist
  com ▲▼ e adicionar faixa nova/existente com upload, publicar faixa,
  encarte com adicionar/mover/remover, letra, Sync Studio, material extra,
  botões do tópico, thumb). Material antigo: editar e excluir. No
  protótipo, o álbum ganhou o botão **＋ Adicionar faixa** (inédita ou já
  publicada sem álbum), que faltava desenhar.
- Aba Pre-save: campanhas com editar faixas, missões, Top (ranking),
  "Contador em 0? Verificar/corrigir" e cancelar campanha.

---

### 5.8 Meu Império (`/perfil`)

Abre ao tocar na foto do jogador. Grupos, nesta ordem:

1. **Cabeçalho:** foto, nome, @, tipo de perfil, **Editar** (nome, foto,
   aniversário).
2. **Nível e prestígio** (barra), link "Como ganhar prestígio".
3. **Meus artistas** (com saldo em eCoin) + **Gerenciar** (vincular/criar,
   o `GlobalLinkModal` de hoje).
4. **Estúdio:** Meus lançamentos · Meus Spotlight Banners · Performance
   Award (quando pendente).
5. **Economia:** Ponto · Market · Leilão · Como ganhar prestígio.
6. **Premiações e festivais:** **Abrir Premiações** (→ Início › Premiações) · Indicar · Votação · Prêmios já ganhos
   (retroativo) · Inscrição em festival.
7. **Biblioteca:** Salvos · Minhas playlists (atalhos para o Catálogo).
8. **Aparência:** Escuro · Claro · Sistema (5.10).
9. **Admin** (só admin): Entrar como usuário / Voltar a ser admin ·
   Banners · Programação da Empire TV · Painel do catálogo.
10. **App:** Notificações · Canais oficiais · Guia de Sobrevivência · Sair.

---

### 5.9 Componentes compartilhados (unificações)

| Componente novo | Substitui | Usado em |
|---|---|---|
| `ScrollRow` (fileira rolável com setas, 6.1) | `useDragScroll` + `StickyScrollArrow*` espalhados, `ScrollArrows`, `PillScroller` | toda fileira de abas/filtros |
| `useHistoryOverlay` (voltar = fecha só esta camada) | `use-back-close` + `pushState` manual | toda folha, janela, tela por cima (~61 hoje) |
| `ActionSheet` (menu ⋯) | menus soltos em cada tela | faixa, vídeo, álbum, post, comentário, tópico, turnê |
| `PlaylistScreen` | `TelaPlaylist`, tela de playlist do jogador | Ao vivo, Biblioteca, comunidade |
| `ChartPlaylist` | `ChartsCategoryView`/`GlobalView`/`CountryView`/`MonthlyView` | Charts (5.5.2) |
| `PaginaLancamento` (álbum, música, vídeo) | tópico do Fórum, `album.$id`, `albuns-antigos.$id` | 5.3.4 |
| `LembreteDiarioPopup` | `VmaNominationPopup`, `VotacaoReminderPopup`, `FestivalNominationPopup` | raiz |
| `BannerCarousel` único | `BannerCarousel`, `SpotlightBannerCarousel`, `PreSaveBannerCarousel` | Início, Catálogo |
| `useIsAdmin()` / `isAdmin()` | o id fixo `810141686` copiado em ~10 arquivos do front e 4 do back | todo lugar |
| `useJogador()` | `useTelegramUser` + `getStoredLogin` + `tg_user_cache` | todo lugar |
| `ConferenciaPlanilha` (grade do Ponto) | as duas planilhas do Ponto (~500 linhas cada) | `/ponto/*` |

**Regra:** a unificação nunca muda o comportamento. Antes de trocar,
listar o que cada versão antiga faz e conferir que a nova faz tudo.

---

### 5.10 Modo claro

**Hoje:** o app força `class="dark"` no `<html>` e no `<body>`. As cores
do escuro estão em variáveis (`styles.css`, bloco `.dark`), mas há **cerca
de 2.800 cores escritas direto no código** (`bg-white/5`,
`text-neutral-400`, `bg-black/40`, `emerald-500`...). Elas não mudam com o
tema.

**Visual do claro** (estrutura do Apple Music + cor do Empire, como no
protótipo):
- fundo branco; blocos em cinza agrupado (`#F2F2F7`); linhas finas;
- títulos grandes à esquerda, sem itálico e sem caixa alta (a marca
  "EMPIRE HUB" no topo continua itálica);
- barras de cima e de baixo translúcidas;
- cor de destaque: **roxo do Empire** (`#6C4CE8` no claro, `#957AF8` no
  escuro), não o vermelho da Apple;
- aba e opção ativas em roxo; textos secundários `#6B6B73`.

**Como fazer sem quebrar o escuro:**
1. Definir tokens semânticos (fundo, superfície 1 e 2, texto, texto
   secundário, linha, destaque, ao vivo, alta, queda...) com valor do
   escuro **igual ao de hoje** e valor do claro novo.
2. Trocar as cores escritas direto por esses tokens, **tela por tela**,
   conferindo que o escuro fica idêntico (comparação de captura de tela
   antes/depois).
3. Unificar os dois verdes de destaque (o `primary` e o `emerald` do
   Catálogo) e a pílula branca num token só por papel. Regra aprovada: U13.
4. Só ligar a opção "Claro" quando todas as telas estiverem migradas.

Preferência em Meu Império › Aparência: **Escuro (padrão) · Claro ·
Sistema**, salva no aparelho (call meu: padrão continua escuro).

---

### 5.11 Troca de dados (desempenho e custo)

| Problema hoje | Mudança |
|---|---|
| 118 chamadas `fetch("/api/...")` soltas em 38 arquivos, mais o `api.ts` (2,3 mil linhas) com cache manual em `sessionStorage` | **Um cliente de API** (o `api.ts`, organizado por domínio) + **React Query** para cache, deduplicação e recarregar ao voltar para a tela. O `QueryClient` e o Provider já estão montados (`router.tsx`, `__root.tsx`), só não há nenhum `useQuery`. |
| Cada tela busca tudo de novo ao abrir | Cache **no front** com tempos por tipo: ao vivo = 30 s; catálogo = 5 min; social = 30 s + puxar para atualizar; charts = o mesmo comportamento de hoje (nada muda no backend de charts). |
| Social carrega todos os posts | Paginação por cursor (5.6.4). |
| Social e curtidas leem a planilha inteira | D1 como fonte da verdade (5.6.7). |
| Pacote principal de ~960 KB | Cada aba carrega só o seu código (divisão por rota). |
| Imagens grandes | `loading="lazy"` em todas (hoje só 28 usos) e tamanho certo por lugar. |
| `src/services/api.ts` (cliente antigo do Apps Script) | Sem uso: sai na fase de limpeza. |

---

## 6. Padrões de interface

### 6.1 Fileira rolável com seta (`ScrollRow`)

Decisão do usuário: **só seta e arrastar para o lado; nunca quebra de
linha.** Padrão do YouTube/Spotify:

- A fileira rola na horizontal; cada item tem `shrink-0`, padding real e o
  texto inteiro (sem "…").
- **Seta numa faixa própria**: degradê da cor do fundo (≈56px) com o botão
  redondo (32px visível, área de toque de 44px) por cima. A seta só aparece
  do lado que ainda tem conteúdo e some no fim.
- Toque na seta = avança "uma página" (largura visível − as duas faixas) e
  **para no começo de um item** (`scroll-snap`, `scroll-padding` igual à
  faixa).
- A opção **selecionada sempre fica inteira na tela**: ao abrir e ao
  trocar, a fileira rola até ela.
- O item pela metade na ponta é **proposital**: mostra que dá para
  arrastar. Ele aparece inteiro com um toque na seta ou ao arrastar.
- Teclado: setas ←/→ movem entre itens (acessibilidade).

### 6.2 Telas por cima e voltar

Toda folha, janela ou tela por cima usa `useHistoryOverlay`: empurra
entrada no histórico ao abrir, fecha no `popstate` só se a entrada dela
saiu, e o X/seta chama `history.back()` se ela ainda é a atual (padrão já
descrito no `CLAUDE.md`).

### 6.3 Menu ⋯

Sempre uma folha de baixo (`ActionSheet`) com ícone + texto, ações
destrutivas em vermelho e por último, e "Cancelar".

### 6.4 Selo NOVO

Só no protótipo. No app não existe selo.

### 6.5 Regras de tela pequena, toque e acessibilidade (revisão de UX/UI)

Aplicadas no protótipo (versão 12) e obrigatórias no app:

| # | Regra |
|---|---|
| U1 | **Abaixo de 380px de largura** (celulares pequenos): o botão Criar vira só o ícone ＋, a marca "EMPIRE HUB" diminui, "Interagindo como" mostra só a foto e o nome, e as linhas de lista encolhem capa e coluna de posição. Nada pode sobrepor nada (testar em 320, 360 e 390px). |
| U2 | **Rótulos da barra de baixo** crescem com o texto do sistema só até 11,5px, para nunca se encostarem. |
| U3 | **Área de toque mínima de 44×44px** em todo link e botão, inclusive "Ver tudo", "Gerenciar" e "Abrir" (a área cresce, o visual não muda). |
| U4 | **Nome de música/álbum em cartão estreito** quebra em até 2 linhas, nunca "…" em 1 linha. |
| U5 | **Página do lançamento:** Tocar + 2º botão ocupam a linha; ♡ e ⋯ ficam no cabeçalho da tela; selos numa linha só que rola. |
| U6 | **Social:** o filtro de rede é o botão "Redes ▾" ao lado de "Interagindo como" (uma folha com Todas/Instagram/Twitter/TikTok), não uma fileira a mais. |
| U7 | **Fórum:** botão de filtros (artista, datas) dentro do campo de busca; "Não comentei" é a última opção da fileira Tudo/Músicas/Vídeos/Álbuns. |
| U8 | **Início › Para você:** ordem = **banners (Patrocinado, Pre-save)** → faixa Ao vivo → cronômetro → **Pra fazer hoje** → Meus artistas → Lançamentos → Global 100 #1 → Top por plataforma → Próximos eventos → ticker → Social → Da Imprensa. A ordem continua configurável por `homeFlags`. |
| U9 | **Estados obrigatórios em toda tela nova:** carregando (esqueleto no formato do conteúdo), vazio (frase do que falta + ação) e erro (o que deu errado + "Tentar de novo"), reaproveitando o `LoadErrorState`. |
| U10 | **Cada aba lembra onde parou** ao trocar de aba; tocar na aba ativa volta ao topo. |
| U11 | **Deslizar para o lado** troca entre Para você, Empire TV, Turnês e Premiações (fora de fileiras roláveis). |
| U12 | **Puxar para atualizar** com indicador "Solte para atualizar" → "Atualizando…", em toda tela com lista. |
| U13 | **Cor por papel** (**aprovada**, D3): roxo = ação e link; aba/opção ativa = branco no escuro e roxo no claro; verde = tocar, alta e "tocando"; vermelho = ao vivo e queda; dourado = coroa/prêmio. |

### 6.6 Identidade visual (reforços)

- **Números em preto itálico** (`.num`): posições de chart, Fortuna, estatísticas, a mesma letra da marca.
- **Coroa dourada no #1** (charts, Hall of Fame), com brilho leve.
- **Equalizador animado** ao lado da faixa que está tocando (listas, charts, mini player); parado com `prefers-reduced-motion`.
- Mantém: fundo azul-marinho, roxo do logo, títulos de marca em preto itálico maiúsculo no escuro, cartões com degradê da cor da capa.

### 6.7 Página do artista

**Mantém o formato de hoje** (`src/routes/artistas.$nome.index.tsx`), que o
usuário prefere a uma lista corrida: capa (celular/computador), foto
redonda, gravadora, nome com verificado, status, 3 cartões de Fortuna,
nível do responsável, ações rápidas do dono (Álbum, Turnê, Cinema, agora
abrindo o Criar) e **abas**: Visão Geral, Discografia, Músicas, Vídeos,
Charts (Global 100, Spotify, YouTube, BB 200 + Chart Runs), Awards, Turnês
& Projetos, Social, Gestão (dono). Mudanças só de casca: fileira de abas
rolável com seta e **presa no topo ao rolar**; seguidores passam a ser o
número calculado (5.6.6).

**Fonte única de artistas (já na `main`, 2026-11-25; ver
`2026-11-25-artistas-fonte-unica-design.md`) — entra no Beta sem mudar a
lógica:**

- Aba **Gestão** do artista (dono): Trocar foto, Editar biografia, Capa do
  perfil (como hoje) e o bloco **Perfil do artista**:
  - **Nacionalidade:** escolhe da lista de países; depois de salva fica
    travada ("Para alterar, fale com a administração."). Admin troca quando
    quiser.
  - **Estilo principal:** lista fechada (POP, R&B, ALTERNATIVE/ROCK, RAP,
    FUNK…), pode trocar sempre.
  - **Só admin:** "Atualizar a partir da planilha" (sobrescreve o perfil com
    a aba ARTISTAS, mostra o que mudou, com confirmação).
  - Administrativo: Rescindir (como hoje).
- **Link direto** `/artistas/$nome?aba=gestao` abre já na aba Gestão (usado
  pelo aviso abaixo) — entra na tabela 5.1.
- **Aviso "Complete o perfil de {artista}: nacionalidade / estilo"**: hoje
  aparece na Gestão (Catálogo › Gestão). No Beta continua lá (Criar ›
  Gestão) **e** aparece em **Início › Pra fazer hoje** e em **Meu Império ›
  Meus artistas** (selo "falta completar"), levando à aba Gestão do
  artista.
- **Admin › Painel do catálogo:** "Atualizar todos os artistas a partir da
  planilha" (com confirmar/cancelar), como na `main`.
- **Perfil público mais completo (pedido do usuário; todo jogador vê):**
  - **Abaixo do nome**, ao lado do status: dois selos tocáveis numa linha
    (sem quebrar; rola para o lado se não couber): **bandeira + país**
    (abre Charts › Ao vivo › Por país daquele país) e **🎵 estilo
    principal** (abre a página do gênero no Catálogo). Se o artista ainda
    não tem os dados, os selos não aparecem para os outros; **só o dono**
    vê "＋ Adicionar nacionalidade e estilo", que abre a aba Gestão.
  - **Visão Geral começa com a "Ficha do artista"**: cartões em 2 colunas com
    Nacionalidade (bandeira + nome), Estilo principal, Gravadora, Na ativa
    desde, Contrato e Awards (vitórias e indicações, os mesmos números da
    aba Awards). Depois vêm Biografia e o resto da Visão Geral de hoje.
  - **Acessível:** a bandeira nunca aparece sozinha (sempre com o nome do
    país, e o emoji é escondido do leitor de tela); selos com altura mínima
    de 32 px e texto que não sai do selo (regras do `CLAUDE.md`); "Não
    informada" quando faltar, em vez de vazio.
  - **Dados:** país, estilo e gravadora já vêm de `GET /api/artistas/perfil`.
    "Na ativa desde" usa a coluna ANO EM QUE INICIOU A CARREIRA, que já está
    no espelho (`ano_inicio`) mas **ainda não sai na API**: incluir
    `anoInicio` na resposta (só leitura; nenhuma regra muda). Bandeira:
    tabela país → emoji no front (mesma lista de países de `pais_peso`).
- **Aba Charts do artista — chart run completo (pedido do usuário):**
  - **Hoje** (`ChartsTab`): mostra só "#pico · título · N sem." das 10
    melhores músicas do Global 100, e só o pico em Spotify/Apple/YouTube.
    A sequência de posições **já chega** (campo `runs[].v`, ex.: "12 - 5 -
    1 - 1"), só não é mostrada.
  - **Novo:** fileira rolável **Global 100 · Spotify · Apple Music ·
    YouTube**; números do topo (#1s, Top 10, semanas no chart); e um cartão
    por música: **título** + selo **Peak #N** (dourado no #1, roxo no top
    10) e embaixo a **sequência de posições** semana a semana ("12 – 5 –
    **1** – **1** – 2 – 4 …"), com #1 em dourado, top 10 em destaque e o
    resto mais apagado; rodapé com semanas, semanas no #1, estreia e última
    posição. Legenda das cores. Todas as músicas, ordenadas por pico e
    depois por semanas. Leitor de tela lê "posições 12, 5, 1…".
  - **Leitura:** zero linha a mais. O Global 100 já vem do D1
    (`chart_artista_musica`, lida pela chave do artista: uma linha por
    música). Para Spotify/Apple/YouTube, a **mesma consulta** já traz a
    coluna `run`; só falta devolvê-la em `perfilHOF` (hoje devolve só o
    pico). Charts que ainda estão só na planilha (HALL_OF_FAME_DB) seguem
    mostrando só o pico até migrarem. **Nenhuma regra/cálculo dos charts
    muda.**
- **Ouvintes mensais e ranking do mês (estilo Spotify):**
  - Abaixo do nome (pedido do usuário: as três plataformas): fileira de 3
    cartões iguais — **Spotify · ouvintes mensais**, **Apple Music ·
    ouvintes mensais** e **YouTube · visualizações mensais** — do último mês
    fechado. Nome da plataforma em cima (pode quebrar em 2 linhas em tela
    estreita, nunca corta), número grande, rótulo embaixo.
  - No começo da Visão Geral: **Ranking do mês · {mês}** com 3 cartões
    (Spotify, Apple Music, YouTube): posição no ranking do mês e ouvintes.
    Tocar abre Charts › {plataforma} › Artistas do mês.
  - **Dados:** os mesmos de Charts › Artistas do mês: abas RESUMO MENSAL
    (ouvintes, `ov`) e TOP 50 ARTISTAS (posição) da planilha mensal. **Não
    usa o D1** (zero linha lida no plano gratuito do D1). As abas já ficam
    em cache no servidor (cache de leitura do `googleSheetsService` e das
    respostas de `/api/charts`), compartilhado por todos os jogadores. Nova
    ação `getArtistMonth&artist=` devolvendo, para o mês mais recente de
    cada plataforma, ouvintes e posição, lendo as **mesmas duas abas** já
    lidas hoje. Artista fora do TOP 50 do mês: mostra só os ouvintes, sem
    posição; sem dado no mês: o cartão não aparece.
- O critério de admin passa a ser um só: `isAdminLogin` (`LoginScreen.tsx`).
  O `useIsAdmin` da fase 0 usa essa função.

### 6.8 Mudança de lugar: aviso ao jogador *(NOVO)*

Na primeira abertura do app novo, uma folha **"O Empire Hub mudou de
lugar"** mostra onde ficou cada coisa (Empire TV/Turnês/Premiações → Início; Acervo → Social › Imprensa;
Gestão e Pre-save → Criar; Perfil, Ponto, Market, Premiações → sua foto;
Fórum → aba própria; playlists ao vivo → Charts › Ao vivo). Aparece uma
vez (guardado no aparelho) e pode ser reaberta em Meu Império › Guia.

### 6.9 Pequenos acertos encontrados na 6ª conferência

- **Notificações:** a tela ganha "Marcar todas como lidas" (a API já existe:
  `/api/notificacoes/marcar-lidas`) e "Configurar" (o "O que receber no
  celular" de hoje).
- **Página 404** está em inglês ("Page not found", "Go home" em
  `__root.tsx`): passa a "Página não encontrada" e "Voltar ao Início".

### 6.10 Computador e tablet

A mesma estrutura, com a casca adaptada ao tamanho da tela (medida pela
largura da área do app):

| Largura | Navegação | Conteúdo | Player |
|---|---|---|---|
| até 699px (celular) | barra de baixo com 5 abas; topo com logo + selo beta, ＋, sino e foto | 1 coluna | mini player acima da barra |
| 700–999px (tablet) | **trilho lateral** com as 5 abas (ícone + nome); topo igual ao celular | grades com várias colunas (cartões de ~170px), prateleiras maiores | mini player flutuante embaixo |
| 1000px ou mais (computador) | **barra lateral completa** (240px): logo, botão **Criar**, 5 abas, **Sua biblioteca** (Minhas playlists, Salvos), **Meu Império** (Perfil e economia, Meus lançamentos); topo com **campo de busca aberto**, sino e foto | conteúdo com largura máxima de ~1100px | **barra de player fixa** embaixo, de ponta a ponta (como no Spotify) |

- Folhas (Criar, ⋯, Avaliar & Comentar) aparecem centralizadas, com
  largura máxima de ~560px, no tablet e no computador.
- Vídeos verticais (TikTok) ficam centralizados com no máximo 420px.
- A capa do artista já tem versões para celular e computador; o
  computador usa a de computador.
- Regras de toque (U3) e de texto (R4) valem em todas as larguras.

### 6.11 Beta test (convivência das duas versões)

**Objetivo (pedido do usuário):** lançar a versão nova como **"Beta test"**,
com um botão no topo para **voltar para a versão anterior** a qualquer
momento. Assim, se algo der errado, o jogador volta e **reporta** o que
aconteceu.

**Quem vê o quê**
- No lançamento, **todo jogador abre no Beta test** (call meu, lendo o
  pedido: "liberar uma versão nova" com opção de voltar). O admin pode
  mudar isso sem nova versão do app (ver "Chave do admin").
- A escolha de cada jogador (**beta** ou **anterior**) fica salva **no
  servidor**, no perfil dele, e também no aparelho para abrir rápido. Assim
  ela vale no celular e no computador.

**No Beta test**
- Selo amarelo **BETA** no topo, ao lado do logo (no computador, ao lado da
  busca). Tocar abre a folha **"Você está no Beta test"**:
  - **Reportar um problema**;
  - **Como usar** (tutorial, 6.12);
  - **Voltar para a versão anterior**.
- **Voltar:** confirmação com motivos opcionais (Não achei uma função · Algo
  quebrou · Ficou lento · Prefiro o visual antigo · Outro) e texto livre.
  "Voltar agora" salva a escolha, grava o motivo como um reporte (se houver)
  e recarrega o app na versão anterior, **na tela equivalente** quando
  existir (as URLs são as mesmas, 5.1).

**Na versão anterior**
- Uma faixa fina no topo: **"Versão anterior · Reportar · Ir para o Beta
  test"**. É a única mudança visível na versão de hoje.

**Reportar um problema** (nas duas versões)
- Campos: **O que aconteceu?** (obrigatório), **Tela** (preenchida sozinha
  com o nome da tela atual), **Anexar print** (opcional, mesmo upload de
  imagem que o app já usa) e **Incluir dados técnicos** (ligado por padrão:
  versão — beta ou anterior —, rota, aparelho e navegador, número da versão
  do app (`__BUILD_ID__`) e os últimos erros que o app já captura em
  `error-capture`).
- Depois de enviar: "Recebido! A moderação vai olhar."
- **Guardado no D1** (tabela nova, ex.: `beta_reporte`: id, jogador, versão,
  tela, rota, texto, motivo, print, dados técnicos, status, data). Nada de
  planilha.
- O admin recebe uma **notificação** (mesmo sistema do sino/push).

**Para o admin** (Meu Império › Admin)
- **Reportes do Beta:** lista com filtro por status (Novo · Visto ·
  Resolvido), tela e versão; abrir mostra tudo, inclusive o print.
- **Chave do Beta test** (salva no servidor, efeito imediato para todos):
  - **Ligado para todos** (padrão no lançamento): todos começam no Beta e
    podem voltar.
  - **Só convidados:** só quem o admin marcar vê o Beta (para testar com
    poucos antes).
  - **Desligado:** todo mundo volta para a versão anterior na próxima
    abertura (botão de emergência se o Beta quebrar).
  - **Obrigatório:** o Beta vira a única versão; o botão de voltar some.
    É o passo antes de apagar o código antigo (fase 6).

**O que um jogador vê do outro (decisão confirmada com o usuário)**

As duas versões leem e gravam **os mesmos dados**. Tudo o que alguém faz
numa versão aparece para quem está na outra: posts, comentários,
curtidas, lançamentos, playlists, pontos, votos, turnês, Red Carpet etc.

Funções que só existem no Beta, e como aparecem na versão anterior:

| Função do Beta | Quem está na versão anterior vê |
|---|---|
| **Repostar** | o post continua no feed normalmente; a versão anterior não mostra "Fulano repostou" nem reordena o feed (ela não tem esse recurso). O contador de reposts, hoje fixo em "0", passa a mostrar o número real |
| **Seguir entre artistas** | o número de "seguindo" já soma os follows reais (mesma resposta da API); o botão Seguir da versão anterior também passa a salvar de verdade (call meu: é o mesmo dado) |
| **Seguidores calculados** | o mesmo número calculado (a API devolve o mesmo valor para as duas) |
| **Lembretes (sininho)** | os avisos chegam no sino e no celular, qualquer que seja a versão aberta |
| **Abas Respostas/Mídia/Curtidas/Reels/Marcados** | só no Beta; na anterior continuam como hoje |
| **Mensagem** | o botão sai também da versão anterior (decisão do usuário) |

**Tempo para aparecer:** quem publica vê na hora. Para os outros, a
versão de hoje guarda as respostas por até 2 minutos (`CACHE_FRESH` em
`api.ts`) antes de buscar de novo, e o Beta faz o mesmo (30 s no
Social, 5 min no catálogo). Puxar para atualizar busca na hora, nas duas.

**Regras técnicas que não podem falhar**
- **As duas versões usam o mesmo backend e os mesmos dados.** Toda mudança
  de backend feita para o Beta precisa continuar funcionando para a versão
  anterior enquanto ela existir (ex.: o Social no D1, 5.6.7, tem que servir
  as duas telas).
- As duas cascas convivem no mesmo app: a raiz decide qual barra, topo e
  telas montar a partir da escolha do jogador. As URLs são as mesmas.
- Trocar de versão nunca perde o que está tocando no player nem um texto
  sendo digitado sem aviso (o app pergunta antes se houver rascunho).
- Medir: quantos voltam para a anterior, por qual motivo e em qual tela.
  É o termômetro do Beta.

### 6.12 Tutorial "Como usar"

- Duas versões do texto, mantidas no repositório e mostradas no app:
  - `docs/tutorial/tutorial-beta-test.md` (versão nova);
  - `docs/tutorial/tutorial-versao-anterior.md` (o tutorial do usuário,
    revisado e completado).
- **Onde aparece:** no Beta, em Meu Império › App › **Como usar** e na
  folha do selo BETA; na versão anterior, no menu ☰ › Guia de
  Sobrevivência. Uma alternância **Beta test | Versão anterior** no topo
  deixa ler as duas.
- Formato: um tema por bloco (abre e fecha), com avisos "Importante" em
  destaque.
- **As imagens do documento original** não vieram na leitura (só o texto):
  precisam ser recolocadas, de preferência com capturas do app novo.
- **Imagens:** capturas do app novo (decisão do usuário), uma por tema.
- **Cada tema tem um botão "Abrir …"** que leva direto para a tela de que
  ele fala (decisão do usuário).
- Shop, Info e Visual **já funcionam** e entram no tutorial (5.1, passo 8).
- **Popup de boas-vindas** (substitui o aviso de 6.8): aparece **logo de
  cara** na primeira abertura do Beta (decisão do usuário), com o que é o
  Beta, onde ficou cada coisa e três saídas: **Começar no Beta**, **Ver o
  tutorial** e **Prefiro a versão anterior**. Aparece uma vez por jogador
  (guardado no servidor junto com a escolha de versão).

### 6.13 Onde fica o Ponto

O Ponto era uma aba da barra de baixo. No primeiro desenho ele ficou
escondido em Meu Império, e o próprio usuário não o encontrou. Agora ele
tem **quatro entradas**:
1. **"Pra fazer hoje"** (Início): "Distribuir seus pontos da semana",
   enquanto houver saldo para distribuir (some quando já distribuiu).
2. **Charts:** botão **"Meu Ponto"** ao lado do título (os pontos mexem
   nos charts, então é onde o jogador pensa neles).
3. **Meu Império:** o grupo **Economia** (Ponto, Market, Leilão) é o
   primeiro depois de Meus artistas.
4. **Computador:** atalho **Ponto** na barra lateral, em Meu Império.

A tela do Ponto é a de hoje: saldo da semana e as 3 opções (Distribuir
pontos, Aplicar playlists, O que vale ponto). Nenhuma regra muda.

### 6.14 Cronômetro da semana *(NOVO, pedido do usuário)*

O calendário de divulgações vai de **quarta 00:00 até terça 23:59
(Brasília)**. É a mesma regra que o backend já usa
(`semanaAtual()`/`limitesSemanaAtual()` em `marketController.ts`, Metacritic
e reconciliação do registro). O cronômetro usa exatamente essa regra.

- **Onde aparece:** no topo de **Início › Para você**, no topo dos
  **Charts** e na tela do **Ponto**. Formato: `⏱ Semana 25/11 – 01/12 ·
  fecha em 6d 08h 06min`. Nas últimas 24h, vira `fecha em 05:12:33` em
  vermelho.
- **Custo zero:** calculado **no aparelho**, a partir do relógio, sem
  chamada ao servidor e sem escrita no banco. Atualiza a cada segundo só
  na tela visível.
- **Relógio errado no celular:** para não mostrar tempo errado, o app
  corrige o relógio com a hora do servidor que já vem no cabeçalho `Date`
  das respostas da API (diferença guardada na memória). Sem chamada extra.
- **Uma função só** (front e back), com teste nas viradas: quarta 00:00
  abre a semana nova, terça 23:59:59 ainda é a anterior (já conferido no
  protótipo).
- No **Pra fazer hoje**, o item do Ponto diz "fecha terça 23:59".

### 6.15 Medição de uso *(NOVO, pedido do usuário)*

**Objetivo:** descobrir com dados, e não com palpite, quais telas e ações
os jogadores mais usam, para revisar a navegação daqui a ~1 mês. Hoje a
percepção é: Catálogo e Fórum, depois Charts.

**Entra antes do Beta, na versão de hoje (call meu).** Assim temos a base
("como é hoje") e depois comparamos com o Beta. Sem essa base, não dá para
saber se a navegação nova encurtou os caminhos.

**O que mede**
| Medida | Exemplo |
|---|---|
| Tela aberta (rota + aba/sub-aba) | `/empire-play/forum › Músicas`, `Charts › Global 100` |
| Ações principais | tocar música, comentar, publicar lançamento, distribuir pontos, votar, postar, repostar, seguir, buscar, abrir o Criar |
| Versão | anterior · beta |
| Aparelho | celular · tablet · computador (pela largura) |
| Jogadores distintos por dia e por semana | quantos usaram cada tela |
| Caminho até as ações principais | de qual tela o jogador veio quando publicou, comentou ou distribuiu pontos |
| Volta do Beta | quantos voltaram para a anterior, por qual motivo e em qual tela (6.11) |

**O que não mede:** conteúdo de comentários ou posts, texto de busca,
dados pessoais. O id do jogador só aparece na contagem de "jogadores
distintos por dia". Os dados ficam guardados por 90 dias.

**Como funciona, sem custo extra**
- O app junta os eventos **na memória** e envia em lote **a cada 2
  minutos** e quando a aba é escondida ou fechada (`navigator.sendBeacon`
  para `/api/uso`). Não é uma chamada por clique.
- O servidor (o mesmo Worker) **soma** os contadores numa tabela D1 nova,
  `uso_diario (dia, versao, aparelho, evento, alvo, contagem)`, com uma
  única instrução em lote por envio
  (`INSERT … ON CONFLICT DO UPDATE SET contagem = contagem + ?`).
- Jogadores distintos: `uso_jogador_dia (dia, jogador)` com `INSERT OR
  IGNORE`, uma vez por jogador por dia (o app lembra que já mandou hoje).
- **Conta do custo** (planos gratuitos da Cloudflare: Workers 100 mil
  requisições/dia; D1 100 mil escritas/dia, 5 milhões de leituras/dia):
  cada jogador ativo gera cerca de 10 envios e 60 escritas por dia. **Com
  500 jogadores ativos/dia: ~5 mil requisições e ~30 mil escritas**, bem
  dentro do grátis. Se um dia passar de ~1.500 ativos/dia, o app passa a
  enviar a cada 5 minutos ou a amostrar 50% (ajuste por configuração,
  sem deploy).
- Uma chave em `homeFlags` liga e desliga a medição.

**Como ler o resultado**
- **Meu Império › Admin › Uso do app:** telas e ações mais usadas na
  semana, jogadores distintos, comparação **anterior × Beta** e por
  aparelho. Lê só a tabela somada (leituras baratas).
- **Revisão em ~1 mês:** ler essa tela (ou consultar o D1 direto) e
  decidir mudanças. Perguntas para a revisão: quais telas ninguém usa;
  quantos toques até publicar, comentar e distribuir pontos; onde o Beta
  perde jogadores.

### 6.16 Sininho "Lembrar" nos eventos *(NOVO, pedido do usuário)*

- **Onde:** um sininho em cada evento com hora marcada: programas da
  **Grade** da Empire TV e itens de **Próximos eventos** no Início (shows
  de turnê e programas). O sininho fica preenchido quando há lembrete.
- **Tocar abre a folha "Me avise antes de começar":** Quando começar · 10
  minutos antes · 30 minutos antes · 1 hora antes · 1 dia antes. Com
  lembrete ativo, aparece também "Não avisar mais".
- **Como avisa:** no **sino** do app e, se o jogador ativou, como
  **notificação no celular** (o push que já existe, `webPushService`).
- **Custo zero:** uma tabela D1 pequena, `lembrete (jogador, tipo_evento,
  id_evento, avisar_em, enviado)`. O **agendamento que já roda a cada 10
  minutos** (`triggers.crons` no `wrangler.jsonc`) envia os avisos
  vencidos. Por isso as opções são múltiplos de 10 minutos, e o aviso
  pode chegar até 10 minutos depois da hora escolhida (dito na folha
  como "por volta de").
- Se o evento mudar de horário, o lembrete acompanha (recalculado pelo
  `id_evento`); se o evento for cancelado, o lembrete some.

### 6.17 Fontes

As mesmas de hoje (conferido em `__root.tsx` e nos componentes):
- **Inter:** texto e títulos do app inteiro.
- **Fjalla One** (estreita, maiúsculas): títulos dos **Charts** e do
  painel de playlists (`PlaylistsInicio`, que vira Charts › Ao vivo).
  Continua exatamente onde está.
- **Poppins:** texto das capas dinâmicas de playlist (`DynamicCoverCard`).
- **Press Start 2P:** é carregada em `__root.tsx`, mas nenhuma tela usa.
  Sai do carregamento na fase de limpeza (página mais leve).

### 6.18 Admin "vendo como" outro jogador

Hoje o aviso "Vendo como … — Voltar a ser admin" só aparece dentro do
Perfil. No Beta, quando o admin entra como outro jogador, uma **faixa fina
fixa no topo** de todas as telas mostra "Vendo como @usuario · Voltar a ser
admin", para o admin não esquecer em qual conta está.


### 6.19 Sala da Empire TV no celular *(NOVO, pedido do usuário — caminho A)*

**Problema de hoje (lido em `src/routes/tv.tsx`, `WatchView`/`ChatPanel`):**
no celular o vídeo, os botões e a fileira de abas ocupam metade da tela e
espremem o chat; o chat sempre puxa para o fim (quem está lendo algo antigo
perde o lugar) e não tem aviso de "mensagens novas"; mensagens antigas só
carregam apertando um botão.

**Sala nova** (protótipo: Início › Empire TV › Entrar na sala), inspirada
no chat do Telegram, sem perder o vídeo, que é o foco:

1. **Vídeo sempre no topo** (16:9, largura toda), com só dois botões por
   cima: **⌄ minimizar** (continua tocando no mini player) e **⤢ tela
   cheia**. O selo "Ao vivo" fica no canto.
2. **Faixa fina** logo abaixo: nome do programa e "N assistindo · Sobre"
   (toca e abre Sobre) e, à direita, o **círculo da sua participação**
   (ex.: 62%), que abre o detalhe (6.19.1).
3. **Fileira rolável** (seta + arrastar, regra do CLAUDE.md) com Red Carpet
   (só quando o tipo de evento tem, como hoje), Participantes, Enquete e
   Sobre. Cada uma abre como **folha por cima** (o vídeo continua tocando
   atrás; voltar fecha só a folha — regra "voltar = tela anterior").
4. **Enquete fixada** no topo do chat (como mensagem fixada do Telegram)
   enquanto estiver aberta. É a enquete de hoje: **nota secreta** de
   `notaMin` a `notaMax` sobre o alvo da planilha, "Você votou N".
5. **Chat compacto:** foto pequena, **nome e texto na mesma linha**, nome na
   cor do papel (U13; equipe com selo). Separador de horário. O aviso
   "✨ Fulano chegou ao Red Carpet" continua como pílula que abre o look.
   Mensagem citada aparece em cima da resposta.
6. **Rolagem como no Telegram:** se a pessoa está no fim, novas mensagens
   descem sozinhas; se rolou para cima, o chat **não puxa** e aparece
   **"↓ N novas"**. Rolar até o topo **carrega as anteriores sozinho**
   (substitui o botão "Carregar mensagens mais antigas").
7. **Arrastar a mensagem para a esquerda = responder** (o botão Responder
   de hoje continua no menu). **Segurar a mensagem** abre: reações (❤️ 🔥
   😂 😱 👏 🖤 — **NOVO**, precisa de coluna/tabela de reações no Supabase),
   Responder, Copiar texto, Denunciar.
8. **Caixa de mensagem** com **Aa** (negrito `*texto*` e itálico `_texto_`,
   que já existem), campo, **GIF** (a mesma galeria de hoje, inclusive
   "Enviar novo GIF/sticker") e enviar.
9. **O teclado não cobre o vídeo** (o usuário já tinha implementado isso e
   continua valendo): ao digitar, quem encolhe é a área do chat, usando a
   altura visível (`visualViewport`); o vídeo fica fixo no topo.
10. **Celular deitado:** vídeo em tela cheia e o chat **semitransparente na
    lateral direita** (~38% da largura), com a caixa de mensagem embaixo
    dele. Deitar de volta volta para a sala normal.
11. **Computador e tablet (6.10):** vídeo à esquerda, chat como coluna fixa
    à direita, sem folhas (abas ao lado do chat).

Nada sai: Chat, GIFs (escolher e subir), responder, negrito/itálico,
Enquete, Red Carpet (postar com várias fotos, curtir, ranking, excluir o
seu, pílula de chegada), Participantes, Sobre, minimizar, mini player,
carrossel "Assistir agora" e grade continuam.

#### 6.19.1 Porcentagem de participação (caminho A)

**Problema de hoje** (`registrarPresencaTVController` e
`somarPresencaPorTransmissao` em `backend/src/controllers/tvController.ts`):

- o app conta os segundos **da entrada atual** e grava uma linha nova na
  planilha Presenca_TV a cada 30 s;
- o processamento pega o **maior** valor por pessoa em cada segmento. Quem
  sai e volta **recomeça do zero** e só a maior sessão vale (ex.: 40 min +
  sai + 50 min = **50 min**, não 90);
- **minimizar desmonta a sala** e para a contagem, mesmo com o mini player
  tocando;
- a aba Participantes mostra o tempo de um segmento, mas o crédito usa a
  transmissão inteira: **o número que a pessoa vê não é o que ela ganha**;
- uma linha a cada 30 s por pessoa pesa na cota do Google Sheets.

**Regra (decidida pelo usuário):** a porcentagem é **só o tempo em que a
pessoa esteve com a sala aberta ou o mini player tocando**. Mensagens **não** entram na conta (quem
só assiste e comenta pouco recebe o tempo todo; quem manda várias
mensagens e sai cedo recebe só o tempo em que ficou). Isso substitui a
regra de hoje "vale o maior entre presença e chat (10 mensagens = 100%)".

**Início e Término marcados pelo admin, na própria sala:**

- Na sala, **só o admin** vê uma faixa com **▶ Início do evento** e, depois
  de iniciar, **■ Término**. Cada toque grava o horário exato
  (`tv_evento`: `programa_id`, `inicio_em`, `fim_em`, quem marcou — 2
  gravações por evento) e manda um aviso no chat ("🔴 O evento começou" /
  "🏁 Evento encerrado").
- A duração do evento é **Término − Início**. Não depende mais da grade.
- **Ao tocar em Término**, o servidor já calcula a participação e envia
  para a planilha (não precisa esperar o cron). Enquetes abertas são
  encerradas e o resultado vai para o chat.
- **Se o admin esquecer:** sem Início, vale o horário da grade (como hoje).
  Sem Término, o cron encerra sozinho no fim da grade + 1 hora e avisa o
  admin no sino. O admin pode corrigir os horários em Admin › Programação
  da Empire TV antes de reprocessar.

**Como medir:**

1. **Linha do tempo por minuto**, de Início a Término. A pessoa está
   **presente num minuto** quando a **sala está aberta ou minimizada no
   mini player** (autorizado pelo usuário) e a tela está ligada na aba do
   app (`visibilitychange`). Para isso, a contagem sai da `WatchView` e
   passa a morar no `TvPlayerContext` (que continua montado com o mini
   player).
2. **Tolerância a queda de conexão:** um buraco de até 2 minutos entre dois
   minutos presentes conta como presente (troca de rede, app recarregando).
3. **Sessões somam sem contar em dobro:** sair e voltar soma; duas abas ou
   dois aparelhos ao mesmo tempo contam o minuto uma vez só.
4. **% = minutos presentes ÷ minutos entre Início e Término.** As faixas da
   aba "Regras", a REGISTRO e o prestígio `assistir_tv` (90% ou mais)
   continuam iguais. O número de mensagens vai para a planilha só como
   informação.

**Como guardar, sem pesar no plano gratuito do D1** (limite do plano
gratuito: 100 mil linhas gravadas e 5 milhões lidas por dia):

5. **O app junta os minutos e envia a cada 5 minutos** (e ao sair da sala,
   com `sendBeacon`), não a cada minuto: uma lista de minutos presentes.
6. **Uma linha por pessoa por transmissão** na tabela `tv_presenca`
   (`programa_id`, `jogador_id`, `nome`, `minutos` = mapa de minutos em
   texto, `atualizado_em`). Cada envio **junta** o mapa novo com o guardado
   (minuto presente em qualquer envio = presente).
7. **Conta:** 200 pessoas × 2 h ÷ 5 min ≈ **4.800 linhas gravadas por
   evento** (~5% do limite diário gratuito). Para comparar: a primeira
   versão desta proposta (uma linha por minuto) daria 24 mil. O servidor
   ignora envios repetidos da mesma pessoa em menos de 4 minutos (proteção
   contra abas duplicadas ou bug).
8. **Somar com o resto do D1:** junto com a medição de uso (6.15, ~2 linhas
   por jogador por dia) e o Social (5.6.7), fica abaixo de 20% do limite
   diário num dia com evento grande. A tela Admin › Uso do app mostra o
   consumo do dia.
9. **Limpeza:** o cron apaga as linhas de `tv_presenca` com mais de 30 dias
   (depois de processadas).

**Enviar os dados combinados para a planilha:**

10. No **Término** (ou pelo cron, se o admin esquecer),
    `processarParticipacaoTV` lê o D1, conta as mensagens do chat no
    Supabase (só como informação) e junta tudo **por pessoa**.
11. Grava a **REGISTRO** como hoje (mesma % final, mesmas faixas).
12. Grava na **Presenca_TV** **uma linha por pessoa**, numa gravação só
    (em lote): Data · Programa · Jogador · Nome · Minutos presentes ·
    Início · Término · % presença · Mensagens · Entrou às · Saiu às.
    Assim o admin confere tudo numa linha só.
13. **Participantes e o círculo** da sala leem a mesma conta (com cache de
    30 s), então o número da tela é o que será creditado.
14. **Transição:** transmissões que começaram antes da troca continuam
    processadas pelo jeito antigo; as novas usam o D1. O corte é pela
    data/hora de início.

**Ganho extra:** hoje cada pessoa grava uma linha na planilha a cada 30 s
(200 pessoas = ~400 gravações por minuto). O Google Sheets limita as
gravações por minuto; acima disso, ele recusa e o registro se perde em
silêncio. **Isso pode ser parte da contagem ruim de hoje** (a conferir nos
logs de erro do Worker durante um evento cheio). Com a proposta, a planilha
recebe uma gravação por transmissão.

**Vale para as duas versões** (anterior e Beta), porque é o mesmo servidor:
por isso entra numa fase própria (0b, seção 8), antes do Beta.

#### 6.19.3 GIFs do chat em tempo real

**Hoje** (`tvChatGifsController.ts` e `ChatPanel`): o seletor já tem
**Mais usados** (padrão) e **Recentes**. Os usos ficam na aba
`TV_Chat_Gifs_Usos` da planilha Agenda_TV. Três limites:

- a lista é carregada **uma vez** por sala: o que os outros mandam não
  muda a ordem até sair e voltar;
- **Recentes** é a ordem de upload, não de uso;
- só os **100 GIFs mais novos** da pasta do Drive aparecem: um GIF antigo
  muito usado some do seletor quando a pasta passa de 100.

**Como fica:**

1. **Ao vivo, sem custo extra:** o chat já chega em tempo real pelo
   Supabase. Quando chega uma mensagem de GIF (de qualquer pessoa), o app
   soma 1 no contador daquele GIF e o põe no topo de Recentes **na hora**,
   com o seletor aberto ou fechado. Ao abrir o seletor, busca a lista de
   novo para acertar os números.
2. **Recentes = último uso no chat ou upload**, o que for mais recente. A
   aba de usos ganha a coluna **Último uso** (gravada no mesmo envio que já
   existe; nenhuma gravação a mais).
3. **Todos os GIFs aparecem:** a listagem do Drive passa a buscar todas as
   páginas (com cache curto no servidor).
4. Cada GIF mostra o número de usos (Mais usados) ou "há N min" (Recentes).

#### 6.19.4 Enquetes criadas pelo admin no próprio chat *(NOVO, pedido do usuário)*

**Hoje:** a enquete vem da planilha (pergunta, alvo, nota de `notaMin` a
`notaMax`, voto secreto) e aparece em cima do chat. **Continua
funcionando** como hoje.

**Novo:**

1. **Criar na sala:** o admin toca em **📊** ao lado do GIF (só admin vê) e
   preenche: pergunta; **tipo — Escolha única ou Múltipla escolha** (sempre
   uma das duas; a "Nota" de hoje fica como terceira opção); de 2 a 10
   opções; e as chaves **Voto secreto** (ligada por padrão), **Resultado só
   no fim** e **Encerrar sozinha em N minutos**. **Publicar** põe a
   enquete no chat na hora, para todos, e a **fixa no topo**.
2. **Votar no chat:** escolha única = um toque. Múltipla = marcar as
   opções e **Votar**. Cada pessoa vota uma vez por enquete (pode trocar o
   voto enquanto estiver aberta). Depois de votar, vê as porcentagens ao
   vivo (a não ser que esteja "Resultado só no fim").
3. **Encerrar:** pelo botão **Encerrar** no cartão (admin), pelo tempo, ou
   no **Término** do evento. Ao encerrar, o chat recebe a mensagem
   **🏁 Resultado da enquete** com as barras, o total de votos e o
   vencedor. Publicar uma enquete nova encerra a anterior.
4. **Arquivo do chat:** a aba **📊 Enquetes** da sala lista todas as
   enquetes daquela transmissão com os resultados (aberta ou encerrada).
   Fica guardado mesmo depois da transmissão; o admin pode **baixar a
   planilha** (enquete, tipo, opção, votos, %, horário).
5. **Onde fica:** no **Supabase**, junto do chat (que já é em tempo real e
   não usa a cota do D1): tabelas `tv_enquete` (sala, pergunta, tipo,
   opções, chaves, aberta/encerrada, horários, quem criou) e
   `tv_enquete_voto` (enquete, jogador, opções escolhidas; uma linha por
   pessoa por enquete). O voto secreto esconde quem votou em quê de todos,
   menos do admin na planilha baixada. No **Término**, o servidor também
   grava os resultados na aba **Enquetes_TV** da planilha Agenda_TV, numa
   gravação só.
6. **Quem pode criar:** só admin (mesmo critério de hoje). A regra é
   checada no servidor, não só escondendo o botão.

#### 6.19.2 Som da Kick no celular

**Hoje:** o player da Kick abre com `autoplay=true&muted=false`. O
navegador do celular não deixa vídeo **começar sozinho com som**, então
força o mudo. O botão "Ativar som" fica fora do player da Kick e, no
iPhone, um toque fora do player não libera o som: o jogador precisa
expandir o vídeo e tocar no ícone de som da própria Kick.

**Limite da Kick:** o player embutido só aceita `autoplay` e `muted` no
endereço; não existe API para controlar som/play de fora (pedido aberto:
KickDevDocs #445).

**Opções:**

| # | Opção | Custo | Situação |
|---|---|---|---|
| 1 | Abrir o player **parado** (`autoplay=false&muted=false`) com "Toque para assistir com som": o primeiro toque é no play da própria Kick, e o vídeo já começa com som | zero | **Recomendada; em teste.** Página escondida só para admin: `/tv-teste-som` (opções A hoje, B parado, C mudo) |
| 2 | Player nosso tocando o vídeo da Kick por dentro (endereço interno com senha que expira) | zero | Não recomendada: não oficial, a Kick bloqueia o servidor, pode quebrar |
| 3 | Transmissor próprio (ex.: Cloudflare Stream Live) com repasse para a Kick; nosso player no app | ~US$ 1 por mil minutos assistidos (~US$ 24 por evento de 200 pessoas × 2 h) | Projeto à parte, se o usuário quiser |

**Decisão pendente (D5):** resultado do teste da opção 1 no iPhone e no
Android. Se B funcionar, a sala nova abre parada com "Toque para assistir
com som"; o mini player e o YouTube/Vimeo continuam como hoje.


### 6.20 Auditoria de acessibilidade, toque e telas estreitas (2026-11-26)

Rodada automática no protótipo (47 telas × 320 px e 390 px, tablet e
computador, modo claro e escuro), mais revisão das capturas. Vira regra
para a implementação:

1. **Voltar do celular/navegador** fecha só a camada de cima (folha, tela
   cheia da TV, página empilhada); fechar pela seta/X remove a entrada
   dela; trocar de aba da barra limpa as entradas das páginas fechadas.
   Testado no protótipo: página › página › folha, folha por cima da sala da
   TV, celular deitado, seta seguida do voltar (não pula tela).
2. **Contraste (WCAG AA, 4,5:1 no texto normal)** — cores que mudam no
   **modo claro**: dourado `#fbbf24/#f59e0b` → `#92400e`; azul do
   verificado `#38bdf8`, Twitter `#1d9bf0` e ciano → `#0369a1`/`#0e7490`;
   roxo dos nomes de artista no chat `#c084fc` → `#7e22ce`; rosa
   `#f472b6` → `#be185d`; texto secundário `--p-muted` `#6b6b73` →
   `#55555c`; verde de play/alta `#0a8f62` → `#087a54`. No **modo escuro**:
   botão Tocar/Assistir verde com **texto escuro** (`#03140d`) em vez de
   branco; selo "Ao vivo" em `#dc2626`; selos verdes com texto branco em
   `#047857`. Bandeira/emoji nunca é a única informação.
3. **Área de toque:** mínimo 44×44 px em tudo que se toca sozinho (ações do
   post, ◀ ▶ do encarte, número da faixa, "Encerrar" da enquete, selo BETA
   do topo com 28 px de altura + folga); nome de artista em linha ganha
   área invisível de 8 px em volta. Nunca menos de 24×24 px.
4. **Folga entre botões:** pelo menos 6–8 px entre ícones do topo (Criar,
   sino, foto) e entre ações do post; controles segmentados (Início ·
   Buscar · Biblioteca) contam como um bloco só.
5. **Telas de 320 px:** nenhuma rolagem lateral da página. As ações do post
   usam o ponto roxo de "novo" em vez do selo escrito (o selo empurrava o
   "⋯" para fora). Rótulos da grade do Criar quebram em 2 linhas em vez de
   escapar.
6. **Fileira de 3+ opções com rótulos de tamanhos diferentes vira fileira
   rolável** (regra do `CLAUDE.md`), não controle segmentado: Charts
   (Global · Por país · Artistas do mês) e Uso do app (Esta semana ·
   Anterior × Beta · Por aparelho) — antes cortavam o texto em 320 px.


---

## 7. Itens que mudam de texto (resquícios de Telegram)

| Onde | Hoje | Novo |
|---|---|---|
| ☰ Acesso Rápido | "Canais oficiais Telegram" | "Canais oficiais" (os links continuam os mesmos) |
| Modal "Identidade Imperial" | "DIGITE SEU ID TELEGRAM" | sai (o login por usuário e senha substitui); **conferir antes** se algum fluxo ainda abre esse modal (`window.setShowIdModal`) |
| `/ponto` | "Abra o app pelo Telegram para acessar o Ponto." | "Entre na sua conta para acessar o Ponto." |
| `GlobalLinkModal` | toast "Conecte seu Telegram primeiro" | "Entre na sua conta primeiro" |
| Gestão (`Gestao.tsx`, ~linha 744) | "Abra o app pelo Telegram para continuar." | "Entre na sua conta para continuar." |

Antes da fase 1, rodar uma busca por "Telegram" em todo texto visível e
completar esta tabela.

Nomes internos (`useTelegramUser`, `telegramId`, `tg_user_cache`...) **não**
são renomeados neste projeto (só texto visível), para não arriscar quebrar
dados salvos.

---

## 8. Fases de entrega

Cada fase vai ao ar completa e só é dada como pronta quando: (a) as linhas
da cobertura daquela fase foram conferidas no app; (b) os testes passam;
(c) as rotas da tabela 5.1 abrem a tela certa; (d) foi testada num celular
de 360px nos dois tamanhos de texto.

| Fase | Conteúdo | Depende de |
|---|---|---|
| **0a. Medição de uso** (na versão de hoje) | 6.15: envio em lote, tabelas `uso_diario` e `uso_jogador_dia`, chave em `homeFlags`, tela Admin › Uso do app. **Vai ao ar primeiro**, para medir a base por ~4 semanas antes do Beta | — |
| **0b. Participação na TV e GIFs** (nas duas versões) | 6.19.1: minutos presentes enviados a cada 5 min, tabela `tv_presenca` (uma linha por pessoa), processamento lendo o D1, Presenca_TV com uma linha por pessoa, Início/Término do admin, Participantes com o mesmo número; 6.19.3: GIFs ao vivo, Último uso, todos os GIFs | ~~D6~~ | **Decidido:** a porcentagem é só o tempo com a sala aberta ou o mini player, entre Início e Término marcados pelo admin; mensagens não contam. | — | — |
| **0. Fundações** (nada visível muda) | `ScrollRow`, `useHistoryOverlay`, `ActionSheet`, `useIsAdmin`, `useJogador`, React Query + cliente de API, tokens de cor com os valores atuais | — |
| **1. Navegação (Beta test)** | casca nova inteira **atrás do Beta test** (6.11): topo, barra/trilho/barra lateral (6.10), Criar, Meu Império, abas do Início, aviso de mudança, tutorial; chave do admin, reportes e faixa na versão anterior | 0 |
| **1b. Sala da Empire TV** (Beta) | 6.19: enquetes no chat (6.19.4), vídeo no topo, faixa fina, folhas, chat compacto, "↓ novas", arrastar para responder, reações, celular deitado; som conforme D5 | 0b, 1 |
| **2. Charts** | Ao vivo = painel do Catálogo; `ChartPlaylist` (só tela). **Nenhuma mudança de backend nem de cálculo.** | 0, 1 |
| **3. Catálogo e Fórum** | Catálogo Início novo, Buscar, Biblioteca, `PaginaLancamento` (tópico novo), Fórum na barra, `/meus-lancamentos` | 1, 2 (o painel sai do Catálogo na fase 2) |
| **4. Social** | D1 do Social + migração, paginação, "Interagindo como", perfil único, configurar perfis, Repostar, Seguir, seguidores calculados, abas que não funcionavam, Compartilhar, saída do Mensagem | 0, 1 |
| **5. Modo claro** | migração das ~2.800 cores tela a tela, Aparência | 0 (pode correr em paralelo a 2–4, tela a tela) |
| **6. Limpeza** | `ChartsRealTime` e telas antigas substituídas, rotas legadas só como redirecionamento, `src/services/api.ts`, `PlanilhaGrid`, componentes `ui/*` sem uso, Bolsa/Empresas no `api.ts`, controllers `adminDiag*` de investigações encerradas (listar e confirmar com o usuário antes de apagar) | 1–5 |

**Entre as fases 2 e 3**, por um tempo, o painel aparece em Charts › Ao
vivo e o Catálogo › Início ainda é o antigo. Aceitável (nada some), mas a
fase 3 deve vir logo em seguida (call meu: entregar 2 e 3 juntas se der).

---

## 9. O que fica para o construtor

- Nomes de componentes, tabelas, rotas novas e arquivos (os daqui são
  sugestão).
- Estrutura interna do React Query (chaves, invalidações).
- Divisão exata de código por rota.
- Ícones (lucide, como hoje) e animações, desde que sigam o protótipo.
- Como guardar o histórico do "Continue ouvindo".
- Formato do cursor de paginação.
- Ordem das telas dentro da fase 5.

---

## 10. Decisões abertas

| # | Decisão | Quem | Impacto |
|---|---|---|---|
| D1 | Pesos da fórmula de seguidores (`P=120, C=15, M=40, R=60` propostos) | usuário pode ajustar a qualquer momento, sem deploy | baixo |
| ~~D2~~ | ~~Seguidores antigos~~ **Decidido:** só a fórmula para artistas; perfis de mídia mantêm o número da planilha; seguindo = digitado + real. | — | — |
| ~~D3~~ | **Decidido:** cor por papel (U13). | — | — |
| D4 | Lista dos controllers `adminDiag*` que podem ser apagados na fase 6 | usuário (na fase 6) | só limpeza |
| D5 | Som da Kick: resultado do teste da opção 1 (`/tv-teste-som`) no iPhone e no Android; se não funcionar, avaliar a opção 3 | usuário (teste no celular) | sala da TV |
| D6 | Participação na TV só pelo tempo presente (mensagem só prova presença no minuto), no lugar de "vale o maior entre presença e chat" | usuário | REGISTRO e prestígio |

---

## 11. Referências

- Protótipo: https://claude.ai/artifact/XMEbpSJQP2xNnb1DJNjUGF
- Cobertura: `docs/superpowers/specs/2026-11-25-cobertura-funcionalidades.md`
- Mapa atual: `docs/superpowers/specs/2026-11-25-mapa-do-app.md`
- Painel de playlists (vai para Charts › Ao vivo):
  `docs/superpowers/specs/2026-11-24-playlists-empire-play-design.md`
- Charts no D1: `docs/superpowers/specs/2026-11-14-charts-d1-design.md`
- Catálogo D1 primeiro: `docs/superpowers/specs/2026-11-18-catalogo-d1-primeiro-design.md`
