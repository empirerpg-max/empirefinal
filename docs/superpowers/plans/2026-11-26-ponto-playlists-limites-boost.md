# Ponto > Playlists: limites, marca BOOST e saldo não negativo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Impedir playlists manuais repetidas por música/plataforma, limitar Music/Album Boost a 1 por plataforma por música/álbum na semana (marcado com `BOOST` na coluna F e escondido da lista), cobrar o boost pelo preço do Market e nunca deixar o saldo do artista negativo.

**Architecture:** Toda regra pura (ler linhas da aba, achar linha manual, contar boosts, calcular custo, escolher linhas para marcar) fica num módulo novo sem I/O, testado com `bun test`. Os controllers (`playlistsInvestimentoController`, `marketController`) só leem a planilha de forma fresca, chamam essas funções, gravam, releem e desfazem se a regra foi furada. Um endpoint admin pontual marca as linhas de boost desta semana (diagnóstico → aplicar).

**Tech Stack:** TypeScript, Cloudflare Worker (`backend/src`), Google Sheets via `googleSheetsService`, React/TanStack Router (`src/routes`), testes `bun:test` em `scripts/*.test.ts`.

**Spec:** `docs/superpowers/specs/2026-11-26-ponto-playlists-limites-boost-design.md`

## Global Constraints

- Aba `ECOIN + INVESTIMENTO` (planilha `registrosCharts`), dados a partir da linha 3. Colunas: C artista (idx 2), D saldo (fórmula, idx 3), E música (idx 4), **F marca (idx 5)**, G/I/K playlist Spotify/Apple/YouTube (idx 6/8/10). Nunca escrever em B, D, H, J, L, O.
- Marca exata: o texto `BOOST` em F. Comparações de artista/música sempre com `normalizeComparison`.
- Custo do boost = `item.preco` (MARKET_ITENS). A planilha desconta sozinha `PRECO_PLAYLIST_MINIMA[plataforma]`; o Worker cobra só `max(0, item.preco − PRECO_PLAYLIST_MINIMA[plataforma])` em `DADOS!AD` via `descontarSaldoArtista`.
- Trava: `saldo (DADOS!AI, leitura fresca) − custo ≥ 0`. Troca manual: custo = `preçoNovo − preçoAtualDaCélula` (troca para mais barata sempre passa). "Limpar" sempre passa.
- Leituras usadas para decidir regra/saldo usam `readValuesFresh` (nunca a leitura com cache).
- Mensagens de erro em PT-BR, diretas, mostrando valores em `R$ 1.234.567` (`toLocaleString("pt-BR")`). O saldo do boost mostra o preço do Market.
- Nada é apagado nem cobrado retroativamente nas compras já feitas.
- UI tocada segue `CLAUDE.md` (botões com `min-w-0`/`truncate`/`shrink-0`; voltar = tela anterior).

## Review Focus

1. **Dois cliques rápidos no mesmo Music Boost** (o caso do wes: 5 compras em 50 s) → só uma linha `BOOST` sobrevive por música+plataforma; as outras desfazem a linha e devolvem a diferença. Teste: `resolverCorridaBoost` em Task 1 + verificação manual na Task 3.
2. **Nome da música do boost escrito diferente do manual** (`"Max Gorghan - Paradise Artificiale"` vs `"Paradise Artificiale"`) → o limite de boost compara só linhas `BOOST` com o nome que o próprio boost grava; teste `contarBoosts ignora linhas manuais` em Task 1.
3. **Linha livre reaproveitada com `BOOST` antigo em F** (reset semanal não limpou F) → `iniciar` grava `F = ""`, e `parseLinhasEcoin` só considera linhas com C preenchido. Teste `linha sem artista nunca conta` em Task 1.
4. **Saldo exatamente igual ao custo** → permitido (fica zero, não negativo). Teste `saldoCobre(100000, 100000) === true` em Task 1.
5. **Troca manual para playlist mais barata com saldo já negativo** → permitida (custo ≤ 0). Teste `custoTrocaManual` em Task 1.

---

### Task 1: Módulo de regras puras

**Files:**
- Create: `backend/src/services/ecoinInvestimentoRegras.ts`
- Modify: `backend/src/controllers/playlistsInvestimentoController.ts` (exportar `precoPlaylist`)
- Test: `scripts/ecoin-investimento-regras.test.ts`

**Interfaces:**
- Produces (todas puras, sem I/O):
  - `type Plataforma = "SPOTIFY" | "APPLE MUSIC" | "YOUTUBE"`
  - `interface LinhaEcoin { linha: number; artista: string; musica: string; marca: string; spotify: string; apple: string; youtube: string }`
  - `const MARCA_BOOST = "BOOST"`
  - `parseLinhasEcoin(rows: string[][]): LinhaEcoin[]` — a partir do índice 2 (linha 3), `linha = i + 1`; descarta linhas com C vazio.
  - `ehBoost(l: LinhaEcoin): boolean` — `normalizeText(l.marca).toUpperCase() === "BOOST"`.
  - `playlistDa(l: LinhaEcoin, p: Plataforma): string`
  - `linhaManualDaMusica(linhas: LinhaEcoin[], artista: string, musica: string): LinhaEcoin | null` — não-boost, mesmo artista+música, menor `linha`.
  - `boostsDa(linhas: LinhaEcoin[], artista: string, musicaE: string, p: Plataforma): LinhaEcoin[]` — linhas `BOOST` do par com a plataforma `p` preenchida, ordenadas por `linha` crescente.
  - `resolverCorridaBoost(boosts: LinhaEcoin[], minhaLinha: number): "mantem" | "desfaz"` — `"mantem"` se `minhaLinha` é a menor.
  - `custoTrocaManual(precoNovo: number, precoAtual: number): number` — `precoNovo − precoAtual`.
  - `diferencaBoost(precoItem: number, precoMinimo: number): number` — `max(0, precoItem − precoMinimo)`.
  - `saldoCobre(saldo: number, custo: number): boolean` — `custo <= 0 || saldo - custo >= 0`.
  - `formatarReais(n: number): string` — `"R$ " + n.toLocaleString("pt-BR")`.
- Produces (em `playlistsInvestimentoController.ts`): `export function precoPlaylist(plataforma: string, playlist: string): number` (0 se vazio/desconhecido).

- [ ] **Step 1: Escrever os testes**

```ts
import { test, expect } from "bun:test";
const R = await import("../backend/src/services/ecoinInvestimentoRegras.ts");

const rows = [[], ["cab"],
  ["", "X", "Max Gorghan", "R$ 60.000", "Max Gorghan - Paradise Artificiale", "", "TOPO TODAY'S TOP HITS", "", "TOPO TODAY'S HITS", "", "Ad 5 segundos (Comercial/Vídeo)"],
  ["", "Y", "Max Gorghan", "", "Max Gorghan - Paradise Artificiale", "BOOST", "THIS IS... (ARTIST)"],
  ["", "Z", "Max Gorghan", "", "Max Gorghan - Paradise Artificiale", "BOOST", "THIS IS... (ARTIST)"],
  ["", "W", "", "", "", "BOOST", "THIS IS... (ARTIST)"],
];

test("parse começa na linha 3 e linha sem artista nunca conta", () => {
  const l = R.parseLinhasEcoin(rows);
  expect(l.map((x) => x.linha)).toEqual([3, 4, 5]);
});
test("linhaManualDaMusica ignora BOOST", () => {
  expect(R.linhaManualDaMusica(R.parseLinhasEcoin(rows), "max gorghan", "MAX GORGHAN - PARADISE ARTIFICIALE")?.linha).toBe(3);
});
test("contarBoosts ignora linhas manuais e filtra plataforma", () => {
  const l = R.parseLinhasEcoin(rows);
  expect(R.boostsDa(l, "Max Gorghan", "Max Gorghan - Paradise Artificiale", "SPOTIFY").map((x) => x.linha)).toEqual([4, 5]);
  expect(R.boostsDa(l, "Max Gorghan", "Max Gorghan - Paradise Artificiale", "APPLE MUSIC")).toEqual([]);
});
test("resolverCorridaBoost mantém a menor linha", () => {
  const b = R.boostsDa(R.parseLinhasEcoin(rows), "Max Gorghan", "Max Gorghan - Paradise Artificiale", "SPOTIFY");
  expect(R.resolverCorridaBoost(b, 4)).toBe("mantem");
  expect(R.resolverCorridaBoost(b, 5)).toBe("desfaz");
});
test("custos e saldo", () => {
  expect(R.custoTrocaManual(100000, 370000)).toBe(-270000);
  expect(R.saldoCobre(-50000, -270000)).toBe(true);
  expect(R.saldoCobre(100000, 100000)).toBe(true);
  expect(R.saldoCobre(60000, 100000)).toBe(false);
  expect(R.diferencaBoost(200000, 100000)).toBe(100000);
  expect(R.diferencaBoost(200000, 200000)).toBe(0);
  expect(R.diferencaBoost(200000, 250000)).toBe(0);
  expect(R.formatarReais(1500000)).toBe("R$ 1.500.000");
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `bun test scripts/ecoin-investimento-regras.test.ts`
Expected: FAIL (módulo não existe)

- [ ] **Step 3: Implementar o módulo e `precoPlaylist`**

Importar `normalizeText`/`normalizeComparison` de `googleSheetsService`. `precoPlaylist` usa o mapa `PLATAFORMAS[plataforma]?.precos[playlist] ?? 0`.

- [ ] **Step 4: Rodar e ver passar**

Run: `bun test scripts/ecoin-investimento-regras.test.ts`
Expected: PASS, 0 fail

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/ecoinInvestimentoRegras.ts backend/src/controllers/playlistsInvestimentoController.ts scripts/ecoin-investimento-regras.test.ts
git commit -m "feat(ponto): regras puras de linha manual, boost e saldo"
```

---

### Task 2: Ponto > Playlists respeita as regras

**Files:**
- Modify: `backend/src/controllers/playlistsInvestimentoController.ts` (`getInvestimentosController`, `iniciarInvestimentoController`, `investirPlaylistController`)
- Modify: `backend/src/controllers/marketController.ts` (adicionar `getSaldoEcoinFresco`)
- Modify: `src/routes/ponto.playlists.planilha.tsx:519-523` (aviso "Saldo estourado")

**Interfaces:**
- Consumes: Task 1 inteira; `precoPlaylist`.
- Produces: `export async function getSaldoEcoinFresco(artista: string): Promise<number>` em `marketController.ts` — mesma leitura/parse de `getSaldosEcoin` (`DADOS!AC1:AI5000`, coluna AI), mas com `readValuesFresh`; retorna 0 se não achar.

- [ ] **Step 1: `getInvestimentosController`** — descarta linhas com `ehBoost` (usar `rows[i][5]`) antes de agrupar. O saldo continua vindo de D das linhas que restam; se o artista só tiver linhas `BOOST`, ele simplesmente não tem grupo (mesmo comportamento de hoje para artista sem linha).

- [ ] **Step 2: `iniciarInvestimentoController`** — trocar a busca de idempotência por `linhaManualDaMusica(parseLinhasEcoin(rowsFrescas), artista, musica)`: se existir, retorna essa linha **com ou sem playlist**. Ao reivindicar linha livre, gravar também `F{linha} = ""`. Leitura com `readValuesFresh`.

- [ ] **Step 3: `investirPlaylistController`** — antes de gravar:
  - recusar (403) se a linha for `BOOST` ("Essa linha é de um Music Boost e não pode ser editada aqui.");
  - `precoAtual = precoPlaylist(plataforma, célulaAtual)`, `custo = custoTrocaManual(precoNovo, precoAtual)`;
  - `saldo = await getSaldoEcoinFresco(artistaDaLinha)`; se `!saldoCobre(saldo, custo)` → 400 com `"Saldo insuficiente: " + formatarReais(saldo) + " disponível, essa troca custa " + formatarReais(custo) + "."`.
  Depois de gravar: reler o saldo fresco; se `< 0` e `custo > 0`, regravar a célula com o valor anterior e responder 409 "Saldo insuficiente (outra compra entrou ao mesmo tempo). Nada foi alterado.". `somarPrestigio` só roda se passou.

- [ ] **Step 4: Front** — em `ponto.playlists.planilha.tsx`, trocar o texto "Saldo estourado — pode continuar, mas fica no vermelho." por "Saldo no vermelho — só dá pra trocar por playlists mais baratas." (o erro do backend já aparece via `setMsg`).

- [ ] **Step 5: Verificar tipos e testes**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "playlistsInvestimento|marketController|ponto.playlists" ; bun test scripts/ecoin-investimento-regras.test.ts`
Expected: nenhuma linha de erro nesses arquivos; testes PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/controllers/playlistsInvestimentoController.ts backend/src/controllers/marketController.ts src/routes/ponto.playlists.planilha.tsx
git commit -m "feat(ponto): uma linha manual por música, esconde BOOST e trava saldo negativo"
```

---

### Task 3: Market — limite de boost, marca, cobrança da diferença e desfazer

**Files:**
- Modify: `backend/src/controllers/marketController.ts` (`escreverBoostEmEcoinInvestimento`, `registrarMusicBoostInvestimento`, `registrarAlbumBoostInvestimento`, ramo `ecoin_investimento` de `comprarItemController`, `descontarSaldoArtista`)

**Interfaces:**
- Consumes: Task 1; `getSaldoEcoinFresco` (Task 2); `PRECO_PLAYLIST_MINIMA`, `PLAYLIST_MINIMA`.
- Produces: `async function comprarBoost(p: { artista: string; nomeE: string; plataforma: Plataforma; precoItem: number; rotuloPlataforma: string }): Promise<{ ok: true } | { ok: false; error: string; status: number }>` (interna ao `marketController.ts`).

- [ ] **Step 1: `descontarSaldoArtista` passa a usar `readValuesFresh`** (mesmo range `DADOS!AC1:AD5000`), para encurtar a janela de ler-alterar-gravar. Devolver saldo = chamar com valor negativo.

- [ ] **Step 2: Implementar `comprarBoost`** nesta ordem:
  1. `nomeE` já resolvido pelo chamador (Music: `resolverNomeCompletoMusica`; Album: `"(ALBUM) - " + título`).
  2. Ler a aba fresca → `boostsDa(...)`; se `length > 0` → `{ ok:false, status:400, error: "Essa música já tem Music Boost no " + rotuloPlataforma + " essa semana." }` (Album: "Esse álbum já tem Album Boost…").
  3. `saldo = getSaldoEcoinFresco(artista)`; se `!saldoCobre(saldo, precoItem)` → 400 `"Saldo insuficiente: " + formatarReais(saldo) + " disponível, o boost custa " + formatarReais(precoItem) + "."`.
  4. `acharLinhaLivreEcoinInvestimento()`; gravar C, E, `F = "BOOST"`, G/I/K = `PLAYLIST_MINIMA[plataforma]`.
  5. `dif = diferencaBoost(precoItem, PRECO_PLAYLIST_MINIMA[plataforma])`; se `> 0`, `descontarSaldoArtista(artista, dif)`.
  6. Reler aba fresca e saldo fresco. Se `resolverCorridaBoost(boostsDa(...), minhaLinha) === "desfaz"` ou saldo `< 0`: limpar C, E, F e G/I/K da minha linha, `descontarSaldoArtista(artista, -dif)` se `dif > 0`, e retornar 409 ("Outra compra entrou ao mesmo tempo — essa não foi feita, nada foi cobrado.").
- [ ] **Step 3: Ligar no `comprarItemController`** — no ramo `music_boost`/`album_boost`, chamar `comprarBoost` com `precoItem = item.preco`; se `ok:false`, responder `{ success:false, error }` com o `status` e **não** chamar `registrarCompra`. Remover `escreverBoostEmEcoinInvestimento`/`registrar*BoostInvestimento` que ficarem sem uso.

- [ ] **Step 4: Verificar tipos e testes**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep marketController ; bun test scripts/ecoin-investimento-regras.test.ts`
Expected: sem erros em `marketController`; testes PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/controllers/marketController.ts
git commit -m "feat(market): boost marcado, 1 por plataforma por semana, cobra preço do Market e nunca negativa saldo"
```

---

### Task 4: Marcação retroativa desta semana (diagnóstico → aplicar)

**Files:**
- Modify: `backend/src/services/ecoinInvestimentoRegras.ts` (função pura)
- Create: `backend/src/controllers/adminMarcarBoostsSemanaController.ts`
- Modify: `backend/src/routes/api.ts` (registrar `/api/ponto/playlists/admin/marcar-boosts-semana` igual a `/api/ponto/playlists/admin/fix-duplicata-samantha-cooper`, inclusive no `supportedPaths` da linha ~741)
- Test: `scripts/ecoin-investimento-regras.test.ts`

**Interfaces:**
- Consumes: Task 1; `semanaAtual()`, `PLAYLIST_MINIMA` .
- Produces: `interface CompraBoost { tipo: "music_boost" | "album_boost"; artista: string; detalhe: string }` e `escolherLinhasBoostRetroativas(linhas: LinhaEcoin[], compras: CompraBoost[], minimas: Record<Plataforma, string>): { marcar: number[]; ambiguas: number[] }`.

Regra da função: candidata = não-boost, exatamente uma plataforma preenchida e ela igual à mínima daquela plataforma. Casa com uma compra quando o artista bate e (music) `normalizeComparison(E)` termina com `normalizeComparison(detalhe)` ou (album) `E` = `"(ALBUM) - " + detalhe`. Por par artista+detalhe, marca no máximo `nº de compras` candidatas, **as de maior número de linha primeiro**. Uma candidata é `ambigua` quando é a única linha não-boost daquele par (pode ser a manual).

- [ ] **Step 1: Teste** `escolherLinhasBoostRetroativas` com as linhas reais da Paradise Artificiale (linha 5 manual completa; linhas 7–11 com uma mínima cada) e 5 compras `music_boost` "Paradise Artificiale" → `marcar = [7,8,9,10,11]`, `ambiguas = []`; e um caso com 1 linha manual só "THIS IS... (ARTIST)" e 1 compra → `ambiguas` contém essa linha e `marcar` não.
- [ ] **Step 2: Rodar e ver falhar** — `bun test scripts/ecoin-investimento-regras.test.ts` → FAIL.
- [ ] **Step 3: Implementar a função** e ver PASS.
- [ ] **Step 4: Controller** — GET; lê fresco `ECOIN + INVESTIMENTO` e `usuarios!Market_Compras` (D ProdutoID, G Detalhe, J Artista, K semana = `semanaAtual()`); responde `{ marcar, ambiguas, linhas: <detalhe de cada uma> }`. Só com `?aplicar=1` grava `F = "BOOST"` nas `marcar` (nunca nas `ambiguas`).
- [ ] **Step 5: tsc + testes** — mesmos comandos das tasks anteriores, sem erros, PASS.
- [ ] **Step 6: Commit**

```bash
git add backend/src/services/ecoinInvestimentoRegras.ts backend/src/controllers/adminMarcarBoostsSemanaController.ts backend/src/routes/api.ts scripts/ecoin-investimento-regras.test.ts
git commit -m "feat(ponto): endpoint admin pra marcar os boosts desta semana"
```

**Depois do deploy (fora do código):** abrir o endpoint sem `aplicar`, mostrar a lista ao dono e só então rodar com `?aplicar=1`.
