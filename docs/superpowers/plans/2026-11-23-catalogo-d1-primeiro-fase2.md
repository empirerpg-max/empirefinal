# Catálogo "D1 primeiro" — Fase 2 (músicas) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** As abas `Musicas` e `Comentarios_Musicas` passam a ser lidas e gravadas só no D1 (planilha vira backup pela fila), o Código único (EMPnnn) é reservado pelo D1 e o registro na `EDIÇÃO CHARTS` vai pela fila, sem nenhuma requisição de jogador depender do Google Sheets nessas abas.

**Architecture:** Reaproveita o porteiro da Fase 1 (`porteiroD1.ts` + `planilhaVirtualD1.ts` + `despachanteFilaBackup.ts`). Antes de ligar abas grandes, as leituras do porteiro ganham um cache por versão da aba (1 linha lida por requisição quando nada mudou). A tabela tipada `musicas` passa a ser derivada da planilha virtual (espelho pós-escrita + reconciliação no cron, igual a `videosD1Sync.ts`). O Fórum de música deixa de usar `comentarios_musicas` e lê os comentários pela planilha virtual (com linha real → reações e respostas funcionam). O contador da próxima linha livre da `EDIÇÃO CHARTS` fica no D1 e a fila grava naquela linha exata, só se ela ainda estiver vazia.

**Tech Stack:** Cloudflare Workers (plano Free hoje: 10 ms de CPU por requisição), D1 `CATALOGO_DB` (`globalThis.__CATALOGO_DB__`), KV `FLAGS`, Google Sheets API v4, testes com `bun test` + `bun:sqlite` (`scripts/helpers/fakeD1`), rodados um arquivo por processo com `scripts/rodar-testes-isolados.sh`.

**Spec:** `docs/superpowers/specs/2026-11-18-catalogo-d1-primeiro-design.md` (Fase 2 da tabela "Fases e ordem"). Plano anterior: `docs/superpowers/plans/2026-11-18-catalogo-d1-primeiro-fase1.md`.

## Global Constraints

- Nunca perder nem sobrescrever dado existente; carga inicial aborta se a cópia divergir.
- Aba ligada nunca cai para a planilha nem para GViz em leitura; se o D1 falhar, o erro sobe.
- Nenhum processo copia planilha real → D1 para uma aba ligada.
- Gravação só retorna sucesso depois de gravada no D1; a fila é só backup.
- `withWriteLock` continua envolvendo os fluxos que já o usam (`gestao:edicao-charts`, `linha-livre:*`).
- Estado por aba na tabela `catalogo_estado_aba` (`off`/`carregando`/`on`/`pausado`), mesma mecânica da Fase 1.
- Código único = `"EMP" & TEXT(ROW-1;"000")` da linha da `EDIÇÃO CHARTS` (`EMP` + `(linha − 1)` com no mínimo 3 dígitos: linha 2 → `EMP001`, linha 1029 → `EMP1028`).
- `EDIÇÃO CHARTS`: o app só grava `A{n}:Q{n}`; nunca a coluna G nem nada depois de Q.
- Antes de gravar a linha reservada na `EDIÇÃO CHARTS`, o despachante confere que `B{n}` está vazia; se não estiver, para, registra no log e não sobrescreve.
- Orçamento do plano Free: D1 5 milhões de linhas lidas/dia e 100 mil gravadas/dia; KV 1.000 gravações/dia. Nenhuma leitura de jogador pode reler uma aba inteira do D1 a cada requisição.
- O app roda em Cloudflare Workers; nada de Telegram (CLAUDE.md).

## Desvios do spec (decididos neste plano)

- **`comentarios_musicas` deixa de ser índice do Fórum** (spec §2 manda mantê-la derivada). O Fórum de música passa a ler `Comentarios_Musicas` pela planilha virtual: uma fonte só, sem cópia que possa ficar para trás (foi exatamente uma cópia atrasada que escondeu o comentário do Andrei, 2026-11-23). Com a aba ligada, a tabela para de ser gravada; a remoção fica para a Fase 4.
- **Espelhos manuais de `musicas` (`upsertMusicaD1`, `mirrorMusicaRowParaD1`) não são removidos nesta fase**, igual à Fase 1 com vídeos: eles gravam a partir dos valores em memória (não releem o Google), e a reconciliação do cron (Task 4) corrige qualquer diferença a partir da planilha virtual. Remoção na Fase 4.
- **`REGISTRO` (pontos/prestígio do comentário) continua no Google.** Está fora das abas do spec. Num pico de cota do Google o comentário continua falhando com erro claro (nunca sucesso fingido, regra já existente em `forumController.ts`). Levado ao dono como item da Fase 4.

## Review Focus

1. Duas músicas lançadas ao mesmo tempo: cada uma reserva uma linha diferente da `EDIÇÃO CHARTS` e recebe um Código único diferente (Task 3, teste de concorrência).
2. Alguém escreveu à mão na linha reservada da `EDIÇÃO CHARTS` antes do despachante: o item fica parado com erro, nada é sobrescrito, os itens seguintes da mesma aba esperam (Task 2).
3. Cache por versão com várias instâncias do Worker: uma gravação feita em outra instância é vista na próxima leitura desta (a versão é lida do D1 a cada leitura, nunca de memória) (Task 1).
4. Comentário novo, resposta, reação e exclusão com `Comentarios_Musicas` ligada aparecem no tópico na hora, sem passar por `comentarios_musicas` (Task 5).
5. Música opção (c) ("conta para música já lançada"): o Código único da música referenciada vem do D1 mesmo com o Google bloqueado (Task 3).

---

### Task 1: Cache por versão nas leituras do porteiro

Sem isso, ligar `Musicas` (~990 linhas, ~1 MB de letras) e `Comentarios_Musicas` (~1.290 linhas) estoura o orçamento: só o letreiro de atividade (`/api/forum/atividade-recente`, recarregado a cada 60 s por jogador com o app aberto) passaria a ler ~3.400 linhas do D1 por chamada (~8 milhões/dia com 10 jogadores 4 h/dia; limite Free = 5 milhões).

**Files:**
- Modify: `backend/src/services/planilhaVirtualD1.ts` (tabela de versão em `PLANILHA_VIRTUAL_CREATE_STATEMENTS`; `stmtSubirVersao`)
- Modify: `backend/src/services/porteiroD1.ts` (`lerD1`, `gravarD1`, `appendD1`, `removerD1`, `limparD1`)
- Modify: `backend/src/controllers/adminD1PrimeiroController.ts` (`substituirAba` da carga também sobe a versão)
- Test: `scripts/porteiro-d1.test.ts`

**Interfaces:**
- Produces:
  - Tabela `planilha_virtual_versao (planilha TEXT, aba TEXT, versao INTEGER NOT NULL, PRIMARY KEY (planilha, aba))`.
  - `stmtSubirVersao(planilha: string, aba: string): D1PreparedStatement` — upsert `versao = versao + 1`; entra no MESMO `db.batch` de toda gravação do porteiro e da carga.
  - `lerD1(planilha, aba, range)` mantém a assinatura. Lê a versão (1 linha); se o cache da instância tiver a aba inteira nessa versão, recorta o intervalo em memória; senão lê a aba inteira uma vez (`lerIntervalo(..., "A:ZZ")`), guarda `{ versao, linhas }` e recorta. Recorte = mesmo resultado de `lerIntervalo` para o intervalo (mesmo aparar de células/linhas vazias).
  - `limparCacheLeitura(): void` exportada (testes).

- [ ] **Step 1: Write the failing tests**

```ts
test("segunda leitura sem gravação no meio não relê a aba", async () => {
  // aba "Music Videos" on, 3 linhas; espiona prepare(): 2ª G.readValues lê só planilha_virtual_versao
});
test("gravação em outra instância invalida o cache", async () => {
  // lê; grava direto no D1 via gravarD1 após limpar só o cache de estado (simula outra instância); relê → vê o valor novo
});
test("recorte do cache = lerIntervalo", async () => {
  // para "A:ZZ", "A2:B2", "F5", "A1:I1", "A2:A20000": readValues(cache) toEqual lerIntervalo direto
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test scripts/porteiro-d1.test.ts`
Expected: FAIL nos 3 testes novos.

- [ ] **Step 3: Implement** a tabela de versão, `stmtSubirVersao` nos batches de `gravarD1`/`appendD1`/`removerD1`/`limparD1`/carga e o cache em `lerD1` (`Map` por banco em `WeakMap`, como `cachesEstado`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `bash scripts/rodar-testes-isolados.sh scripts/porteiro-d1.test.ts scripts/planilha-virtual-d1.test.ts scripts/admin-d1-primeiro.test.ts scripts/despachante-fila.test.ts`
Expected: todos OK.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/planilhaVirtualD1.ts backend/src/services/porteiroD1.ts backend/src/controllers/adminD1PrimeiroController.ts scripts/porteiro-d1.test.ts
git commit -m "Porteiro D1: cache de leitura por versão da aba (1 linha lida quando nada mudou)"
```

---

### Task 2: Fila — gravação condicional e append real fora do porteiro

**Files:**
- Modify: `backend/src/services/planilhaVirtualD1.ts` (coluna `condicao` em `fila_backup_planilha`; `itemFila` aceita `condicao`)
- Modify: `backend/src/services/despachanteFilaBackup.ts`
- Create: `backend/src/services/filaPlanilhaExterna.ts`
- Test: `scripts/despachante-fila.test.ts`

**Interfaces:**
- Produces:
  - `ALTER TABLE fila_backup_planilha ADD COLUMN condicao TEXT` em `garantirTabelas` (ignora o erro "duplicate column").
  - Condição `"vazia:B"`: antes de enviar um item `update` com essa condição, o despachante lê `B{r1}` da planilha real (`googleDireto.readValuesFresh`). Vazia → grava. Ocupada com o MESMO valor que o item grava em B → apaga o item (já gravado por uma execução anterior). Ocupada com outro valor → `marcarErro(id, "linha-ocupada")`, `registrarLogSistema` (categoria "Falha de escrita") e para a aba (itens seguintes da mesma aba esperam).
  - Item `append` com `intervalo` nulo = append real do Google (`googleDireto` append na aba, próxima linha livre do próprio Google). Hoje um `append` sem intervalo cairia em `A1`; passa a usar o append.
  - `enfileirarUpdateCondicional(planilha: string, aba: string, intervalo: string, valores: unknown[][], condicao: "vazia:B"): Promise<void>` e `enfileirarAppendReal(planilha: string, aba: string, valores: unknown[]): Promise<void>` em `filaPlanilhaExterna.ts`, para abas que NÃO são do porteiro (`EDIÇÃO CHARTS`, `INFOS MÚSICAS`).

- [ ] **Step 1: Write the failing tests**

```ts
test("update com condição vazia:B grava quando B está vazia", async () => {});
test("update com condição vazia:B para e não sobrescreve quando B tem outro valor", async () => {
  // planilha falsa B5="Outra - Música" → item fica com ultimo_erro "linha-ocupada", nenhum PUT/batchUpdate enviado, item seguinte da mesma aba não é enviado
});
test("update com condição já aplicado (B igual) é dado como gravado", async () => {});
test("append com intervalo nulo usa o append do Google", async () => {
  // fetch recebeu URL com ":append" e o item saiu da fila
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test scripts/despachante-fila.test.ts`
Expected: FAIL nos 4 testes novos.

- [ ] **Step 3: Implement** a coluna, os dois enfileiradores e os dois caminhos novos em `enviarGrupo` (item condicional nunca é agrupado com outros).

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test scripts/despachante-fila.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/planilhaVirtualD1.ts backend/src/services/despachanteFilaBackup.ts backend/src/services/filaPlanilhaExterna.ts scripts/despachante-fila.test.ts
git commit -m "Fila de backup: gravação só em linha vazia e append real para planilhas fora do porteiro"
```

---

### Task 3: Código único reservado pelo D1

**Files:**
- Create: `backend/src/services/reservaEdicaoCharts.ts`
- Modify: `backend/src/controllers/gestaoController.ts` (`registrarNaEdicaoCharts` ~l.178, `lerCodigoUnicoGerado` ~l.272, opção (c) ~l.682, `registrarInfosMusicas` ~l.300)
- Modify: `backend/src/controllers/adminD1PrimeiroController.ts` + `backend/src/routes/api.ts` (rota admin do contador)
- Test: `scripts/reserva-edicao-charts.test.ts`

**Interfaces:**
- Consumes: Task 2 (`enfileirarUpdateCondicional`, `enfileirarAppendReal`); `estadoAba(PLANILHA_PRINCIPAL_ID, "Musicas")`.
- Produces:
  - Tabela `contador_edicao_charts (aba TEXT PRIMARY KEY, proxima_linha INTEGER NOT NULL, atualizado_em TEXT)`.
  - `recalcularContador(aba: "EDIÇÃO CHARTS"): Promise<{ proximaLinha: number }>` — lê `B2:B20000` da planilha real (`googleDireto`), última linha com título + 1 (mesma regra de `registrarNaEdicaoChartsSemTrava`), soma os itens condicionais ainda na fila para essa aba, grava o contador e registra no log o aviso do spec ("apagar uma linha da EDIÇÃO CHARTS renumera o Código único de todas as linhas abaixo; prefira limpar a linha").
  - `reservarLinhaEdicaoCharts(valoresAQ: string[]): Promise<{ linha: number; codigoUnico: string }>` — num único `db.batch`: sobe o contador e insere o item condicional (`A{n}:Q{n}`, `"vazia:B"`) calculando `n` pelo próprio contador no SQL; depois lê o `intervalo` do item pelo `last_row_id` (mesmo padrão de `appendD1`). Lança se o contador não existir ("Contador da EDIÇÃO CHARTS não iniciado").
  - `codigoUnicoDaLinha(linha: number): string` — `"EMP" + String(linha - 1).padStart(3, "0")`.
  - `POST /api/admin/d1primeiro/contador-edicao-charts` (admin) → `recalcularContador("EDIÇÃO CHARTS")`.
  - Em `gestaoController`, com `Musicas` em `"on"`: `registrarNaEdicaoCharts` usa `reservarLinhaEdicaoCharts` (dentro do mesmo `withWriteLock`) e devolve a linha; `lerCodigoUnicoGerado(linha)` devolve `codigoUnicoDaLinha(linha)` sem ler o Google; opção (c) busca o código em `SELECT codigo_unico FROM musicas` comparando `normalizeComparison(titulo)` com a referência; `registrarInfosMusicas` usa `enfileirarAppendReal`. Com `Musicas` em `"off"`: tudo como hoje.

- [ ] **Step 1: Write the failing tests**

```ts
test("código da linha segue a fórmula", () => {
  expect(codigoUnicoDaLinha(2)).toBe("EMP001");
  expect(codigoUnicoDaLinha(946)).toBe("EMP945");
  expect(codigoUnicoDaLinha(1029)).toBe("EMP1028");
});
test("duas reservas simultâneas ganham linhas e códigos diferentes", async () => {
  // contador 1030; Promise.all de 2 reservas → linhas {1030,1031}, códigos {EMP1029,EMP1030}, 2 itens condicionais na fila
});
test("reserva sem contador iniciado lança", async () => {});
test("lançar música com Musicas on não chama o Google", async () => {
  // createSongController com fetch espião: zero URLs sheets.googleapis.com; Musicas!Z da linha nova = código reservado
});
test("opção (c) acha o código da música referenciada no D1", async () => {});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test scripts/reserva-edicao-charts.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** `reservaEdicaoCharts.ts`, a rota admin e os ramos em `gestaoController.ts`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test scripts/reserva-edicao-charts.test.ts`
Expected: 5 pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/reservaEdicaoCharts.ts backend/src/controllers/gestaoController.ts backend/src/controllers/adminD1PrimeiroController.ts backend/src/routes/api.ts scripts/reserva-edicao-charts.test.ts
git commit -m "Código único reservado pelo D1; EDIÇÃO CHARTS e INFOS MÚSICAS pela fila"
```

---

### Task 4: Porteiro aceita as abas de música; `musicas` derivada da planilha virtual

**Files:**
- Modify: `backend/src/services/porteiroD1.ts` (`ABAS_D1_PRIMEIRO_FASE2 = ["Musicas", "Comentarios_Musicas"]`, incluídas em `ABAS_DO_PORTEIRO`)
- Modify: `backend/src/controllers/adminD1PrimeiroController.ts` (abas aceitas por `carregar`/`desligar`/`status`)
- Create: `backend/src/services/musicasD1Sync.ts`
- Modify: `backend/src/services/googleSheetsService.ts` (depois de gravação em `Musicas` ligada, chama o espelho, como já faz para vídeos)
- Modify: `src/server.ts` (cron: `reconciliarMusicasD1()` depois do despachante)
- Test: `scripts/musicas-d1-sync.test.ts`

**Interfaces:**
- Consumes: `musicaDaLinhaPlanilha(row, extra)` e `lerExtrasMusicas()` de `adminMigrarMusicasD1Controller.ts`; `buildMusicaUpsertStatement`, `chaveMusica` de `musicasDbService.ts`.
- Produces:
  - `espelharMusicasLinhas(ini: number, fim: number): Promise<void>` — relê essas linhas de `Musicas` pelo porteiro e faz upsert em `musicas`; nunca lança (só loga).
  - `reconciliarMusicasD1(): Promise<{ ok: boolean; corrigidas: number; sobrando: string[] }>` — só roda com `Musicas` em `"on"`; compara a planilha virtual inteira com `musicas` (por `chave`, todos os campos de `MusicaUpsert`), faz upsert das diferentes, **não apaga** linha que sobra em `musicas` (só lista em `sobrando` e no log), registra no log quando corrige.

- [ ] **Step 1: Write the failing tests**

```ts
test("gravação em Musicas ligada atualiza a tabela musicas", async () => {});
test("reconciliação corrige campo divergente e não apaga sobra", async () => {});
test("reconciliação não faz nada com a aba off", async () => {});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test scripts/musicas-d1-sync.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** a lista de abas, `musicasD1Sync.ts`, o gancho pós-escrita e o cron.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bash scripts/rodar-testes-isolados.sh scripts/musicas-d1-sync.test.ts scripts/porteiro-d1.test.ts scripts/admin-d1-primeiro.test.ts scripts/rotas-d1-primeiro.test.ts`
Expected: todos OK.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/porteiroD1.ts backend/src/controllers/adminD1PrimeiroController.ts backend/src/services/musicasD1Sync.ts backend/src/services/googleSheetsService.ts src/server.ts scripts/musicas-d1-sync.test.ts
git commit -m "Porteiro: Musicas e Comentarios_Musicas; tabela musicas derivada da planilha virtual"
```

---

### Task 5: Fórum de música lê comentários pela planilha virtual

**Files:**
- Modify: `backend/src/controllers/empirePlayController.ts` (caminho rápido de música, ~l.2085–2160)
- Modify: `backend/src/controllers/forumController.ts` (espelho em `comentarios_musicas`, ~l.705–800)
- Test: `scripts/forum-musica-d1.test.ts`

**Interfaces:**
- Consumes: `estadoAba(PLANILHA_PRINCIPAL_ID, "Comentarios_Musicas")`; Task 1 (leitura barata e repetida).
- Produces:
  - Com `Comentarios_Musicas` em `"on"`: o caminho rápido que lê `comentarios_musicas` é pulado e o tópico usa o caminho normal (que já lê `Comentarios_Musicas` por `readSheetObjectsWithRowIndex`, agora servido pelo D1), com `rowIndex` real; `forumController` não grava mais em `comentarios_musicas` nem marca tópico no KV (`marcarTopicoMusicaD1Incompleto`).
  - Com `"off"`: comportamento atual (inclusive a marca no KV).

- [ ] **Step 1: Write the failing tests**

```ts
test("com a aba on, comentário salvo aparece no tópico mesmo sem linha em comentarios_musicas", async () => {
  // reproduz o caso Andrei: Comentarios_Musicas virtual tem 7 linhas do tópico, comentarios_musicas tem 6 → resposta traz 7, todas com rowIndex numérico
});
test("com a aba on, comentar não grava em comentarios_musicas", async () => {});
test("com a aba on, abrir tópico não chama o Google para Musicas/Comentarios_Musicas", async () => {});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test scripts/forum-musica-d1.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** os dois desvios por estado da aba.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test scripts/forum-musica-d1.test.ts`
Expected: 3 pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/controllers/empirePlayController.ts backend/src/controllers/forumController.ts scripts/forum-musica-d1.test.ts
git commit -m "Fórum de música lê comentários pela planilha virtual (fonte única)"
```

---

### Task 6: Ligar a Fase 2 em produção (roteiro operacional)

Não é código; sequência para depois do merge e do deploy, com o dono acompanhando. Escolher um horário de pouco uso (a carga deixa a aba em "carregando" por alguns segundos e recusa gravações nesse intervalo).

- [ ] **Step 1:** `GET /api/admin/d1primeiro/status` → `Musicas` e `Comentarios_Musicas` em `"off"`, fila 0.
- [ ] **Step 2:** `POST /api/admin/d1primeiro/contador-edicao-charts` → `proximaLinha` = última linha com título da `EDIÇÃO CHARTS` + 1 (conferir na planilha).
- [ ] **Step 3:** `POST /api/admin/d1primeiro/carregar {"aba":"Comentarios_Musicas"}` → `ok:true`.
- [ ] **Step 4:** `POST /api/admin/d1primeiro/carregar {"aba":"Musicas"}` → `ok:true`. Se `motivo:"formula"`, parar e trazer as células ao dono (a coluna com fórmula precisa ser reproduzida antes, como o spec manda).
- [ ] **Step 5:** Abrir "Beautiful Distortion" no Fórum → 7 comentários, o do Andrei incluído; reagir a um comentário funciona.
- [ ] **Step 6:** Comentar numa música → aparece na hora para outro jogador.
- [ ] **Step 7:** Lançar uma música de teste pela Gestão → Código único na resposta = `codigoUnicoDaLinha(proximaLinha)`; aparece no catálogo e no Fórum.
- [ ] **Step 8:** Depois do próximo ciclo do cron: fila 0; a linha nova está na planilha `Musicas`, e na `EDIÇÃO CHARTS` a fórmula da coluna BD mostra o MESMO código.
- [ ] **Step 9:** Painel de métricas do D1 no Cloudflare (Metrics > Row Metrics) no dia seguinte: linhas lidas/dia bem abaixo de 5 milhões.
