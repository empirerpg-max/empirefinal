# Ponto > Playlists: limite por plataforma, Music Boost marcado e saldo nunca negativo

Data: 2026-11-26

## Por quê

Na semana de 2026-11-25, a música **Max Gorghan - Paradise Artificiale** ficou com
6 linhas na aba `ECOIN + INVESTIMENTO` (planilha `registrosCharts`):

- 1 linha manual (Ponto > Playlists): TOPO no Spotify, TOPO na Apple e Ad 5s no YouTube;
- 5 linhas de **Music Boost**, compradas pelo mesmo jogador entre 02:37 e 02:38
  (`Market_Compras`). Cada compra abre uma linha nova com a playlist mínima da
  plataforma. No fim: 3 Spotify, 3 Apple e 2 YouTube para a mesma música.

Com Alchimia aconteceu o mesmo na semana anterior. Brida e Samantha Cooper têm
o mesmo padrão. Além disso, nada impede o saldo do artista de ficar negativo:
a tela de Playlists até avisa "Saldo estourado — pode continuar", e o Market
não confere o saldo antes de comprar com ECoin.

## Regras (decididas com o dono do projeto)

### Playlists manuais (Ponto > Playlists)
- Cada música tem no máximo **uma linha manual** na semana, com no máximo uma
  playlist por plataforma (Spotify, Apple Music, YouTube).
- Se a música já tem uma linha manual (com ou sem playlist), "Nova" reaproveita
  essa linha em vez de abrir outra. Na linha, a pessoa pode **trocar** a playlist
  de uma plataforma, mas não pode somar uma segunda.

### Music Boost e Album Boost (Market)
- O boost é um **extra**: soma por cima da playlist manual, inclusive na mesma
  plataforma.
- Limite: **1 boost por plataforma por música na semana** (Music Boost) e,
  pela mesma lógica, **1 por plataforma por álbum na semana** (Album Boost:
  extensão proposta por Claude).
- A linha do boost recebe a marca `BOOST` na **coluna F** da aba (hoje não
  usada). A planilha continua descontando como já faz.
- Linhas com `BOOST` **não aparecem** na lista de Ponto > Playlists e **não
  contam** para o limite das manuais.

### Saldo
- Nenhuma gravação de playlist manual e nenhuma compra de Music Boost ou Album
  Boost pode deixar o saldo do artista **negativo**. Se `saldo atual − custo < 0`,
  a operação é recusada com uma mensagem clara (ex.: "Saldo insuficiente:
  R$ 60.000 disponível, essa playlist custa R$ 100.000.").
- **Trocar** a playlist manual de uma plataforma conta só a diferença
  (`preço novo − preço atual daquela célula`). Trocar por uma mais barata
  sempre é permitido.
- "Limpar" uma linha manual sempre é permitido.

### Esta semana (dados já existentes)
- As linhas de boost que já existem não têm a marca. Elas serão marcadas uma
  vez, cruzando com `Market_Compras` (proposta de Claude; ver Execução).
- Boosts excedentes já comprados **não são apagados**, porque já foram pagos. As
  regras valem daqui para frente.

## Fora do escopo
- "Distribuir pontos > Aleatório" (porcentagens por categoria na aba `PONTOS`)
  continua como está. Não tem relação com playlists.
- Spotlight Banner: continua como está. Sua linha já é identificada por
  `C = (BANNER)` e não aparece na lista, porque C não é nome de artista.
- O brainstorming estrutural do menu Ponto é um trabalho separado, feito depois deste.

## Abordagens consideradas
- **A) Marca na planilha (coluna F = `BOOST`) + checagem no Worker antes de
  gravar.** ← **escolhida.** Tudo fica num lugar só, quem olha a planilha vê o que é
  boost, e o reset semanal da aba zera os limites sozinho.
- B) Sem marca: identificar boosts cruzando com `Market_Compras`. Descartada por
  ser frágil: o nome da música é escrito de jeitos diferentes nos dois lugares, o log
  não zera por semana e a planilha continua sem mostrar o que é boost.
- C) Boosts numa aba separada. Descartada porque exige mudar as fórmulas de
  saldo (`$ BANK ACCOUNT` / `DADOS`), que são do dono da planilha.

## Como (decisões tomadas)

Layout da aba (confirmado ao vivo; dados a partir da linha 3): C artista, D
`$ BANK ACCOUNT` (fórmula, saldo ao vivo = `DADOS!AI`), E música, **F marca**,
G/I/K playlist Spotify/Apple/YouTube, H/J/L valores (fórmula), O total. A coluna
B vem pré-preenchida e não indica quem comprou. Nunca ler nem escrever nela.

1. **Identidade da música.** Duas linhas são da "mesma música" quando C (artista)
   e E (música) batem, comparando com `normalizeComparison`. A escrita de E é
   diferente em cada caminho: o manual grava o texto de `PONTOS!D`, e o Music Boost
   grava o nome completo resolvido por `resolverNomeCompletoMusica`
   (`"Artista - Título"`). A checagem do limite de boost compara o valor que o
   **próprio boost grava** (resolvido do mesmo jeito) com outras linhas `BOOST`,
   então a diferença de escrita entre manual e boost não atrapalha. Album Boost
   compara `"(ALBUM) - <título>"`.
2. **Linha manual = linha sem `BOOST` em F e com C = artista.**
   - `getInvestimentosController` filtra fora as linhas com F = `BOOST`.
   - `iniciarInvestimentoController` reaproveita **qualquer** linha manual já
     existente do par artista+música (hoje só reaproveita se estiver sem
     playlist). Ao reivindicar uma linha livre, grava F = `""` explicitamente,
     para que uma marca antiga nunca esconda uma linha nova caso o reset semanal
     não limpe F.
3. **Market (`comprarItemController`, `music_boost`/`album_boost`):** antes de
   gravar, faz uma leitura fresca (`readValuesFresh`) da aba e:
   - recusa se já existe uma linha `BOOST` da mesma música/álbum na mesma
     plataforma (mensagem: "Essa música já tem Music Boost no Spotify essa
     semana.");
   - recusa se o saldo não cobre o custo.
   Se passar, `escreverBoostEmEcoinInvestimento` grava C, E, **F = `BOOST`** e
   G/I/K.
4. **Custo e cobrança (decidido pelo dono: o boost custa o preço do Market).**
   - Playlist manual: custo = preço da tabela `PRECOS_*`, que a planilha já
     desconta via H/J/L. Nada muda na cobrança, só entra a trava.
   - Boost: custo = **`item.preco` do `MARKET_ITENS`** (hoje R$ 200.000 no Music
     Boost e R$ 400.000 no Album Boost). A planilha já desconta sozinha a
     playlist mínima da linha (`PRECO_PLAYLIST_MINIMA[plataforma]`). O Worker
     cobra **a diferença** `item.preco − PRECO_PLAYLIST_MINIMA[plataforma]` com
     `descontarSaldoArtista` (`DADOS!AD`), só se ela for > 0. Hoje: Spotify
     +100.000, Apple +140.000, YouTube 0 (Music Boost); Album Boost +300.000 /
     +340.000 / +200.000. Calcular sempre a partir dos valores vigentes, nunca fixar.
   - Trava: `saldo atual (DADOS!AI, leitura fresca) − custo ≥ 0`. Para o boost, o
     custo é o `item.preco` inteiro.
   - A mensagem de erro mostra o preço que o Market exibe.
   - Compras desta semana feitas antes da mudança **não** são cobradas
     retroativamente (decisão de Claude, coerente com "não apagar excedentes").
5. **Cliques em sequência.** A planilha é lenta e duas requisições podem passar
   na checagem ao mesmo tempo. Ordem do boost: checar → gravar a linha (C, E,
   F=`BOOST`, G/I/K) → cobrar a diferença em `DADOS!AD` → reler.
   - Se o limite foi furado (2 linhas `BOOST` da mesma música e plataforma), fica
     a de menor número de linha. A outra requisição desfaz o que gravou: limpa a
     linha e **devolve** a diferença em `DADOS!AD`.
   - Se o saldo ficou negativo, quem acabou de gravar desfaz a própria
     gravação. Na pior hipótese as duas desfazem, e nunca sobra saldo negativo.
   - Manual: se o saldo ficou negativo, a célula da playlist volta ao valor anterior.
   - Mesmo padrão de reconferência que `iniciarInvestimentoController` já usa.
     `Market_Compras` só registra depois que tudo passou.
   - Observação: `descontarSaldoArtista` faz ler-alterar-gravar em `DADOS!AD`. Se
     duas cobranças do mesmo artista caírem juntas, uma pode sobrescrever a outra.
     Quem implementar deve reduzir essa janela (reler logo antes de gravar e
     conferir depois).
6. **Front:**
   - `ponto.playlists.planilha.tsx` remove o aviso "Saldo estourado — pode
     continuar" e passa a mostrar o erro do backend no lugar.
   - `market.index.tsx` só mostra o erro do backend (o fluxo já faz isso).
   - Seguir as regras do `CLAUDE.md` (botões/tabs, voltar = tela anterior) em
     qualquer UI tocada.
7. **Marcação retroativa desta semana.** Endpoint admin pontual, no padrão dos
   `admin*Controller` existentes, com modo diagnóstico (só leitura, mostra o que
   marcaria) e modo aplicar.
   - Uma linha recebe `BOOST` quando: tem exatamente uma plataforma preenchida,
     com a playlist mínima daquela plataforma; tem C = artista; e existe compra
     `music_boost`/`album_boost` da semana atual em `Market_Compras` para esse
     artista e essa música/álbum.
   - O número de linhas marcadas por par nunca passa do número de compras.
   - Rodar o diagnóstico, conferir e só depois aplicar.

## Casos resolvidos na revisão
- Na marcação retroativa, uma linha manual com só a playlist mínima escolhida
  pode ficar igual a um boost. Por isso o modo diagnóstico roda primeiro, só
  em leitura. A lista vai para o dono conferir, e só depois se aplica.
- Música com 2 ou mais linhas manuais nesta semana (dados antigos): as extras
  ficam como estão até o reset. "Nova" reaproveita a de menor número.
- Se o reset semanal não limpar F: não atrapalha, porque os limites só contam
  linhas com C preenchido e toda linha reivindicada grava F explicitamente.

## Deixado para quem implementar
- Estrutura interna das funções, nomes e onde ficam os helpers compartilhados
  (preços e colunas estão hoje duplicados entre `playlistsInvestimentoController`,
  `marketController` e o front; unificar só se for barato).
- Texto exato das mensagens de erro, em PT-BR e direto.
- Testes: seguir o que o repositório já usa para controllers.

## Decisões para conferir (tomadas por Claude)
- Album Boost segue a mesma regra de 1 por plataforma por álbum por semana.
- Compras de boost desta semana feitas antes da mudança não são cobradas
  pela diferença retroativamente.
- Marca na coluna F com o texto `BOOST` (o dono confirmou que F está livre).
- Boosts excedentes já pagos nesta semana não são apagados.
