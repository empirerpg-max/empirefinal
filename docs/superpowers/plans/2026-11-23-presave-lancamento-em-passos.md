# Pre-save em passos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O lançamento de um pre-save vira uma lista de passos guardada no D1, executada aos poucos por um cron próprio, que nunca grava nada duas vezes e se completa sozinha.

**Architecture:**
- **Dados:** duas tabelas D1 (`presave_lancamentos` e `presave_lancamento_passos`) guardam o estado de cada passo.
- **Montagem:** uma função pura monta a lista a partir da campanha.
- **Execução:** executores pequenos gravam um passo cada, reaproveitando os blocos de escrita que já existem em `gestaoController.ts`. Depois de qualquer falha, eles **procuram antes de gravar**.
- **Motor:** roda num cron só dele, respeita um orçamento de chamadas externas e marca a campanha `lancada` assim que o álbum existe.

**Tech Stack:** TypeScript, Cloudflare Workers + D1, Google Sheets API v4, testes `bun test` com D1 falso (`scripts/helpers/fakeD1.ts`) e `mock.module`.

**Spec:** `docs/superpowers/specs/2026-11-23-presave-lancamento-em-passos-design.md`

## Global Constraints

- Nunca excluir linha em EDIÇÃO CHARTS. O Código único é `"EMP" & TEXT(ROW-1;"000")` (coluna BD). Linha errada é esvaziada só em A:Q.
- Toda leitura de **busca antes de gravar** usa `readValuesFresh`: só API v4, sem cache e sem fallback GViz, e lança erro em falha. Nunca usar `readValues`, porque o fallback GViz pula linhas vazias e desloca o índice (bug real visto em 23/11). Leitura que falhou = passo falhou, nunca "não existe".
- `MAX_TENTATIVAS = 6`. Na 6ª falha o passo vira `travado`.
- Orçamento padrão por execução: `ORCAMENTO_CHAMADAS_PRESAVE = 35` chamadas externas.
- Cron do pre-save: `"2-59/10 * * * *"`. Os outros jobs continuam em `"*/10 * * * *"`.
- A campanha vira `status = "lancada"` quando o passo `album` fica `feito`.
- Bônus congelado no dia D: `Math.round(calcularAcumulado(c))` depois de `aplicarDiasPerdidos(c)`, gravado uma vez em `resultado.valor` do passo `bonus`.
- O passo `album` usa `c.albumTopicId` (o id reservado) em `Albuns!B` e `Albuns!D`.
- Gravações em D1 da faixa são aguardadas (`await mirrorMusicaRowParaD1(linha)`). Nada de `upsertMusicaD1` sem `await` no fluxo novo: o Worker termina antes, e por isso faltaram linhas no D1 da Jessica.
- Testes: `bash scripts/rodar-testes-isolados.sh <arquivos>`. Cada arquivo roda num processo próprio, por causa do `mock.module`.
- Comentários e mensagens em português, no estilo do repo.

## Review Focus

1. **Queda entre "gravou na planilha" e "anotou no D1".** A próxima execução tem que achar a linha e não gravar de novo. O teste está na Task 6 (`retoma sem duplicar após queda`).
2. **Leitura de busca falha (cota/HTTP 429).** O passo tem que contar como falha e **não** gravar. O teste está na Task 5 (`busca que falha não grava`).
3. **Duas execuções do cron ao mesmo tempo na mesma campanha.** A trava por campanha tem que impedir trabalho duplo. O teste está na Task 6 (`duas execuções simultâneas não duplicam`).
4. **Faixas com o mesmo título no mesmo álbum** (ex.: versão e remix com nome parecido). A busca casa por (álbum + número da faixa, coluna U) em Musicas, não só por título. O teste está na Task 5.
5. **Campanha já lançada antes deste código** (DERBY, FOLLIA, Samantha, Jessica). O relançamento admin cria a lista em modo reconciliação e não regrava nada que existe. O teste está na Task 8.

---

### Task 1: Orçamento de chamadas externas

**Files:**
- Create: `backend/src/services/orcamentoChamadas.ts`
- Modify: `backend/src/services/googleSheetsService.ts` (`sheetsRequest`, `fetchGVizCsv` e o `fetch` do token em `getGoogleAccessToken`): chamar `registrarChamadaExterna()` antes de cada `fetch`
- Test: `scripts/presave-orcamento.test.ts`

**Interfaces:**
- Produces:
  - `iniciarOrcamento(limite: number): void`
  - `registrarChamadaExterna(): void`
  - `chamadasRestantes(): number` (devolve `Infinity` se nenhum orçamento foi iniciado)
  - `encerrarOrcamento(): void`

- [ ] **Step 1: Write the failing test.**
  - `sem orçamento iniciado, chamadasRestantes() === Infinity`.
  - `iniciarOrcamento(5)` e depois 3× `registrarChamadaExterna()` → `chamadasRestantes() === 2`.
  - Depois de `encerrarOrcamento()` → `Infinity`.
  - `nunca fica negativo`: `iniciarOrcamento(1)` e depois 3 registros → `0`.
- [ ] **Step 2: Run, expect FAIL** with module not found: `bash scripts/rodar-testes-isolados.sh scripts/presave-orcamento.test.ts`
- [ ] **Step 3: Implement** `orcamentoChamadas.ts` with module-level state, and hook `registrarChamadaExterna()` into the three `fetch` calls of `googleSheetsService.ts`.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** `feat(presave): contador de chamadas externas por execução`

### Task 2: Tabelas D1 do lançamento

**Files:**
- Create: `backend/src/services/presaveLancamentoDb.ts`
- Test: `scripts/presave-lancamento-db.test.ts` (usa `instalarFakeD1()`)

**Interfaces:**
- Produces:
```ts
export type EstadoPasso = "pendente" | "feito" | "falhou" | "travado";
export const MAX_TENTATIVAS = 6;
export interface PassoNovo { passo: string; ordem: number; procurarAntes: boolean; estado?: "pendente" | "feito"; resultado?: Record<string, unknown> | null }
export interface Passo { campanhaId: string; passo: string; ordem: number; estado: EstadoPasso; tentativas: number; procurarAntes: boolean; resultado: Record<string, unknown> | null; ultimoErro: string | null; atualizadoEm: string }
export interface Lancamento { campanhaId: string; albumTitulo: string; albumTopicId: string; completo: boolean }
export async function criarLancamento(l: Omit<Lancamento, "completo">, passos: PassoNovo[]): Promise<boolean>   // false se já existia (não mexe em nada)
export async function listarPassos(campanhaId: string): Promise<Passo[]>             // ordenado por ordem
export async function marcarFeito(campanhaId: string, passo: string, resultado: Record<string, unknown>): Promise<void>
export async function registrarFalha(campanhaId: string, passo: string, erro: string): Promise<EstadoPasso> // incrementa tentativas, procurar_antes=1; "travado" ao chegar em MAX_TENTATIVAS
export async function lancamentosIncompletos(): Promise<Lancamento[]>
export async function lancamentoEmAndamentoPorAlbum(albumTitulo: string): Promise<string | null> // campanhaId; compara com normalizeComparison
export async function reabrirPassos(campanhaId: string): Promise<number>  // falhou/travado → pendente, tentativas=0, procurar_antes=1; completo=0
export async function marcarCompleto(campanhaId: string): Promise<void>
```
- Tabelas, com `CREATE TABLE IF NOT EXISTS` garantido uma vez por isolate:
  - `presave_lancamentos(campanha_id TEXT PRIMARY KEY, album_titulo TEXT NOT NULL, album_topic_id TEXT NOT NULL, completo INTEGER NOT NULL DEFAULT 0, criado_em TEXT DEFAULT (datetime('now')))`
  - `presave_lancamento_passos(campanha_id TEXT, passo TEXT, ordem INTEGER, estado TEXT, tentativas INTEGER DEFAULT 0, procurar_antes INTEGER DEFAULT 0, resultado_json TEXT, ultimo_erro TEXT, atualizado_em TEXT, PRIMARY KEY(campanha_id, passo))`
  - `criarLancamento` grava tudo num único `db.batch`.

- [ ] **Step 1: Write failing tests:**
  - `criarLancamento é idempotente`: a 2ª chamada devolve `false` e mantém os passos originais.
  - `registrarFalha 5x → "falhou"; 6ª → "travado"`, e `procurarAntes` passa a `true`.
  - `marcarFeito guarda resultado`: `listarPassos()[0].resultado` igual a `{ linha: 899 }`.
  - `lancamentosIncompletos só lista completo=0`.
  - `lancamentoEmAndamentoPorAlbum ignora acento/caixa`: `"jessica johnson - bad behavior"` acha a campanha.
  - `reabrirPassos volta travado para pendente com procurarAntes=true e tentativas=0`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** `presaveLancamentoDb.ts`, using `getCatalogoDb()` like `writeLockService.ts`.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** `feat(presave): tabelas D1 dos passos de lançamento`

### Task 3: Montar a lista de passos (função pura)

**Files:**
- Create: `backend/src/controllers/presaveLancamento/montarPassos.ts`
- Test: `scripts/presave-montar-passos.test.ts`, com fixture `scripts/fixtures/presave-jessica.json`. A fixture é a campanha `PRESAVE-d4fd66d2` em formato `PreSaveCampanha`, com `letra` encurtada, 12 faixas (inéditas 1, 2, 5, 6, 7, 8, 10, 11 e 12; existentes 3, 4 e 9), modo `missao` e `extraMaterialJson` com shop, info e arte ativos.

**Interfaces:**
- Consumes: `PassoNovo` (Task 2), `PreSaveCampanha` (`preSaveController.ts`)
- Produces:
```ts
export function montarPassosLancamento(c: PreSaveCampanha, opts: {
  reconciliacao: boolean;               // true → todo passo nasce procurarAntes=true
  bonusCongelado: number | null;        // null quando modo "contagem"
  albumExistente?: { linhaAlbuns: number; codigoUnicoAlbum: string; albumTopicId: string } | null; // reconciliação: passo "album" nasce "feito" com esse resultado
}): PassoNovo[]
```
- Chaves e ordem: `album`; para cada faixa inédita N (ordem de `num`), `faixa:N:musicas`, `faixa:N:charts`, `faixa:N:codigo`, `faixa:N:registro`; para cada faixa existente N, `vinculo:N`; depois `tracklist`, `extra` (só se algum de shopAtivo/infoAtivo/visualAtivo), `bonus` (só se `modo === "missao"`, com `resultado: { valor }`) e `fechar`.

- [ ] **Step 1: Write failing tests:**
  - `jessica gera 44 passos`: `1 + 9*4 + 3 + tracklist + extra + bonus + fechar`. O primeiro é `album` e o último é `fechar`.
  - `ordem é estritamente crescente`.
  - `bonus leva o valor congelado`: `bonusCongelado: 914002` → `resultado` igual a `{ valor: 914002 }`.
  - `modo contagem não tem passo bonus`.
  - `sem extra ativo não tem passo extra`.
  - `reconciliacao marca procurarAntes em todos`, e com `albumExistente` o `album` nasce `estado: "feito"` com `resultado.codigoUnicoAlbum === "EMPALBM098"`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** `montarPassosLancamento`.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** `feat(presave): monta a lista de passos do lançamento`

### Task 4: Extrair blocos de escrita de `gestaoController.ts` (sem mudar comportamento)

**Files:**
- Modify: `backend/src/controllers/gestaoController.ts`
- Test: `scripts/gestao-blocos-escrita.test.ts`

**Interfaces:**
- Produces (todos exportados de `gestaoController.ts`):
```ts
export function montarLinhaMusicasFaixaInedita(p: { dataFormatada: string; faixa: TrackItemPayload; artistaAlbum: string; albumFullTitle: string; capaUrl: string; jogadorId: string; trackTopicId: string; weeksOverride?: string }): { songTitle: string; linha: GoogleSheetRow; pendente: boolean }
export async function appendRowMusicasSeguro(values: GoogleSheetRow): Promise<number>          // já existe; só exportar
export async function registrarNoRegistroDeMusica(p: { songTitle: string; tipoSingle: string; tipoMusica: string; album: string; artistaPrincipal: string; participantes: string[] }): Promise<void> // LANÇA em falha
export async function registrarInfosMusicas(p: { fullTitle: string; capaUrl: string }): Promise<void> // já existe; só exportar
export async function gravarLinhaAlbumEmAlbuns(p: { dataFormatada: string; albumTopicId: string; capaUrl: string; jogadorId: string; nomeJogador: string; albumFullTitle: string; encartesStr: string; tipoAlbum: string }): Promise<number>
```
- Já exportados e reaproveitados como estão: `registrarNaEdicaoCharts`, `lerCodigoUnicoGerado`, `vincularFaixaExistenteAoAlbum`, `mirrorMusicaRowParaD1`, `registrarAlbumNaEdicaoChartsAlbuns`, `construirTracklistEntries`, `dedupeArtistPrefix`.
- `processarFaixasDoAlbum` passa a montar a linha com `montarLinhaMusicasFaixaInedita`. `registrarFaixaNosCharts` chama `registrarNoRegistroDeMusica` dentro do seu `try/catch`, com o mesmo comportamento de hoje. `publicarAlbum` chama `gravarLinhaAlbumEmAlbuns` dentro da mesma trava `"gestao:edicao-charts-albuns"`.

- [ ] **Step 1: Write failing tests.**
  - `montarLinhaMusicasFaixaInedita` com a faixa 6 da fixture (Shipbait, participante "Samantha Cooper", sem `abrirTopico`) dá:
    - `songTitle === "Jessica Johnson - Shipbait"`;
    - `linha.length === 24`;
    - `linha[8] === "TRACKLIST ALBUM"`, `linha[9] === "SOLO"`, `linha[10] === "Jessica Johnson - Bad Behavior"`, `linha[13] === "Jessica Johnson"`, `linha[14] === "Samantha Cooper"`, `linha[20] === "6"`, `linha[23] === "Sim"`.
  - A faixa 12 com `abrirTopico: true` e `trackTopicId: "musica_x"` dá `linha[1] === "musica_x"`, `linha[5] === "musica_x"` e `linha[23] === "Não"`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Extract** the functions, with no other change to the callers.
- [ ] **Step 4: Run** the new test plus the existing ones that import `gestaoController` (`scripts/testar-chave-musicas-d1.test.ts`, `scripts/rotas-d1-primeiro.test.ts`). Expect PASS.
- [ ] **Step 5: Commit** `refactor(gestao): exporta blocos de escrita de álbum/faixa`

### Task 5: Executores de passo com "procurar antes de gravar"

**Files:**
- Create: `backend/src/controllers/presaveLancamento/busca.ts`
- Create: `backend/src/controllers/presaveLancamento/executores.ts`
- Test: `scripts/presave-executores.test.ts`. Usa `mock.module` de `googleSheetsService.ts` com abas em memória: Musicas, Albuns, EDIÇÃO CHARTS (BD = `"EMP" + (linha-1)`), EDIÇÃO CHARTS ÁLBUMS, REGISTRO DE MÚSICA e Extra_Albuns. `readValuesFresh` pode ser configurado para lançar.

**Interfaces:**
- Consumes: Task 2 (`Passo`), Task 4 (blocos), `PreSaveCampanha`.
- Produces:
```ts
// busca.ts — todas usam readValuesFresh; lançam se a leitura falhar
export async function acharAlbumPorTopico(albumTopicId: string): Promise<{ linhaAlbuns: number; codigoUnicoAlbum: string } | null>
export async function acharFaixaEmMusicas(albumFullTitle: string, num: number): Promise<{ linha: number; codigoUnico: string } | null>  // K==álbum && U==num && H não vazio
export async function acharFaixaEmEdicaoCharts(songTitle: string, albumFullTitle: string): Promise<{ linha: number; codigoUnico: string } | null> // B==título && E==álbum
export async function acharNoRegistro(songTitle: string, albumFullTitle: string): Promise<boolean>

// executores.ts
export interface ContextoLancamento { c: PreSaveCampanha; albumFullTitle: string; dataFormatada: string; passos: Map<string, Passo> }
export async function executarPasso(ctx: ContextoLancamento, p: Passo): Promise<Record<string, unknown>> // resultado p/ marcarFeito; lança em falha
```
- Comportamento por chave, sempre "se `p.procurarAntes`, busca primeiro; achou → devolve o achado sem gravar":
  - `album`: `gravarLinhaAlbumEmAlbuns` com `c.albumTopicId`, depois `registrarAlbumNaEdicaoChartsAlbuns`. Devolve `{ linhaAlbuns, codigoUnicoAlbum }`.
  - `faixa:N:musicas`: `appendRowMusicasSeguro(montarLinhaMusicasFaixaInedita(...).linha)`. Devolve `{ linha, songTitle }`.
  - `faixa:N:charts`: `registrarNaEdicaoCharts` (`null` → lança) e depois `lerCodigoUnicoGerado` (vazio → lança). Devolve `{ linhaCharts, codigoUnico }`.
  - `faixa:N:codigo`: grava `Musicas!Z{linha}`, e `registrarInfosMusicas` se a faixa não é pendente. Depois `await mirrorMusicaRowParaD1(linha)` (false → lança). Devolve `{ codigoUnico }`.
  - `faixa:N:registro`: `registrarNoRegistroDeMusica`.
  - `vinculo:N`: `vincularFaixaExistenteAoAlbum` (`musicasOk=false` → lança), depois acha a linha da faixa por título e roda `await mirrorMusicaRowParaD1`.
  - `tracklist`: `Albuns!M{linhaAlbuns}` = `JSON.stringify(construirTracklistEntries(...))`, via `googleSheetsService.principal.updateValues`, o que dispara o espelho de Albuns no D1. `false` → lança.
  - `extra`: `saveExtraMaterialController` com o `codigoUnicoAlbum` do passo `album`. Resposta não-ok → lança.
  - `bonus`: acha em EDIÇÃO CHARTS ÁLBUMS a linha com `R == codigoUnicoAlbum` (`readValuesFresh`) e grava `resultado.valor` na coluna do cabeçalho "PRE-SAVE". Linha não achada → lança.
  - `fechar`: grava `PreSave_Album!Q{_rowIndex}` = `codigoUnicoAlbum`.
  - Os subpassos de uma faixa leem o `resultado` dos subpassos anteriores pelo `ctx.passos`. Se o anterior não estiver `feito`, lança "dependência pendente".

- [ ] **Step 1: Write failing tests:**
  - `faixa musicas grava uma linha`: Musicas ganha 1 linha com H = `"Jessica Johnson - Shipbait"`.
  - `procurarAntes acha e não grava`: a linha já existe (K = álbum, U = "6") → nenhuma escrita, e o resultado traz a linha existente.
  - `mesmo título, outro número não conta como achado`: existe "Pretty Woman" com U = "4"; a busca da faixa 1 grava.
  - `busca que falha não grava`: `readValuesFresh` lança → `executarPasso` lança e não houve escrita.
  - `charts devolve código pela posição`: a nova linha 1058 dá `codigoUnico === "EMP1057"`.
  - `album usa o tópico reservado`: `Albuns!B` = `c.albumTopicId`.
  - `bonus grava 914002 na coluna PRE-SAVE`.
  - `codigo sem dependência feita lança`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** `busca.ts` and `executores.ts`.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** `feat(presave): executores idempotentes dos passos`

### Task 6: Motor do lançamento (cron, trava, orçamento, status)

**Files:**
- Create: `backend/src/controllers/presaveLancamento/motor.ts`
- Create: `backend/src/controllers/presaveLancamento/protecoes.ts`, só com `avisarPassoTravado` (a Task 9 completa o arquivo)
- Modify: `backend/src/controllers/notificacoesController.ts`: novo `evento: "presave_travado"` em `montarPush` (title "⚠️ Pre-save travado", body com álbum e passo, url `/catalogo`)
- Modify: `backend/src/controllers/preSaveController.ts`: `processarLancamentosPreSaveScheduled` passa a só chamar `executarMotorLancamentos()`. Remover `lancarCampanhaPreSave`, com o mesmo retorno `{ lancados, falhas }`.
- Test: `scripts/presave-motor.test.ts`, com o D1 falso, as abas em memória da Task 5 e um contador de chamadas falso.
- Também produz: `export async function avisarPassoTravado(c: { id: string; albumTituloFull: string }, passo: string, erro: string): Promise<void>`. Chama `registrarNotificacao` para `ADMIN_TG_ID` (de `sessionService.ts`), com `autorId: "sistema"` e `evento: "presave_travado"`, e também `registrarLogSistema`. Nunca lança.

**Interfaces:**
- Consumes: Tasks 1, 2, 3 e 5; `readAllCampanhas`, `writeCampanha`, `aplicarDiasPerdidos`, `calcularAcumulado` (exportar `aplicarDiasPerdidos` e `writeCampanha`); `jaFoiLancadaDeVerdade` e `withWriteLock` (`writeLockService.ts`).
- Produces:
```ts
export const ORCAMENTO_CHAMADAS_PRESAVE = 35;
export async function executarMotorLancamentos(opts?: { orcamento?: number; agora?: Date }): Promise<{ lancados: number; falhas: number; passosFeitos: number }>
```
- Algoritmo:
  1. `iniciarOrcamento(orcamento)`.
  2. Lê as campanhas. Para cada `ativa` com `dataLancamento <= hoje` (Brasília, mesma regex atual) e sem lançamento no D1:
     - se `jaFoiLancadaDeVerdade(id)`, pula. São campanhas antigas, que só entram pelo admin (Task 8);
     - senão, `aplicarDiasPerdidos`, congela o bônus, `montarPassosLancamento(..., { reconciliacao: false })` e `criarLancamento`.
  3. Para cada lançamento de `lancamentosIncompletos()`, dentro de `withWriteLock("presave:lancamento:<id>", ..., { ttlMs: 5*60_000 })`, percorre os passos em ordem:
     - pula os `feito`;
     - se achar um `travado`, para a campanha;
     - antes de cada passo, se `chamadasRestantes() < 10`, encerra toda a execução;
     - `executarPasso`. Sucesso → `marcarFeito`. Falha → `registrarFalha` e para a campanha.
  4. Quando `album` fica `feito` nesta execução: `c.status = "lancada"`, `writeCampanha(c)` e `marcarLancadaDeVerdade(id)`.
  5. Todos os passos `feito` → `marcarCompleto` e log "Ação concluída".
  6. `registrarFalha` devolveu `"travado"` → `avisarPassoTravado` (Task 9).
  7. `encerrarOrcamento()` no `finally`.

- [ ] **Step 1: Write failing tests:**
  - `campanha de 12 faixas completa em várias execuções`: com orçamento pequeno, rodar o motor até `completo`. Musicas termina com exatamente 9 linhas novas do álbum, EDIÇÃO CHARTS com 9, Albuns com 1 e EDIÇÃO CHARTS ÁLBUMS com 1.
  - `status vira lancada quando o álbum existe`: depois da 1ª execução, `PreSave_Album!M` = `"lancada"`, mesmo com faixas pendentes.
  - `retoma sem duplicar após queda`: um mock faz `marcarFeito` lançar uma vez, logo depois da escrita de `faixa:6:musicas`. Na execução seguinte, Musicas tem 1 linha da faixa 6, não 2.
  - `duas execuções simultâneas não duplicam`: `Promise.all([executarMotorLancamentos(), executarMotorLancamentos()])` → nenhuma linha repetida.
  - `campanha antiga com marca no D1 não é tocada`: `jaFoiLancadaDeVerdade` verdadeiro → nenhuma lista criada, nenhuma escrita.
  - `passo travado para a campanha e avisa uma vez`: a escrita de `faixa:6:charts` sempre falha. Depois de 6 execuções o passo está `travado`, `avisarPassoTravado` foi chamado 1 vez e os passos seguintes continuam `pendente`.
  - `avisarPassoTravado não lança mesmo se a notificação falhar`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** `motor.ts` and the change in `preSaveController.ts`.
- [ ] **Step 4: Run the new test plus Tasks 2–5. Expect PASS.**
- [ ] **Step 5: Commit** `feat(presave): motor de lançamento em passos com orçamento`

### Task 7: Cron próprio para o pre-save

**Files:**
- Modify: `wrangler.jsonc`: `"crons": ["*/10 * * * *", "2-59/10 * * * *"]`
- Modify: `src/server.ts`: `scheduled(event, ...)` lê `event.cron`. `"2-59/10 * * * *"` roda **só** o pre-save; o outro roda todo o resto, menos o pre-save.
- Create: `src/cronJobs.ts` com `export const CRON_PRESAVE = "2-59/10 * * * *"; export function ehCronPresave(cron: string | undefined): boolean`
- Test: `scripts/cron-jobs.test.ts`

- [ ] **Step 1: Write failing test:** `ehCronPresave("2-59/10 * * * *") === true`, `ehCronPresave("*/10 * * * *") === false` e `ehCronPresave(undefined) === false`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** `cronJobs.ts`, then move the pre-save `ctx.waitUntil` in `server.ts` into the `ehCronPresave` branch and update `wrangler.jsonc`.
- [ ] **Step 4: Run, expect PASS.** Then `bun install && bun run build` must finish without errors.
- [ ] **Step 5: Commit** `feat(presave): cron próprio, separado dos outros jobs`

### Task 8: Admin: status e relançamento pelo motor

**Files:**
- Modify: `backend/src/controllers/adminRelancarFaixasFaltantesPreSaveController.ts`: reescrever sem comparar títulos
- Modify: `backend/src/routes/api.ts`: nova rota `GET /api/presave/admin/lancamento?campanhaId=` (fica em `isPresavePath`)
- Create: `backend/src/controllers/adminPresaveLancamentoController.ts`
- Test: `scripts/presave-admin.test.ts`

**Interfaces:**
- Consumes: Tasks 2, 3, 5 e 6
- Produces:
  - `adminPresaveLancamentoController(request)`: devolve `{ campanhaId, completo, passos: Passo[] }`.
  - Relançar, `GET ...relancar-faixas-faltantes-presave?campanhaId=&confirmar=1`:
    - se já existe lista, `reabrirPassos`;
    - se não existe, `acharAlbumPorTopico`, tentando o tópico da campanha e, se não achar, o `Código único` em `Albuns!L` = `c.codigoUnicoAlbum`. Depois `montarPassosLancamento({ reconciliacao: true, albumExistente })` e `criarLancamento`. Se o álbum não for achado, recusa (400);
    - em seguida roda `executarMotorLancamentos()` uma vez.
  - Sem `confirmar=1`, só mostra o que faria.

- [ ] **Step 1: Write failing tests:**
  - `campanha antiga vira lista em reconciliação sem regravar nada`: as abas já têm o álbum e as 12 faixas da fixture → depois do relançamento, nenhuma linha nova em nenhuma aba, e todos os passos `feito`.
  - `campanha antiga com 6 faixas faltando grava só as 6`.
  - `álbum não achado → 400 e nada criado`.
  - `reabrir lista existente volta travados para pendente`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** `feat(presave): relançamento admin usa o motor em modo reconciliação`

### Task 9: Bloqueio na Gestão

**Files:**
- Modify: `backend/src/controllers/presaveLancamento/protecoes.ts` (criado na Task 6)
- Modify: `backend/src/controllers/gestaoController.ts`: chamar a proteção no início de:
  - `substituirAlbumController`, pelo título do álbum lido de Albuns;
  - `createSongController`, quando o payload traz álbum;
  - `publicarFaixaPendenteController` **não** é bloqueado, porque só atualiza a linha existente.
- Test: `scripts/presave-protecoes.test.ts`

**Interfaces:**
- Consumes: `lancamentoEmAndamentoPorAlbum` (Task 2)
- Produces:
```ts
export const MENSAGEM_ALBUM_EM_ANDAMENTO = "Esse álbum de pre-save ainda está sendo completado automaticamente. Tente de novo quando o lançamento terminar.";
export async function bloqueioPresave(albumFullTitle: string): Promise<string | null> // mensagem ou null
```
- Os controllers respondem `409` com `{ success: false, error: MENSAGEM_ALBUM_EM_ANDAMENTO }`.

- [ ] **Step 1: Write failing tests:**
  - `album com lançamento incompleto bloqueia`;
  - `album completo não bloqueia`;
  - `album sem pre-save não bloqueia`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** and wire into the two controllers.
- [ ] **Step 4: Run all pre-save tests:** `bash scripts/rodar-testes-isolados.sh scripts/presave-*.test.ts scripts/gestao-blocos-escrita.test.ts scripts/cron-jobs.test.ts`. Expect every line `OK`.
- [ ] **Step 5: Commit** `feat(presave): Gestão não grava em álbum com lançamento em andamento`
