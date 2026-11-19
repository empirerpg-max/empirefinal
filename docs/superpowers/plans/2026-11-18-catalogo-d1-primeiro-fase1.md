# Catálogo "D1 primeiro" — Fase 1 (vídeos + programa de TV) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** As abas `Music Videos`, `Comentarios_MV` e `VIDEOS_PENDENTES_EMPIRE_TV` passam a ser lidas e gravadas só no D1 (planilha vira backup por fila), e o arquivo de vídeo sobe direto do navegador para o Drive.

**Architecture:** Um "porteiro" dentro de `googleSheetsService.ts` desvia toda leitura/gravação das abas ligadas para uma planilha virtual posicional no D1 (`planilha_virtual`) e acrescenta cada gravação numa fila (`fila_backup_planilha`) que o cron grava no Google em ordem. As tabelas tipadas (`videos`, `comentarios_videos`) continuam sendo atualizadas pelo espelho existente, que agora lê a planilha virtual através do próprio porteiro. Upload de vídeo: o Worker abre uma sessão retomável no Drive e o navegador envia o arquivo direto ao Google.

**Tech Stack:** Cloudflare Workers, D1 (binding `CATALOGO_DB`, acessado via `globalThis.__CATALOGO_DB__`), KV `FLAGS`, Google Sheets API v4, Google Drive API v3, React (TanStack Start), testes com `bun test` + `bun:sqlite`.

**Spec:** `docs/superpowers/specs/2026-11-18-catalogo-d1-primeiro-design.md`

## Global Constraints

- Nunca perder nem sobrescrever dado existente; carga inicial aborta se a cópia divergir.
- Aba ligada nunca cai para a planilha nem para GViz em leitura; se o D1 falhar, o erro sobe.
- Nenhum processo copia planilha → D1 para uma aba ligada.
- Gravação só retorna sucesso depois de gravada no D1; a fila é só backup.
- `withWriteLock` continua envolvendo os fluxos que já o usam.
- Chave por aba no KV `FLAGS`: `d1primeiro:<nome exato da aba>` com valores `"off"` (ou ausente), `"carregando"`, `"on"`.
- Arquivos do app ficam no Drive da conta OAuth (`getDriveOAuthAccessToken`); token nunca vai ao navegador.
- Vídeos enviados pelo app vão para `DRIVE_FOLDERS.musicVideos` (`1Jk9Jk-Zd6QAoZnW3nAqFhBiJCNAnw3wR`).
- O app roda em Cloudflare Workers; nada de Telegram (CLAUDE.md).
- Botões/textos novos seguem a regra de botões do CLAUDE.md (`min-w-0`, `px-1`+, ícone `shrink-0`, texto `truncate`).

## Desvios do spec (decididos neste plano)

- **Espelho/reconciliação de vídeos não são removidos**: `aposEscritaNaPlanilha` e `reconciliarVideosD1` leem por `readValuesFresh`, que passa pelo porteiro — com a aba ligada eles passam a comparar planilha virtual × tabelas tipadas, sem tocar no Google. Isso cumpre o objetivo do spec §4 (nada copia planilha real → D1). A remoção do código fica para a Fase 4.
- **Despachante só no cron de 10 min** (mais uma rota admin para forçar), não após cada gravação: o dono aceitou minutos de atraso no backup, e não há `waitUntil` confiável dentro do serviço.
- **Upload de vídeo**: em vez de "reservar o cadastro antes do upload", o arquivo enviado cujo cadastro falha é mandado para a lixeira pelo navegador (rota de descarte). Mesmo resultado (sem órfão), muito menos mudança.

- **Consertos pontuais de admin** (spec §6): na Fase 1 eles já passam pelo porteiro sozinhos (gravam no D1); a lista de quais desativar é levada ao dono na Fase 4.

## Review Focus

1. Valor que o Sheets reformataria com USER_ENTERED (data ISO `2026-11-18`, `0123`, `95`) — o D1 devolve exatamente o texto gravado; quem ordena por data (`parseDateToIso`) aceita os dois formatos.
2. `appendRow` em aba com células pré-preenchidas abaixo da última linha de dados (coluna T "Thumb" em `Music Videos`) — a linha nova cai depois da última linha com QUALQUER célula, igual ao Sheets.
3. Dois envios simultâneos (`appendRow` em paralelo) — cada um ganha uma linha diferente.
4. D1 indisponível (`__CATALOGO_DB__` ausente ou `prepare` lançando) com a aba ligada — erro sobe, zero chamadas ao Google.
5. Intervalos abertos/curtos (`A:ZZ`, `A2:A20000`, `F5`, `A1:I1`) e linhas mais curtas que o intervalo — a resposta vem aparada como a do Sheets (sem células vazias no fim da linha nem linhas vazias no fim).

---

### Task 1: Planilha virtual no D1 (armazenamento posicional)

**Files:**
- Create: `backend/src/services/planilhaVirtualD1.ts`
- Modify: `d1/schema.sql` (acrescentar as duas tabelas)
- Test: `scripts/planilha-virtual-d1.test.ts`

**Interfaces:**
- Produces:
  - `PLANILHA_VIRTUAL_CREATE_STATEMENTS: string[]` — cria `planilha_virtual(planilha TEXT, aba TEXT, linha INTEGER, celulas_json TEXT NOT NULL, atualizado_em TEXT, PRIMARY KEY(planilha, aba, linha))` e `fila_backup_planilha(id INTEGER PRIMARY KEY AUTOINCREMENT, planilha TEXT, aba TEXT, operacao TEXT CHECK(operacao IN ('update','append','delete','clear')), intervalo TEXT, valores_json TEXT, criado_em TEXT DEFAULT (datetime('now')), tentativas INTEGER DEFAULT 0, ultimo_erro TEXT)` + índice `(planilha, aba, id)`.
  - `parseA1(range: string): { c1: number; r1: number; c2: number | null; r2: number | null }` (colunas 0-based, linhas 1-based; `null` = aberto).
  - `lerIntervalo(planilha: string, aba: string, range: string): Promise<string[][]>`
  - `gravarIntervalo(planilha: string, aba: string, range: string, valores: unknown[][]): D1PreparedStatement[]` — devolve statements (não executa), para entrar no mesmo `db.batch` da fila.
  - `proximaLinhaAppend(planilha: string, aba: string): Promise<number>`
  - `removerLinhas(planilha: string, aba: string, linhas1: number[]): D1PreparedStatement[]` — remove e desloca as de baixo.
  - `limparIntervalo(planilha: string, aba: string, range: string): D1PreparedStatement[]`
  - `substituirAba(planilha: string, aba: string, linhas: string[][]): D1PreparedStatement[]` — usado pela carga inicial.
  - `itemFila(planilha, aba, operacao, intervalo, valores): D1PreparedStatement`

- [ ] **Step 1: Write the failing tests** (mesmo padrão de banco falso de `scripts/testar-espelho-albuns-d1.test.ts`: `bun:sqlite` em memória exposto como `globalThis.__CATALOGO_DB__` com `prepare/bind/run/all/batch`)

```ts
test("parseA1", () => {
  expect(parseA1("A:ZZ")).toEqual({ c1: 0, r1: 1, c2: 701, r2: null });
  expect(parseA1("A2:A20000")).toEqual({ c1: 0, r1: 2, c2: 0, r2: 20000 });
  expect(parseA1("F5")).toEqual({ c1: 5, r1: 5, c2: 5, r2: 5 });
  expect(parseA1("A1:I1")).toEqual({ c1: 0, r1: 1, c2: 8, r2: 1 });
});
test("gravar e ler devolve aparado como o Sheets", async () => {
  await db.batch(gravarIntervalo("p", "Aba", "A1:C3", [["a","",""],["","",""],["x","y",""]]));
  expect(await lerIntervalo("p", "Aba", "A:ZZ")).toEqual([["a"],[],["x","y"]]);
  expect(await lerIntervalo("p", "Aba", "B3:C3")).toEqual([["y"]]);
  expect(await lerIntervalo("p", "Aba", "A5:C9")).toEqual([]);
});
test("valor gravado volta literal (sem reformatar)", async () => {
  await db.batch(gravarIntervalo("p", "Aba", "A1:C1", [["2026-11-18","0123",95]]));
  expect(await lerIntervalo("p", "Aba", "A1:C1")).toEqual([["2026-11-18","0123","95"]]);
});
test("append cai depois da última linha com QUALQUER célula", async () => {
  await db.batch(gravarIntervalo("p", "MV", "A1:B2", [["h1","h2"],["v",""]]));
  await db.batch(gravarIntervalo("p", "MV", "T7", [["thumb-padrao"]]));
  expect(await proximaLinhaAppend("p", "MV")).toBe(8);
});
test("removerLinhas desloca as de baixo", async () => {
  await db.batch(substituirAba("p", "R", [["h"],["1"],["2"],["3"]]));
  await db.batch(removerLinhas("p", "R", [2]));
  expect(await lerIntervalo("p", "R", "A:A")).toEqual([["h"],["2"],["3"]]);
});
test("gravação parcial preserva as outras células da linha", async () => {
  await db.batch(substituirAba("p", "S", [["a","b","c"]]));
  await db.batch(gravarIntervalo("p", "S", "B1", [["X"]]));
  expect(await lerIntervalo("p", "S", "A1:C1")).toEqual([["a","X","c"]]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test scripts/planilha-virtual-d1.test.ts`
Expected: FAIL (`Cannot find module .../planilhaVirtualD1.ts`)

- [ ] **Step 3: Implement `planilhaVirtualD1.ts`** — células guardadas como `string[]` JSON por linha (sem as vazias do fim); `String(v)` para número/booleano; leitura apara células vazias no fim de cada linha e linhas vazias no fim do resultado, linhas vazias no meio viram `[]`. `gravarIntervalo` faz ler-modificar-gravar por linha (upsert). Acrescentar os `CREATE` em `d1/schema.sql`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test scripts/planilha-virtual-d1.test.ts`
Expected: 6 pass, 0 fail

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/planilhaVirtualD1.ts d1/schema.sql scripts/planilha-virtual-d1.test.ts
git commit -m "Planilha virtual posicional no D1 + tabela da fila de backup"
```

---

### Task 2: Porteiro no googleSheetsService

**Files:**
- Modify: `backend/src/services/googleSheetsService.ts` (funções públicas `readValues`, `readValuesFresh`, `updateValues`, `updateValuesBatch`, `appendRow`, `appendRows`, `deleteRows`, `clearValues`, `listSheetTabs`, `ensureSheetTab`, `ensureRowCapacity`)
- Create: `backend/src/services/porteiroD1.ts`
- Test: `scripts/porteiro-d1.test.ts`

**Interfaces:**
- Consumes: Task 1 (todas as funções de `planilhaVirtualD1.ts`); `flagAtiva`/`definirFlag` de `videosD1Leitura.ts` (mas ler o valor cru, ver abaixo).
- Produces:
  - `ABAS_D1_PRIMEIRO_FASE1 = ["Music Videos", "Comentarios_MV", "VIDEOS_PENDENTES_EMPIRE_TV"] as const` (planilha `principal`).
  - `estadoAba(spreadsheetId: string, aba: string): Promise<"off" | "carregando" | "on">` — lê `d1primeiro:<aba>` no KV `FLAGS` (cache 30 s como `flagAtiva`); abas fora da lista → `"off"` sem consultar KV.
  - `definirEstadoAba(aba: string, estado: "off" | "carregando" | "on"): Promise<boolean>`
  - Em `googleSheetsService.ts`, as implementações atuais renomeadas para `readValuesGoogle`, `updateValuesGoogle`, `updateValuesBatchGoogle`, `appendRowGoogle`, `appendRowsGoogle`, `deleteRowsGoogle`, `clearValuesGoogle` e exportadas num objeto `googleDireto` (usado só pela fila e pela carga).
  - Comportamento por estado: `"off"` → igual a hoje; `"on"` → D1 + item na fila no MESMO `db.batch`, e depois chama `espelharNoD1SeAplicavel` (tabelas tipadas); `"carregando"` → gravação lança `Error("Catálogo em manutenção por alguns segundos. Tente de novo.")`, leitura segue no Google.
  - `appendRow` devolve o número da linha gravada (hoje devolve `number | null`).
  - `updateValuesBatch` com entradas de abas ligadas e não ligadas: separa — ligadas no D1, demais no Google.
  - `listSheetTabs`/`ensureSheetTab`: abas ligadas respondem sem chamar o Google (`ensureSheetTab` não faz nada; `listSheetTabs` inclui as ligadas mesmo sem chamar a API quando o pedido for só para conferir existência — implementar `ensureSheetTab` com curto-circuito antes de `listSheetTabs`).

- [ ] **Step 1: Write the failing tests** (banco falso de `bun:sqlite`; `globalThis.fetch` substituído por um espião que conta chamadas a `sheets.googleapis.com`; KV `FLAGS` falso em memória)

```ts
test("aba ligada: gravação e leitura só no D1, zero chamadas ao Google", async () => {
  await definirEstadoAba("Music Videos", "on");
  await updateValues("principal", "Music Videos", "A1:B1", [["h1","h2"]]);
  const linha = await appendRow("principal", "Music Videos", ["x","y"]);
  expect(linha).toBe(2);
  expect(await readValues("principal", "Music Videos")).toEqual([["h1","h2"],["x","y"]]);
  expect(chamadasGoogle()).toBe(0);
  expect(await contarFila("Music Videos")).toBe(2);
});
test("aba desligada: comportamento antigo (vai ao Google)", async () => {
  await readValues("principal", "Social", "A1:A2").catch(() => {});
  expect(chamadasGoogle()).toBeGreaterThan(0);
});
test("ensureSheetTab de aba ligada não chama o Google", async () => {
  await definirEstadoAba("VIDEOS_PENDENTES_EMPIRE_TV", "on");
  await ensureSheetTab("principal", "VIDEOS_PENDENTES_EMPIRE_TV");
  expect(chamadasGoogle()).toBe(0);
});
test("D1 indisponível com aba ligada: erro sobe, sem Google", async () => {
  delete (globalThis as any).__CATALOGO_DB__;
  await expect(readValues("principal", "Music Videos")).rejects.toThrow();
  expect(chamadasGoogle()).toBe(0);
});
test("dois appendRow em paralelo ganham linhas diferentes", async () => {
  const [a, b] = await Promise.all([
    appendRow("principal", "Comentarios_MV", ["c1"]),
    appendRow("principal", "Comentarios_MV", ["c2"]),
  ]);
  expect(a).not.toBe(b);
});
test("carregando: gravação recusada com mensagem amigável", async () => {
  await definirEstadoAba("Comentarios_MV", "carregando");
  await expect(appendRow("principal", "Comentarios_MV", ["z"])).rejects.toThrow("manutenção");
});
test("updateValuesBatch misto separa D1 e Google", async () => { /* 1 entrada em "Music Videos" (on) + 1 em "Social": fila +1, Google +1 chamada */ });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test scripts/porteiro-d1.test.ts`
Expected: FAIL (`definirEstadoAba` não existe)

- [ ] **Step 3: Implement** — `porteiroD1.ts` com `estadoAba`/`definirEstadoAba` e as versões D1 de cada operação; em `googleSheetsService.ts`, cada função pública faz `if ((await estadoAba(id, aba)) === "on") return <versãoD1>(...)` antes do código atual (já renomeado `*Google`). Corrida do `appendRow`: calcular a linha e gravar dentro do mesmo `db.batch` usando `INSERT ... SELECT coalesce(max(linha),0)+1` para a linha da planilha virtual, e devolver a linha lida de volta. O cache de leitura (`readCache`) não é usado para abas ligadas.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test scripts/porteiro-d1.test.ts scripts/planilha-virtual-d1.test.ts`
Expected: todos pass

- [ ] **Step 5: Run the existing suites to confirm nada quebrou com a aba desligada**

Run: `bun test scripts/` e `npx tsc --noEmit -p .`
Expected: os testes que passavam antes continuam passando; `tsc` com o mesmo 1 erro pré-existente (`adminAlbunsD1Controller.ts(175,30)`)

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/porteiroD1.ts backend/src/services/googleSheetsService.ts scripts/porteiro-d1.test.ts
git commit -m "Porteiro: abas ligadas leem e gravam no D1, com fila de backup"
```

---

### Task 3: Despachante da fila (D1 → planilha real)

**Files:**
- Create: `backend/src/services/despachanteFilaBackup.ts`
- Modify: `src/server.ts` (bloco `scheduled`, junto dos outros `ctx.waitUntil`)
- Modify: `backend/src/routes/api.ts` (rota admin `POST /api/admin/fila-backup/despachar`, protegida por `requestProvesAdmin`)
- Test: `scripts/despachante-fila.test.ts`

**Interfaces:**
- Consumes: `googleDireto` (Task 2); tabela `fila_backup_planilha` (Task 1).
- Produces: `despacharFila(opts?: { maxItens?: number }): Promise<{ gravados: number; pendentes: number; parouPorLimite: boolean; erros: { id: number; erro: string }[] }>`; `statusFila(): Promise<{ aba: string; pendentes: number; maisAntigo: string | null }[]>`.

- [ ] **Step 1: Write the failing tests** (fetch falso registrando a ordem das chamadas ao Google)

```ts
test("grava em ordem por aba e apaga da fila", async () => { /* 3 itens update/append/update em "Music Videos" → 3 chamadas na ordem dos ids; fila vazia */ });
test("updates seguidos da mesma aba viram um values:batchUpdate só", async () => { /* 2 updates consecutivos → 1 chamada batchUpdate */ });
test("erro de cota para o despacho e mantém os itens", async () => { /* fetch responde 429 'Quota exceeded' → parouPorLimite true, itens continuam, tentativas+1 */ });
test("delete só é enviado depois dos itens anteriores da mesma aba", async () => {});
test("erro permanente (400) fica registrado no item e não bloqueia outras abas", async () => {});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test scripts/despachante-fila.test.ts`
Expected: FAIL (módulo não existe)

- [ ] **Step 3: Implement `despacharFila`** — lê até `maxItens` (padrão 200) em ordem de `id`; agrupa por aba mantendo a ordem; dentro da aba, junta `update`s consecutivos num `updateValuesBatchGoogle`; `append` → `updateValuesGoogle` na linha exata gravada no D1 (o item guarda o intervalo já resolvido, nunca "primeira linha livre"); `delete` → `deleteRowsGoogle`; cota → para tudo; erro permanente de uma aba → para só aquela aba e registra com `registrarLogSistema`. No cron: `ctx.waitUntil(despacharFila())` a cada ciclo.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test scripts/despachante-fila.test.ts`
Expected: 5 pass

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/despachanteFilaBackup.ts src/server.ts backend/src/routes/api.ts scripts/despachante-fila.test.ts
git commit -m "Despachante: fila de backup gravada na planilha pelo cron"
```

---

### Task 4: Carga inicial, ligar/desligar e integridade

**Files:**
- Create: `backend/src/controllers/adminD1PrimeiroController.ts`
- Modify: `backend/src/routes/api.ts` (rotas abaixo, todas com `requestProvesAdmin`)
- Modify: `src/server.ts` (verificação de integridade 1×/dia: só no ciclo do cron entre 06:00 e 06:10 UTC)
- Test: `scripts/admin-d1-primeiro.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces (rotas e funções):
  - `POST /api/admin/d1primeiro/carregar {aba}` → `carregarAba(aba)`: estado `"carregando"` → lê a aba real com `readValuesGoogle` em `FORMATTED_VALUE` e em `FORMULA`; se qualquer célula da leitura `FORMULA` começar com `=`, volta para `"off"` e responde `{ ok:false, motivo:"formula", celulas:[...] }`; senão `substituirAba` + relê do D1 e compara célula a célula; diferença → `"off"` e `{ ok:false, motivo:"divergencia" }`; igual → `"on"` e `{ ok:true, linhas }`.
  - `POST /api/admin/d1primeiro/desligar {aba}` → só se `statusFila()` da aba tiver 0 pendentes; senão `{ ok:false, motivo:"fila-pendente", pendentes }`.
  - `GET /api/admin/d1primeiro/status` → `{ abas: [{ aba, estado, pendentesFila, linhasD1 }] }`.
  - `verificarIntegridade(): Promise<{ aba: string; ok: boolean; diferentes: number[] }[]>` — só para abas `"on"` com fila vazia; compara D1 × planilha real; nunca grava no D1; diferenças vão para `registrarLogSistema`.

- [ ] **Step 1: Write the failing tests**

```ts
test("carga copia a aba exata e liga", async () => { /* planilha falsa com cabeçalho duplicado ("ID da mensagem" 2x), linha vazia no meio → ok, estado "on", lerIntervalo == planilha */ });
test("aba com fórmula não é ligada", async () => { /* leitura FORMULA com "=ARRAYFORMULA(...)" → ok:false motivo formula, estado "off" */ });
test("desligar recusado com fila pendente", async () => {});
test("integridade acusa diferença e não altera o D1", async () => {});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test scripts/admin-d1-primeiro.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement controller, rotas e o gancho diário no cron**

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test scripts/admin-d1-primeiro.test.ts`
Expected: 4 pass

- [ ] **Step 5: Commit**

```bash
git add backend/src/controllers/adminD1PrimeiroController.ts backend/src/routes/api.ts src/server.ts scripts/admin-d1-primeiro.test.ts
git commit -m "Admin: carga inicial, ligar/desligar e integridade das abas D1 primeiro"
```

---

### Task 5: Upload de vídeo direto do navegador para o Drive

**Files:**
- Create: `backend/src/controllers/videoUploadSessaoController.ts`
- Modify: `backend/src/routes/api.ts` (`POST /api/gestao/video-upload-sessao`, `POST /api/gestao/video-upload-descartar`)
- Create: `src/lib/uploadVideoDireto.ts`
- Modify: `src/components/EmpirePlay/Gestao.tsx` (`publicarVideo`, ~linhas 1135–1200: o `mediaFile` de vídeo usa `uploadVideoDireto` em vez de `handleUploadToDrive`; em erro no POST de cadastro, chama o descarte)
- Test: `scripts/video-upload-sessao.test.ts`

**Interfaces:**
- Produces:
  - `POST /api/gestao/video-upload-sessao` body `{ fileName: string; mimeType: string; size: number }` → `{ success: true, uploadUrl: string }`. Abre sessão em `https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id` com headers `Authorization: Bearer <OAuth>`, `X-Upload-Content-Type`, `X-Upload-Content-Length`, `Origin: <Origin da requisição>`, corpo `{ name: fileName, parents: [DRIVE_FOLDERS.musicVideos] }`; devolve o header `Location`. Recusa `mimeType` que não comece com `video/` e `size` > 5 GB.
  - `POST /api/gestao/video-upload-descartar` body `{ fileId: string }` → manda para a lixeira com `trashDriveFileIfInFolders(fileId, [DRIVE_FOLDERS.musicVideos])` só se o arquivo tiver sido criado há menos de 2 h e o ID não aparecer em nenhuma linha de `Music Videos` (ler via `readValues`, que passa pelo porteiro).
  - `uploadVideoDireto(file: File, nome: string, onProgresso: (pct: number) => void): Promise<string>` — pede a sessão, envia com `XMLHttpRequest` `PUT` do arquivo inteiro (progresso por `xhr.upload.onprogress`), lê `id` do JSON de resposta e devolve `https://drive.google.com/file/d/<id>/view?usp=drivesdk` (mesmo formato salvo hoje). Falha de rede: até 2 novas tentativas, cada uma com sessão nova.
  - Texto de progresso na tela: `Enviando vídeo... <n>%` (substitui "Fazendo upload do arquivo de vídeo...").

- [ ] **Step 1: Write the failing backend tests** (fetch falso capturando o pedido ao Drive)

```ts
test("sessão: pede ao Drive com pasta de vídeos e Origin, devolve Location", async () => {
  // req com Origin https://app.exemplo → fetch recebeu parents ["1Jk9Jk-Zd6QAoZnW3nAqFhBiJCNAnw3wR"], header Origin igual, X-Upload-Content-Length = size
  // resposta { success:true, uploadUrl:"https://upload.googleapis.com/sessao-x" }
});
test("sessão recusa arquivo que não é vídeo", async () => { /* mimeType image/png → 400 */ });
test("descarte recusa arquivo já usado no catálogo", async () => { /* ID presente em Music Videos → não chama trash */ });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test scripts/video-upload-sessao.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement backend controller e rotas**

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test scripts/video-upload-sessao.test.ts`
Expected: 3 pass

- [ ] **Step 5: Implement `uploadVideoDireto` e a troca em `Gestao.tsx`**

- [ ] **Step 6: Verificação manual no navegador (CORS da sessão)** — `bun run dev`, abrir a Gestão > Vídeos com Playwright (Chromium pré-instalado), enviar um arquivo de vídeo de teste de ~150 MB gerado com `ffmpeg -f lavfi -i testsrc2=s=1920x1080:d=120 -c:v libx264 -b:v 10M teste.mp4`. Esperado: barra chega a 100%, o PUT vai direto para `upload.googleapis.com` (não para o Worker), sem erro de CORS no console. Se o ambiente de dev não tiver as credenciais do Drive, registrar isso e fazer esta verificação no ambiente publicado antes de ligar a Fase 1 (Task 6).

- [ ] **Step 7: Commit**

```bash
git add backend/src/controllers/videoUploadSessaoController.ts backend/src/routes/api.ts src/lib/uploadVideoDireto.ts src/components/EmpirePlay/Gestao.tsx scripts/video-upload-sessao.test.ts
git commit -m "Upload de vídeo direto do navegador para o Drive (sessão retomável)"
```

---

### Task 6: Ligar a Fase 1 em produção (roteiro operacional)

Não é código; é a sequência a executar depois do merge e do deploy, com o dono acompanhando. Cada passo tem um resultado conferível.

- [ ] **Step 1:** `GET /api/admin/d1primeiro/status` → as 3 abas `"off"`, fila 0.
- [ ] **Step 2:** `POST /api/admin/d1primeiro/carregar {"aba":"VIDEOS_PENDENTES_EMPIRE_TV"}` → `ok:true` (aba nova pode ter só o cabeçalho ou nada — aceitar 0 linhas).
- [ ] **Step 3:** Carregar `Comentarios_MV`, depois `Music Videos` → `ok:true`; se `motivo:"formula"`, parar e trazer as células ao dono (a coluna com fórmula precisa ser reproduzida antes, como o spec manda).
- [ ] **Step 4:** Envio real pela Gestão com "Lançar em um programa dessa semana?" e **link colado** → sucesso; aparece em `GestaoEmpireTv` para o admin.
- [ ] **Step 5:** Mesmo envio com **arquivo** de vídeo > 100 MB → sucesso com barra de progresso.
- [ ] **Step 6:** Comentar e curtir um vídeo no Fórum → aparece na hora.
- [ ] **Step 7:** Após o próximo ciclo do cron, `status` → fila 0 e as linhas novas presentes na planilha real.
- [ ] **Step 8:** Reversão de teste numa aba pouco usada (`VIDEOS_PENDENTES_EMPIRE_TV`): `desligar` com fila 0 → `ok:true`; religar com `carregar`.
