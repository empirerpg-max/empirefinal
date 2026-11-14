# Busca rápida no cabeçalho — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lupa ao lado do sininho que abre uma busca rápida com resultados agrupados (Músicas, Vídeos, Álbuns, Artistas), cada um levando direto ao item.

**Architecture:** O endpoint `GET /api/busca` monta, a partir das MESMAS funções que o catálogo usa (D1), um índice compacto `ItemBusca[]` guardado 60 s na memória do Worker. Cada busca filtra esse índice com uma função pura (`buscarNoIndice`). No front, `BuscaRapida.tsx` (botão + `CommandDialog` de `src/components/ui/command.tsx`) chama `api.buscar` com debounce e cancelamento.

**Tech Stack:** Cloudflare Worker (TanStack Start), D1, React + TanStack Router, cmdk (`ui/command.tsx`), `bun test`.

**Spec:** `docs/superpowers/specs/2026-11-14-busca-rapida-design.md`

## Global Constraints

- Grupos e ordem fixa: `musicas`, `videos`, `albuns`, `artistas` (rótulos: "Músicas", "Vídeos", "Álbuns", "Artistas").
- Busca só com termo de **2+ caracteres** (depois de trim); até **5** por grupo; "ver todos" pede o grupo com limite **50**.
- Comparação sem acento e sem maiúscula: usar `normalizeComparison` de `backend/src/services/googleSheetsService.ts`.
- Casa contra título + artistas (principal e participações). Ordem: começa-com antes de contém; empate → mais recente (`dataIso` desc); sem data por último.
- Itens com `pendente` = "sim" ficam fora (mesmo filtro do catálogo: `(getValue(rec, ["pendente"]) || "").trim().toLowerCase() !== "sim"`).
- Índice reaproveitado por **60 s** (item novo aparece em até 1 min).
- Destinos: música `/empire-play/forum?tab=musicas&id=<id>`, vídeo `...tab=videos&id=<id>`, álbum `...tab=albuns&id=<id>`, artista `/artistas/<nome>`; `<id>` = `telegramTopicId || id` do item do catálogo.
- CLAUDE.md: todo botão/item com texto tem `min-w-0`, padding real (`px-1`+), ícone `shrink-0`, texto `truncate`; o cabeçalho não pode estourar em tela de 320 px.
- Debounce **250 ms** e cancelar (AbortController) a busca anterior.

## Review Focus

1. Termo com acento/maiúscula/espaços nas pontas ("  Fóllia ") — deve achar o mesmo que "follia". → teste em Task 1.
2. Termo que é só pontuação ou 1 letra ("a", "-") — não busca, não erra, mostra nada. → teste em Task 1 e no endpoint (Task 2: `q` curto devolve grupos vazios com 200).
3. Mesmo título em versões diferentes (Fuori Rotta e seus remixes; Evergreen/Evergreen Deluxe com o mesmo Código único) — todos aparecem, cada um com seu próprio link (o ID do tópico, nunca o código). → teste em Task 1.
4. D1 fora do ar / uma fonte falha (ex.: artistas) — o resto da busca ainda responde. → teste em Task 2.
5. Digitar rápido "f", "fo", "fol"… — só o último resultado aparece (respostas antigas descartadas). → Task 3, verificação manual com rede lenta.

---

### Task 1: Função pura de busca

**Files:**
- Create: `backend/src/services/buscaRapida.ts`
- Test: `scripts/busca-rapida.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type GrupoBusca = "musicas" | "videos" | "albuns" | "artistas";
  export interface ItemBusca { grupo: GrupoBusca; id: string; titulo: string; subtitulo: string; capa?: string; link: string; dataIso?: string; termos: string /* normalizado: título + artistas */ }
  export function buscarNoIndice(indice: ItemBusca[], q: string, opcoes?: { limitePorGrupo?: number; grupo?: GrupoBusca }): { grupos: { grupo: GrupoBusca; total: number; itens: Omit<ItemBusca, "termos">[] }[] }
  export function termosDeBusca(...partes: (string | undefined)[]): string
  ```

- [ ] **Step 1: Testes que falham** (`scripts/busca-rapida.test.ts`, índice fixo de ~8 itens):
  - `acento e maiúscula`: `buscarNoIndice(idx, "  Fóllia ")` tem os mesmos ids que `"follia"`.
  - `termo curto`: `"a"` e `"-"` → `grupos` vazio.
  - `começa-com antes de contém`: "Follia" (álbum) antes de "Abbiso di Follia" (música) dentro de cada grupo; empate por `dataIso` desc; sem data por último.
  - `participação`: item com artistas "Max Gorghan, Samantha Cooper" aparece buscando "samantha".
  - `versões`: 3 músicas "Fuori Rotta", "Fuori Rotta (Acústico)", "Fuori Rotta (Enaldi Remix)" com links distintos → 3 itens, 3 links distintos.
  - `limite e total`: 7 matches no grupo → `itens.length === 5`, `total === 7`; com `{ grupo: "musicas", limitePorGrupo: 50 }` → só esse grupo, 7 itens.
  - `ordem dos grupos`: musicas, videos, albuns, artistas; grupo sem match não aparece; `termos` não vem na resposta.
- [ ] **Step 2:** `bun test scripts/busca-rapida.test.ts` → FAIL (módulo não existe).
- [ ] **Step 3:** Implementar em `backend/src/services/buscaRapida.ts`. `termosDeBusca` = `normalizeComparison` das partes não vazias unidas por " | ". Casa se `termos` contém o termo normalizado; "começa-com" = título normalizado começa com o termo OU algum artista começa com ele.
- [ ] **Step 4:** `bun test scripts/busca-rapida.test.ts` → PASS.
- [ ] **Step 5:** Commit `feat(busca): função pura de busca agrupada`.

### Task 2: Índice + endpoint `GET /api/busca`

**Files:**
- Create: `backend/src/controllers/buscaController.ts`
- Modify: `backend/src/routes/api.ts` (rota nova, junto das rotas `/api/empire-play/*`)
- Test: `scripts/busca-rapida.test.ts` (acrescentar)

**Interfaces:**
- Consumes: `buscarNoIndice`, `termosDeBusca`, `ItemBusca` (Task 1); de `empirePlayController.ts`: `readMusicasFromD1()`, `buildCleanItem(sheetName, rec, idx)` (rótulos "Musicas", "Videos", "Album"), e as funções internas `lerMusicVideosComoObjetos()` / `lerAlbunsComoObjetos()` — **exportar** essas duas; de `artistasController.ts`: `getAllArtistasController()` (lê `data[].nome` da resposta JSON).
- Produces: `GET /api/busca?q=<termo>[&grupo=<GrupoBusca>&limite=<n>]` → `{ success: true, q, grupos }` (formato de `buscarNoIndice`); `limite` máx 50, padrão 5. Também `export function montarIndiceDeFontes(fontes): ItemBusca[]` (pura, testável) e `export async function obterIndiceBusca(): Promise<ItemBusca[]>` (cache 60 s).

- [ ] **Step 1: Testes que falham** para `montarIndiceDeFontes({ musicas, videos, albuns, artistas })` (registros crus de exemplo):
  - item `pendente: "Sim"` não entra.
  - link de música = `/empire-play/forum?tab=musicas&id=<telegramTopicId || id>` (id com espaço/acento vai `encodeURIComponent`); vídeo `tab=videos`; álbum `tab=albuns`; artista `/artistas/<encodeURIComponent(nome)>`.
  - fonte que falhou (`artistas: null`) → os outros grupos continuam no índice.
- [ ] **Step 2:** `bun test scripts/busca-rapida.test.ts` → FAIL.
- [ ] **Step 3:** Implementar `buscaController.ts`. `obterIndiceBusca` busca as 4 fontes com `Promise.allSettled` (falha vira `null`) e guarda `{ indice, ate: Date.now() + 60_000 }` em variável de módulo. Handler: `q` com menos de 2 caracteres → `{ success: true, q, grupos: [] }` sem montar índice. Erro inesperado → 500 `{ success: false, error }`.
- [ ] **Step 4:** `bun test scripts/busca-rapida.test.ts` → PASS; `npx tsc --noEmit` sem erro novo nos arquivos tocados.
- [ ] **Step 5:** Commit `feat(busca): endpoint /api/busca com índice em cache`.

### Task 3: Lupa + janela de resultados

**Files:**
- Create: `src/components/BuscaRapida.tsx`
- Modify: `src/lib/api.ts` (método novo), `src/routes/__root.tsx:860-862` (inserir `<BuscaRapida />` antes de `<NotificationBell />`)

**Interfaces:**
- Consumes: `GET /api/busca` (Task 2).
- Produces: `api.buscar(q: string, opcoes?: { grupo?: GrupoBusca; limite?: number; signal?: AbortSignal }): Promise<{ grupos: GrupoResultado[] }>` (em erro → `{ grupos: [] }`); `export function BuscaRapida(): JSX.Element`.

- [ ] **Step 1:** `api.buscar` em `src/lib/api.ts` (fetch `cache: "no-store"`, repassa `signal`; abortado não loga erro).
- [ ] **Step 2:** `BuscaRapida.tsx`: botão ícone `Search` (lucide) no mesmo estilo/tamanho do sininho, `aria-label="Pesquisar"`, `haptic.light()` ao tocar; abre `CommandDialog` com `shouldFilter={false}` (o filtro é do servidor). Campo com placeholder "Buscar músicas, vídeos, álbuns, artistas…". Debounce 250 ms + AbortController por busca; só a resposta do último termo é aplicada. Estados: termo < 2 → dica "Digite pelo menos 2 letras"; carregando → indicador discreto; sem resultado → "Nada encontrado para “<termo>”". Cada grupo = `CommandGroup` com rótulo, itens (capa 40 px quando houver, título `truncate`, subtítulo `truncate`) e, se `total > itens.length`, item "Ver todos (N)" que pede `{ grupo, limite: 50 }` e substitui só aquele grupo. Ao escolher: fecha a janela, limpa o termo e `navigate({ to: link })` (link já pronto do servidor; `/artistas/...` e `/empire-play/forum?...`).
- [ ] **Step 3:** Inserir no cabeçalho de `__root.tsx` antes do `NotificationBell`; conferir que o container `flex items-center gap-1.5` continua cabendo.
- [ ] **Step 4: Verificar** — `npx tsc --noEmit` sem erro novo; com o app local (skill `run`), Playwright a 320×640: screenshot do cabeçalho (nada cortado) e da janela buscando "follia" contra `/api/busca` (mock ou produção) com os 4 grupos; testar digitação rápida "f"→"fol"→"follia" e conferir que só aparece o resultado final.
- [ ] **Step 5:** Commit `feat(busca): lupa no cabeçalho com resultados agrupados`.

### Task 4: Publicar e conferir em produção

- [ ] **Step 1:** PR para `main` (usar o número que `create_pull_request` devolver), merge, aguardar o deploy (`deploy.yml`) com sucesso.
- [ ] **Step 2:** Pelo `admin-call.yml`, chamar `/api/busca?q=follia` → `success: true`, grupos com Músicas (Abbiso di Follia, Follia…), Vídeos (Max Gorghan - Follia), Álbuns (Max Gorghan - FOLLIA), Artistas se houver; e `/api/busca?q=a` → `grupos: []`.
- [ ] **Step 3:** Pedir ao usuário para testar no app (lupa, busca, toque num resultado de cada grupo).
