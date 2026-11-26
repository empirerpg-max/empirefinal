# Sala da Empire TV (participação, chat e enquetes) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corrigir, no app de hoje (sem esperar o Beta), a contagem de participação da Empire TV, o chat da sala no celular e criar enquetes do admin dentro do chat.

**Architecture:** Três partes que vão ao ar separadas, na ordem A → B → C. **A (participação):** o app marca os minutos com a sala ou o mini player aberto e manda a cada 5 min; o servidor guarda **uma linha por pessoa por transmissão** no D1 e calcula a % na janela Início–Término (aviso do `transmissao.py` ou botões do admin). A REGISTRO, as faixas da aba "Regras" e o prestígio seguem iguais. **B (chat):** só a tela (`tv.tsx`), com funções puras testáveis para rolagem. **C (enquetes):** tabelas no D1, rotas no Worker, cartão no chat anunciado por mensagem com prefixo no Supabase (mesmo padrão do `RC_ARRIVAL::`).

**Tech Stack:** TanStack Start/React + Tailwind 4 (front), Worker Cloudflare (`backend/src`), D1 `CATALOGO_DB`, Google Sheets (Agenda_TV), Supabase (chat em tempo real), testes `bun test` com `scripts/helpers/fakeD1.ts`.

**Spec:** `docs/superpowers/specs/2026-11-25-reorganizacao-do-app-design.md`, seções 6.19, 6.19.1, 6.19.3 e 6.19.4 (com as decisões de 2026-11-26: só tempo conta; mini player conta; Início/Término do admin).

## Global Constraints

- O app roda no Cloudflare (Workers), não no Telegram (`CLAUDE.md`).
- Botões/pills/tabs com texto: `min-w-0`, `px` real (≥ `px-1`), ícone `shrink-0`, texto `truncate`; barra de abas = fileira rolável (`useDragScroll` + `StickyScrollArrowLeft/Right`), nunca texto cortado com "…" (`CLAUDE.md`).
- Voltar = tela anterior: folha/overlay aberto por cima empurra `history.pushState` com marca própria e fecha no `popstate` (`CLAUDE.md`; padrão em `src/routes/empire-play.index.tsx`).
- Plano gratuito do D1: 100 mil linhas gravadas/dia, 5 milhões lidas/dia. Presença: envio a cada **5 min**, **uma linha por pessoa por transmissão**. Nenhuma tabela nova com índice extra além da chave primária.
- Nenhuma lógica de charts muda.
- Faixas da aba "Regras", gravação na REGISTRO, prestígio `assistir_tv` com **≥ 90%** de presença e a marca em `TV_Participacao_Processada` continuam como hoje.
- **Mensagens de chat não entram na %** (decisão do usuário); só aparecem como informação na planilha.
- Tolerância de queda de conexão: buraco de **até 2 minutos** entre dois minutos presentes conta como presente.
- Transmissões que começaram antes da troca continuam sendo processadas pelo caminho antigo (Presenca_TV).
- Abas novas na planilha não podem ser criadas pela conta de serviço: `Enquetes_TV` precisa ser criada à mão antes da Parte C (só escrita best-effort).
- Commits na branch `claude/nice-euler-1yslj3`.

## Review Focus

1. **Relógio do celular errado** (adiantado/atrasado minutos): a presença tem de cair na janela certa → o cliente manda **idade** de cada marca (ms atrás), e o servidor converte com o próprio relógio. Teste na Task A1/A3.
2. **App antigo em cache** mandando `{ watched_seconds }` no POST de presença: não pode dar erro nem perder a presença → continua gravando na Presenca_TV (caminho antigo). Teste na Task A3.
3. **Jogador sem sessão** (token ausente/expirado): presença usa o `telegram_id` do corpo como hoje; voto em enquete e botões de admin respondem 401/403. Testes nas Tasks A3, A5, C2.
4. **Admin toca Término duas vezes, ou Término sem Início**: não pode creditar duas vezes (a marca de processado já protege) e sem Início usa o início da grade. Teste na Task A5.
5. **Voto depois de encerrada / enquete "resultado só no fim"**: voto fora do prazo → 409; antes do fim, a lista não revela contagem a ninguém, nem ao admin no app. Teste na Task C2.

---

## Parte A — Participação

### Task A1: Cálculo puro da presença

**Files:**
- Create: `backend/src/services/tvPresenca.ts`
- Test: `scripts/tv-presenca.test.ts`

**Interfaces:**
- Produces:
  - `minutosDeIdades(agoraMs: number, idadesMs: number[]): number[]` — minutos Unix (`Math.floor(ms/60000)`), sem repetição, ordenados; ignora idades < 0 ou > 6 h.
  - `unirMinutos(...listas: number[][]): number[]` — união ordenada sem repetição.
  - `codificarMinutos(m: number[]): string` / `lerMinutos(s: string | null): number[]` — texto `"29000000,29000001"`; `lerMinutos` ignora lixo.
  - `calcularPresenca(minutos: number[], inicioMs: number, fimMs: number): { minutosPresentes: number; duracaoMin: number; pct: number; entrouMs: number | null; saiuMs: number | null }` — conta só minutos dentro de `[inicio, fim)`, preenche buracos de até 2 min entre presentes, `pct` arredondado e limitado a 100, `duracaoMin = Math.max(1, ceil((fim-inicio)/60000))`.

- [ ] **Step 1: Write the failing tests**

```ts
import { test, expect } from "bun:test";
const P = await import("../backend/src/services/tvPresenca.ts");
const M = (h: number, m: number) => Date.UTC(2026, 10, 26, h, m) ;
test("idades viram minutos pelo relógio do servidor", () => {
  expect(P.minutosDeIdades(M(20, 10), [0, 60_000, 61_000])).toEqual([M(20,8)/60000, M(20,9)/60000, M(20,10)/60000]);
  expect(P.minutosDeIdades(M(20, 10), [-5, 7 * 3600_000])).toEqual([]);
});
test("buraco de até 2 min conta; de 3 min não", () => {
  const ini = M(20, 0), fim = M(20, 10);
  const mins = [0,1,2,5,9].map((k) => M(20, k) / 60000); // buraco 3-4 (2 min) e 6-8 (3 min)
  expect(P.calcularPresenca(mins, ini, fim)).toMatchObject({ minutosPresentes: 7, duracaoMin: 10, pct: 70 });
});
test("minutos fora da janela não contam e pct limita a 100", () => {
  const ini = M(20, 0), fim = M(20, 2);
  const mins = [-1,0,1,2,3].map((k) => M(20, k) / 60000);
  expect(P.calcularPresenca(mins, ini, fim)).toMatchObject({ minutosPresentes: 2, pct: 100 });
});
test("codificar/ler ida e volta e união", () => {
  expect(P.lerMinutos(P.codificarMinutos([3, 1, 2, 2]))).toEqual([1, 2, 3]);
  expect(P.lerMinutos("x,4,,5")).toEqual([4, 5]);
  expect(P.unirMinutos([1, 3], [2, 3])).toEqual([1, 2, 3]);
});
```

- [ ] **Step 2: Run** `bun test scripts/tv-presenca.test.ts` — Expected: FAIL (módulo não existe).
- [ ] **Step 3: Implement** as funções acima em `backend/src/services/tvPresenca.ts` (sem dependências).
- [ ] **Step 4: Run** `bun test scripts/tv-presenca.test.ts` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(tv): cálculo puro da presença por minuto`

### Task A2: Tabela `tv_presenca` no D1

**Files:**
- Modify: `d1/schema.sql` (acrescentar a tabela)
- Modify: `backend/src/services/tvPresenca.ts`
- Test: `scripts/tv-presenca.test.ts`

**Interfaces:**
- Consumes: A1.
- Produces:
  - `garantirTabelaPresenca(db: D1DatabaseLike): Promise<void>` — `CREATE TABLE IF NOT EXISTS tv_presenca (programa_id TEXT NOT NULL, jogador_id TEXT NOT NULL, nome TEXT, minutos TEXT NOT NULL, atualizado_em INTEGER NOT NULL, PRIMARY KEY (programa_id, jogador_id)) WITHOUT ROWID`; memoizado por isolate.
  - `gravarMinutosPresenca(db, p: { programaId: string; jogadorId: string; nome: string; minutos: number[] }, agoraMs: number): Promise<"gravado" | "sem-novidade">` — lê a linha, une, **só grava se houver minuto novo** (1 leitura + no máximo 1 escrita).
  - `lerPresencaGrupo(db, rowIds: string[]): Promise<Map<string, { nome: string; minutos: number[] }>>` — une as linhas da pessoa em todos os segmentos (`WHERE programa_id IN (...)`, lida pela chave primária).
  - `apagarPresencaAntiga(db, antesDeMs: number): Promise<number>`.

- [ ] **Step 1: Write the failing tests** (com `instalarFakeD1()`): gravar `[1,2]` depois `[2,3]` → linha com `"1,2,3"` e retorno `"gravado"`; gravar `[3]` de novo → `"sem-novidade"` e `atualizado_em` igual; `lerPresencaGrupo(["row_5","row_6"])` com a mesma pessoa nos dois → minutos unidos; `apagarPresencaAntiga` remove só as linhas mais velhas.
- [ ] **Step 2: Run** `bun test scripts/tv-presenca.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** as funções e acrescente o mesmo `CREATE TABLE` em `d1/schema.sql`.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `feat(tv): tabela tv_presenca (uma linha por pessoa por transmissão)`

### Task A3: Rotas de presença (gravar e listar)

**Files:**
- Modify: `backend/src/controllers/tvController.ts` (`registrarPresencaTVController`, `listarPresencaTVController`)
- Test: `scripts/tv-presenca-rotas.test.ts` (use `fakeD1` + `fakePlanilhas`)

**Interfaces:**
- Consumes: A1, A2; `verifySessionToken`, `extractBearerToken` (`backend/src/services/sessionService.ts`); `readProgramas`, `agruparTransmissoes`, `lerEventosReais` (já em `tvController.ts`).
- Produces:
  - `POST /api/tv/presenca` corpo novo `{ programa_id: string; idades_ms: number[]; nome?: string; telegram_id?: string }` → `{ ok: true, resultado: "gravado" | "sem-novidade" }`. Jogador = `sessao.id`; sem sessão, `telegram_id` do corpo. Corpo **antigo** (`watched_seconds` sem `idades_ms`) → caminho de hoje (append na Presenca_TV).
  - `janelaDoGrupo(grupo: BroadcastGroup, eventosReais: Record<string, EventoRealTV>, agoraMs: number): { inicioMs: number; fimMs: number; aoVivo: boolean }` — início real > início estimado (`endTs - totalDuracaoSeg*1000`); fim real > `agoraMs` se ainda ao vivo > `endTs`.
  - `GET /api/tv/presenca?programa_id=` → mesmas linhas de hoje `{ telegram_id, nome, watched_seconds, percentual }[]`, calculadas por `calcularPresenca` sobre o **grupo inteiro** quando houver linha no D1; senão, o cálculo de hoje.

- [ ] **Step 1: Write the failing tests**: (a) POST novo com sessão grava no D1 com o id da sessão, não o do corpo; (b) POST sem sessão usa `telegram_id`; (c) POST antigo `{watched_seconds: 30}` chama o append da Presenca_TV e não toca no D1; (d) relógio: `idades_ms: [0]` sempre vira o minuto do servidor; (e) GET devolve `percentual` igual a `calcularPresenca(...).pct` para a janela do grupo.
- [ ] **Step 2: Run** `bun test scripts/tv-presenca-rotas.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** as mudanças nos dois controllers e `janelaDoGrupo` (exportada).
- [ ] **Step 4: Run** — Expected: PASS. Rode também `bash scripts/rodar-testes-isolados.sh scripts/cron-jobs.test.ts`.
- [ ] **Step 5: Commit** `feat(tv): presença no D1 com relógio do servidor; corpo antigo continua valendo`

### Task A4: Processamento usa o D1 e só o tempo

**Files:**
- Modify: `backend/src/controllers/tvController.ts` (`processarParticipacaoTV`)
- Modify: `src/cronJobs.ts` (limpeza diária)
- Test: `scripts/tv-presenca-processar.test.ts`

**Interfaces:**
- Consumes: A1–A3.
- Produces:
  - `percentualDoJogador(origem: "d1" | "planilha", presencaPct: number, chatPct: number): number` — `"d1"` → `Math.round(presencaPct)`; `"planilha"` → regra de hoje `Math.round(Math.max(presencaPct, chatPct))`.
  - No laço de grupos: se `lerPresencaGrupo(db, grupo.rowIds)` tiver alguém → origem `"d1"` com `janelaDoGrupo`; senão, origem `"planilha"` (código de hoje intacto).
  - Depois de creditar um grupo `"d1"`: **uma** chamada `appendRows` na `Presenca_TV` com uma linha por pessoa: `[agoraISO, grupo.chave, jogadorId, nome, segundosPresentes, minutosPresentes, duracaoMin, pct, mensagensChat, entrouISO, saiuISO]`.
  - Cron: `apagarPresencaAntiga(db, agora - 30 dias)` uma vez por dia.

- [ ] **Step 1: Write the failing tests**: `percentualDoJogador("d1", 40, 100) === 40`; `percentualDoJogador("planilha", 40, 100) === 100`; com fakes, um grupo com D1 grava REGISTRO com a faixa de 70% para quem tem 70% de tempo e 10 mensagens; prestígio só para ≥ 90; uma única chamada `appendRows`.
- [ ] **Step 2: Run** `bun test scripts/tv-presenca-processar.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement**.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `feat(tv): participação pelo tempo presente (D1) e resumo por pessoa na Presenca_TV`

### Task A5: Início e Término pelo admin

**Files:**
- Modify: `backend/src/controllers/tvController.ts` (nova `registrarEventoAdminController`)
- Modify: `backend/src/routes/api.ts` (rota `POST /api/tv/evento-admin`, na lista de rotas e no roteador, junto de `/api/tv/evento-transmissao`)
- Test: `scripts/tv-evento-admin.test.ts`

**Interfaces:**
- Consumes: `requestProvesAdmin` (`sessionService.ts`), `lerEventosReais`/`gravarEventosReais`, `processarParticipacaoTV`, `readProgramas`/`agruparTransmissoes`.
- Produces: `POST /api/tv/evento-admin { programa_id, acao: "inicio" | "fim" }` → acha o grupo que contém `programa_id`, grava `inicioTs`/`fimTs` na **mesma** chave KV `tv-eventos-reais` usada pelo `transmissao.py` (o admin só reforça/corrige), e em `"fim"` roda `processarParticipacaoTV`. 403 sem admin; 400 sem grupo; `"fim"` sem início grava só o fim.

- [ ] **Step 1: Write the failing tests**: não-admin → 403; admin `inicio` grava `inicioTs`; `fim` duas vezes → a segunda não credita de novo (marca de processado); `fim` sem `inicio` → processa com início da grade.
- [ ] **Step 2: Run** `bun test scripts/tv-evento-admin.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement**.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `feat(tv): botões de Início/Término do admin`

### Task A6: Coletor no app (sala + mini player) e telas

**Files:**
- Create: `src/lib/tvPresencaCliente.ts`, `src/components/EmpireTV/PresencaTVTracker.tsx`
- Modify: `src/components/EmpireTV/TvPlayerContext.tsx` (montar o tracker dentro do provider), `src/routes/tv.tsx` (remover o heartbeat de 30 s da `WatchView`; círculo "Sua participação" na faixa da sala; faixa "Só admin" com Início/Término usando `isAdminLogin`), `src/lib/api.ts` (`enviarMinutosPresenca`, `eventoAdminTV`)
- Test: `scripts/tv-presenca-cliente.test.ts`

**Interfaces:**
- Consumes: A3, A5.
- Produces:
  - `class ColetorMinutos { marcar(agoraMs: number): void; pendentes(agoraMs: number): number[] /* idades em ms */; confirmar(): void }` — no máximo uma marca por minuto; `pendentes` não esvazia até `confirmar`.
  - `api.enviarMinutosPresenca(programaId: string, idadesMs: number[], nome: string): Promise<boolean>` — `fetch` com `keepalive: true` e `authHeaders()`.
  - `api.eventoAdminTV(programaId: string, acao: "inicio" | "fim")`.
  - `PresencaTVTracker`: com `watching != null` (sala **ou** mini player) e `!document.hidden`, marca a cada 60 s; envia a cada 5 min, ao esconder a aba (`visibilitychange`) e em `pagehide`; troca de programa envia o que estava pendente antes.

- [ ] **Step 1: Write the failing tests** (`ColetorMinutos`): duas marcas no mesmo minuto → 1 pendente; `pendentes` devolve idades corretas; sem `confirmar`, reenvia; depois de `confirmar`, vazio.
- [ ] **Step 2: Run** `bun test scripts/tv-presenca-cliente.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** o coletor, o tracker, as funções da API e as mudanças de tela (Participantes passa a mostrar o `percentual` do servidor sempre; círculo usa a linha do próprio jogador do mesmo GET).
- [ ] **Step 4: Run** os testes e `npx tsc --noEmit -p .` e `npx vite build` — Expected: PASS / sem erros novos.
- [ ] **Step 5: Commit** `feat(tv): presença conta com a sala ou o mini player; círculo e botões do admin`

---

## Parte B — Chat da sala no celular

### Task B1: Regras de rolagem (funções puras)

**Files:**
- Create: `src/lib/tvChatRolagem.ts`
- Test: `scripts/tv-chat-rolagem.test.ts`

**Interfaces:**
- Produces:
  - `estaNoFim(el: { scrollTop: number; scrollHeight: number; clientHeight: number }, folgaPx = 80): boolean`
  - `pertoDoTopo(scrollTop: number, limitePx = 120): boolean`
  - `decidirAoChegar(noFim: boolean, minha: boolean, novasAntes: number): { rolar: boolean; novas: number }` — rola se estava no fim ou a mensagem é minha (zera); senão soma 1.

- [ ] **Step 1: Write the failing tests** cobrindo os três casos de `decidirAoChegar` e os limites (exatamente 80 px / 120 px).
- [ ] **Step 2: Run** `bun test scripts/tv-chat-rolagem.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement**.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `feat(tv): regras de rolagem do chat`

### Task B2: Chat que não puxa, "↓ N novas" e antigas ao rolar

**Files:**
- Modify: `src/routes/tv.tsx` (`ChatPanel`: efeito de auto-scroll ~linha 1182, `loadOlderMessages` ~1135, botão "Carregar mensagens mais antigas" ~1398)

**Interfaces:**
- Consumes: B1.
- Produces: estado `novas: number`; botão flutuante "↓ {novas} novas" (`min-h-[40px] px-3`, some ao chegar no fim); `onScroll` chama `loadOlderMessages()` quando `pertoDoTopo` e `hasMoreHistory` (mantendo a posição como hoje); o botão "Carregar mensagens mais antigas" sai.

- [ ] **Step 1:** Implement com B1.
- [ ] **Step 2: Verify** `npx tsc --noEmit -p .` e `npx vite build` sem erros novos; no dev (`npx vite dev`), com Playwright em 390×844: rolar para cima numa sala com 60+ mensagens, inserir mensagem de outro usuário → não rola e aparece "↓ 1 novas"; rolar ao topo → carrega mais sem pular.
- [ ] **Step 3: Commit** `feat(tv): chat não puxa quem está lendo; novas e antigas automáticas`

### Task B3: Mensagens compactas, arrastar para responder, segurar para copiar

**Files:**
- Modify: `src/routes/tv.tsx` (render da mensagem em `ChatPanel`)
- Create: `src/hooks/useArrastarParaResponder.ts`

**Interfaces:**
- Produces: `useArrastarParaResponder(onResponder: () => void, limitePx = 50)` → handlers de pointer que deslocam a mensagem até 70 px para a esquerda e chamam `onResponder` ao soltar além do limite; toque longo (500 ms) abre menu com **Responder** e **Copiar texto**. Layout: foto 24 px, **nome e texto na mesma linha**, citação em cima; pílula "chegou ao Red Carpet", GIFs, negrito/itálico e mensagens pendentes continuam iguais. Reações com emoji **ficam fora** desta entrega (precisam de tabela nova no Supabase).

- [ ] **Step 1:** Implement.
- [ ] **Step 2: Verify** build + Playwright (touch emulado) arrastando uma mensagem 60 px → barra "Respondendo a …" aparece; 30 px → nada.
- [ ] **Step 3: Commit** `feat(tv): chat compacto com arrastar para responder`

### Task B4: Layout da sala: vídeo fixo, faixa fina, deitado

**Files:**
- Modify: `src/routes/tv.tsx` (`WatchView`, ~linhas 737–995)

**Interfaces:**
- Produces: no celular, vídeo 16:9 sempre no topo; abaixo, **faixa fina** (título truncado + "N assistindo" + círculo da A6) e a fileira de abas existente compacta (rolável, regras do `CLAUDE.md`); o chat ocupa o resto. A lógica de teclado de hoje (`useVisualViewport`) continua: ao digitar, encolhe o chat, nunca o vídeo. Com `(orientation: landscape) and (max-height: 500px)`: vídeo em tela cheia e o chat numa coluna à direita (38%, fundo `bg-black/55`), sem abas. Voltar do celular sai do modo deitado antes de sair da sala (padrão `history.pushState` do `CLAUDE.md`).

- [ ] **Step 1:** Implement.
- [ ] **Step 2: Verify** build + Playwright 390×844 e 844×390: vídeo visível em ambos; com o teclado simulado (`visualViewport` menor), o vídeo não some.
- [ ] **Step 3: Commit** `feat(tv): sala com vídeo fixo no topo e modo deitado`

---

## Parte C — Enquetes no chat

### Task C1: Tabelas e apuração

**Files:**
- Create: `backend/src/services/tvEnquetes.ts`
- Modify: `d1/schema.sql`
- Test: `scripts/tv-enquetes.test.ts`

**Interfaces:**
- Produces:
  - Tabelas: `tv_enquete (id TEXT PRIMARY KEY, programa_id TEXT NOT NULL, pergunta TEXT NOT NULL, tipo TEXT NOT NULL CHECK (tipo IN ('unica','multipla')), opcoes TEXT NOT NULL, secreto INTEGER NOT NULL, so_fim INTEGER NOT NULL, encerra_em INTEGER, aberta INTEGER NOT NULL, criada_em INTEGER NOT NULL, encerrada_em INTEGER, criada_por TEXT)` e `tv_enquete_voto (enquete_id TEXT NOT NULL, jogador_id TEXT NOT NULL, nome TEXT, opcoes TEXT NOT NULL, votado_em INTEGER NOT NULL, PRIMARY KEY (enquete_id, jogador_id)) WITHOUT ROWID`.
  - `apurar(nOpcoes: number, votos: number[][]): { contagem: number[]; pct: number[]; total: number; vencedores: number[] }` — `total` = número de pessoas; `pct` sobre pessoas (múltipla pode somar > 100); empate → vários vencedores; sem votos → `vencedores: []`.
  - `criarEnquete(db, e: { programaId; pergunta; tipo; opcoes: string[]; secreto; soFim; encerraEmMs: number | null; criadaPor }, agoraMs): Promise<string>` (2 a 10 opções, pergunta 1–140 caracteres, opção 1–60).
  - `votar(db, enqueteId, jogadorId, nome, opcoes: number[], agoraMs): Promise<"ok" | "encerrada" | "invalida">` — única exige 1 opção; troca de voto permitida enquanto aberta (upsert).
  - `encerrar(db, enqueteId, agoraMs): Promise<boolean>`; `listarEnquetes(db, programaId, jogadorId | null, agoraMs)` — fecha as vencidas por `encerra_em`; com `so_fim && aberta` devolve `contagem: null`.

- [ ] **Step 1: Write the failing tests** para `apurar` (única, múltipla, empate, vazio), validações de `criarEnquete`, `votar` (única com 2 opções → invalida; depois de encerrar → encerrada; troca de voto mantém 1 linha), `listarEnquetes` escondendo contagem com `so_fim` e fechando a vencida.
- [ ] **Step 2: Run** `bun test scripts/tv-enquetes.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement**.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `feat(tv): enquetes do chat no D1`

### Task C2: Rotas e aviso no chat

**Files:**
- Modify: `backend/src/controllers/tvController.ts` (controllers `criarEnqueteChatController`, `votarEnqueteChatController`, `encerrarEnqueteChatController`, `listarEnquetesChatController`), `backend/src/routes/api.ts`
- Modify: `registrarEventoAdminController` (A5): no `"fim"`, encerra as enquetes abertas do grupo.
- Test: `scripts/tv-enquetes-rotas.test.ts`

**Interfaces:**
- Consumes: C1, `requestProvesAdmin`, `verifySessionToken`, `getSupabaseCreds` (já em `tvController.ts`).
- Produces:
  - `POST /api/tv/enquetes` (admin) → `{ ok, id }` e insere no Supabase `tv_chat_messages` a mensagem `ENQ::{id}` (usuário "Empire TV").
  - `POST /api/tv/enquetes/votar` (sessão) → 200 / 401 sem sessão / 409 encerrada / 400 inválida.
  - `POST /api/tv/enquetes/encerrar` (admin) → insere `ENQRES::{id}` no chat e grava, best-effort, as linhas na aba `Enquetes_TV` (`[data, programa, pergunta, tipo, opção, votos, %]`), numa chamada `appendRows`.
  - `GET /api/tv/enquetes?programa_id=` → lista para o arquivo da sala e para os cartões.

- [ ] **Step 1: Write the failing tests**: criar sem admin → 403; votar sem sessão → 401; votar encerrada → 409; encerrar grava uma chamada `appendRows` e uma inserção no Supabase (fetch simulado); falha do Supabase não impede a criação.
- [ ] **Step 2: Run** `bun test scripts/tv-enquetes-rotas.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement**.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `feat(tv): rotas das enquetes e aviso no chat`

### Task C3: Telas das enquetes

**Files:**
- Create: `src/components/EmpireTV/EnqueteChat.tsx` (cartão), `src/components/EmpireTV/NovaEnqueteSheet.tsx`, `src/components/EmpireTV/ArquivoEnquetes.tsx`
- Modify: `src/routes/tv.tsx` (`ChatPanel`: renderizar `ENQ::`/`ENQRES::` como cartão, como faz com `RC_ARRIVAL::`; botão 📊 no composer só para `isAdminLogin`; aba "📊 Enquetes" na fileira de abas), `src/lib/api.ts`

**Interfaces:**
- Consumes: C2.
- Produces: cartão com pergunta, tipo, "voto secreto", opções (círculo = única, quadrado = múltipla + botão **Votar**), barras com % depois de votar (ou "resultado no fim"), "Encerrar" para admin; cartão de resultado com vencedor 🏆. Atualiza a cada 15 s **só enquanto o cartão está na tela** (`IntersectionObserver`). A folha de nova enquete e o arquivo abrem por cima com `history.pushState` (voltar fecha só eles). Enquete aberta fica fixada no topo do chat. A enquete de nota da planilha (`EnqueteBanner`) continua igual.

- [ ] **Step 1:** Implement.
- [ ] **Step 2: Verify** build + Playwright: admin cria enquete múltipla com 3 opções → cartão aparece; jogador vota 2 opções → barras; admin encerra → cartão de resultado; voltar do celular com a folha aberta fecha só a folha.
- [ ] **Step 3: Commit** `feat(tv): enquetes no chat (criar, votar, resultado, arquivo)`

---

## Antes de ir ao ar

- [ ] Rodar todos os testes novos e os existentes: `bash scripts/rodar-testes-isolados.sh scripts/*.test.ts`.
- [ ] `npx tsc --noEmit -p .` e `npx vite build` sem erros novos.
- [ ] Pedir ao usuário: criar a aba `Enquetes_TV` na planilha Agenda_TV (cabeçalho `Data | Programa | Pergunta | Tipo | Opção | Votos | %`).
- [ ] Deploy só com o OK do usuário; acompanhar a primeira transmissão: Participantes deve mostrar o mesmo número gravado na REGISTRO.
