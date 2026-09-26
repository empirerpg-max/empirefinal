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
