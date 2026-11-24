# Reordenar faixas de álbum (Albuns!M) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reordenar faixas na Gestão passa a gravar a tracklist do álbum (Albuns!M), que é de onde a tela e a página pública leem; "adicionar faixas" para de duplicar entradas; o front mostra erro se falhar.

**Architecture:** Duas funções puras novas (`reordenarTracklist`, `mesclarTracklist`) num arquivo próprio, testadas com `bun test`. `reordenarAlbumFaixasController` e `substituirAlbumController` passam a usá-las. `EditModal.tsx` manda `topicId` e checa a resposta.

**Tech Stack:** TypeScript, Cloudflare Workers, Google Sheets (`googleSheetsService.principal`), `bun:test`.

**Spec:** `docs/superpowers/specs/2026-11-24-reordenar-faixas-album-design.md`

## Global Constraints

- Título na tracklist é sempre o de Musicas!H ("Artista - Título"); comparação por título é `trim().toLowerCase()`.
- `ordem` recomeça em 1 dentro de cada `disco`; `disco` ausente/≤0 = 1.
- Nunca apagar entrada da tracklist sem música correspondente: vai pro fim do seu disco.
- Escrita em Albuns já espelha no D1 sozinha; escrita em Musicas precisa de `mirrorMusicaRowParaD1(rowIndex)`.
- Comentários e mensagens em português, no estilo do arquivo.

## Review Focus

- Tracklist com o mesmo título duplicado (caso Utopia) → resultado tem cada título uma vez só. Teste em Task 1.
- Entrada órfã ("Immobilier Vous") → preservada no fim do disco, ordem seguinte. Teste em Task 1.
- Álbum multi-disco → cada disco reinicia a ordem em 1, faixa não troca de disco. Teste em Task 1.
- Álbum antigo sem tracklist (M vazia) → reordenar cria a tracklist a partir da ordem da tela (disco 1). Teste em Task 1.
- Faixa nova cujo `num` colide com ordem existente → entra no fim do disco. Teste em Task 1.

---

### Task 1: Funções puras da tracklist

**Files:**
- Create: `backend/src/controllers/albumTracklist.ts`
- Test: `scripts/album-tracklist.test.ts`

**Interfaces:**
- Consumes: `import type { TracklistEntry } from "./gestaoController"` (só tipo — `{ titulo: string; disco: number; ordem: number }`).
- Produces:
  - `reordenarTracklist(atual: TracklistEntry[], titulosNaOrdem: string[]): TracklistEntry[]`
  - `mesclarTracklist(atual: TracklistEntry[], novas: TracklistEntry[]): TracklistEntry[]`

- [ ] **Step 1: Escrever os testes** em `scripts/album-tracklist.test.ts` (import dinâmico como em `scripts/presave-montar-passos.test.ts`):

```ts
const e = (titulo: string, ordem: number, disco = 1) => ({ titulo, disco, ordem });

test("reordenar segue a ordem da tela e deduplica", () => {
  const atual = [e("A - Toast", 1), e("A - Utopia", 1), e("A - Mani", 2), e("A - Toast", 5)];
  expect(reordenarTracklist(atual, ["A - Utopia", "A - Mani", "A - Toast"]))
    .toEqual([e("A - Utopia", 1), e("A - Mani", 2), e("A - Toast", 3)]);
});

test("órfã vai pro fim, preservada", () => {
  const atual = [e("A - X", 1), e("A - Immobilier", 2), e("A - Y", 3)];
  expect(reordenarTracklist(atual, ["A - Y", "A - X"]))
    .toEqual([e("A - Y", 1), e("A - X", 2), e("A - Immobilier", 3)]);
});

test("multi-disco reinicia ordem e mantém o disco de cada faixa", () => {
  const atual = [e("A - a", 1, 1), e("A - b", 2, 1), e("A - c", 1, 2), e("A - d", 2, 2)];
  expect(reordenarTracklist(atual, ["A - b", "A - a", "A - d", "A - c"]))
    .toEqual([e("A - b", 1, 1), e("A - a", 2, 1), e("A - d", 1, 2), e("A - c", 2, 2)]);
});

test("tracklist vazia vira disco 1 na ordem da tela", () => {
  expect(reordenarTracklist([], ["A - b", "A - a"])).toEqual([e("A - b", 1), e("A - a", 2)]);
});

test("comparação de título ignora caixa/espaços e mantém o título da tela", () => {
  expect(reordenarTracklist([e(" a - x ", 1)], ["A - X"])).toEqual([e("A - X", 1)]);
});

test("mesclar não duplica título existente e põe novo no fim do disco", () => {
  const atual = [e("A - a", 1), e("A - b", 2)];
  expect(mesclarTracklist(atual, [e("A - b", 1), e("A - c", 1)]))
    .toEqual([e("A - a", 1), e("A - b", 2), e("A - c", 3)]);
});

test("mesclar respeita o disco da faixa nova", () => {
  expect(mesclarTracklist([e("A - a", 1, 1), e("A - z", 1, 2)], [e("A - n", 1, 2)]))
    .toEqual([e("A - a", 1, 1), e("A - z", 1, 2), e("A - n", 2, 2)]);
});
```

- [ ] **Step 2: Rodar e ver falhar** — `bun test scripts/album-tracklist.test.ts` → FAIL (módulo não existe).

- [ ] **Step 3: Implementar** em `albumTracklist.ts`.
  - `reordenarTracklist`: deduplica `atual` por título (vale a ÚLTIMA ocorrência — mesmo comportamento do `Map` em `getAlbumFaixasController`, pra o disco lido ser o que a tela já usava). Percorre `titulosNaOrdem` (também deduplicado), pega o disco da entrada existente (padrão 1). Depois anexa as órfãs (títulos de `atual` fora da tela) na ordem em que estavam. Numera `ordem` 1..n por disco na sequência final; saída agrupada por disco crescente.
  - `mesclarTracklist`: copia `atual`; para cada nova, se o título já existe ignora; senão anexa com `ordem = max(ordem do disco) + 1` (1 se disco vazio).

- [ ] **Step 4: Rodar e ver passar** — `bun test scripts/album-tracklist.test.ts` → 7 pass.

- [ ] **Step 5: Commit** — `git add backend/src/controllers/albumTracklist.ts scripts/album-tracklist.test.ts && git commit -m "Funções puras pra reordenar/mesclar tracklist de álbum"`

### Task 2: Backend usa as funções

**Files:**
- Modify: `backend/src/controllers/gestaoController.ts` — `ReordenarFaixasPayload`/`reordenarAlbumFaixasController` (~2780-2814) e mescla em `substituirAlbumController` (~2975-2987).

**Interfaces:**
- Consumes: Task 1.
- Produces: `POST /api/gestao/album-faixas/reordenar` aceita `{ topicId?: string; ordens: { musicaRowIndex: number; ordem: number }[] }` e responde `{ success: true }` ou `{ success: false, error }` (status 4xx/5xx).

- [ ] **Step 1: `reordenarAlbumFaixasController`**
  - Adicionar `topicId?: string` ao payload.
  - Ordenar `ordens` por `ordem`; para cada uma grava `U${row}` (como hoje) e chama `mirrorMusicaRowParaD1(row)`.
  - Se `topicId`: `readValues("Albuns")`, achar a linha com `B === topicId` (rowIndex = índice + 1, linha 1 é cabeçalho — mesma conta de `substituirAlbumController`); se não achar → 404 `"Álbum não encontrado."`. Ler títulos de Musicas!H de cada `musicaRowIndex` (uma `readValues("Musicas")` e indexar por `rowIndex - 1`), chamar `reordenarTracklist(lerTracklistAlbum(albumRow), titulos)` e gravar `M${rowIndex}` com `JSON.stringify(...)`. Erro aqui NÃO é engolido: cai no catch → 500.
- [ ] **Step 2: `substituirAlbumController`** — trocar `[...tracklistAtual, ...novasEntries]` por `mesclarTracklist(tracklistAtual, novasEntries)`; atualizar o comentário.
- [ ] **Step 3: Verificar tipos** — `npx tsc --noEmit -p .` (ou o tsconfig que cubra `backend/`) sem erro novo nos arquivos tocados; `bun test scripts/album-tracklist.test.ts` segue passando.
- [ ] **Step 4: Commit** — `"Reordenar faixas grava a tracklist do álbum (Albuns!M) e adicionar faixas não duplica"`

### Task 3: Front confere a resposta e manda topicId

**Files:**
- Modify: `src/components/EmpirePlay/EditModal.tsx` — `handleMoveFaixa` e `handleSetOrdem` (~331-387).

**Interfaces:**
- Consumes: endpoint da Task 2.

- [ ] **Step 1:** Extrair `salvarOrdemFaixas(reindexed: AlbumFaixa[]): Promise<void>` usado pelos dois handlers (hoje duplicam o fetch). Body inclui `topicId: editingItem?.fields?.topicId`. Se `!res.ok` ou `json.success !== true` (ou exceção): `setErrorMsg(json?.error || "Não foi possível salvar a nova ordem das faixas.")` e `fetchAlbumFaixas(topicId)` pra voltar ao estado real. Sucesso limpa `errorMsg`.
- [ ] **Step 2: Verificar** — `npx tsc --noEmit` sem erro novo em `EditModal.tsx`; `npx eslint src/components/EmpirePlay/EditModal.tsx`.
- [ ] **Step 3: Commit** — `"Gestão: reordenar faixas mostra erro e recarrega se o servidor falhar"`

### Task 4: Verificação com o Utopia

- [ ] Depois do deploy (feito pelo usuário), reordenar uma faixa do Utopia, reabrir a edição e conferir a ordem; no D1: `SELECT celulas_json FROM abas_espelho WHERE aba='Albuns' AND linha=108` → tracklist com as 14 faixas na ordem escolhida + "Immobilier Vous" no fim, ordens 1..15, sem títulos repetidos.
