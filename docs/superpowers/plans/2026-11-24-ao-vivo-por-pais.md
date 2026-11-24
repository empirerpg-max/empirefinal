# Ao vivo por país — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** No "Ao vivo", cada plataforma ganha a visão **Por país**: streams ao vivo da EM Alta × fatia do país pela regra C, Top 50 por país, atualizando a cada 30 s.

**Architecture:** Função pura `rankingAoVivoPorPais` (reaproveita `valoresPorPais` da regra C) + carregador `calcularAoVivoPaises` que lê do D1 as referências (pesos, nacionalidade, foco, `chart_config`, próxima data de chart) em cache de 5 min; nova ação `getRealTimePaises` em `/api/charts` com cache de 30 s; front mostra **Mundo | Por país** dentro da plataforma.

**Tech Stack:** TypeScript, Cloudflare Workers + D1, Bun tests, React + Tailwind.

**Spec:** `docs/superpowers/specs/2026-11-24-ao-vivo-por-pais-design.md`

## Global Constraints

- Mesmo input → mesmo resultado; sorteio pela **próxima data de chart** (última data do Global 100 em `chart_datas` + 7 dias), nunca pela hora atual.
- Regras = `regrasDeConfig(chart_config atual)`; pesos = `pais_peso` da plataforma (SPOTIFY / APPLE MUSIC / YOUTUBE).
- Soma dos países + resto = streams ao vivo da música.
- Uma leitura da EM Alta serve Mundo e países; nenhuma leitura extra por jogador.
- Regras de botões/tabs do `CLAUDE.md`; textos em português; app roda no Cloudflare.

## Review Focus

1. **"Ao vivo" que não atualiza:** hoje `getRealTime` passa pelo `fetchCached` do front (cache sem prazo) e pelo cache de 5 min do servidor, então o intervalo de 30 s não traz dados novos. Os dados ao vivo (Mundo e países) precisam mudar a cada 30 s. → Task 3.
2. **Título da EM Alta fora do catálogo:** a música entra sem nacionalidade/foco (só pesos base), nunca some nem quebra. → teste na Task 1.
3. **Nenhuma data de chart no D1 / sem pesos:** resposta vazia, sem erro; o Mundo continua. → teste na Task 2.
4. **Valor ao vivo vazio ou não numérico** ("", "-"): conta como 0, sem `NaN`. → teste na Task 1.
5. **País escolhido some da lista na atualização seguinte:** a tela cai no primeiro país, sem tela vazia. → Task 4.

---

### Task 1: Ranking ao vivo por país (função pura)

**Files:**
- Create: `backend/src/services/chartsD1/aoVivoPaises.ts`
- Test: `scripts/charts-paises.test.ts`

**Interfaces:**
- Consumes: `EntradaMusica`, `valoresPorPais(musicas, pesos, dataIso, r)` (paises.ts); `RegraPaises` (regras.ts); `normalizarTitulo` (o mesmo usado para `titulo_norm` na ingestão — conferir em repo.ts/dados.ts).
- Produces:
  - `interface ItemAoVivo { t: string; n: number /* streams ao vivo */; c: string /* capa */; artistas: string[]; nacionalidades: Set<string>; foco: string | null }`
  - `interface LinhaAoVivoPais { pais: string; pos: number; t: string; s: string /* formatado pt-BR */; c: string; art: string }`
  - `rankingAoVivoPorPais(itens: ItemAoVivo[], pesos: Pesos, dataIso: string, r: RegraPaises): LinhaAoVivoPais[]` — para cada país de `pesos`, ordem de países = peso desc (empate por nome); dentro do país, valor bruto desc (empate por `tituloNorm`), Top `r.top_pais`; `s` = `Math.round(valor)` formatado `toLocaleString("pt-BR")`; `art` = primeiro artista ou parte antes de " - " no título. `n` não finito → 0.

- [ ] **Step 1: Write the failing tests**

```ts
test("ao vivo por país: soma + resto = streams; fatia fixa na semana; países por peso", () => {
  const pesos: Pesos = new Map([["EUA", 0.3], ["BRASIL", 0.05], ["AUSTRÁLIA", 0.02]]);
  const R = REGRAS_PADRAO.paises;
  const it = (t: string, n: number, nac: string[] = []): ItemAoVivo =>
    ({ t, n, c: "", artistas: [t.split(" - ")[0]], nacionalidades: new Set(nac), foco: null });
  const a = rankingAoVivoPorPais([it("A - x", 1000, ["BRASIL"]), it("B - y", 800)], pesos, "2026-11-18", R);
  expect([...new Set(a.map((l) => l.pais))]).toEqual(["EUA", "BRASIL", "AUSTRÁLIA"]);
  const b = rankingAoVivoPorPais([it("A - x", 2000, ["BRASIL"]), it("B - y", 1600)], pesos, "2026-11-18", R);
  // streams dobraram → valores dobram (mesma fatia na mesma semana)
  const va = (l: LinhaAoVivoPais[], p: string, t: string) => Number(l.find((x) => x.pais === p && x.t === t)!.s.replace(/\./g, ""));
  expect(Math.abs(va(b, "BRASIL", "A - x") - 2 * va(a, "BRASIL", "A - x"))).toBeLessThanOrEqual(1);
  expect(rankingAoVivoPorPais([it("A - x", 1000, ["BRASIL"])], pesos, "2026-11-18", R))
    .toEqual(rankingAoVivoPorPais([it("A - x", 1000, ["BRASIL"])], pesos, "2026-11-18", R));
});
test("ao vivo por país: valor inválido conta 0; sem nacionalidade não some", () => {
  const pesos: Pesos = new Map([["BRASIL", 0.05]]);
  const r = rankingAoVivoPorPais(
    [{ t: "Z - w", n: NaN, c: "", artistas: [], nacionalidades: new Set(), foco: null }],
    pesos, "2026-11-18", REGRAS_PADRAO.paises);
  expect(r).toEqual([{ pais: "BRASIL", pos: 1, t: "Z - w", s: "0", c: "", art: "Z" }]);
});
```

- [ ] **Step 2: Run** `bun test scripts/charts-paises.test.ts` — Expected: FAIL (módulo não existe).
- [ ] **Step 3: Implement** `aoVivoPaises.ts` (monte `EntradaMusica` com `tituloNorm = normalizarTitulo(t)`, `valor = n`, e use `valoresPorPais`).
- [ ] **Step 4: Run** `bun test scripts/charts-paises.test.ts scripts/charts-d1.test.ts` — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(charts): ranking ao vivo por país (regra C)"`

---

### Task 2: Carregador do ao vivo por país (D1 + EM Alta)

**Files:**
- Modify: `backend/src/services/chartsD1/aoVivoPaises.ts`
- Test: `scripts/charts-paises.test.ts` (SQLite em memória via `criarD1Sqlite`, como os testes de `calcularSemanaPaises`)

**Interfaces:**
- Consumes: Task 1; `carregarFocos`/`focoVigente` (foco.ts); `regrasDeConfig` (regras.ts); `buscarNoCatalogo`, `extrairArtistasDoTitulo`, `semAcentoMaiusculo` (artistas.ts); `mapaPaisPorNome` (paradas.ts).
- Produces:
  - `type PlataformaAoVivo = "spotify" | "apple" | "youtube"` (mapeia para "SPOTIFY" / "APPLE MUSIC" / "YOUTUBE" em `pais_peso`)
  - `interface ItemEmAlta { t: string; n: number; c: string }`
  - `async function calcularAoVivoPaises(db: D1DatabaseLike, emAlta: Record<PlataformaAoVivo, ItemEmAlta[]>, cat: Map<string, MusicaCatalogo>): Promise<Record<PlataformaAoVivo, LinhaAoVivoPais[]>>`
  - `function proximaDataChart(ultimaIso: string): string` — ISO + 7 dias (UTC).

Regras do carregador:
- Referências lidas em paralelo: `SELECT MAX(data) AS data FROM chart_datas WHERE chart = 'BILLBOARD HOT 100'`, `pais_peso`, `artista_info` (nacionalidade), `carregarFocos`, `chart_config`. Guardar em cache de módulo por 5 min (exportar `limparCacheAoVivoPaises()` para os testes e para `limparCacheCharts`).
- Sem data de chart ou sem pesos da plataforma → lista vazia daquela plataforma (sem erro). Erro de D1 → todas vazias + `console.warn`.
- Artistas: `buscarNoCatalogo(t, cat)?.artistas`; senão `extrairArtistasDoTitulo(t)` filtrado pelos nomes conhecidos em `artista_info`. Nacionalidade e foco resolvidos para o nome de `pais_peso` sem acento/caixa (mesmo `mapaPaisPorNome`); foco = `focoVigente(h, codigoUnico, proximaData)`, `GLOBAL` = null.

- [ ] **Step 1: Write the failing tests**

```ts
test("calcularAoVivoPaises: usa próxima data de chart; vazio sem chart_datas/pesos", async () => {
  expect(proximaDataChart("2026-11-11")).toBe("2026-11-18");
  const vazio = criarD1Sqlite(); // sem tabelas
  limparCacheAoVivoPaises();
  expect(await calcularAoVivoPaises(vazio, { spotify: [{ t: "A - x", n: 10, c: "" }], apple: [], youtube: [] }, new Map()))
    .toEqual({ spotify: [], apple: [], youtube: [] });
  const db = await bancoDeTeste(); // helper existente: semanas 04/11 e 11/11, pesos, artista_info
  limparCacheAoVivoPaises();
  const r = await calcularAoVivoPaises(db, { spotify: [{ t: "A - x", n: 1000, c: "" }], apple: [], youtube: [] }, new Map());
  expect(r.spotify.length).toBeGreaterThan(0);
  expect(r.apple).toEqual([]);
  limparCacheAoVivoPaises();
  expect(await calcularAoVivoPaises(db, { spotify: [{ t: "A - x", n: 1000, c: "" }], apple: [], youtube: [] }, new Map())).toEqual(r);
});
```

(Ajuste nomes de música/país ao que o `bancoDeTeste` existente semeia.)

- [ ] **Step 2: Run** — Expected: FAIL. **Step 3: Implement.** **Step 4: Run** testes + `bunx tsc --noEmit -p .` (só o erro pré-existente `adminAlbunsD1Controller.ts:175`) — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(charts): carregador do ao vivo por país"`

---

### Task 3: API do ao vivo (por país + atualização real a cada 30 s)

**Files:**
- Modify: `backend/src/controllers/chartsController.ts` (`fetchRT` ~L330, ações ~L744, cache de resposta ~L677-720, `limparCacheCharts`)
- Modify: `src/lib/charts.ts` (`getRealTime` ~L104; novo `getRealTimePaises`)
- Test: `scripts/charts-paises.test.ts` (handler sobre SQLite + planilha simulada, como os testes da Task 6 anterior)

**Interfaces:**
- Consumes: `calcularAoVivoPaises`, `ItemEmAlta`, `limparCacheAoVivoPaises` (Task 2); `referenciasD1` / `getCatalogoDb` já existentes.
- Produces:
  - `fetchRTBruto(): Promise<Record<PlataformaAoVivo, (ItemEmAlta & { p: string })[]>>` — a leitura atual da EM Alta, com `n` = número bruto da col. D (`parseNumeroBR`, inválido → 0); `fetchRT` passa a derivar dele (mesma saída de hoje: `{t, s: fmt, p, c}`).
  - Uma leitura da EM Alta por 30 s por isolate, compartilhada entre `getRealTime` e `getRealTimePaises`.
  - Ação `getRealTimePaises` → `{ spotify: LinhaAoVivoPais[], apple: [...], youtube: [...] }`; fora do D1 / erro → listas vazias.
  - `chartsResponseCache`: ações `getRealTime` e `getRealTimePaises` com TTL **30 s** (as outras continuam 5 min).
  - Front: `getRealTime()` e `getRealTimePaises()` **não** usam o `fetchCached` (fazem `fetch` direto, com fallback para o último valor bom se a resposta vier vazia/erro). Tipo `RealTimePaisesData = { spotify?: ChartRow[]; apple?: ChartRow[]; youtube?: ChartRow[] }`.

- [ ] **Step 1: Write the failing tests** — (a) duas chamadas de `getRealTimePaises` em menos de 30 s leem a EM Alta 1 vez; com o relógio adiantado 31 s (injete `Date.now` ou exporte um helper de TTL), leem de novo; (b) `getRealTime` continua devolvendo exatamente o formato `{t, s, p, c}` de hoje; (c) `getRealTimePaises` sem D1 → `{spotify: [], apple: [], youtube: []}`.
- [ ] **Step 2: Run** — Expected: FAIL. **Step 3: Implement.** **Step 4: Run** testes + tsc — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(charts): API do ao vivo por país e atualização real a cada 30 s"`

---

### Task 4: Tela — Mundo | Por país no Ao vivo

**Files:**
- Modify: `src/routes/charts.tsx` (`ChartsRealTime` ~L191-300)

**Interfaces:**
- Consumes: `getRealTimePaises()`, `RealTimePaisesData` (Task 3).

Comportamento:
- Na tela de uma plataforma (`activeCol`), abaixo do título: alternador **Mundo | Por país** (dois pills, padrão `ChartsPill`/`chartsPillClass`).
- **Por país:** busca `getRealTimePaises()` junto com o `getRealTime()` no mesmo intervalo de 30 s (só quando a visão Por país estiver aberta). Seletor de país rolável com `PillScroller` (já usa `useDragScroll` + setas), países na ordem que a API devolve (peso desc). País padrão = o primeiro; se o país escolhido não vier na atualização, volta ao primeiro.
- Lista igual à do Mundo (posição, capa, título, valor, barra), com os itens do país escolhido; vazio → "Sem dados por país agora."
- Voltar ("‹ Ao vivo") volta para a grade e reseta para Mundo.
- Regras do `CLAUDE.md` em todos os pills (`shrink-0`, padding real, sem `truncate` em barra de tabs).

- [ ] **Step 1:** Implementar.
- [ ] **Step 2: Run** `bunx tsc --noEmit -p .` — sem erros novos.
- [ ] **Step 3: Verificação visual:** renderizar a tela com `fetch` simulado (como as tarefas de tela anteriores; `bun run dev` não sobe neste ambiente) e tirar screenshots Playwright a 390 px e 1280 px: alternador visível, país rola, nenhum texto cortado, trocar de país troca a lista.
- [ ] **Step 4: Commit** `git commit -m "feat(charts): ao vivo por país na tela"`

---

## Self-review (feito)

- Cobertura do spec: regra C/sorteio da semana em andamento (T1, T2), regras = chart_config atual (T2), Top 50 + países por peso (T1), API + cache 30 s + uma leitura da EM Alta (T3), tela Mundo | Por país (T4), vazio sem erro (T2, T3, T4).
- Achado na leitura do código (Review Focus 1): o "Ao vivo" de hoje não atualiza de verdade — corrigido na T3 porque o spec pede "atualiza a cada 30 s como hoje".
- Nomes consistentes: `ItemAoVivo`, `LinhaAoVivoPais`, `rankingAoVivoPorPais`, `ItemEmAlta`, `PlataformaAoVivo`, `calcularAoVivoPaises`, `proximaDataChart`, `limparCacheAoVivoPaises`, `fetchRTBruto`, `getRealTimePaises`.
