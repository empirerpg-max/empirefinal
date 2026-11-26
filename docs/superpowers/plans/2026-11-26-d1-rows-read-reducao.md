# Redução de linhas lidas no D1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cortar as maiores fontes de `rows_read` do D1 (ticker da Home, conferência de vídeos do cron, datas dos Charts) sem mudar o que o usuário vê.

**Architecture:** Consultas por faixa ou PK no lugar de abas e tabelas inteiras, e uma lista pronta de datas em `chart_config`. Não depende de cache por isolate, porque o painel mostrou que ele quase não acerta.

**Tech Stack:** TypeScript, Cloudflare Workers + D1, `bun test` (testes em `scripts/*.test.ts`, D1 falso em `scripts/helpers/fakeD1.ts`).

**Spec:** `docs/superpowers/specs/2026-11-26-d1-rows-read-reducao-design.md`

## Global Constraints

- Nada muda no que o usuário vê: o ticker mostra os mesmos itens (8 últimos por tipo, no máximo 20), e as datas dos Charts saem na mesma ordem (mais recente primeiro, `dd/mm/aaaa`).
- Falha do D1 nunca deixa a tela vazia: cai para a leitura antiga.
- A conferência de vídeos do cron roda 1 vez por hora (ciclo em que `getUTCMinutes() < 10`).
- Comentários no código em português, no estilo do repositório.

## Review Focus

- Aba `Comentarios_MV` com menos de 8 linhas de dados (ou só cabeçalho): o ticker mostra o que houver, sem erro e sem incluir o cabeçalho. Teste na Task 1.
- Buracos no meio da aba (linha apagada no D1): a faixa das últimas linhas pode trazer linha vazia. O ticker ignora a linha vazia, como já faz o `.filter`. Teste na Task 1.
- Comentário cujo vídeo não existe na tabela `videos`: fica fora do ticker, como hoje (título vazio é filtrado). Teste na Task 2.
- Reenvio da mesma semana nos Charts: a lista pronta continua sem data duplicada. Teste na Task 4.
- Banco sem a linha pronta (primeiro acesso depois do deploy): `datasDoChart` monta a lista, grava e devolve o mesmo resultado da consulta antiga. Teste na Task 4.

---

### Task 1: `lerUltimasLinhas` no googleSheetsService

**Files:**
- Modify: `backend/src/services/planilhaVirtualD1.ts` (nova função ao lado de `proximaLinhaAppend`)
- Modify: `backend/src/services/googleSheetsService.ts` (nova função pública ao lado de `readValues`, ~linha 914, e no objeto `principal`, ~linha 1110)
- Test: `scripts/porteiro-d1.test.ts`

**Interfaces:**
- Produces: `ultimaLinha(planilha: string, aba: string): Promise<number>` em `planilhaVirtualD1.ts`: `SELECT MAX(linha)`, ou 0 se a aba estiver vazia.
- Produces: `readUltimasLinhas(spreadsheetKeyOrId: SpreadsheetKey | string, sheetName: string, n: number): Promise<string[][]>` em `googleSheetsService.ts`, e `googleSheetsService.principal.readUltimasLinhas(sheetName, n)`. Devolve **só linhas de dados** (sem cabeçalho), em ordem de planilha, no máximo `n`. Uma linha inexistente na faixa vira `[]`.
  - Aba do porteiro com leitura no D1 (`leNoD1(estadoAba(...))`): `ultimaLinha`, depois `lerD1(id, aba, \`A${max(2, ult-n+1)}:ZZ${ult}\`)`. Com `ult < 2`, devolve `[]`.
  - Outra aba: `readValues(...)` normal, `.slice(1).slice(-n)`.

- [ ] **Step 1: Escrever os testes que falham** em `scripts/porteiro-d1.test.ts`:

```ts
test("readUltimasLinhas: aba ligada lê só a faixa final, sem cabeçalho e sem Google", async () => {
  await definirEstadoAba("Comentarios_MV", "on");
  await G.updateValues("principal", "Comentarios_MV", "A1:C1", [["id", "x", "jogador"]]);
  for (let i = 1; i <= 12; i++) await G.appendRow("principal", "Comentarios_MV", [`t${i}`, "", `j${i}`]);
  const r = await G.readUltimasLinhas("principal", "Comentarios_MV", 8);
  expect(r.map((l: string[]) => l[0])).toEqual(["t5", "t6", "t7", "t8", "t9", "t10", "t11", "t12"]);
  expect(googleCalls.filter((u) => u.includes("sheets.googleapis.com"))).toEqual([]);
});

test("readUltimasLinhas: aba com menos linhas que n e aba só com cabeçalho", async () => {
  await definirEstadoAba("Comentarios_MV", "on");
  await G.updateValues("principal", "Comentarios_MV", "A1:C1", [["id", "x", "jogador"]]);
  expect(await G.readUltimasLinhas("principal", "Comentarios_MV", 8)).toEqual([]);
  await G.appendRow("principal", "Comentarios_MV", ["t1", "", "j1"]);
  expect(await G.readUltimasLinhas("principal", "Comentarios_MV", 8)).toEqual([["t1", "", "j1"]]);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `bun test scripts/porteiro-d1.test.ts`
Expected: FAIL, `readUltimasLinhas is not a function`.

- [ ] **Step 3: Implementar `ultimaLinha` e `readUltimasLinhas`** conforme as Interfaces. `ultimaLinha` reaproveita a consulta de `proximaLinhaAppend` (esta passa a chamar `ultimaLinha(...) + 1`).

- [ ] **Step 4: Rodar e ver passar**

Run: `bun test scripts/porteiro-d1.test.ts scripts/planilha-virtual-d1.test.ts`
Expected: PASS (incluindo os testes antigos).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/planilhaVirtualD1.ts backend/src/services/googleSheetsService.ts scripts/porteiro-d1.test.ts
git commit -m "feat(d1): ler só as últimas linhas de uma aba do porteiro"
```

### Task 2: Ticker "Atividade recente" lê só o necessário

**Files:**
- Modify: `backend/src/services/videosD1Leitura.ts` (nova função)
- Modify: `backend/src/controllers/forumController.ts:1306-1365` (`getAtividadeRecenteController`)
- Modify: `src/components/ActivityTicker.tsx:25-40`
- Test: `scripts/atividade-recente.test.ts` (novo)

**Interfaces:**
- Consumes: `googleSheetsService.principal.readUltimasLinhas(sheetName, n)` (Task 1).
- Produces: `titulosVideosPorTopico(ids: string[]): Promise<Map<string, string> | null>` em `videosD1Leitura.ts`: `SELECT id_topico, titulo_topico FROM videos WHERE id_topico IN (...)` (PK). A chave do mapa é `normalizeComparison(id_topico)` e o valor é `normalizeText(titulo_topico)`. Sem D1 ou com erro, devolve `null`. Com `ids` vazio, devolve um `Map` vazio sem consultar.

- [ ] **Step 1: Escrever os testes que falham** em `scripts/atividade-recente.test.ts`. Use o mesmo cabeçalho de mocks do `porteiro-d1.test.ts`, crie a tabela `videos` com `VIDEOS_CREATE_STATEMENTS` (de `videosDbService.ts`) e conte as linhas lidas embrulhando `sqlite.query`, ou conte as chamadas `fetch` ao Google:

```ts
test("ticker: vídeos vêm dos 8 últimos comentários e títulos pela tabela videos", async () => {
  // Comentarios_MV ligada com 12 comentários (t1..t12, jogadores j1..j12);
  // videos com id_topico t1..t12 e titulo_topico "Clipe tN", exceto t11 (ausente)
  const res = await getAtividadeRecenteController();
  const { data } = await res.json();
  const videos = data.filter((x: any) => x.tipo === "video");
  expect(videos.map((x: any) => x.jogador)).toEqual(["j12", "j10", "j9", "j8", "j7", "j6", "j5"]); // t11 sem vídeo fica fora
  expect(videos[0]).toEqual({ jogador: "j12", titulo: "Clipe t12", tipo: "video" });
});

test("ticker: Music Videos não é lida inteira (nenhuma leitura de planilha_virtual da aba Music Videos)", async () => {
  // mesma montagem; conta as consultas a planilha_virtual com aba = 'Music Videos'
  expect(consultasMusicVideos).toBe(0);
});

test("ticker: linha vazia no meio da faixa é ignorada", async () => {
  // apaga a linha de t10 (G.deleteRows ou limparIntervalo) e confere que nada quebra e j10 some
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `bun test scripts/atividade-recente.test.ts`
Expected: FAIL (hoje o controller lê `Music Videos` inteira e `titulosVideosPorTopico` não existe).

- [ ] **Step 3: Implementar `titulosVideosPorTopico`**, conforme as Interfaces.

- [ ] **Step 4: Ajustar `getAtividadeRecenteController`**:
  - `Comentarios_MV` passa a vir de `readUltimasLinhas("Comentarios_MV", 8)`. O helper `ultimos` precisa aceitar linhas **sem** cabeçalho: separe "linhas de dados" de "aba inteira" e mantenha `.slice(-n).reverse()` e o filtro de jogador e título.
  - Sai a leitura de `Music Videos`. O mapa de títulos de vídeo vem de `titulosVideosPorTopico(ids dos comentários)`.
  - Se `titulosVideosPorTopico` devolver `null`, volta ao comportamento antigo só para vídeos (`readValues("Music Videos")` + `mapaTitulos(mvRows, 5, 1)`).
  - Músicas e álbuns continuam iguais (vêm da planilha, não do D1).

- [ ] **Step 5: Rodar e ver passar**

Run: `bun test scripts/atividade-recente.test.ts`
Expected: PASS.

- [ ] **Step 6: Ticker pausa com a aba escondida** em `src/components/ActivityTicker.tsx`. O `setInterval(load, 60_000)` só chama `load()` com `document.visibilityState === "visible"`. Um listener de `visibilitychange` chama `load()` ao voltar a ficar visível. Os dois são removidos no cleanup. É o mesmo padrão de `src/components/EmpirePlay/PlaylistsInicio.tsx:60-70`.

- [ ] **Step 7: Lint e tipos**

Run: `cd /home/user/empirefinal && bunx tsc --noEmit -p . 2>&1 | grep -E "ActivityTicker|forumController|videosD1Leitura" ; bunx eslint src/components/ActivityTicker.tsx backend/src/controllers/forumController.ts backend/src/services/videosD1Leitura.ts`
Expected: nenhum erro novo nesses arquivos.

- [ ] **Step 8: Commit**

```bash
git add backend/src/services/videosD1Leitura.ts backend/src/controllers/forumController.ts src/components/ActivityTicker.tsx scripts/atividade-recente.test.ts
git commit -m "perf(d1): ticker da Home lê só os últimos comentários e pausa escondido"
```

### Task 3: Conferência de vídeos do cron 1 vez por hora

**Files:**
- Modify: `src/cronJobs.ts`
- Modify: `src/server.ts:456-472` (bloco `reconciliarVideosD1`)
- Test: `scripts/cron-jobs.test.ts`

**Interfaces:**
- Produces: `ehCicloDaHora(agora: Date): boolean` em `src/cronJobs.ts`: `agora.getUTCMinutes() < 10`.

- [ ] **Step 1: Escrever o teste que falha**

```ts
test("ehCicloDaHora: só o primeiro ciclo de 10 min de cada hora", () => {
  expect(C.ehCicloDaHora(new Date("2026-11-26T13:00:30Z"))).toBe(true);
  expect(C.ehCicloDaHora(new Date("2026-11-26T13:09:59Z"))).toBe(true);
  expect(C.ehCicloDaHora(new Date("2026-11-26T13:10:00Z"))).toBe(false);
  expect(C.ehCicloDaHora(new Date("2026-11-26T13:50:00Z"))).toBe(false);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `bun test scripts/cron-jobs.test.ts`
Expected: FAIL, `ehCicloDaHora is not a function`.

- [ ] **Step 3: Implementar `ehCicloDaHora`** e, em `src/server.ts`, envolver o `ctx.waitUntil(likesVideos.then(... reconciliarVideosD1 ...))` em `if (ehCicloDaHora(new Date()))`. Atualizar o comentário do bloco: "1x/hora — economia de linhas lidas no D1, ver spec 2026-11-26". Os outros jobs ficam como estão.

- [ ] **Step 4: Rodar e ver passar**

Run: `bun test scripts/cron-jobs.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cronJobs.ts src/server.ts scripts/cron-jobs.test.ts
git commit -m "perf(d1): conferência do espelho de vídeos passa a rodar 1x/hora"
```

### Task 4: Lista de datas dos Charts pronta em `chart_config`

**Files:**
- Modify: `backend/src/services/chartsD1/repo.ts` (`ingerirSemana` ~linha 647, `datasDoChart` ~linha 716)
- Test: `scripts/charts-datas-cache.test.ts` (novo; D1 falso + `garantirSchemaCharts`)

**Interfaces:**
- Produces: `stmtRegravarDatasCharts(db: D1DatabaseLike): D1PreparedStatement` em `repo.ts`. É uma única instrução que regrava `chart_config` com `chave = 'datas:' || chart` e `valor` = JSON array das datas ISO desse chart, em ordem decrescente, para **todos** os charts em `chart_datas`:
  ```sql
  INSERT OR REPLACE INTO chart_config (chave, valor)
  SELECT 'datas:' || chart, json_group_array(data)
  FROM (SELECT chart, data FROM chart_datas ORDER BY chart, data DESC)
  GROUP BY chart
  ```
- `datasDoChart(db, chart)` mantém a assinatura. Lê `SELECT valor FROM chart_config WHERE chave = ?` (1 linha). Sem linha, roda `stmtRegravarDatasCharts(db)` e lê de novo. Se ainda não houver linha (chart sem datas), devolve `[]`. A saída continua `dataIsoParaBr` em cada data.

- [ ] **Step 1: Escrever os testes que falham**

```ts
test("datasDoChart: sem linha pronta, monta, grava e devolve igual à consulta antiga", async () => {
  // insere chart_datas: SPOTIFY 2026-11-04, 2026-11-18, 2026-11-11
  expect(await datasDoChart(db, "SPOTIFY")).toEqual(["18/11/2026", "11/11/2026", "04/11/2026"]);
  const r = await db.prepare("SELECT valor FROM chart_config WHERE chave = 'datas:SPOTIFY'").first();
  expect(JSON.parse(r.valor)).toEqual(["2026-11-18", "2026-11-11", "2026-11-04"]);
});

test("datasDoChart: com linha pronta lê só ela (não consulta chart_datas)", async () => {
  // grava chart_config 'datas:SPOTIFY' = ["2026-11-18"] e chart_datas vazia
  expect(await datasDoChart(db, "SPOTIFY")).toEqual(["18/11/2026"]);
});

test("ingerirSemana regrava a lista pronta no mesmo lote, sem duplicar no reenvio", async () => {
  // ingere a semana 2026-11-25 duas vezes (payload mínimo válido, como em charts-d1.test.ts)
  const r = await db.prepare("SELECT valor FROM chart_config WHERE chave = 'datas:SPOTIFY'").first();
  expect(JSON.parse(r.valor).filter((d: string) => d === "2026-11-25")).toHaveLength(1);
  expect(JSON.parse(r.valor)[0]).toBe("2026-11-25");
});

test("chart sem nenhuma data: devolve []", async () => {
  expect(await datasDoChart(db, "DIGITAL SALES")).toEqual([]);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `bun test scripts/charts-datas-cache.test.ts`
Expected: FAIL (`chart_config` sem `datas:*` e `stmtRegravarDatasCharts` inexistente).

- [ ] **Step 3: Implementar** `stmtRegravarDatasCharts`, adicionar a instrução ao final do `db.batch([...])` de `ingerirSemana` (depois dos inserts de `chart_datas`) e reescrever `datasDoChart` conforme as Interfaces. `datasCarregadas` não muda. Observação: `SELECT chave, valor FROM chart_config` (`repo.ts:542`, `aoVivoPaises.ts:151`) passa a trazer também as chaves `datas:*`. Os dois montam um `Map` e só usam as chaves de regras, então isso não tem efeito (são 5 linhas a mais). Não renomear chaves existentes.

- [ ] **Step 4: Rodar e ver passar, junto com os testes de Charts já existentes**

Run: `bun test scripts/charts-datas-cache.test.ts scripts/charts-d1.test.ts scripts/charts-paises.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/chartsD1/repo.ts scripts/charts-datas-cache.test.ts
git commit -m "perf(d1): datas dos Charts lidas de uma linha pronta em chart_config"
```

### Task 5: Verificação final

- [ ] **Step 1: Suíte inteira**

Run: `cd /home/user/empirefinal && bun test scripts/`
Expected: todos passam. Qualquer falha que já existia antes destas mudanças é anotada, não escondida.

- [ ] **Step 2: Lint**

Run: `cd /home/user/empirefinal && bunx eslint src/cronJobs.ts src/server.ts src/components/ActivityTicker.tsx backend/src/services/chartsD1/repo.ts backend/src/services/googleSheetsService.ts backend/src/services/planilhaVirtualD1.ts backend/src/services/videosD1Leitura.ts backend/src/controllers/forumController.ts`
Expected: nenhum erro novo.

- [ ] **Step 3: Push** para `claude/busy-pasteur-iay6il`.
