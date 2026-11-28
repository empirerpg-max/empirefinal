# Fase 1a — Base do Beta test (chave, escolha de versão, reportes) — plano

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** criar a "tomada" do Beta test: a chave do admin, a escolha de versão de cada jogador (servidor + aparelho), o formulário "Reportar um problema", a lista de reportes do admin e a faixa fina na versão anterior. **Com a chave desligada, nada muda para os jogadores.**

**Architecture:** a chave fica numa chave própria do KV (`beta-config`); a escolha e os reportes ficam no D1 (`beta_jogador`, `beta_reporte`). O app pergunta o estado uma vez ao abrir (`GET /api/beta/estado`), guarda no aparelho para abrir rápido e expõe tudo por um `BetaProvider`. Nesta fase as duas versões ainda usam a mesma casca; o Beta só ganha o selo **BETA** no topo com a folha "Você está no Beta test". A casca nova vem na fase 1b.

**Tech Stack:** TanStack Start/Router, React 19, React Query, Tailwind 4, Cloudflare Workers + D1 + KV, testes `bun:test` (D1 falso em `scripts/helpers/fakeD1`).

**Spec:** `docs/superpowers/specs/2026-11-25-reorganizacao-do-app-design.md` — seções **6.11** (Beta test), 6.15 (medição: "volta do Beta"), 8 (fase 1). Peças: `docs/beta-fundacoes.md`.

## Como a fase 1 foi dividida

A fase 1 do design é grande demais para um plano só. São três planos, cada um vai ao ar sozinho:

| Parte | O que entrega | Visível para jogadores? |
|---|---|---|
| **1a (este plano)** | chave do admin, escolha de versão, reportes, faixa na versão anterior, selo BETA | não, enquanto a chave estiver **desligada** (padrão) |
| 1b | casca nova: topo (logo + beta, ＋, sino, foto), barra de 5 abas / trilho / barra lateral (6.10), folha Criar (5.7.1), Meu Império (5.8), fileiras de abas do Início e do Social › Imprensa, faixa "Vendo como" (6.18), 404 em português (6.9), textos de Telegram (7), Geist no Beta (6.17) | só para quem está no Beta |
| 1c | Início › Para você (faixa Ao vivo, cronômetro 6.14, "Pra fazer hoje"), aba Premiações, popup de boas-vindas e tutorial (6.12), guia "mudou de lugar" | só para quem está no Beta |

## Global Constraints

- O app roda no Cloudflare Workers; nunca assumir Telegram (`CLAUDE.md`).
- Plano gratuito: D1 ≤100 parâmetros por instrução; nada por pessoa a cada poucos segundos lê tabela inteira; KV 1.000 gravações/dia (só o admin grava `beta-config`).
- Voltar = tela anterior: toda folha usa `useHistoryOverlay`; todo menu ⋯ usa `ActionSheet`; fileira de abas usa `ScrollRow` (`docs/beta-fundacoes.md`).
- Botões com texto: `min-w-0`, padding real (`px-1`+), ícone `shrink-0`, texto `truncate`; alvo de toque ≥ 40 px nos principais.
- Admin no front: `useIsAdmin()`; no back: `requestProvesAdmin(request)` (já aceita o id antigo e "Tipo de Perfil = Admin").
- Medição: todo POST automático em segundo plano entra em `IGNORADOS` (`src/lib/uso/coletor.ts`); nenhum texto do jogador entra em `alvo`.
- Não mexer em nada de Charts.
- Textos visíveis em português, sem "Telegram".
- Chave ausente ou ilegível = **desligado** (decisão deste plano: seguro enquanto o Beta é construído; no lançamento o admin liga "Ligado para todos", que é o padrão de 6.11).

## Review Focus

1. **Chave desligada não muda nada para um jogador comum:** sem selo, sem faixa, sem pedido extra além de 1 `GET /api/beta/estado` por abertura. Teste na Task 4 (`renderiza nada com modo desligado e jogador comum`).
2. **API fora do ar / D1 sem tabela:** `/api/beta/estado` falhando ou devolvendo 500 → o app abre na versão anterior, sem erro na tela. Teste na Task 4 (`estado com erro vira anterior`).
3. **Abuso do formulário de reporte:** texto vazio, texto de 10 mil caracteres, 50 reportes seguidos → 400 / corta em 2.000 / limita a 10 por jogador por dia. Testes na Task 2.
4. **Admin que trocou para "Entrar como usuário":** a escolha de versão é a do jogador simulado (sessão dele), e a tela de reportes exige o admin de verdade. Teste na Task 2 (`reportes exige admin`).
5. **Modo "obrigatório":** o botão "Voltar para a versão anterior" some e um `POST /api/beta/escolha {versao:"anterior"}` é recusado (409). Testes nas Tasks 1 e 2.

---

### Task 1: Regras puras da versão e serviço D1

**Files:**
- Create: `backend/src/services/betaService.ts`
- Create: `src/lib/beta/regras.ts` (puro, usado pelo front e pelo back)
- Modify: `d1/schema.sql` (documentar as duas tabelas)
- Test: `scripts/beta-test-regras.test.ts`, `scripts/beta-test-service.test.ts`

**Interfaces:**
- Produces (`src/lib/beta/regras.ts`):
  - `type ModoBeta = "desligado" | "convidados" | "todos" | "obrigatorio"`
  - `type Versao = "beta" | "anterior"`
  - `type ConfigBeta = { modo: ModoBeta; convidados: string[] }`
  - `const CONFIG_BETA_PADRAO: ConfigBeta = { modo: "desligado", convidados: [] }`
  - `function lerConfigBeta(raw: string | null): ConfigBeta` — JSON ruim/campos errados → padrão; `convidados` só strings não vazias, sem repetição, máx. 500.
  - `function estadoBeta(i: { modo: ModoBeta; convidado: boolean; admin: boolean; escolha: Versao | null }): { podeVer: boolean; podeVoltar: boolean; versao: Versao }`
  - `const MOTIVOS_VOLTA = ["nao_achei", "quebrou", "lento", "visual_antigo", "outro"] as const` e `type MotivoVolta`
  - `const ROTULO_MOTIVO: Record<MotivoVolta, string>` = Não achei uma função · Algo quebrou · Ficou lento · Prefiro o visual antigo · Outro
- Produces (`betaService.ts`):
  - `garantirTabelasBeta(db): Promise<void>` (memoizado por isolate)
  - `lerEscolha(db, jogadorId): Promise<{ versao: Versao | null; boasVindasEm: number | null }>`
  - `gravarEscolha(db, jogadorId, versao, agora): Promise<void>` (upsert)
  - `marcarBoasVindas(db, jogadorId, agora): Promise<void>` (usada na fase 1c)
  - `criarReporte(db, r: NovoReporte, agora): Promise<{ id: string } | { erro: "limite" }>`
  - `listarReportes(db, f: { status?: StatusReporte; limite: number; antesDe?: number }): Promise<Reporte[]>`
  - `mudarStatusReporte(db, id, status): Promise<boolean>`
  - `type StatusReporte = "novo" | "visto" | "resolvido"`
  - `type NovoReporte = { jogadorId: string; usuario: string; versao: Versao; tela: string; rota: string; texto: string; motivo: MotivoVolta | null; printUrl: string; tecnico: string }`
  - `type Reporte = NovoReporte & { id: string; status: StatusReporte; criadoEm: number }`

Tabelas (SQL exato):

```sql
CREATE TABLE IF NOT EXISTS beta_jogador (
  jogador_id TEXT PRIMARY KEY,
  versao TEXT,
  boas_vindas_em INTEGER,
  atualizado_em INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS beta_reporte (
  id TEXT PRIMARY KEY,
  jogador_id TEXT NOT NULL,
  usuario TEXT NOT NULL,
  versao TEXT NOT NULL,
  tela TEXT NOT NULL,
  rota TEXT NOT NULL,
  texto TEXT NOT NULL,
  motivo TEXT,
  print_url TEXT NOT NULL DEFAULT '',
  tecnico TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'novo',
  criado_em INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS beta_reporte_status_data ON beta_reporte (status, criado_em DESC);
CREATE INDEX IF NOT EXISTS beta_reporte_jogador_data ON beta_reporte (jogador_id, criado_em);
```

Tabela de `estadoBeta` (o teste confere todas as linhas). Consequência de propósito: com a chave desligada, **só o admin** vê a faixa "Versão anterior · Ir para o Beta test", para poder testar antes de ligar.

| modo | admin | convidado | escolha | podeVer | podeVoltar | versao |
|---|---|---|---|---|---|---|
| desligado | não | qualquer | qualquer | false | false | anterior |
| desligado | sim | — | null | true | true | anterior |
| desligado | sim | — | beta | true | true | beta |
| convidados | não | não | beta | false | false | anterior |
| convidados | não | sim | null | true | true | beta |
| convidados | não | sim | anterior | true | true | anterior |
| todos | não | — | null | true | true | beta |
| todos | não | — | anterior | true | true | anterior |
| obrigatorio | qualquer | — | anterior | true | false | beta |

(Admin pode ver o Beta em qualquer modo, para testar antes de ligar.)

- [ ] **Step 1: testes de regras** — `scripts/beta-test-regras.test.ts`: um `test.each` com a tabela acima; `lerConfigBeta` com `null`, `"x"`, `{"modo":"zzz"}`, `{"modo":"todos","convidados":["a","a",""," b ",3]}` → `{modo:"todos",convidados:["a","b"]}`.
- [ ] **Step 2:** `bun test scripts/beta-test-regras.test.ts` → FAIL (módulo não existe).
- [ ] **Step 3:** implementar `src/lib/beta/regras.ts`.
- [ ] **Step 4: testes do serviço** — `scripts/beta-test-service.test.ts` com `instalarFakeD1`: `gravarEscolha` duas vezes mantém 1 linha; `lerEscolha` de quem nunca escolheu → `{versao:null, boasVindasEm:null}`; `criarReporte` 11 vezes no mesmo dia UTC para o mesmo jogador → a 11ª devolve `{erro:"limite"}`; `texto` com 5.000 caracteres é gravado com 2.000; `tecnico` cortado em 4.000; `listarReportes({status:"novo",limite:20})` em ordem de `criado_em` decrescente; `mudarStatusReporte` com status inválido → false.
- [ ] **Step 5:** rodar → FAIL; implementar `betaService.ts` (id `R` + `Date.now()` + 3 dígitos aleatórios; limite pela contagem com `WHERE jogador_id = ? AND criado_em >= ?` início do dia UTC); rodar → PASS.
- [ ] **Step 6:** acrescentar as tabelas em `d1/schema.sql`; commit `feat(beta): regras de versão e tabelas do Beta test`.

### Task 2: Rotas da API do Beta

**Files:**
- Create: `backend/src/controllers/betaController.ts`
- Modify: `backend/src/routes/api.ts` (lista de rotas + ramos, no mesmo padrão de `/api/uso`)
- Modify: `backend/src/services/webPushService.ts` e `backend/src/controllers/notificacoesController.ts` (evento novo `reporte_beta`)
- Test: `scripts/beta-test-rotas.test.ts` (roda por `bash scripts/rodar-testes-isolados.sh`, usa `mock.module` do `sessionService` como `scripts/uso-rotas.test.ts`)

**Interfaces:**
- Consumes: Task 1 inteira; `verifySessionToken`, `extractBearerToken`, `requestProvesAdmin` (`sessionService`); `getCatalogoDb`; KV em `globalThis.__FLAGS_KV__`; `registrarNotificacao` e `ADMIN_TG_ID`.
- Produces (rotas; todas respondem JSON, erros com `{ ok:false, erro }` em português):

| Rota | Quem | Entrada | Saída |
|---|---|---|---|
| `GET /api/beta/estado` | sessão | — | `{ ok:true, modo, podeVer, podeVoltar, versao, boasVindasVistas }`; sem sessão → `{ ok:true, modo, podeVer:false, podeVoltar:false, versao:"anterior", boasVindasVistas:true }` |
| `POST /api/beta/escolha` | sessão | `{ versao, motivo?, texto?, tela?, rota? }` | `{ ok:true, versao }`; `versao:"anterior"` com `podeVoltar:false` → 409; `versao:"beta"` com `podeVer:false` → 403. Se vier `motivo` ou `texto`, grava também um reporte (`texto` vazio vira o rótulo do motivo) |
| `POST /api/beta/reporte` | sessão | `{ texto, tela, rota, versao, printUrl?, tecnico? }` | `{ ok:true, id }`; texto vazio (depois de `trim`) → 400 "Conte o que aconteceu."; limite → 429 "Você já enviou muitos reportes hoje. Tente amanhã." |
| `GET /api/beta/reportes?status=&antesDe=` | admin | — | `{ ok:true, reportes: Reporte[] }` (20 por página) |
| `POST /api/beta/reporte/status` | admin | `{ id, status }` | `{ ok:true }` / 404 |
| `GET /api/beta/config` | admin | — | `{ ok:true, config: ConfigBeta }` |
| `POST /api/beta/config` | admin | `ConfigBeta` | `{ ok:true, config }` (passa por `lerConfigBeta` antes de gravar) |

- A config do KV é lida com cache de isolate de 60 s (o `POST /api/beta/config` zera o cache do próprio isolate).
- `registrarNotificacao({ evento:"reporte_beta", ownerId: ADMIN_TG_ID, autorId: jogadorId, autorNome: usuario, tipoMedia:"beta", tituloMedia: tela, topicId: id, comentario: texto })`, sem esperar (`void`), nunca derruba o reporte. `montarPush` ganha o ramo `reporte_beta` → título "🐞 Novo reporte do Beta", `url: "/beta-admin"`, `tag: "reporte-beta"`. `TipoNotificacao` e `DEFAULT_PREFS` ganham `reporte_beta: true`; `TIPOS_NOTIFICACAO` também (para a preferência ser lida).

- [ ] **Step 1: testes** — `scripts/beta-test-rotas.test.ts`, um teste por linha da tabela de rotas, mais: `estado` sem tabela no D1 cria a tabela e responde; `estado` com KV `{"modo":"todos"}` e jogador sem escolha → `versao:"beta"`; `escolha anterior` em `obrigatorio` → 409; `reportes exige admin` (sessão comum → 403); `reporte` chama a notificação uma vez com `evento:"reporte_beta"` (mock de `notificacoesController`); `config` POST com `{"modo":"zzz"}` grava o padrão.
- [ ] **Step 2:** `bash scripts/rodar-testes-isolados.sh scripts/beta-test-rotas.test.ts` → FAIL.
- [ ] **Step 3:** implementar `betaController.ts` e ligar em `api.ts` (405 com mensagem para método errado, como `/api/uso`).
- [ ] **Step 4:** rodar → PASS; rodar também `bash scripts/rodar-testes-isolados.sh` (todos) e `bun test scripts/` → sem regressão.
- [ ] **Step 5:** commit `feat(beta): rotas de estado, escolha, reportes e chave do Beta`.

### Task 3: Cliente do Beta no app (estado, troca de versão, dados técnicos)

**Files:**
- Create: `src/lib/beta/cliente.ts`, `src/lib/beta/errosRecentes.ts`, `src/hooks/useBeta.tsx`
- Modify: `src/lib/api.ts` (funções `betaEstado`, `betaEscolher`, `betaReportar`, `betaListarReportes`, `betaMudarStatus`, `betaConfig`, `betaSalvarConfig`)
- Modify: `src/lib/uso/envio.ts` (`definirVersaoUso(v: Versao)`; o lote usa essa versão em vez de `"anterior"` fixo)
- Modify: `src/lib/uso/coletor.ts` (`IGNORADOS` ganha `GET /api/beta/estado`)
- Test: `scripts/beta-test-cliente.test.ts`

**Interfaces:**
- Consumes: `estadoBeta`, `Versao`, `MotivoVolta` (Task 1); rotas (Task 2); `opcoesConsulta`/`TEMPOS_CACHE` (`src/lib/consultas.ts`); `usoGlobal()`; `BUILD_ID` (`src/lib/pwa.ts`).
- Produces:
  - `type EstadoBeta = { modo: ModoBeta; podeVer: boolean; podeVoltar: boolean; versao: Versao; boasVindasVistas: boolean }`
  - `const ESTADO_SEGURO: EstadoBeta` = `{ modo:"desligado", podeVer:false, podeVoltar:false, versao:"anterior", boasVindasVistas:true }`
  - `lerEstadoGuardado(): EstadoBeta | null` / `guardarEstado(e)` — chave `empireBetaEstado` no localStorage, com try/catch.
  - `dadosTecnicos(i: { versao: Versao; rota: string }): string` — JSON com `versao, rota, aparelho (aparelhoPelaLargura), largura, navegador (navigator.userAgent cortado em 300), build (BUILD_ID), erros (errosRecentes())`, total ≤ 4.000 caracteres.
  - `errosRecentes(): { msg: string; em: number }[]` — guarda os 5 últimos `error`/`unhandledrejection` (mensagem + 1ª linha da pilha, 300 caracteres); `instalarErrosRecentes()` chamado uma vez.
  - `BetaProvider` e `useBeta(): { estado: EstadoBeta; carregado: boolean; trocarVersao(v: Versao, extra?: { motivo?: MotivoVolta; texto?: string }): Promise<boolean>; reportar(r: { texto: string; printUrl?: string; incluirTecnico: boolean }): Promise<{ ok: true } | { ok: false; erro: string }> }`
- Comportamento:
  - Primeiro desenho usa `lerEstadoGuardado() ?? ESTADO_SEGURO`; depois `useQuery(["beta","estado"], api.betaEstado, opcoesConsulta(...))` substitui e guarda. Erro de rede/500 → mantém o guardado; sem guardado → `ESTADO_SEGURO`.
  - `trocarVersao` grava no servidor; se der certo, atualiza o estado na hora **sem recarregar a página** (o player continua tocando; 6.11) e chama `definirVersaoUso`. Ao voltar para a anterior, conta a ação de uso `beta:voltar:<motivo|sem_motivo>` (só o código do motivo, nunca o texto).
  - Tela e rota do reporte vêm da rota atual (`telaDaRota` da medição de uso + `location.pathname`, **sem** a query string).

- [ ] **Step 1: testes** — `estado com erro vira anterior` (fetch falso 500 sem guardado → `ESTADO_SEGURO`); estado guardado é usado antes da resposta; `dadosTecnicos` nunca passa de 4.000 caracteres mesmo com 5 erros enormes e não inclui a query string; `errosRecentes` guarda só 5; `IGNORADOS` contém `GET /api/beta/estado` (via `acaoDaRequisicao("GET","/api/beta/estado",true) === null`); a ação `beta:voltar:lento` passa pelo coletor sem texto livre.
- [ ] **Step 2:** rodar → FAIL; implementar; rodar → PASS.
- [ ] **Step 3:** commit `feat(beta): estado do Beta no app, troca sem recarregar e dados técnicos`.

### Task 4: Telas do jogador — faixa na anterior, selo BETA, folhas

**Files:**
- Create: `src/components/Beta/FaixaVersaoAnterior.tsx`, `src/components/Beta/SeloBeta.tsx`, `src/components/Beta/FolhaBeta.tsx`, `src/components/Beta/FolhaVoltarVersao.tsx`, `src/components/Beta/FolhaReportar.tsx`
- Modify: `src/routes/__root.tsx` (`BetaProvider` dentro de `AuthGate`, em volta de `RootInner`; `SeloBeta` no topo ao lado do logo; `FaixaVersaoAnterior` logo abaixo do topo; o `padding-top` do `#app-scroll` soma a altura da faixa quando ela aparece)
- Modify: `src/lib/driveUpload.ts` (aceitar a pasta do print, ver nota) 
- Test: `scripts/beta-test-telas.test.ts` (o repo não tem biblioteca de teste de componentes: testa as funções de decisão `mostrarFaixa`/`mostrarSelo`, em `src/lib/beta/regras.ts`) + `scripts/navegador/beta-test-base.mjs` (Playwright, padrão de `scripts/navegador/beta-pecas.mjs`)

**Interfaces:**
- Consumes: `useBeta()` (Task 3); `useHistoryOverlay`; `uploadToDrive`; `useIsAdmin`.
- Produces (em `src/lib/beta/regras.ts`, para poder testar sem navegador): `mostrarFaixa(e: EstadoBeta): boolean` (= `e.podeVer && e.versao === "anterior"`), `mostrarSelo(e: EstadoBeta): boolean` (= `e.versao === "beta"`).

Textos exatos:
- Faixa (altura 32 px, texto 12 px, fundo neutro, sem amarelo): **"Versão anterior"** · botão **"Reportar"** · botão **"Ir para o Beta test"**. Em 320 px os dois botões ficam visíveis (o rótulo "Versão anterior" pode encolher com `truncate`; os botões não).
- Selo: pílula amarela **"BETA"** (alvo de toque 40 px), ao lado do logo. Abre a **FolhaBeta** "Você está no Beta test": **Reportar um problema** · **Como usar** (por enquanto leva a `/tutorial`; a fase 1c troca pelo tutorial novo) · **Voltar para a versão anterior** (some quando `podeVoltar` é false).
- FolhaVoltarVersao: título "Voltar para a versão anterior?", motivos opcionais (uma escolha) com os rótulos de `ROTULO_MOTIVO`, campo "Quer contar mais? (opcional)", botões **"Voltar agora"** e **"Ficar no Beta"**. Depois: toast "Pronto! Você está na versão anterior.".
- FolhaReportar: "O que aconteceu?" (obrigatório, 2.000 caracteres, contador), "Tela: <nome da tela>" (só leitura), **"Anexar print"** (opcional, imagem, mesmo upload do app), interruptor **"Incluir dados técnicos"** (ligado), botão **"Enviar"** (desabilitado com texto vazio ou enviando). Sucesso: "Recebido! A moderação vai olhar." Erro: mostra o `erro` da API.
- Todas as folhas: `useHistoryOverlay` (voltar fecha só a folha), ✕ no canto, tocar fora fecha. A folha Reportar aberta por cima da FolhaBeta: voltar fecha só a de cima.

Nota do print: `uploadToDrive` só aceita `materiaisMusica | materiaisAlbum` no tipo. Adicionar `"betaReportes"` exige uma pasta no Drive. **Até o usuário criar a pasta**, o print usa a pasta `socialPosts` (já liberada no backend, `folderType` aceito); trocar depois é mudar uma constante `PASTA_PRINT_REPORTE`.

- [ ] **Step 1: testes** — `renderiza nada com modo desligado e jogador comum` (`mostrarFaixa(ESTADO_SEGURO) === false`, `mostrarSelo(ESTADO_SEGURO) === false`); faixa aparece com `{podeVer:true, versao:"anterior"}`; selo aparece com `versao:"beta"`; botão "Voltar" some com `podeVoltar:false`.
- [ ] **Step 2:** rodar → FAIL; implementar componentes e ligar no `__root.tsx`; rodar → PASS.
- [ ] **Step 3: navegador** — `scripts/navegador/beta-test-base.mjs` com as rotas da API interceptadas (`page.route`): (a) estado desligado → nenhum texto "Versão anterior"/"BETA" na tela; (b) estado `todos`+`anterior` → faixa visível em 320 e 390 px, sem rolagem horizontal; tocar "Ir para o Beta test" → selo BETA aparece **sem recarregar** (`performance.navigation` igual; um marcador `window.__semRecarga = 1` continua lá); (c) selo → FolhaBeta → Reportar → voltar do navegador fecha só Reportar → voltar fecha a FolhaBeta → a URL é a do começo; (d) Voltar para a anterior com motivo "Ficou lento" → o POST levou `motivo:"lento"`.
- [ ] **Step 4:** `npm run build` sem erro; commit `feat(beta): faixa da versão anterior, selo BETA e folhas de reportar e voltar`.

### Task 5: Tela do admin — reportes e chave

**Files:**
- Create: `src/routes/beta-admin.tsx`
- Modify: `src/routes/perfil.tsx` (no bloco que só o admin vê, botão **"Beta test (reportes e chave)"** → `/beta-admin`; a fase 1b repete o atalho em Meu Império › Admin)
- Modify: `src/lib/uso/coletor.ts`/`nomes.ts` se a tela nova precisar de nome na medição ("Beta test (admin)")
- Modify: `src/components/NotificationBell.tsx` (evento `reporte_beta`: ícone de inseto, link `/beta-admin`; não aparece nas preferências de "O que receber no celular", porque só o admin recebe)
- Test: `scripts/navegador/beta-test-base.mjs` (acrescentar o roteiro do admin)

**Interfaces:**
- Consumes: `api.betaListarReportes`, `api.betaMudarStatus`, `api.betaConfig`, `api.betaSalvarConfig` (Task 3); `ScrollRow`; `useIsAdmin`; `ActionSheet`.

Tela `/beta-admin` (não admin → "Só o admin pode ver esta tela." e link para o Início):
- `ScrollRow` com **Reportes · Chave do Beta**.
- **Reportes:** filtro (ScrollRow) **Novos · Vistos · Resolvidos · Todos**; cartão com data, @usuario, versão, tela, texto (3 linhas, "ver mais"), motivo, miniatura do print (abre grande numa folha com `useHistoryOverlay`), "Dados técnicos" (abre/fecha). ⋯ (`ActionSheet`): Marcar como visto · Marcar como resolvido · Voltar para novo. "Carregar mais" usa `antesDe`.
- **Chave do Beta:** 4 opções (uma escolha) com explicação de uma linha cada: **Desligado** ("Ninguém vê o Beta, só o admin.") · **Só convidados** ("Só quem estiver na lista abaixo.") · **Ligado para todos** ("Todos começam no Beta e podem voltar.") · **Obrigatório** ("O Beta vira a única versão. O botão de voltar some."). Lista de convidados: adicionar por ID ou @usuário, remover. Botão **"Salvar"** com confirmação (`ActionSheet` com "Confirmar: <modo>") — Obrigatório pede a confirmação em vermelho.

- [ ] **Step 1:** implementar a tela; no roteiro de navegador: não admin vê o aviso; admin vê os reportes falsos, muda status (POST certo), troca a chave para "Só convidados" com 1 convidado e salva (POST com `{modo:"convidados",convidados:["123"]}`); fileiras sem texto cortado em 320 px.
- [ ] **Step 2:** `npm run build`; `bun test scripts/` e `bash scripts/rodar-testes-isolados.sh` → todos passam; commit `feat(beta): tela do admin com reportes e chave do Beta`.

### Task 6: Documentação, prévia e PR

**Files:**
- Modify: `docs/beta-fundacoes.md` (seção nova "Beta test: chave, escolha e reportes": rotas, tabelas, chave do KV, como ligar e desligar, custo)
- Modify: `docs/medicao-de-uso.md` (versão `beta` agora vem do estado; ação `beta:voltar:*`)
- Modify: design `2026-11-25-reorganizacao-do-app-design.md` (fase 1a ✅ na tabela da seção 8; nota de que a chave ausente = desligado)
- Modify: cobertura (linhas de 6.11 marcadas como feitas)

Custo esperado (vai para o doc): 1 pedido + 1 leitura de KV (com cache de 60 s por isolate) + 1 linha lida no D1 por abertura do app; gravações só ao trocar de versão ou reportar.

- [ ] **Step 1:** escrever os docs.
- [ ] **Step 2:** push na branch; conferir a prévia (`sala-tv-tanstack-start-app…workers.dev`) com a chave **desligada**: nada muda para um jogador; como admin, `/beta-admin` abre e "Ir para o Beta test" aparece para o admin.
- [ ] **Step 3:** revisão final do ramo inteiro; abrir o PR; pedir ao usuário o OK para o merge (fora do horário de transmissão, 21h de Brasília).
