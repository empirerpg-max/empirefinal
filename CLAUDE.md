# Empire Hub — instruções do projeto

## Onde o app roda (regra permanente)

**O aplicativo roda no Cloudflare (Workers), NÃO no Telegram.** O Telegram
não é mais usado. Nomes e comentários no código com "telegram" (ex.:
`src/lib/telegram.ts`, `useTelegramUser`, `haptic`, `telegramTopicId`,
`message_thread_id`, menções a "Telegram WebView") são resquícios da época
em que o app rodava lá — hoje são só identificadores/utilitários internos.
Nunca assumir ambiente, limitações ou comportamento do Telegram (WebView,
safe-area do Telegram, mini app etc.) ao projetar, explicar ou testar algo.

## EDIÇÃO CHARTS: o app só escreve de A até Q (regra permanente)

Na aba **EDIÇÃO CHARTS** (planilha edicaoCharts), o app só pode gravar ou
limpar células das colunas **A até Q**. Da R em diante são fórmulas da
planilha — inclusive o **Código único** em BD
(`=ARRAYFORMULA(IF(B2:B="";"";"EMP"&TEXT(ROW(B2:B)-1;"000")))`) — e
qualquer escrita ali, até `""`, quebra a fórmula (na linha ou na coluna
inteira). Também não apagar linhas dessa aba (desloca os códigos de todas
as linhas abaixo): pra "remover", limpar A:Q com `clearValues`.

Se BD estiver vazio numa linha, o código daquela linha é `"EMP" & (linha-1)`
(ver `backend/src/services/codigoUnicoEdicaoCharts.ts`) — usar esse valor
no app (Musicas!Z, D1), nunca gravá-lo em BD.

## Botões/pills/tabs com texto (regra permanente, não precisa repetir)

Todo botão, pill ou tab que tem texto (label, nome, título) precisa:

1. **Nunca deixar o texto escapar do botão.** Em qualquer container flex
   (linha de tabs, seletor horizontal etc.), o item que tem texto longo
   precisa de `min-w-0` (senão o texto força o item a crescer além do
   espaço disponível, mesmo com `truncate` no span — `truncate` sozinho
   não basta dentro de flex/grid sem `min-w-0` no ancestral direto).
2. **Margem de segurança**: padding horizontal real no botão (`px-1` pra
   cima, nunca `px-0`/sem padding), pra texto e ícone nunca colarem na
   borda.
3. Ícone com `shrink-0` (não deixa o ícone espremer quando o texto é
   longo) e o texto com `truncate` (corta com "..." em vez de quebrar
   layout).

Isso vale sempre que um botão/tab for adicionado ou um label for trocado
por um mais longo — não é preciso o usuário pedir de novo a cada vez.

### Barra de tabs com N itens de largura fixa (ex.: `grid-cols-N`)

**Regra explícita: texto nunca pode aparecer cortado com "..." numa barra
de tabs.** Um `grid-cols-N` de largura igual quebra assim que qualquer
label for mais longo que os outros (ex.: "Tá na Mídia" ao lado de "Feed",
"News") — em tela estreita, `truncate`+`min-w-0` só evita o texto
estourar o card, mas ainda corta a palavra, o que também não é aceitável.

Nesses casos, troca `grid-cols-N` por uma fileira ROLÁVEL horizontal (o
padrão já usado em várias telas do app: `useDragScroll` +
`StickyScrollArrowLeft`/`StickyScrollArrowRight`, ver exemplo em
`src/routes/social.tsx`, barra de tabs do Empire Social). Cada tab fica
com `shrink-0` + padding real (largura do próprio conteúdo, sem
truncar/cortar nada) e a fileira rola quando não cabe tudo. Isso garante
o texto sempre legível por inteiro, em qualquer tamanho de tela — é a
forma "ajustável, responsiva e bonita" que já foi pedida e deve ser
aplicada por padrão em qualquer barra de tabs nova ou quando um label
novo for adicionado a uma existente.

## Voltar = tela anterior (regra permanente, não precisa repetir)

Em **todo** o app, o gesto/botão de voltar do celular (e do navegador) leva
para a **tela imediatamente anterior**, nunca pula várias de uma vez. Ex.:
abrir uma playlist e, dentro dela, um clipe → voltar fecha só o clipe e
mostra a playlist; voltar de novo fecha a playlist.

Como fazer: toda tela/painel/modal aberto **por cima** de outra (tela
deslizante, player de vídeo, sheet, overlay) empurra a sua própria entrada
no histórico ao abrir (`history.pushState` com uma marca própria no
`state`), fecha no `popstate` **só quando a entrada dela saiu** (confere o
`history.state` atual) e, ao fechar pelo X/seta, chama `history.back()` se
a entrada dela ainda for a atual (para não deixar entrada órfã). Ver o
padrão em `src/routes/empire-play.index.tsx` (playlist) e
`src/components/EmpirePlay/VitrineClipes.tsx` (clipe por cima da playlist).
Vale para qualquer tela nova sem o usuário pedir de novo.

## Sala da Empire TV (referência)

Antes de mexer na sala da TV (`src/routes/tv.tsx`, `src/components/EmpireTV/*`,
`/api/tv/*`), ler `docs/empire-tv-sala-manual.md`: mapa dos arquivos, como o
player do app, a participação e as enquetes funcionam, limites do plano
gratuito (nada por pessoa a cada poucos segundos pode ler a sala inteira no
D1) e como testar pelo link de prévia sem publicar.

## Medição de uso (referência)

Antes de mexer na medição de uso (`src/lib/uso/*`, `backend/src/services/usoService.ts`,
`/api/uso*`, tela `/uso-do-app`), ler `docs/medicao-de-uso.md`: o que é medido e o
que não é, mapa dos arquivos, tabelas, liga/desliga no KV e custo. Todo novo POST
automático em segundo plano precisa entrar em `IGNORADOS` (`src/lib/uso/coletor.ts`)
e nenhum conteúdo de usuário pode entrar em `alvo`.
