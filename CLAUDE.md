# Empire Hub — instruções do projeto

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
