# Catálogo "D1 primeiro" (planilha vira backup) — design

Data: 2026-11-18 · Status: aguardando aprovação

## Intenção e porquê

O dono do projeto migrou músicas, vídeos e álbuns para o D1 para o app
parar de depender do Google Sheets (limite de leituras por minuto que o app
inteiro divide, e que trava o app em picos). A combinação era: **tudo é lido
e gravado no D1; a planilha só recebe uma cópia de backup; o Google Drive só
guarda arquivos.**

Hoje está o contrário. A leitura do catálogo vem do D1 (por isso o catálogo
parou de travar), mas **toda gravação vai primeiro para a planilha**, relê a
planilha para espelhar no D1, e um cron de 10 min força o D1 a ficar igual à
planilha (`videosD1Sync.ts`: "A planilha CONTINUA sendo a fonte de
verdade"). Resultado concreto: o envio "Lançar em um programa dessa
semana?" (Empire TV) falha com `Quota exceeded for quota metric 'Read
requests'...` — com upload de arquivo e com link colado — porque passa por
leituras de planilha sem proteção (`ensureSheetTab` → `listSheetTabs`, sem
cache nem retry) e grava numa aba que só existe na planilha
(`VIDEOS_PENDENTES_EMPIRE_TV`).

Objetivo do dono: **todos os uploads funcionando como foram programados**, de
forma definitiva, sem depender do limite do Google.

## Objetivos

1. Toda leitura e gravação das abas do catálogo acontece **no D1**. Nenhuma
   requisição de jogador espera, nem falha, por causa do Google Sheets.
2. A planilha recebe **cópia de backup** de toda mudança, em segundo plano,
   respeitando o limite do Google, sem perder nem embaralhar nada.
3. O envio de vídeo (com arquivo ou link), com ou sem "programa dessa
   semana", funciona sempre, inclusive em pico.
4. Vídeo de qualquer tamanho sobe **direto do aparelho para o Drive**, sem
   passar pelo Worker (limite de corpo de requisição do Cloudflare e timeout
   de 45 s hoje).
5. O app continua mostrando exatamente o que mostra hoje (mesmos dados, mesmas
   telas).

## Não-objetivos (nesta leva)

- Travamentos das salas da Empire TV em eventos (dono pediu para depois).
- Painel admin de catálogo (Fase 5; ganha design próprio depois que as fases
  1–4 estiverem no ar).
- Conversão dos 54 vídeos HEVC e reenvio das 25 capas perdidas (tarefas
  operacionais à parte; ferramentas já existem no PR #955).
- Reescrever cada controller para falar com o D1 em modelo próprio (Caminho
  2, descartado — ver Abordagens).
- Abas fora do catálogo (Social, Usuários, Tour, Market, Votação etc.).

## Anti-objetivos (seria fracasso mesmo "funcionando")

- Perder ou sobrescrever qualquer dado já existente (regra antiga do dono:
  "não posso perder nenhum dado").
- A planilha voltar a mandar no D1 (qualquer processo que copie planilha →
  D1 depois que a aba virou "D1 primeiro").
- Um upload responder "sucesso" com dado que só existe na fila e some se a
  fila falhar (a gravação no D1 é a gravação real; a fila é só backup).
- Duas gravações simultâneas caírem na mesma linha (o "bug da Rayna",
  hoje protegido por `writeLockService`).
- Upload de vídeo deixar arquivo órfão no Drive a cada tentativa que falha.

## Restrições

- **Toda a base de código fala com a planilha por um único serviço**,
  `backend/src/services/googleSheetsService.ts`
  (`readValues`, `readValuesFresh`, `updateValues`, `updateValuesBatch`,
  `appendRow(s)`, `deleteRows`, `clearValues`, `findRows`,
  `readSheetObjects`, `ensureSheetTab`, `listSheetTabs`,
  `spreadsheetBatchUpdate`), usando **semântica de planilha**: abas, linhas
  numeradas, intervalos A1, "primeira linha livre". São ~20 controllers de
  produto (Gestão, edição, fórum, comentários, curtidas, playlists, charts,
  pre-save, votações, busca, market, indicações, awards, metacritic,
  notificações…) e 60+ controllers de "conserto pontual" de admin.
- **"Código único" (EMPnnn)** é gerado hoje por ARRAYFORMULA na planilha
  EDIÇÃO CHARTS (`="EMP"&TEXT(ROW(B2:B)-1;"000")`, coluna BD de
  "EDIÇÃO CHARTS"; coluna R de "EDIÇÃO CHARTS ÁLBUMS"). O upload grava lá e
  relê o código. Fora da planilha, alguém precisa calcular isso.
- Estado atual do D1 (`empire-hub-catalogo`):
  - `videos` / `comentarios_videos`: tabelas tipadas, uma coluna por campo,
    com `linha_planilha`; espelho em tempo real via
    `espelharNoD1SeAplicavel` + reconciliação no cron (`reconciliarVideosD1`).
  - `musicas` / `comentarios_musicas`: tabelas tipadas com chave própria
    (`chave`), espelhadas manualmente pelos controllers (`upsertMusicaD1`,
    `mirrorMusicaRowParaD1`); leitura por `readMusicasFromD1`.
  - Álbuns: `abas_espelho` (aba, linha, celulas_json) — cópia linha a linha
    de "Albuns", "Extra_Albuns", "Comentarios_Albuns".
  - Leitura pelo D1 ligada por chaves no KV `FLAGS`
    (`videos:leitura-d1`, `albuns:leitura-d1`, …), com queda para a
    planilha em erro.
- Cron do Worker roda a cada 10 min (`src/server.ts`, `scheduled`).
- Arquivos enviados pelo app ficam no Drive da conta
  `empirerpg.forum@gmail.com` (OAuth, `getDriveOAuthAccessToken`) e são
  servidos pelo proxy `/api/media/*`.
- O app roda no Cloudflare Workers (nunca assumir Telegram — CLAUDE.md).

## Abordagens consideradas

1. **"Porteiro" central no `googleSheetsService` (escolhida pelo dono).**
   Para as abas do catálogo, o próprio serviço passa a ler/gravar numa
   "planilha virtual" no D1 (mesma semântica de linhas/intervalos) e
   enfileira a gravação para a planilha real como backup. Cobre todos os
   controllers sem reescrevê-los. Troca: o D1 continua com dados "em formato
   de planilha".
2. **Reescrever cada fluxo para o D1 com modelo próprio.** Mais limpo,
   facilita o painel admin, mas mexe em 20+ controllers e exige reescrever
   ou aposentar 60+ consertos; muito maior, mais caro e mais arriscado;
   demora mais para destravar o upload da TV. Descartado agora; pode virar
   evolução gradual.
3. **Manter a planilha como fonte e só economizar leituras** (cache/retry).
   Contraria o que o dono quer (o limite do Google continuaria mandando).
   Descartado.

## O desenho

### 1. Abas "D1 primeiro"

Conjunto fechado, ligado aba por aba (Fases abaixo):

| Planilha | Aba |
|---|---|
| principal | `Music Videos`, `Comentarios_MV`, `VIDEOS_PENDENTES_EMPIRE_TV` |
| principal | `Musicas`, `Comentarios_Musicas` |
| principal | `Albuns`, `Extra_Albuns`, `Comentarios_Albuns` |

**EDIÇÃO CHARTS e EDIÇÃO CHARTS ÁLBUMS ficam fora** (continuam com a
planilha como fonte): são a planilha de trabalho do cálculo semanal dos
charts, com colunas calculadas por fórmula lá dentro. O que muda nelas é só
*quando* o app grava: o registro de lançamento (colunas A–Q / A–?) entra na
fila de backup (seção 3) em vez de ser gravado durante a requisição do
jogador. Ver "Código único" na seção 2.

Uma chave no KV `FLAGS` por aba (`d1primeiro:<aba>`), sem deploy para
ligar/desligar.

### 2. Planilha virtual no D1 (fonte de verdade)

Uma tabela genérica posicional (evolução de `abas_espelho`, que já existe e
já guarda células cruas por (aba, linha)) é a **fonte de verdade** de toda
aba "D1 primeiro": `(planilha, aba, linha) → celulas_json`, cabeçalho
incluído, células exatamente como a API devolve (FORMATTED_VALUE).

O porteiro implementa sobre ela, com a mesma assinatura e o mesmo resultado
que a API do Sheets daria:

- `readValues` / `readValuesFresh` / `readSheetObjects` / `findRows`:
  leem do D1. Nunca caem para a planilha nem para GViz enquanto a aba estiver
  "D1 primeiro" (se o D1 falhar, o erro sobe — não existe "fonte de
  reserva" que possa estar desatualizada).
- `updateValues` / `updateValuesBatch`: gravam as células do intervalo.
- `appendRow(s)`: acrescenta depois da última linha não vazia (mesma regra
  do Sheets).
- `deleteRows`: remove e desloca as linhas de baixo (mesma semântica).
- `clearValues`: limpa as células.
- `ensureSheetTab` / `listSheetTabs`: para abas "D1 primeiro", respondem
  sem chamar o Google.

Tudo dentro de uma transação D1 (`db.batch`), e a operação só retorna
sucesso depois de gravada no D1.

**Tabelas tipadas como índices.** `videos`, `comentarios_videos`, `musicas`,
`comentarios_musicas` continuam existindo porque leitores rápidos dependem
delas (Fórum rápido, `readMusicasFromD1`, busca). Elas passam a ser
**derivadas** da planilha virtual, atualizadas na mesma transação de cada
gravação, com as funções de conversão que já existem
(`linhaPlanilhaParaVideo`, `buildMusicaUpsertStatement`, etc.). Nunca são
gravadas por fora.

**Código único (EMPnnn).** Hoje vem da ARRAYFORMULA da EDIÇÃO CHARTS
(`"EMP" & (linha − 1)` com 3 dígitos) e o upload relê o valor. No novo
desenho o D1 guarda um **contador da próxima linha livre** de cada aba de
EDIÇÃO CHARTS (inicializado na carga a partir da planilha real), reserva a
linha na mesma transação do cadastro, calcula o código igual à fórmula e
grava o código no catálogo na hora. O registro na EDIÇÃO CHARTS vai pela
fila, **naquela linha exata** (nunca "primeira linha livre" no momento do
envio), então a fórmula da planilha gera o mesmo código. Antes de gravar, o
despachante confere que a linha reservada está vazia; se não estiver,
para, registra no log e avisa (alguém mexeu na planilha à mão) — nunca
sobrescreve.

**Outras fórmulas.** O builder levanta, na carga inicial, todas as colunas
com fórmula nas abas "D1 primeiro" da tabela acima e reproduz cada uma no
porteiro; a carga compara o valor calculado com o da planilha e aborta se
divergir.

**Concorrência.** `withWriteLock` continua envolvendo os fluxos que calculam
"primeira linha livre" e gravam; dentro do D1, a transação garante que duas
gravações não se misturem.

### 3. Fila de backup (D1 → planilha)

Toda gravação numa aba "D1 primeiro" acrescenta, na mesma transação, um
item numa tabela `fila_backup_planilha` (id sequencial, planilha, aba,
operação, intervalo, valores, criado_em, tentativas, último erro).

Um "despachante" grava a fila na planilha real, **em ordem, por aba**:

- disparado em segundo plano após cada gravação (`ctx.waitUntil`) e no cron
  de 10 min;
- junta itens seguidos da mesma aba num `values:batchUpdate` só;
- em erro de limite do Google, para e tenta no próximo disparo (não
  descarta nada); erro permanente fica registrado no item e no log do
  sistema, sem bloquear a gravação no D1;
- operações que deslocam linhas (`deleteRows`) são reaplicadas na mesma
  ordem, para a planilha ficar idêntica.

Verificação de integridade (cron, 1×/dia ou por chave): compara planilha
virtual × planilha real das abas "D1 primeiro" com fila vazia e registra
divergências no log. **Nunca corrige o D1 a partir da planilha.**

### 4. Desligar o caminho antigo (planilha → D1)

Ao ligar uma aba como "D1 primeiro", desligam-se na mesma hora, para ela:
o espelho pós-escrita (`espelharNoD1SeAplicavel`), a reconciliação do cron
(`reconciliarVideosD1` e equivalentes) e os espelhos manuais
(`upsertMusicaD1`, `mirrorMusicaRowParaD1`) — senão eles regravariam o D1
com dados da planilha atrasada.

### 5. Upload de vídeo direto para o Drive

- O Worker cria uma **sessão de upload retomável** na API do Drive (conta
  OAuth do app, pasta de vídeos, nome e tipo do arquivo) e devolve só o
  endereço da sessão ao navegador. O token nunca chega ao navegador.
- O navegador envia o arquivo em partes direto para o Google, com barra de
  progresso real e retomada se a conexão cair.
- Ao terminar, o navegador manda o ID do arquivo junto com o formulário
  (mesmo payload de hoje, `mediaUrl` = link do arquivo).
- **Ordem nova:** o formulário é validado e o cadastro no D1 é reservado
  antes do upload; arquivo que sobe e cujo cadastro falha vai para a
  lixeira do Drive (não fica órfão).
- Vale para vídeos (e para o arquivo de vídeo do "programa dessa semana").
  Capas, imagens e áudios podem continuar no caminho atual
  (`/api/gestao/upload`); o builder decide se estende o mesmo mecanismo ao
  áudio de álbum (hoje com timeout de 120 s).

### 6. Consertos pontuais de admin

Os 60+ controllers `adminFix*`, `adminLimpar*`, `adminDiag*` etc. que
gravam em abas do catálogo passam pelo porteiro automaticamente (gravam no
D1). Os que já cumpriram sua função são **desativados** (rota responde 410)
para ninguém reexecutar um conserto antigo sobre dado novo. O builder lista
quais ficam e quais saem antes de desativar.

## Fases e ordem (aprovadas pelo dono)

| Fase | Entrega | Pronto quando |
|---|---|---|
| 0 | Correções de exclusão de capas (PR #955) | Mergeado e publicado. |
| 1 | Porteiro + fila + planilha virtual; **vídeos**: `Music Videos`, `Comentarios_MV`, `VIDEOS_PENDENTES_EMPIRE_TV`; upload de vídeo direto para o Drive | Envio com "programa dessa semana" (link e arquivo) funciona com o Google Sheets bloqueado; fila zera e planilha fica idêntica ao D1. |
| 2 | **Músicas**: `Musicas`, `Comentarios_Musicas`; registro na `EDIÇÃO CHARTS` via fila, Código único reservado pelo D1 | Lançar música nova e comentar funcionam com Sheets bloqueado; códigos EMP iguais aos que a fórmula daria. |
| 3 | **Álbuns**: `Albuns`, `Extra_Albuns`, `Comentarios_Albuns`; registro na `EDIÇÃO CHARTS ÁLBUMS` via fila | Idem para álbuns. |
| 4 | Limpeza: remover o código do caminho antigo (espelhos, reconciliação planilha→D1, chaves de leitura antigas); verificação diária de integridade | Nenhum código copia planilha → D1. |
| 5 | Painel admin de catálogo no app (design próprio) | — |

Cada fase: carga inicial (cópia exata planilha → planilha virtual, com
validação célula a célula, abortando se divergir) → ligar a chave da aba →
desligar o caminho antigo daquela aba.

## Como reverter

Por aba: esperar a fila zerar, desligar a chave `d1primeiro:<aba>`. A
planilha está idêntica ao D1 (fila vazia), então o caminho antigo volta a
funcionar como antes.

## Testes e critérios de aceite

- Testes do porteiro contra um "Sheets falso" em memória: para cada função,
  mesma entrada → mesmo resultado que a planilha (inclusive `appendRow` em
  aba com linhas vazias no meio e células pré-preenchidas, `deleteRows`
  deslocando linhas, intervalos abertos como `A:ZZ`).
- Teste de carga inicial: cópia sem perda, cabeçalhos com colunas
  duplicadas (ex.: duas "ID da mensagem" em Music Videos).
- Teste com o Google Sheets forçado a falhar (quota): fluxos de upload e
  comentário respondem sucesso e a fila acumula; ao voltar, a fila esvazia
  na ordem certa.
- Contagem de chamadas ao Google por requisição de jogador nas abas "D1
  primeiro": **zero**.

## Deixado para o builder

- Formato exato das tabelas (`planilha_virtual`, `fila_backup_planilha`) e
  índices.
- Levantar **todas** as colunas com fórmula nas abas da tabela da seção 1
  (não só o Código único) e reproduzir cada uma no porteiro.
- Estratégia de agrupamento e ritmo do despachante para caber no limite do
  Google.
- Lista de consertos pontuais a desativar (confirmar com o dono antes).
- Se o upload direto para o Drive também vale para áudio de álbum.
- Detalhes da sessão retomável (CORS da sessão para o domínio do app,
  tamanho das partes) — vale um teste rápido isolado antes de construir.
