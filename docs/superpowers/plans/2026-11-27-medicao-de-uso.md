# Medição de uso (fase 0a) — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Medir, no app de hoje (versão "anterior"), quais telas e ações os
jogadores usam, para ter ~4 semanas de base antes do Beta, e mostrar isso ao
admin numa tela "Uso do app".

**Architecture:** O app junta contagens **na memória** (telas abertas, ações
feitas, caminho tela→ação) e envia **em lote a cada 5 min** e ao esconder a
página (`navigator.sendBeacon` para `POST /api/uso`). O servidor soma num
único `db.batch` de `INSERT … ON CONFLICT DO UPDATE` nas tabelas D1
`uso_diario`, `uso_jogador_dia` e `uso_jogador_tela_dia`. As ações são
contadas **na camada de rede** (o `fetch` que o `__root.tsx` já envolve):
todo `POST /api/...` bem-sucedido vira uma ação pelo caminho normalizado,
então nenhuma tela precisa ser alterada e nenhuma ação fica de fora. A tela
admin lê só a tabela somada.

**Tech Stack:** TanStack Start/Router, React 19, Tailwind 4, Cloudflare
Workers + D1 + KV, `bun test` com `scripts/helpers/fakeD1.ts`.

**Spec:** `docs/superpowers/specs/2026-11-25-reorganizacao-do-app-design.md`
seção **6.15** (Medição de uso), com o ajuste de custo de
`docs/superpowers/specs/2026-11-27-orcamento-d1-e-requisicoes.md` seção 3
(envio a cada **5 min**, não 2).

## Global Constraints

- O app roda no Cloudflare Workers, não no Telegram (`CLAUDE.md`).
- **Nada visível muda para o jogador.** A única tela nova é só para admin.
- **Não medir:** conteúdo de comentários/posts, texto de busca, corpo de
  requisições, dados pessoais. O id do jogador só entra nas tabelas de
  "jogadores distintos" (`uso_jogador_dia`, `uso_jogador_tela_dia`).
- Envio em lote: a cada **5 min** e em `pagehide`/`visibilitychange→hidden`;
  nunca uma requisição por clique.
- Guardar **90 dias**; limpeza diária no cron (mesmo padrão de
  `limparPresencaTVDiaria` em `src/server.ts`).
- Liga/desliga sem deploy: chave `medicaoUso` dentro do KV `home-config`
  (`{ "medicaoUso": { "enabled": true } }`); ausente = ligado.
- Versão: `"anterior"` em tudo nesta fase (o Beta passa a mandar `"beta"`).
- Aparelho pela largura da janela: `< 768` celular, `< 1024` tablet, senão
  computador.
- Regras do `CLAUDE.md` valem na tela admin (botões com `min-w-0`, padding,
  ícone `shrink-0`, texto `truncate`; fileiras de abas roláveis, nunca "…";
  voltar = tela anterior).
- Nenhuma lógica de charts é alterada.
- Plano gratuito: cada envio = 1 requisição; gravações ≈ chaves distintas do
  lote. Meta: ≤ 60 gravações por jogador ativo por dia.

## Review Focus

1. **Requisição que falha ou demora**: o contador de ações só conta
   resposta `ok`; erro de rede não conta e nunca quebra a chamada original
   (o wrapper devolve a mesma `Response`).
2. **Página fechada antes dos 5 min**: o lote pendente vai por
   `sendBeacon` no `pagehide`; um lote vazio não envia nada.
3. **Jogador sem login** (tela de login, convidado): telas contam; as
   tabelas de "jogadores distintos" não recebem nada.
4. **Medição desligada no KV**: o servidor responde `{ ok: true, ativo: false }`
   sem gravar, e o app para de enviar até recarregar.
5. **Lote malformado ou gigante** (cliente antigo, abuso): o servidor
   aceita no máximo 200 entradas por lote, `alvo` com até 120 caracteres e
   `n` inteiro de 1 a 1000; o resto é descartado sem erro 500.

---

## Arquivos

| Arquivo | Responsabilidade |
|---|---|
| `backend/src/services/usoService.ts` (novo) | tabelas, validar e gravar lote, resumo para o admin, limpeza de 90 dias |
| `backend/src/controllers/usoController.ts` (novo) | `POST /api/uso`, `GET /api/uso/resumo` (admin) |
| `backend/src/routes/api.ts` | registrar as duas rotas |
| `src/server.ts` | limpeza diária (`limparUsoDiaria`) |
| `d1/schema.sql` | as três tabelas (documentação; criadas em tempo de execução) |
| `src/lib/uso/coletor.ts` (novo) | acumular contagens, normalizar caminhos, montar o lote (puro, testável) |
| `src/lib/uso/envio.ts` (novo) | relógio de 5 min, `sendBeacon`, chave do dia, "já mandei hoje" |
| `src/routes/__root.tsx` | ligar: tela aberta (roteador) e ações (wrapper de `fetch` que já existe) |
| `src/components/EmpirePlay/PlayerContext.tsx` | ação "tocar música" em `playSong` |
| `src/routes/uso-do-app.tsx` (novo) | tela admin "Uso do app" |
| `src/routes/perfil.tsx` | link "Uso do app (admin)" ao lado de "Gestão de usuários (admin)" |
| `src/lib/api.ts` | `api.resumoUso(dias)` |
| `docs/medicao-de-uso.md` (novo) + `CLAUDE.md` | manual de manutenção |
| `scripts/uso-service.test.ts`, `scripts/uso-rotas.test.ts`, `scripts/uso-coletor.test.ts` | testes |

---

### Task 1: Serviço de uso no D1

**Files:**
- Create: `backend/src/services/usoService.ts`
- Modify: `d1/schema.sql` (acrescentar as 3 tabelas)
- Test: `scripts/uso-service.test.ts`

**Interfaces:**
- Produces:
  - `type EventoUso = { evento: "tela" | "acao" | "caminho"; alvo: string; n: number }`
  - `type LoteUso = { versao: "anterior" | "beta"; aparelho: "celular" | "tablet" | "computador"; eventos: EventoUso[]; telas?: string[] }`
  - `garantirTabelasUso(db: D1DatabaseLike): Promise<void>`
  - `limparLote(bruto: unknown): LoteUso | null` — valida e corta (Review Focus 5)
  - `gravarLoteUso(db, lote: LoteUso, jogadorId: string | null, agoraMs: number): Promise<{ gravadas: number }>`
  - `resumoUso(db, deDia: string, ateDia: string): Promise<ResumoUso>`
  - `type ResumoUso = { jogadores: number; telas: { alvo: string; n: number; jogadores: number }[]; acoes: { alvo: string; n: number }[]; caminhos: { alvo: string; n: number }[]; porAparelho: { aparelho: string; n: number }[] }`
  - `apagarUsoAntigo(db, antesDoDia: string): Promise<number>`
  - `diaUTC(ms: number): string` → `"2026-11-27"`

Tabelas (`WITHOUT ROWID`, chaves pensadas para a soma e para ler por dia):
```sql
CREATE TABLE IF NOT EXISTS uso_diario (
  dia TEXT NOT NULL, versao TEXT NOT NULL, aparelho TEXT NOT NULL,
  evento TEXT NOT NULL, alvo TEXT NOT NULL, contagem INTEGER NOT NULL,
  PRIMARY KEY (dia, versao, aparelho, evento, alvo)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS uso_jogador_dia (
  dia TEXT NOT NULL, jogador TEXT NOT NULL, versao TEXT NOT NULL,
  PRIMARY KEY (dia, jogador)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS uso_jogador_tela_dia (
  dia TEXT NOT NULL, tela TEXT NOT NULL, jogador TEXT NOT NULL,
  PRIMARY KEY (dia, tela, jogador)) WITHOUT ROWID;
```

- [ ] **Step 1: Write the failing tests** (`scripts/uso-service.test.ts`, padrão de `scripts/tv-presenca.test.ts` com `instalarFakeD1`)

```ts
test("dois lotes do mesmo dia somam a contagem", async () => {
  await U.gravarLoteUso(db, { versao: "anterior", aparelho: "celular", eventos: [{ evento: "tela", alvo: "/charts", n: 2 }] }, null, T);
  await U.gravarLoteUso(db, { versao: "anterior", aparelho: "celular", eventos: [{ evento: "tela", alvo: "/charts", n: 3 }] }, null, T);
  expect(linhas("uso_diario")).toEqual([{ dia: "2026-11-27", versao: "anterior", aparelho: "celular", evento: "tela", alvo: "/charts", contagem: 5 }]);
});
test("jogador conta uma vez por dia e uma vez por tela por dia", async () => { /* 2 lotes com telas ["/charts","/forum"] → uso_jogador_dia 1 linha, uso_jogador_tela_dia 2 linhas */ });
test("sem jogador não grava nas tabelas de jogadores", async () => { /* jogadorId null → 0 linhas nelas */ });
test("limparLote corta e descarta o inválido", () => {
  expect(U.limparLote({ versao: "x" })).toBeNull();
  const l = U.limparLote({ versao: "anterior", aparelho: "celular", eventos: [
    ...Array(250).fill({ evento: "tela", alvo: "/a", n: 1 }),
    { evento: "hack", alvo: "/b", n: 1 }, { evento: "acao", alvo: "x".repeat(500), n: 1 }, { evento: "acao", alvo: "/c", n: 5000 }] });
  expect(l!.eventos.length).toBe(200);
  expect(l!.eventos.every((e) => e.alvo.length <= 120 && e.n >= 1 && e.n <= 1000)).toBe(true);
});
test("resumoUso soma o período, conta jogadores distintos e ordena por n", async () => { /* 2 dias, 2 aparelhos → telas ordenadas desc, jogadores por tela */ });
test("apagarUsoAntigo remove só dias anteriores ao corte", async () => { /* 3 tabelas */ });
```

- [ ] **Step 2: Run to verify it fails**
Run: `bun test scripts/uso-service.test.ts` — Expected: FAIL (módulo não existe).

- [ ] **Step 3: Implement `usoService.ts`**
`gravarLoteUso` monta **um** `db.batch` com um `INSERT … ON CONFLICT(dia,versao,aparelho,evento,alvo) DO UPDATE SET contagem = contagem + excluded.contagem` por evento (somando antes, no próprio lote, eventos repetidos) e `INSERT OR IGNORE` para jogador/telas. `gravadas` = número de instruções. `resumoUso` usa `WHERE dia BETWEEN ? AND ?` (a chave começa por `dia`).

- [ ] **Step 4: Run tests** — `bun test scripts/uso-service.test.ts` → PASS.

- [ ] **Step 5: Acrescentar as tabelas em `d1/schema.sql` e commit**
```bash
git add backend/src/services/usoService.ts d1/schema.sql scripts/uso-service.test.ts
git commit -m "uso: serviço D1 da medição de uso (soma em lote, jogadores distintos, resumo, limpeza)"
```

### Task 2: Rotas `/api/uso` e limpeza diária

**Files:**
- Create: `backend/src/controllers/usoController.ts`
- Modify: `backend/src/routes/api.ts` (lista `supportedPaths` e o `switch`), `src/server.ts` (limpeza diária)
- Test: `scripts/uso-rotas.test.ts` (roda por `bash scripts/rodar-testes-isolados.sh`)

**Interfaces:**
- Consumes: Task 1.
- Produces:
  - `registrarUsoController(request: Request): Promise<Response>` — `POST /api/uso`. Corpo = `LoteUso` em JSON (o `sendBeacon` manda `text/plain`; ler com `request.text()` + `JSON.parse`). Jogador = sessão (`verifySessionToken(extractBearerToken(request))?.id`), senão `null`. O `sendBeacon` não manda cabeçalho: aceitar também `token` no corpo (`{ ..., token }`) e verificar do mesmo jeito. Respostas: `{ ok: true, ativo: true, gravadas }`; desligado → `{ ok: true, ativo: false }` sem gravar; lote inválido → `400 { ok: false }`; sem D1 → `503`.
  - `resumoUsoController(request: Request): Promise<Response>` — `GET /api/uso/resumo?de=AAAA-MM-DD&ate=AAAA-MM-DD`, só admin (`requestProvesAdmin`), senão 403. Período máximo 90 dias.
  - `medicaoUsoLigada(flags: FlagsKvLike | undefined): Promise<boolean>` — lê `home-config`, `medicaoUso.enabled !== false`.
  - Em `src/server.ts`: `limparUsoDiaria` com a chave KV `uso-limpeza-dia`, uma vez por dia, `apagarUsoAntigo(db, diaUTC(agora − 90 dias))`.

- [ ] **Step 1: Write the failing tests** (mock de `sessionService` como em `scripts/tv-presenca-rotas.test.ts`)
  - "POST com sessão grava e conta o jogador"; "POST sem sessão grava só as contagens"; "POST com `token` no corpo (beacon) identifica o jogador"; "KV com `medicaoUso.enabled=false` responde ativo:false e não grava"; "corpo inválido → 400"; "resumo sem admin → 403; com admin devolve o `ResumoUso` do período".
- [ ] **Step 2:** `bash scripts/rodar-testes-isolados.sh scripts/uso-rotas.test.ts` → FAIL.
- [ ] **Step 3: Implementar o controller, registrar as rotas e a limpeza diária.**
- [ ] **Step 4:** o mesmo comando → PASS; `bunx tsc --noEmit -p .` sem erro novo (o de `adminAlbunsD1Controller.ts:175` já existia).
- [ ] **Step 5: Commit**
```bash
git commit -m "uso: rotas POST /api/uso e GET /api/uso/resumo (admin) + limpeza de 90 dias"
```

### Task 3: Coletor no app (puro)

**Files:**
- Create: `src/lib/uso/coletor.ts`
- Test: `scripts/uso-coletor.test.ts`

**Interfaces:**
- Produces:
  - `class ColetorUso` com `tela(alvo: string)`, `acao(alvo: string, telaAtual: string | null)` (conta `acao` e `caminho` = `"${alvo} ← ${telaAtual}"`), `retirarLote(versao, aparelho): LoteUso | null` (zera; `null` se vazio), `telasDoDia(): string[]`.
  - `normalizarCaminhoApi(url: string): string | null` — só `/api/...`; tira a query; troca segmentos que parecem id (`/^\d+$/`, `/^[0-9a-f-]{16,}$/i`, `/^[A-Z]{2,}[-_][A-Za-z0-9-]+$/`, `%`-codificados) por `:id`; devolve `null` para `/api/uso`, `/api/log-error`, `/api/flags`.
  - `acaoDaRequisicao(metodo: string, url: string, ok: boolean): string | null` — `POST/PUT/PATCH/DELETE` com `ok` → `normalizarCaminhoApi(url)`; `GET /api/busca` → `"buscar"` (no máximo 1 a cada 10 s, controlado pelo coletor); resto `null`.
  - `telaDaRota(routeId: string, search: Record<string, unknown>): string` — `routeId` do TanStack (`"/artistas/$nome/"`), mais `" › " + valor` de `aba`, `tab` ou `view` se forem texto curto (≤ 30, sem dígitos longos).
  - `aparelhoPelaLargura(px: number): "celular" | "tablet" | "computador"`.

- [ ] **Step 1: Write the failing tests** — cobrir: soma de telas iguais; `caminho` com e sem tela; `retirarLote` vazio → `null` e zera depois de retirar; `normalizarCaminhoApi("/api/social/posts/POST-abc123/deletar?x=1")` → `"/api/social/posts/:id/deletar"`; `"/api/uso"` → `null`; `acaoDaRequisicao("GET","/api/charts",true)` → `null`; `("POST","/api/forum/comment",false)` → `null`; busca limitada a 1 por 10 s; `telaDaRota("/charts", { tab: "Global 100" })` → `"/charts › Global 100"`; `aparelhoPelaLargura(767/768/1024)`.
- [ ] **Step 2:** `bun test scripts/uso-coletor.test.ts` → FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4:** → PASS.
- [ ] **Step 5: Commit** `uso: coletor puro (telas, ações pela rede, caminho, normalização)`.

### Task 4: Ligar no app (envio, telas, ações, tocar música)

**Files:**
- Create: `src/lib/uso/envio.ts`
- Modify: `src/routes/__root.tsx` (dentro do efeito que já instala `fetchComSessao`; e um `useRouterState` para a tela atual), `src/components/EmpirePlay/PlayerContext.tsx` (`playSong` → `uso.acao("tocar_musica", tela)`)

**Interfaces:**
- Consumes: Tasks 2 e 3.
- Produces: `iniciarMedicaoUso(): { tela(alvo), acao(alvo), parar() }` (singleton em `envio.ts`); `usoGlobal()` para quem não tem acesso ao objeto (o `PlayerContext`).

Regras: intervalo de **5 min** com a página visível; `sendBeacon("/api/uso", Blob(JSON, text/plain))` no `pagehide` e no `visibilitychange→hidden`; inclui `token` da sessão salva (`getStoredSessionToken()`); `telas` do lote = telas novas do dia ainda não mandadas (lembrar em `localStorage` `uso-telas-AAAA-MM-DD`, apagar dias velhos; tudo em `try/catch`). Resposta `ativo:false` → `parar()`. O wrapper de `fetch` conta a ação **depois** de ter a resposta e devolve a **mesma** `Response` (nunca lê o corpo).

- [ ] **Step 1: Implementar e ligar.**
- [ ] **Step 2: Verificar no navegador** (build + `wrangler dev` local, Playwright, como na sala da TV): navegar por 3 telas e fazer 1 POST simulado; esconder a página → exatamente **1** `POST /api/uso` com `eventos` contendo as 3 telas e a ação; nenhum outro pedido extra; nenhuma tela muda visualmente (captura antes/depois de `/`, `/charts`, `/perfil` idênticas).
- [ ] **Step 3: Rodar todos os testes** — `bun test scripts/` (os 2 `testar-espelho-*` precisam de CSV e já falhavam) e `bash scripts/rodar-testes-isolados.sh` → tudo OK; `bun run build` OK.
- [ ] **Step 4: Commit** `uso: medir telas e ações no app (lote a cada 5 min + ao esconder)`.

### Task 5: Tela admin "Uso do app"

**Files:**
- Create: `src/routes/uso-do-app.tsx`
- Modify: `src/routes/perfil.tsx` (link ao lado de "Gestão de usuários (admin)"), `src/lib/api.ts` (`resumoUso(de, ate): Promise<ResumoUso | null>`)

Conteúdo (espelha o protótipo, página "Uso do app"): fileira rolável de período **Esta semana · Semana anterior · Últimos 30 dias** (`useDragScroll` + setas, como `social.tsx`); 3 números (jogadores distintos, telas abertas, ações); "Telas mais abertas" (barra + número + jogadores); "Ações principais" com nome amigável (`/api/forum/comment` → "Comentar no Fórum", `/api/social/posts` → "Postar no Social", `/api/social/curtir` → "Curtir post", `/api/ponto/:id` → "Ponto", `/api/gestao/faixa/publicar` → "Publicar faixa", `tocar_musica` → "Tocar música", `buscar` → "Buscar"; o resto mostra o caminho); "Por aparelho"; "De onde vêm as ações" (top 10 caminhos). Estados de carregando, vazio ("Ainda sem dados: a medição começa a contar a partir de hoje") e erro com "Tentar de novo" (`LoadErrorState`). Não admin → "Página não encontrada." (como `/tv-teste-hls`).

- [ ] **Step 1: Implementar.**
- [ ] **Step 2: Verificar no navegador** com resposta simulada: 390 px e 1300 px, sem texto saindo de botão, fileira de período rolável, voltar volta para o Perfil.
- [ ] **Step 3: Commit** `uso: tela admin Uso do app`.

### Task 6: Documentar, publicar e conferir

**Files:**
- Create: `docs/medicao-de-uso.md` (o que mede e o que não mede; tabelas; como ligar/desligar no KV; custo; como ler; como mudar o intervalo)
- Modify: `CLAUDE.md` (uma linha apontando o manual), `docs/superpowers/specs/2026-11-25-reorganizacao-do-app-design.md` (fase 0a ✅ com o commit)

- [ ] **Step 1: Escrever os documentos.**
- [ ] **Step 2: Revisão final do conjunto** (subagente revisor do branch inteiro).
- [ ] **Step 3: Abrir PR** e, com o OK do usuário, merge fora do horário de transmissão.
- [ ] **Step 4: Conferir em produção** (no dia seguinte): `SELECT COUNT(*) FROM uso_diario` > 0, painel do D1 com gravações dentro da meta (≤ 60 por jogador ativo), tela "Uso do app" mostrando dados.
