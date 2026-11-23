# Pre-save: lançamento em passos, que se completa sozinho — design

Data: 2026-11-23 · Status: aguardando aprovação

## Intenção e porquê

Todo lançamento de pre-save de álbum até hoje saiu com algum defeito e
precisou de uma correção manual depois (FOLLIA, DERBY, Samantha Cooper,
Jessica Johnson). Cada correção virou um script `admin-fix-*` pontual,
mas o processo em si nunca ficou confiável. O dono quer que **todos os
passos definidos para o pre-save funcionem sempre**, sem precisar pedir
correção toda semana.

Decisão do dono (2026-11-23): **o álbum sai na data marcada, e o sistema
vai completando sozinho** o que faltar, até tudo estar gravado. Pode
ficar incompleto por um tempo; nunca pode duplicar.

## O que aconteceu com "Jessica Johnson - Bad Behavior" (evidência)

Campanha `PRESAVE-d4fd66d2`, 12 faixas (9 inéditas e 3 já existentes),
lançamento em 22/11:

- 22/11 03:00 UTC: o cron criou o álbum (Albuns, EDIÇÃO CHARTS ÁLBUMS,
  `EMPALBM098`). Das 9 inéditas, gravou só 2. As outras 7 falharam em
  segundos, e nenhuma falha chegou à aba LOGS.
- 03:00:53: `marcarLancadaDeVerdade` marcou a campanha como lançada,
  mesmo com 7 faixas faltando. Nada mais tentou completar.
- Também falharam, sem aviso: o bônus PRE-SAVE (coluna S), o Código
  único na `PreSave_Album`, o material extra (`Extra_Albuns`), a
  tracklist em `Albuns!M` e o espelho das faixas existentes no D1.
- À noite, relançamentos manuais pela conta da jogadora criaram 3 cópias
  de "Pretty Woman" e 2 de "No Strings Attached", e de novo pararam
  depois de 3 faixas.
- Na correção de hoje, o relançamento oficial (`relancar-faixas-faltantes-presave`)
  gravou **4 de 6** faixas numa chamada e as 2 restantes na seguinte. O
  padrão se repete em todas as tentativas: **cada execução do Worker só
  consegue gravar umas 3 ou 4 faixas**. Cada faixa faz cerca de 10
  chamadas ao Google (ler Musicas, conferir linha, gravar, reler, gravar
  na EDIÇÃO CHARTS, ler e gravar no REGISTRO, ler o código, copiar o
  código). Isso bate com um limite de chamadas externas por execução
  (limite de subrequests do Cloudflare Workers) somado à cota do Google.
  A gravação no LOGS também é uma chamada externa, por isso as falhas
  não deixam rastro.

## Causas que este design ataca

1. O lançamento tenta fazer tudo numa execução só, e o trabalho não
   cabe numa execução.
2. "Lançado" é marcado sem conferir se cada parte foi gravada, e nada
   retoma o que faltou.
3. Relançar (manualmente ou pelo admin) não sabe o que já foi gravado,
   e por isso duplica.
4. As falhas só vão para lugares que falham junto (aba LOGS) ou para o
   `console`, que ninguém vê.

## Objetivos

1. No dia D o álbum aparece, e cada parte que faltar é completada pelo
   cron nas execuções seguintes, até tudo estar gravado.
2. Nenhuma faixa, linha de chart ou álbum é gravado duas vezes, mesmo
   que uma execução caia no meio, rode duas vezes ou alguém relance à
   mão.
3. Cada execução respeita um orçamento: faz no máximo N passos e
   termina, deixando o resto para a próxima. Funciona com qualquer
   limite de chamadas por execução.
4. Dá para ver, por campanha, o que já foi feito, o que falta e o que
   está travado, sem depender da aba LOGS.
5. Se um passo falhar repetidamente, alguém é avisado.

## Não-objetivos

- Mudar as regras do pre-save (teto, missões, contador, data, modos).
- Migrar Musicas e EDIÇÃO CHARTS para "D1 primeiro". Isso é a Fase 2 do
  design `2026-11-18-catalogo-d1-primeiro-design.md`. Este design deve
  encaixar nela depois (os passos só mudam de destino), mas não depende
  dela.
- Investigar por que a aba LOGS parou de receber registros desde
  20/11 22:09. É um problema separado e afeta o app inteiro.
- Corrigir os códigos EMP1047 e EMP1051, que no D1 também apontam para
  faixas antigas do Cowboy Fresh (DERBY). É uma limpeza à parte.
- Mudar o lançamento normal de álbum pela Gestão (`createAlbumController`).
  Ele sofre do mesmo limite e pode reaproveitar o mesmo mecanismo depois,
  mas fica fora desta leva.

## Anti-objetivos (seria fracasso mesmo "funcionando")

- Qualquer duplicata nova em Musicas, EDIÇÃO CHARTS, Albuns ou EDIÇÃO
  CHARTS ÁLBUMS.
- **Excluir linha** em EDIÇÃO CHARTS: o Código único é calculado pela
  posição (`"EMP" & ROW-1`), e excluir uma linha troca o código de
  todas as músicas abaixo. Linha errada é esvaziada (só as colunas de
  dados A:Q), nunca excluída.
- Publicar o álbum duas vezes (o problema do DERBY e da FOLLIA).
- Um passo "concluído" que não está de fato na planilha.
- Perder qualquer dado já existente.

## Abordagens consideradas

1. **Lista de passos do lançamento no D1** (escolhida pelo dono). Cada
   campanha ganha uma lista de passos com estado salvo no D1. O cron
   executa só os pendentes, com orçamento por execução. É idempotente,
   retomável e visível.
2. **Conferente que compara campanha × planilhas.** Lançamento igual ao
   atual, e um cron lê as planilhas e preenche o que faltar. Descartada:
   depende de ler abas grandes (o que estoura o limite) e de casar
   títulos, que é frágil ("Atached" × "Attached") e duplicaria.
3. **Esperar o "D1 primeiro" (Fase 2).** Descartada como solução agora,
   porque o próximo pre-save quebraria do mesmo jeito. A abordagem 1 é
   compatível com ela.

## Design

### Tabela `presave_lancamento_passos` (D1)

Uma linha por passo de cada campanha:

| coluna | conteúdo |
|---|---|
| campanha_id | `PRESAVE-xxxx` |
| passo | chave estável, ex. `album`, `faixa:6`, `vinculo:3`, `bonus` |
| ordem | ordem de execução |
| estado | `pendente` · `feito` · `falhou` · `travado` |
| tentativas | quantas vezes já tentou |
| resultado_json | o que foi gravado: linha da planilha, Código único, linha da EDIÇÃO CHARTS etc. |
| ultimo_erro | mensagem da última falha |
| atualizado_em | quando mudou |

A lista é criada **uma vez**, quando a campanha chega ao dia D, a
partir de `FaixasJson` e da configuração da campanha. Chave primária:
(campanha_id, passo).

### Passos

Na ordem:

1. `album`: linha em Albuns e em EDIÇÃO CHARTS ÁLBUMS (com Código único
   do álbum). Guarda a linha de Albuns, o `albumTopicId` e o
   `codigoUnicoAlbum`. Só depois deste passo o álbum "existe".
2. Para cada faixa inédita, `faixa:N`, dividido em subpassos com estado
   próprio, para que uma queda no meio nunca refaça o que já foi feito:
   - `faixa:N:musicas`: linha em Musicas (guarda a linha);
   - `faixa:N:charts`: linha em EDIÇÃO CHARTS (guarda a linha e o
     Código único gerado);
   - `faixa:N:codigo`: cópia do Código único para `Musicas!Z`, espelho
     no D1 (`musicas`) e, se `abrirTopico`, o registro do tópico e o
     INFOS MÚSICAS;
   - `faixa:N:registro`: linha em REGISTRO DE MÚSICA.
3. Para cada faixa existente, `vinculo:N`: vincula ao álbum em Musicas
   (K ou ALBUM 2-5, U) e espelha a linha no D1.
4. `tracklist`: `Albuns!M` com todas as faixas, gravado pelo
   `googleSheetsService` do app, para disparar a atualização do espelho
   de Albuns no D1.
5. `extra`: material extra em `Extra_Albuns` (se a campanha tiver).
6. `bonus`: bônus PRE-SAVE na coluna S de EDIÇÃO CHARTS ÁLBUMS (só no
   modo missão), localizada pelo Código único do álbum.
7. `fechar`: status `lancada` e `CodigoUnicoAlbum` na `PreSave_Album`.

### Idempotência: nunca gravar duas vezes

Antes de gravar uma linha nova, cada subpasso:

1. Se o estado for `feito`, não faz nada.
2. Se não for `feito`, mas houver uma tentativa anterior (`tentativas > 0`),
   **procura primeiro se a linha já existe**, porque uma execução pode
   ter caído depois de gravar e antes de anotar. A busca é por
   (álbum + número da faixa) em Musicas e por (título + álbum) em
   EDIÇÃO CHARTS. Se achar, anota como `feito` com aquela linha, sem
   gravar.
3. Só grava se não achou. Logo depois de gravar, anota `feito` com o
   resultado.

A busca pode ser cara, mas só roda depois de uma falha, nunca no
caminho normal.

### Orçamento por execução

`processarLancamentosPreSaveScheduled` passa a:

1. Criar a lista de passos das campanhas que chegaram ao dia D e ainda
   não têm lista.
2. Executar os passos pendentes, em ordem, até atingir o orçamento
   (ponto de partida: 3 faixas ou 25 passos por execução; ajustável) ou
   até um passo falhar. Na falha, registra o erro e para aquela
   campanha nesta execução.
3. A próxima execução (10 minutos depois) continua de onde parou.

A trava por campanha (`withWriteLock("presave:lancamento:<id>")`)
continua, para duas execuções nunca trabalharem na mesma campanha ao
mesmo tempo. O TTL da trava cobre uma execução com orçamento.

`marcarLancadaDeVerdade` deixa de ser o sinal de "pronto". Passa a
existir o estado de cada passo: o álbum foi criado quando o passo
`album` está `feito`, e a campanha está completa quando todos os passos
estão `feito`. A tabela `presave_lancamentos_confirmados` continua sendo
respeitada para campanhas antigas (não recriar o álbum delas).

### Relançamento manual passa pelo mesmo caminho

- `relancar-faixas-faltantes-presave` deixa de comparar títulos. Ele só
  recoloca em `pendente` os passos `falhou`/`travado` da campanha (ou
  cria a lista, para campanha antiga sem lista) e deixa o cron (ou uma
  execução imediata com o mesmo orçamento) seguir.
- Lançar faixa avulsa numa campanha de pre-save já lançada, pela Gestão,
  deve checar antes se (álbum + título) já existe em Musicas e recusar
  com mensagem clara. Isso fecha a porta que gerou as cópias da Jessica.

### Avisos

- Cada passo que falha grava `ultimo_erro` no D1, que é a fonte que
  sempre funciona.
- Passo com 6 tentativas falhas (cerca de 1 hora) vira `travado` e gera
  um aviso para o admin (notificação do app, além do LOGS como
  tentativa).
- Uma tela simples (ou endpoint admin) por campanha mostra os passos e
  seus estados.

### Status da campanha durante os passos (decisão minha)

- A campanha vira `lancada` **assim que o passo `album` fica `feito`**.
  O álbum existe e sai na data (decisão do dono), então os comentários
  do tópico destravam, a campanha sai do banner de ativas e as missões
  se encerram.
- O passo `fechar` fica só com o `CodigoUnicoAlbum` e a confirmação
  final.
- O cron deixa de escolher campanhas pelo filtro `status === "ativa"`.
  Ele escolhe as que têm passos não `feito`, além das `ativa` que
  chegaram ao dia D e ainda não têm lista.
- O valor do bônus é **congelado no dia D**: calculado
  (`aplicarDiasPerdidos` + `calcularAcumulado`) uma vez, quando a lista
  é criada, e guardado no `resultado_json` do passo `bonus`. Missões
  depois disso não mudam o valor.

### Tópico do álbum (decisão minha)

O passo `album` usa o id reservado na criação da campanha
(`c.albumTopicId`) em `Albuns!B/D`, em vez de gerar outro como o
`publicarAlbum` faz hoje. Assim a página do pre-save, a trava de
comentários e o `album_id` das faixas no D1 apontam todos para o mesmo
tópico. Esse id também é a chave para saber se o álbum já foi gravado:
existe linha em Albuns com B = `c.albumTopicId`. Campanhas já lançadas
mantêm o tópico real que têm hoje (lido de Albuns, nunca regravado).

### Bloqueio na Gestão (decisão minha)

Enquanto uma campanha de pre-save tiver passos não `feito`, a Gestão
recusa, com mensagem clara ("o álbum ainda está sendo completado
automaticamente"), **qualquer** ação que grave faixa naquele álbum:
lançar faixa de álbum, adicionar/substituir faixa, vincular faixa
existente. Depois de tudo `feito`, a Gestão volta ao normal, mas
lançar uma faixa cujo (álbum + título) já exista em Musicas é recusado.
O caminho exato que gerou as cópias da Jessica não ficou registrado
(o LOGS estava mudo); bloquear todos fecha a porta de qualquer jeito.

### Execução isolada dos outros jobs (decisão minha)

Hoje o pre-save divide a mesma execução do `scheduled()` (e o mesmo
limite de chamadas) com TV, SOCIAL_POSTS, likes, espelhos D1 e fila de
backup. O pre-save ganha **um cron próprio** em `wrangler.jsonc` (ex.
`"2-59/10 * * * *"`, deslocado 2 minutos dos outros), e o `scheduled()`
despacha por `event.cron`. Assim o orçamento dele não depende do que os
outros jobs gastaram. O orçamento conta as chamadas reais ao Google
feitas na execução (um contador no `googleSheetsService`) e para com
folga, em vez de só contar passos. Isso cobre tanto o limite de
subrequests do Worker quanto a cota por minuto do Google.

### Migração das campanhas existentes (decisão minha)

- Campanhas `ativa` usam o novo fluxo automaticamente no dia D.
- Campanhas já `lancada` só ganham lista se um admin pedir (via o
  relançamento acima). Nesse caso a lista nasce em **modo
  reconciliação**:
  - o passo `album` nasce `feito` se existir linha em Albuns com o
    tópico da campanha (ou com o `CodigoUnicoAlbum` já gravado),
    guardando a linha e o código encontrados;
  - todos os outros passos nascem com a marca "procurar antes de
    gravar" (o mesmo tratamento de `tentativas > 0`).

  Assim uma lista criada depois do fato nunca regrava o que já existe.

## O que fica para quem for construir

- O número exato de passos por execução (medir quantas chamadas cada
  subpasso faz e escolher um orçamento com folga).
- Onde exatamente aparece o aviso ao admin, dentro do sistema de
  notificações que já existe.
- Testes: simular queda entre "gravou" e "anotou" e conferir que a
  retomada não duplica; simular orçamento curto e conferir que a
  campanha termina completa depois de várias execuções.
