# Fundações do Beta (fase 0) — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Criar as peças comuns que todas as telas do Beta vão usar — fileira
rolável com setas, "voltar fecha só esta camada", menu ⋯, critério único de
admin e de jogador, tempos de cache do React Query e os tokens de cor — sem
mudar nada que o jogador vê hoje.

**Architecture:** Cada peça tem um núcleo **puro e testável** em `src/lib/`
(contas, estados, ordenação) e uma casca React fina em `src/hooks/` ou
`src/components/`. Nenhuma tela de hoje passa a usar as peças novas (isso é
das fases 1+), **exceto** a troca do id fixo de admin `810141686` pelo
critério único `isAdminLogin` (já decidido na 10ª conferência). Uma página
escondida só de admin, `/beta-pecas`, mostra as peças para conferir no
navegador e no celular.

**Tech Stack:** TanStack Start/Router, React 19, Tailwind 4, React Query (o
`QueryClient` já está montado em `src/router.tsx`/`__root.tsx`), `bun test`.

**Spec:** `docs/superpowers/specs/2026-11-25-reorganizacao-do-app-design.md`
— seções **5.9** (componentes compartilhados), **5.10** (tokens/modo claro),
**5.11** (React Query e tempos de cache), **6.1** (`ScrollRow`), **6.2**
(telas por cima e voltar), **6.3** (menu ⋯), **6.5** (U3: toque 44 px) e
**8** (fase 0: "nada visível muda").

## Global Constraints

- O app roda no Cloudflare Workers, não no Telegram (`CLAUDE.md`).
- **Nada visível muda** para o jogador nesta fase. Única tela nova:
  `/beta-pecas`, só admin, sem link em nenhum menu.
- **A unificação nunca muda o comportamento** (spec 5.9): antes de trocar,
  listar o que a versão antiga faz e conferir que a nova faz tudo.
- Regras do `CLAUDE.md` em toda peça com texto: `min-w-0`, padding real
  (≥ `px-1`), ícone `shrink-0`, texto `truncate`; fileiras de abas
  **roláveis, nunca "…"**; voltar = tela anterior.
- `ScrollRow` (spec 6.1): seta numa faixa própria com degradê da cor do fundo
  (≈ 56 px), botão redondo **32 px visível com área de toque de 44 px**;
  seta só do lado que ainda tem conteúdo; toque avança uma "página"
  (largura visível − as duas faixas) e **para no começo de um item**
  (`scroll-snap`, `scroll-padding` = faixa); a opção selecionada sempre fica
  inteira na tela; teclado ←/→ move entre itens; itens `shrink-0`, nunca "…".
- `useHistoryOverlay` (spec 6.2 / `CLAUDE.md`): ao abrir, `pushState` com
  marca própria no `state`; fecha no `popstate` **só se a entrada dela
  saiu**; fechar pelo X/seta chama `history.back()` **só se a entrada dela
  ainda é a atual**.
- `ActionSheet` (spec 6.3): folha de baixo com ícone + texto, ações
  destrutivas em vermelho **e por último**, e "Cancelar".
- Tempos de cache (spec 5.11): ao vivo **30 s**; catálogo **5 min**; social
  **30 s**; charts = comportamento de hoje (sem mudar backend de charts).
- Tokens (spec 5.10): valor do **escuro igual ao de hoje**; valor do claro
  novo; o claro **não é ligado** nesta fase. Destaque roxo `#957AF8`
  (escuro) / `#6C4CE8` (claro); textos secundários do claro `#55555c` (spec 6.20, contraste AA; não `#6B6B73`).
- Nenhuma lógica de charts é alterada.

## Review Focus

1. **Duas camadas abertas** (ex.: menu ⋯ por cima de uma folha): voltar fecha
   só a de cima; fechar a de baixo pelo X não pode desfazer a navegação de
   outra tela.
2. **Camada aberta e o jogador navega para outra rota pelo link**: ao
   desmontar, não chamar `history.back()` (desfaria a navegação).
3. **Fileira com 1 item ou que cabe inteira**: nenhuma seta aparece; com
   item selecionado fora da tela ao abrir, a fileira rola até ele.
4. **Admin por `tipoPerfil` ("Admin") sem o id antigo**: passa a ver os
   mesmos botões de admin que o id antigo via — é a unificação decidida;
   jogador comum continua sem ver nada de admin.
5. **Sem login / SSR**: `useJogador` devolve `null` sem quebrar no servidor
   (sem `window` no render).

---

## Arquivos

| Arquivo | Responsabilidade |
|---|---|
| `src/lib/historicoOverlay.ts` (novo) | núcleo puro: marca, abrir, decidir no `popstate`, decidir ao fechar pela UI |
| `src/hooks/useHistoryOverlay.ts` (novo) | casca React do núcleo acima |
| `src/lib/scrollRow.ts` (novo) | contas da fileira: próxima página com snap, item a mostrar, bordas |
| `src/components/ScrollRow.tsx` (novo) | fileira rolável com faixas de seta, snap e teclado |
| `src/lib/acoesMenu.ts` (novo) | ordenar ações (destrutivas por último) |
| `src/components/ActionSheet.tsx` (novo) | menu ⋯ como folha de baixo, usando `useHistoryOverlay` |
| `src/hooks/useJogador.ts` (novo) | `useJogador()` e `useIsAdmin()` |
| arquivos com `810141686` (lista na Task 4) | trocar pelo critério único |
| `src/lib/consultas.ts` (novo) | tempos de cache e opções por tipo para o React Query |
| `src/styles.css` | tokens semânticos novos (escuro = hoje; claro definido, não ligado) |
| `src/routes/beta-pecas.tsx` (novo) | vitrine só admin das peças |
| `docs/beta-fundacoes.md` (novo), `CLAUDE.md`, design §8 | manual e referência |
| `scripts/beta-*.test.ts` | testes |

---

### Task 1: `useHistoryOverlay` (voltar fecha só esta camada)

**Files:** Create `src/lib/historicoOverlay.ts`, `src/hooks/useHistoryOverlay.ts`; Test `scripts/beta-historico.test.ts`

**Interfaces — Produces:**
- `type HistoricoLike = { state: unknown; pushState(s: unknown, t: string): void; back(): void }`
- `criarMarca(): string` — id único por camada (`"ov-" + contador + aleatório`)
- `abrirCamada(h: HistoricoLike, marca: string): void` — `pushState({ ...estadoAtual, __overlay: marca }, "")`, preservando o `state` existente (o TanStack Router guarda dados nele)
- `entradaEhDaCamada(state: unknown, marca: string): boolean`
- `deveFecharNoPopstate(stateAtual: unknown, marca: string): boolean` — `true` quando a entrada da camada **saiu** (o state atual não é dela)
- `deveVoltarAoFecharPelaUi(stateAtual: unknown, marca: string): boolean` — `true` só se a entrada da camada ainda é a atual
- `useHistoryOverlay(aberto: boolean, aoFechar: () => void): { fechar: () => void }` — `fechar()` é o que o X/seta chama.

- [ ] **Step 1: Testes que falham** (história falsa em memória com pilha e `popstate` manual):
  - "abrir empurra 1 entrada com a marca e preserva o state anterior";
  - "voltar (pop) fecha a camada";
  - "fechar pelo X volta 1 entrada só se a da camada ainda for a atual";
  - "duas camadas: voltar fecha só a de cima; a de baixo continua aberta";
  - "navegou para outra rota com a camada aberta: fechar não chama back()" (Review Focus 1 e 2).
- [ ] **Step 2:** `bun test scripts/beta-historico.test.ts` → FAIL.
- [ ] **Step 3: Implementar** o núcleo e o hook (listener de `popstate` só enquanto aberto; SSR-safe).
- [ ] **Step 4:** → PASS.
- [ ] **Step 5: Commit** `beta: useHistoryOverlay (voltar fecha só a camada de cima)`.

### Task 2: `ScrollRow` (fileira rolável com setas)

**Files:** Create `src/lib/scrollRow.ts`, `src/components/ScrollRow.tsx`; Test `scripts/beta-scrollrow.test.ts`

**Interfaces — Produces:**
- `FAIXA_SETA = 56` (px)
- `bordas(scrollLeft: number, clientWidth: number, scrollWidth: number): { esquerda: boolean; direita: boolean }` — margem de 4 px como `useDragScroll`
- `destinoDaPagina(dir: -1 | 1, scrollLeft: number, clientWidth: number, inicios: number[], faixa = FAIXA_SETA): number` — avança `clientWidth − 2·faixa` e **encosta no começo de um item** (o maior início ≤ alvo, à frente; o menor ≥ alvo, para trás), limitado a `[0, último início]`
- `scrollParaMostrar(inicio: number, fim: number, scrollLeft: number, clientWidth: number, faixa = FAIXA_SETA): number | null` — `null` se o item já está inteiro entre as faixas
- `ScrollRow` props: `{ children: React.ReactNode; selecionado?: string; rotulo: string; className?: string }` — cada filho direto com `data-scroll-item={id}`; `rotulo` vira `aria-label` da fileira; usa `useDragScroll`; faixas de seta com degradê de `var(--background)`, botão 32 px visível dentro de área de 44 px (`aria-label` "Rolar para a esquerda/direita"); `scroll-snap-type: x proximity` e `scroll-padding-inline: 56px`; ←/→ com foco dentro movem o foco entre itens.

- [ ] **Step 1: Testes que falham** — `bordas` (início, meio, fim, conteúdo que cabe); `destinoDaPagina` (avança e para no começo de item; não passa do fim; volta); `scrollParaMostrar` (item já inteiro → `null`; item cortado à direita/esquerda → valor que o deixa inteiro com a faixa) (Review Focus 3).
- [ ] **Step 2:** `bun test scripts/beta-scrollrow.test.ts` → FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4:** → PASS.
- [ ] **Step 5: Commit** `beta: ScrollRow (fileira rolável com setas, snap e teclado)`.

### Task 3: `ActionSheet` (menu ⋯)

**Files:** Create `src/lib/acoesMenu.ts`, `src/components/ActionSheet.tsx`; Test `scripts/beta-acoes.test.ts`

**Interfaces — Consumes:** `useHistoryOverlay` (Task 1). **Produces:**
- `type AcaoMenu = { id: string; rotulo: string; icone?: React.ComponentType<{ className?: string }>; destrutiva?: boolean; aoEscolher: () => void }`
- `ordenarAcoes(acoes: AcaoMenu[]): AcaoMenu[]` — mantém a ordem dada, move as destrutivas para o fim (estável)
- `ActionSheet` props: `{ aberto: boolean; titulo?: string; acoes: AcaoMenu[]; aoFechar: () => void }` — folha de baixo (fundo escurecido clicável fecha), cada ação com ícone `shrink-0` + texto `truncate`, linhas de ≥ 44 px, destrutivas em vermelho (`text-destructive`), botão "Cancelar" no fim; escolher uma ação fecha a folha **e depois** chama `aoEscolher` (a entrada do histórico sai antes, para a ação poder navegar); `role="dialog"`, `aria-modal`, foco vai para a folha ao abrir e volta ao botão que abriu ao fechar; Esc fecha.

- [ ] **Step 1: Teste que falha** — `ordenarAcoes` (destrutivas por último, ordem estável, lista vazia).
- [ ] **Step 2:** `bun test scripts/beta-acoes.test.ts` → FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4:** → PASS.
- [ ] **Step 5: Commit** `beta: ActionSheet (menu ⋯ como folha de baixo)`.

### Task 4: `useJogador` / `useIsAdmin` e fim do id fixo de admin

**Files:** Create `src/hooks/useJogador.ts`; Modify os arquivos abaixo; Test `scripts/beta-jogador.test.ts`

**Interfaces — Produces:**
- `type Jogador = { id: string; usuario: string; tipoPerfil?: string }`
- `jogadorAtual(login: LoginResult | null, tgUserId?: string): Jogador | null` — puro: login salvo primeiro; sem login, o id do `useTelegramUser` (compatibilidade com hoje); sem nada, `null`
- `useJogador(): { jogador: Jogador | null; carregado: boolean }` — junta `getStoredLogin()` (de `@/components/LoginScreen`) e `useTelegramUser()`; SSR-safe (Review Focus 5)
- `useIsAdmin(): boolean` — `isAdminLogin(getStoredLogin(), jogador?.id)` (critério único que já existe em `LoginScreen.tsx`)

Trocar o id fixo `810141686` pelo critério único (comportamento esperado: igual para o id antigo; quem tem `tipoPerfil: "Admin"` passa a ser reconhecido em todos — Review Focus 4). Antes de cada troca, ler o trecho e manter tudo o que ele faz:
- `src/components/EmpirePlay/Forum.tsx:268`, `src/components/EmpirePlay/EditModal.tsx:214`, `src/routes/perfil.tsx:79` — já combinam id + `tipoPerfil`: trocar por `isAdminLogin(...)`.
- `src/routes/album.$id.tsx:82`, `src/routes/album.$id.editar.tsx:54`, `src/routes/acervo.tsx:1401`, `src/routes/empire-play.albuns-antigos.$id.tsx:59`, `src/routes/empire-play.playlists.$id.tsx:59`, `src/routes/empire-play.playlists.$id.editar.tsx:23` — checam só o id: trocar a parte "é admin" por `isAdminLogin(getStoredLogin(), <id local>)`, mantendo a parte "é o dono".
- `src/routes/gestao-usuarios.tsx:203` — confere **outro** usuário da lista: `isAdminLogin(u, u.id)`.
- `src/components/EmpirePlay/Gestao.tsx:465,1907` — só comentários: atualizar o texto.
- `LoginScreen.tsx:32` continua sendo o único lugar com o id.
- Backend (`acervoController`, `indicacoesController`, `playlistsController`, `socialController`, `sessionService`) **não muda** nesta fase (segurança do servidor; fora do escopo).

- [ ] **Step 1: Testes que falham** — `jogadorAtual` (login salvo; só id do Telegram; nada → `null`); e um teste que **varre `src/`** e falha se `810141686` aparecer fora de `LoginScreen.tsx` (comentários também, para não voltar).
- [ ] **Step 2:** `bun test scripts/beta-jogador.test.ts` → FAIL.
- [ ] **Step 3: Implementar e trocar.**
- [ ] **Step 4:** → PASS; `bunx tsc --noEmit -p .` sem erro novo; `bun run build`.
- [ ] **Step 5: Commit** `beta: useJogador/useIsAdmin e critério único de admin no front`.

### Task 5: Tempos de cache e tokens de cor

**Files:** Create `src/lib/consultas.ts`; Modify `src/styles.css`; Test `scripts/beta-consultas.test.ts`

**Interfaces — Produces:**
- `TEMPOS_CACHE = { aoVivo: 30_000, catalogo: 300_000, social: 30_000 } as const`
- `opcoesConsulta(tipo: keyof typeof TEMPOS_CACHE): { staleTime: number; refetchOnWindowFocus: boolean }` — `staleTime` do tipo; `refetchOnWindowFocus: true` em ao vivo e social, `false` no catálogo
- Em `styles.css`: tokens semânticos `--superficie-1`, `--superficie-2`, `--texto-secundario`, `--linha`, `--destaque`, `--ao-vivo`, `--alta`, `--queda`, `--ouro`, registrados no `@theme inline` como `--color-*`. Valores do **escuro = os de hoje** (ler as cores mais usadas no código: `bg-white/5`, `border-white/10`, `text-muted-foreground`, o roxo da marca `#957AF8`, `red-500` do ao vivo, `emerald-500` da alta, o dourado da coroa) e do **claro** (spec 5.10: fundo branco, cinza agrupado `#F2F2F7`, texto secundário `#6B6B73`, destaque `#6C4CE8`) num seletor `.tema-claro` que **nada aplica** nesta fase.

- [ ] **Step 1: Teste que falha** — `opcoesConsulta` para os três tipos com os valores exatos.
- [ ] **Step 2:** → FAIL. **Step 3:** implementar. **Step 4:** → PASS; `bun run build`.
- [ ] **Step 5: Conferir que nada mudou na tela:** capturas de `/`, `/charts`, `/perfil` e `/social` antes/depois (build local + Playwright) idênticas.
- [ ] **Step 6: Commit** `beta: tempos de cache do React Query e tokens de cor (claro definido, não ligado)`.

### Task 6: Vitrine `/beta-pecas`, documentação e conferência final

**Files:** Create `src/routes/beta-pecas.tsx`, `docs/beta-fundacoes.md`; Modify `CLAUDE.md`, design §8 (fase 0 ✅)

- `/beta-pecas` (só admin, mesmo padrão de `/tv-teste-hls`; sem link em menu): uma `ScrollRow` com 10 pílulas (uma selecionada no fim), um botão "⋯" que abre um `ActionSheet` com 4 ações (uma destrutiva) que abre por cima uma **segunda** folha simples, e amostras dos tokens novos (escuro e `.tema-claro` lado a lado).
- [ ] **Step 1: Implementar a vitrine.**
- [ ] **Step 2: Verificar no navegador** (build + `wrangler dev` + Playwright) em 320, 390 e 1300 px: setas aparecem/somem nas pontas; seta para no começo de item; selecionado inteiro ao abrir; ←/→ no teclado; voltar do navegador fecha só a folha de cima, depois a de baixo, depois sai da página; X da folha não deixa entrada sobrando; não admin vê "Página não encontrada.".
- [ ] **Step 3: Documentar** `docs/beta-fundacoes.md` (para que serve cada peça, como usar, exemplos curtos, regras) e uma linha no `CLAUDE.md` apontando para ele; marcar a fase 0 como feita no design §8.
- [ ] **Step 4: Rodar tudo** — `bun test scripts/beta-*.test.ts scripts/uso-*.test.ts scripts/tv-*.test.ts`, `bash scripts/rodar-testes-isolados.sh`, `bunx tsc --noEmit -p .`, `bun run build`.
- [ ] **Step 5: Commit**, revisão final do branch inteiro, PR; merge só com o OK do usuário e fora do horário de transmissão.
