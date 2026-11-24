# Paradas oficiais por país + foco do lançamento — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trocar a regra de países por uma regra imprevisível e fixa por data (nacionalidade + foco + sorteio), criar 11 paradas oficiais por país + Global Excl. US com metodologia própria, e o campo "foco do lançamento" no cadastro do single.

**Architecture:** Tudo calculado **na leitura** no Worker a partir de `chart_semana` (D1), com funções puras testáveis (`sorteio.ts`, `paises.ts` regra C, `paradas.ts`, `foco.ts`) e um orquestrador (`semanaPaises.ts`) que calcula a semana inteira de uma vez e guarda em cache por isolate. Regras por semana congeladas em `chart_regras_semana`; foco com histórico em `musica_foco`.

**Tech Stack:** TypeScript, Cloudflare Workers + D1, Bun (`bun test`), React + TanStack Router, Google Apps Script.

**Spec:** `docs/superpowers/specs/2026-11-24-charts-paradas-nacionais-foco-design.md`

## Global Constraints

- Os 5 charts recebidos nunca mudam; por música/plataforma, Σ países + resto × total = total global.
- Mesma data → mesmo resultado para qualquer jogador (sem `Math.random`, sem data/hora atual no cálculo).
- D1 gratuito: nenhuma gravação em massa; +1 escrita/semana (`chart_regras_semana`).
- Ids internos `BILLBOARD HOT 100` / `SPOTIFY` não mudam; só rótulos.
- Regra de botões/tabs do `CLAUDE.md` (pills `shrink-0`, padding real, sem truncar em barra de tabs; seletor rolável com `useDragScroll` + `StickyScrollArrowLeft/Right`).
- App roda no Cloudflare, não no Telegram.
- Textos visíveis em português.

## Review Focus

1. **Semana em que uma plataforma não existe** (Apple Music antes de 20/01/2022, Digital Sales antes de 11/04/2025): paradas calculam com as fontes que existem, sem `NaN`, sem quebrar. → teste em Task 4.
2. **Nome de país de `pais_peso` diferente do da parada** ("EUA" vs "ESTADOS UNIDOS"): resolve por aliases; se nenhum existir, a parada é omitida (não aparece vazia nem quebra). → teste em Task 4.
3. **A mesma música com títulos levemente diferentes entre plataformas**: junta pelas fontes via `titulo_norm`; não aparece duplicada numa parada. → teste em Task 4.
4. **Primeira semana do histórico / semana sem anterior**: todo `st` = `NEW`, sem erro. → teste em Task 4.
5. **Música sem nacionalidade cadastrada e sem foco**: recebe só pesos base × variação; soma ainda fecha 100%. → teste em Task 2.

---

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `backend/src/services/chartsD1/sorteio.ts` (novo) | `sorteio01` — hash determinístico → [0,1) |
| `backend/src/services/chartsD1/regras.ts` (novo) | tipos e padrões de `RegrasSemana` (regra C + paradas), merge com `chart_config` |
| `backend/src/services/chartsD1/paises.ts` (reescrito) | regra C: fatias por país, rankings por país |
| `backend/src/services/chartsD1/foco.ts` (novo) | schema `musica_foco`, `focoVigente` |
| `backend/src/services/chartsD1/paradas.ts` (novo) | fontes por país, metodologias, ACR, recorrência, máx. por artista, Excl. US |
| `backend/src/services/chartsD1/semanaPaises.ts` (novo) | lê D1, monta entradas, chama as funções puras, devolve COUNTRIES + PARADAS da semana |
| `backend/src/services/chartsD1/repo.ts` | schema `chart_regras_semana`, gravação na ingestão, `codigoUnico` no catálogo; remove `linhasPaises` |
| `backend/src/services/chartsD1/artistas.ts` | `MusicaCatalogo.codigoUnico` |
| `backend/src/controllers/chartsController.ts` | aba `PARADAS OFICIAIS`, COUNTRIES via `semanaPaises` |
| `backend/src/controllers/musicaFocoController.ts` (novo) + `backend/src/routes/api.ts` | `GET/POST /api/musica-foco`, `GET /api/musica-foco/paises` |
| `src/lib/focoMusica.ts` (novo) + `src/components/EmpirePlay/FocoSelect.tsx` (novo) | cliente e select do foco |
| `src/components/EmpirePlay/Gestao.tsx`, `EditModal.tsx`, `LancarFaixaAlbumModal.tsx` | foco obrigatório onde nasce single; edição única |
| `src/routes/charts.tsx`, `src/routes/artistas.$nome.index.tsx`, `src/routes/index.tsx` | rótulos Global 100 / Spotify Global, tab Paradas Oficiais |
| `scripts/charts-paises.test.ts` (novo) | testes das funções puras |
| `docs/charts-regras-paises.md` (novo) | documento para mantenedores |

Testes: `bun test scripts/charts-paises.test.ts` e `bun test scripts/charts-d1.test.ts` (existente).

---

### Task 1: Sorteio determinístico e regras da semana

**Files:**
- Create: `backend/src/services/chartsD1/sorteio.ts`, `backend/src/services/chartsD1/regras.ts`
- Test: `scripts/charts-paises.test.ts`

**Interfaces:**
- Produces:
  - `sorteio01(chave: string): number` — FNV-1a 32 bits sobre UTF-8 de `chave`, `>>> 0`, ÷ 2^32.
  - `interface RegraPaises { nac_min: number; nac_max: number; foco_min: number; foco_max: number; bonus_teto: number; variacao: number; top_pais: number; fracao_paga_spotify: number }`
  - `interface Parada { id: string; nome: string; paises: string[] /* aliases, 1º que existir em pais_peso */; tipo: "unidades" | "receita" | "excl"; top: number; ordem: number; a: number; tp: number; tga: number; tgv: number; descricao: string; acr?: { semanas: number; quedas: number; tp: number; tga: number; tgv: number } | null; max_por_artista?: number | null; recorrencia?: { semanas: number; pos: number }[] | null }`
  - `interface RegrasSemana { versao: 1; paises: RegraPaises; paradas: Parada[] }`
  - `REGRAS_PADRAO: RegrasSemana`
  - `regrasDeConfig(cfg: Map<string, string>): RegrasSemana` — cada chave de `RegraPaises` sobrepõe o padrão se for número finito; `paradas` = `JSON.parse(cfg.get("paradas"))` se for array válido, senão padrão.
  - `parseRegrasSemana(json: string | null | undefined): RegrasSemana | null`

Valores de `REGRAS_PADRAO` (do spec, seção 8 e 16). Taxa `0` = fonte não conta. Para `tipo: "receita"`, `a`/`tp`/`tga`/`tgv` são **preços por unidade** (multiplicam), não divisores:

| id | nome | paises | tipo | top | a | tp | tga | tgv | extras | descricao |
|---|---|---|---|---|---|---|---|---|---|---|
| EUA | Billboard Hot 100 | ESTADOS UNIDOS, EUA, USA | unidades | 50 | 1 | 100 | 300 | 300 | recorrência `[{semanas:20,pos:50},{semanas:52,pos:25}]` | Estados Unidos · vendas + streaming |
| UK | UK Official Charts | REINO UNIDO, UK, INGLATERRA | unidades | 50 | 1 | 100 | 600 | 600 | acr `{semanas:9,quedas:3,tp:200,tga:1200,tgv:1200}`, max_por_artista 3 | Reino Unido · vendas + streaming |
| AU | ARIA Charts | AUSTRÁLIA | unidades | 50 | 1 | 100 | 600 | 600 | — | Austrália · vendas + streaming |
| JP | Oricon | JAPÃO | unidades | 50 | 2 | 300 | 300 | 300 | — | Japão · vendas pesam mais |
| KR | Circle Chart | COREIA DO SUL, CORÉIA DO SUL | unidades | 50 | 1 | 100 | 200 | 200 | — | Coreia do Sul · streaming + downloads |
| DE | Offizielle Deutsche Charts | ALEMANHA | receita | 50 | 1.29 | 0.008 | 0.0008 | 0.0008 | — | Alemanha · por receita |
| FR | SNEP | FRANÇA | unidades | 50 | 1 | 150 | 0 | 0 | — | França · vendas + streaming pago |
| CA | Billboard Canadian Hot 100 | CANADÁ | unidades | 50 | 1 | 100 | 300 | 300 | recorrência igual EUA | Canadá · vendas + streaming |
| BR | Billboard Brasil Hot 100 | BRASIL | unidades | 50 | 0 | 100 | 300 | 300 | — | Brasil · só streaming |
| AR | Billboard Argentina Hot 100 | ARGENTINA | unidades | 50 | 0 | 100 | 300 | 300 | — | Argentina · só streaming |
| MX | Billboard México | MÉXICO | unidades | 50 | 0 | 100 | 300 | 300 | — | México · só streaming |
| EXCL_US | Global Excl. US | ESTADOS UNIDOS, EUA, USA | excl | 100 | 1 | 100 | 300 | 300 | — | Mundo sem os EUA · vendas + streaming |

`ordem`: EXCL_US = 0 (primeiro no seletor); depois 1..11 na ordem EUA, UK, AU, JP, KR, DE, FR, CA, BR, AR, MX.

`RegraPaises` padrão: `nac_min 1.5, nac_max 4, foco_min 0.5, foco_max 1.5, bonus_teto 0.2, variacao 0.15, top_pais 50, fracao_paga_spotify 0.45`.

- [ ] **Step 1: Write the failing tests**

```ts
test("sorteio01: determinístico, em [0,1), varia com a chave", () => {
  expect(sorteio01("2026-11-11|x|BRASIL|nac")).toBe(sorteio01("2026-11-11|x|BRASIL|nac"));
  const v = ["a", "b", "c", "d", "e"].map(sorteio01);
  for (const x of v) { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThan(1); }
  expect(new Set(v).size).toBe(5);
});
test("regrasDeConfig: sobrepõe números válidos e paradas; ignora lixo", () => {
  const r = regrasDeConfig(new Map([["nac_max", "5"], ["variacao", "abc"], ["paradas", "[{\"id\":\"X\"}]"]]));
  expect(r.paises.nac_max).toBe(5);
  expect(r.paises.variacao).toBe(0.15);
  expect(r.paradas[0].id).toBe("X");
  expect(regrasDeConfig(new Map([["paradas", "{quebrado"]])).paradas.length).toBe(12);
});
test("parseRegrasSemana: null para vazio/inválido", () => {
  expect(parseRegrasSemana(null)).toBeNull();
  expect(parseRegrasSemana("{x")).toBeNull();
  expect(parseRegrasSemana(JSON.stringify(REGRAS_PADRAO))).toEqual(REGRAS_PADRAO);
});
```

- [ ] **Step 2: Run** `bun test scripts/charts-paises.test.ts` — Expected: FAIL (módulos não existem).
- [ ] **Step 3: Implement** `sorteio.ts` e `regras.ts` com as interfaces acima (`TextEncoder` para UTF-8; FNV offset `0x811c9dc5`, prime `0x01000193` via `Math.imul`).
- [ ] **Step 4: Run** `bun test scripts/charts-paises.test.ts` — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(charts): sorteio determinístico e regras por semana"`

---

### Task 2: Regra C (fatias por país)

**Files:**
- Modify (reescrever): `backend/src/services/chartsD1/paises.ts`
- Modify: `scripts/charts-d1.test.ts` (remover/trocar testes de `fatiasPorPais`/`rankingPais` da regra B)
- Test: `scripts/charts-paises.test.ts`

**Interfaces:**
- Consumes: `sorteio01`, `RegraPaises` (Task 1).
- Produces:
  - `type Pesos = Map<string, number>` (mantém)
  - `interface EntradaMusica { tituloNorm: string; titulo: string; artistaPrincipal: string; artistas: string[]; valor: number; nacionalidades: Set<string>; foco: string | null /* país já resolvido p/ nome de pais_peso, ou null; "GLOBAL" vira null */ }`
  - `fatiasRegraC(pesos: Pesos, m: Pick<EntradaMusica,"tituloNorm"|"nacionalidades"|"foco">, dataIso: string, r: RegraPaises): Map<string, number>` — fórmula exata da seção 7 do spec; chave do sorteio `` `${dataIso}|${tituloNorm}|${pais}|${k}` `` com `k` ∈ `nac`/`foco`/`var` (**sem** plataforma).
  - `valoresPorPais(musicas: EntradaMusica[], pesos: Pesos, dataIso: string, r: RegraPaises): Map<string /*tituloNorm*/, Map<string /*pais*/, number>>` — `valor × share`, sem arredondar.
  - `rankingsPorPais(atual: EntradaMusica[], anterior: EntradaMusica[], pesos: Pesos, dataIsoAtual: string, dataIsoAnterior: string | null, r: RegraPaises): Map<string, (Posicao & { st: "↑" | "↓" | "=" | "NEW" })[]>` — Top `r.top_pais` por país, ordenado pelo valor bruto, desempate por `tituloNorm`; `val` arredondado; `st` contra a anterior (calculada com `dataIsoAnterior`).
  - `Posicao` mantém `{ pos, tituloNorm, titulo, art, val }`.

- [ ] **Step 1: Write the failing tests**

```ts
const pesos: Pesos = new Map([["EUA", 0.3], ["AUSTRÁLIA", 0.02], ["BRASIL", 0.05]]);
const R = REGRAS_PADRAO.paises;
const m = (t: string, nac: string[] = [], foco: string | null = null) =>
  ({ tituloNorm: t, nacionalidades: new Set(nac), foco });

test("regra C: Σ pb ≥ 1 → fatias somam 1; Σ pb < 1 → sobra o resto (inclui música sem nacionalidade nem foco)", () => {
  const cheio: Pesos = new Map([["EUA", 0.7], ["BRASIL", 0.5]]);
  for (const x of [m("a"), m("b", ["BRASIL"]), m("c", ["EUA"], "BRASIL")]) {
    const soma = [...fatiasRegraC(cheio, x, "2026-11-11", R).values()].reduce((s, v) => s + v, 0);
    expect(soma).toBeCloseTo(1, 12);
    const somaParcial = [...fatiasRegraC(pesos, x, "2026-11-11", R).values()].reduce((s, v) => s + v, 0);
    expect(somaParcial).toBeGreaterThan(0);
    expect(somaParcial).toBeLessThan(1);
  }
});
test("regra C: determinística e sem depender da ordem dos pesos", () => {
  const inv: Pesos = new Map([...pesos].reverse());
  expect(fatiasRegraC(pesos, m("b", ["AUSTRÁLIA"]), "2026-11-11", R))
    .toEqual(fatiasRegraC(inv, m("b", ["AUSTRÁLIA"]), "2026-11-11", R));
});
test("regra C: nativo ganha mais que estrangeiro no seu país; bônus ≤ teto", () => {
  const nat = fatiasRegraC(pesos, m("x", ["AUSTRÁLIA"]), "2026-11-11", { ...R, variacao: 0 });
  const est = fatiasRegraC(pesos, m("x"), "2026-11-11", { ...R, variacao: 0 });
  expect(nat.get("AUSTRÁLIA")!).toBeGreaterThan(est.get("AUSTRÁLIA")! * 1.5);
  const eua = fatiasRegraC(pesos, m("y", ["EUA"]), "2026-11-11", { ...R, variacao: 0, nac_min: 4, nac_max: 4 });
  // pb 0.3 × 4 = 1.2 → limitado a 0.2
  expect(eua.get("EUA")!).toBeCloseTo((0.3 + 0.2) / (0.5 + 0.02 + 0.05 + 0.63), 9);
});
test("regra C: foco no país da nacionalidade não soma; com faixas padrão, foco < nacionalidade", () => {
  const z = { ...R, variacao: 0 };
  expect(fatiasRegraC(pesos, m("x", ["BRASIL"], "BRASIL"), "d", z)).toEqual(fatiasRegraC(pesos, m("x", ["BRASIL"]), "d", z));
  const foco = fatiasRegraC(pesos, m("x", [], "BRASIL"), "d", z).get("BRASIL")!;
  const nac = fatiasRegraC(pesos, m("x", ["BRASIL"]), "d", z).get("BRASIL")!;
  const nada = fatiasRegraC(pesos, m("x"), "d", z).get("BRASIL")!;
  expect(foco).toBeGreaterThan(nada);
  expect(foco).toBeLessThanOrEqual(nac); // foco_max 1.5 ≤ nac_min 1.5
});
test("hit mundial 4× maior vence nativo num país de 2%; nativo perto vence", () => {
  const z = { ...R, variacao: 0, nac_min: 3, nac_max: 3 };
  const mk = (t: string, valor: number, nac: string[]): EntradaMusica =>
    ({ tituloNorm: t, titulo: t, artistaPrincipal: t, artistas: [t], valor, nacionalidades: new Set(nac), foco: null });
  const r1 = rankingsPorPais([mk("hit", 1_000_000, ["EUA"]), mk("aus", 200_000, ["AUSTRÁLIA"])], [], pesos, "d", null, z);
  expect(r1.get("AUSTRÁLIA")![0].tituloNorm).toBe("hit");
  const r2 = rankingsPorPais([mk("hit", 1_000_000, ["EUA"]), mk("aus", 500_000, ["AUSTRÁLIA"])], [], pesos, "d", null, z);
  expect(r2.get("AUSTRÁLIA")![0].tituloNorm).toBe("aus");
});
test("rankingsPorPais: sem semana anterior → tudo NEW", () => {
  const e: EntradaMusica = { tituloNorm: "a", titulo: "A", artistaPrincipal: "x", artistas: ["x"], valor: 10, nacionalidades: new Set(), foco: null };
  expect(rankingsPorPais([e], [], pesos, "d", null, R).get("BRASIL")![0].st).toBe("NEW");
});
```

- [ ] **Step 2: Run** `bun test scripts/charts-paises.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** a regra C em `paises.ts` (apagar `fatiasPorPais` com `bonus`, `comFatias`, `rankingPais`, `rankingsDaSemana` da regra B). Atualizar `scripts/charts-d1.test.ts`: remover o import/testes da regra B (os novos ficam em `charts-paises.test.ts`).
- [ ] **Step 4: Run** `bun test scripts/charts-paises.test.ts scripts/charts-d1.test.ts` — Expected: PASS. (`linhasPaises` em `repo.ts` ainda importa a regra B → `bunx tsc --noEmit -p .` pode falhar aqui; é resolvido na Task 5. Não commitar com erro de tipo: se falhar, faça a Task 5 Step 3 parte "remover `linhasPaises`" junto.)
- [ ] **Step 5: Commit** `git commit -m "feat(charts): regra C de distribuição por país"`

---

### Task 3: Foco — vigência e tabela

**Files:**
- Create: `backend/src/services/chartsD1/foco.ts`
- Test: `scripts/charts-paises.test.ts`

**Interfaces:**
- Produces:
  - `FOCO_SCHEMA: string[]` — `CREATE TABLE IF NOT EXISTS musica_foco (codigo_unico TEXT NOT NULL, pais TEXT NOT NULL, desde TEXT NOT NULL, por_admin INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (codigo_unico, desde))`
  - `type HistoricoFoco = Map<string /*codigo_unico*/, { pais: string; desde: string }[]>` (ordenado por `desde` asc)
  - `indexarFocos(rows: { codigo_unico: string; pais: string; desde: string }[]): HistoricoFoco`
  - `focoVigente(h: HistoricoFoco, codigoUnico: string | undefined, dataIso: string): string | null` — linha de maior `desde < dataIso`; `"GLOBAL"` → `null`.
  - `async function carregarFocos(db: D1DatabaseLike): Promise<HistoricoFoco>` — `SELECT codigo_unico, pais, desde FROM musica_foco`; "no such table" → mapa vazio.

- [ ] **Step 1: Write the failing tests**

```ts
test("focoVigente: só depois de 'desde'; troca do admin não muda semanas anteriores; GLOBAL = null", () => {
  const h = indexarFocos([
    { codigo_unico: "EMP1", pais: "ESTADOS UNIDOS", desde: "2026-11-01" },
    { codigo_unico: "EMP1", pais: "REINO UNIDO", desde: "2026-11-20" },
    { codigo_unico: "EMP2", pais: "GLOBAL", desde: "2026-01-01" },
  ]);
  expect(focoVigente(h, "EMP1", "2026-11-01")).toBeNull();
  expect(focoVigente(h, "EMP1", "2026-11-11")).toBe("ESTADOS UNIDOS");
  expect(focoVigente(h, "EMP1", "2026-11-20")).toBe("ESTADOS UNIDOS");
  expect(focoVigente(h, "EMP1", "2026-11-27")).toBe("REINO UNIDO");
  expect(focoVigente(h, "EMP2", "2026-11-27")).toBeNull();
  expect(focoVigente(h, undefined, "2026-11-27")).toBeNull();
});
```

- [ ] **Step 2: Run** — Expected: FAIL. **Step 3: Implement.** **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(charts): histórico de foco do lançamento"`

---

### Task 4: Paradas oficiais (funções puras)

**Files:**
- Create: `backend/src/services/chartsD1/paradas.ts`
- Test: `scripts/charts-paises.test.ts`

**Interfaces:**
- Consumes: `Parada`, `RegrasSemana` (Task 1); `Posicao` (Task 2).
- Produces:
  - `type Plataforma = "SPOTIFY" | "APPLE MUSIC" | "YOUTUBE" | "DIGITAL SALES"`
  - `interface MusicaSemana { tituloNorm: string; titulo: string; artistaPrincipal: string; semanas: number /* Global 100 se estiver lá, senão maior entre plataformas */; totalGlobal: Partial<Record<Plataforma, number>>; porPais: Partial<Record<Plataforma, Map<string, number>>>; streamsGlobaisAnteriores: number[] /* [d-1, d-2, d-3] Spotify+Apple+YouTube; ausente = 0 */ }`
  - `resolverPaisParada(p: Parada, paisesExistentes: Set<string>): string | null` — 1º alias (comparado sem acento/caixa via `semAcentoMaiusculo`) presente; devolve o nome como está em `pais_peso`.
  - `fontes(m: MusicaSemana, pais: string | null /* null = mundo */, fracaoPaga: number): { vendas: number; pagos: number; gratis_audio: number; gratis_video: number }` — fórmula da seção 8 do spec; plataforma ausente = 0; `pais === null` usa `totalGlobal`.
  - `pontos(f: ReturnType<typeof fontes>, p: Pick<Parada,"tipo"|"a"|"tp"|"tga"|"tgv">): number` — `unidades`/`excl`: `a·vendas + pagos/tp + ga/tga + gv/tgv` (divisor 0 ⇒ termo 0); `receita`: `a·vendas + tp·pagos + tga·ga + tgv·gv`.
  - `emAcr(m: MusicaSemana, totalAtual: number, acr: NonNullable<Parada["acr"]>): boolean` — `m.semanas > acr.semanas` e `totalAtual < ant[0] < ant[1] < ant[2]` (caiu em cada uma das `quedas` últimas semanas).
  - `calcularParada(musicas: MusicaSemana[], p: Parada, pais: string, fracaoPaga: number): Posicao[]` — passos: pontos por música (ACR troca `tp/tga/tgv`); ordena desc por pontos, desempate pela soma de `totalGlobal` desc, depois `tituloNorm`; aplica `max_por_artista` (por `semAcentoMaiusculo(artistaPrincipal)`); aplica `recorrencia` (remove quem tem `semanas ≥ s` e posição provisória `> pos`, com posições provisórias calculadas **uma vez** antes de remover); corta em `top`; `val = Math.round(pontos)` (receita: `Math.round`, exibido como número). Para `tipo: "excl"`: pontos = `pontos(fontes(m, null)) − pontos(fontes(m, pais))`.
  - `paradasDaSemana(atual: MusicaSemana[], anterior: MusicaSemana[], regras: RegrasSemana, paisesExistentes: Set<string>): { parada: Parada; linhas: (Posicao & { st: "↑" | "↓" | "=" | "NEW" })[] }[]` — ordem por `ordem`; parada sem país resolvido é omitida; `st` contra `calcularParada(anterior, …)`.

- [ ] **Step 1: Write the failing tests**

```ts
const pais = (v: number) => new Map([["REINO UNIDO", v], ["ESTADOS UNIDOS", v * 3]]);
const ms = (t: string, o: Partial<MusicaSemana> = {}): MusicaSemana => ({
  tituloNorm: t, titulo: t, artistaPrincipal: t, semanas: 1, streamsGlobaisAnteriores: [0, 0, 0],
  totalGlobal: { SPOTIFY: 1000, YOUTUBE: 600, "APPLE MUSIC": 300, "DIGITAL SALES": 10 },
  porPais: { SPOTIFY: pais(100), YOUTUBE: pais(60), "APPLE MUSIC": pais(30), "DIGITAL SALES": pais(1) }, ...o });
const P = (id: string) => REGRAS_PADRAO.paradas.find((p) => p.id === id)!;

test("fontes: pagos = Apple + 45% Spotify; plataforma ausente = 0", () => {
  expect(fontes(ms("a"), "REINO UNIDO", 0.45)).toEqual({ vendas: 1, pagos: 30 + 45, gratis_audio: 55, gratis_video: 60 });
  const semApple = ms("b", { porPais: { SPOTIFY: pais(100) } });
  expect(fontes(semApple, "REINO UNIDO", 0.45)).toEqual({ vendas: 0, pagos: 45, gratis_audio: 55, gratis_video: 0 });
});
test("pontos: SNEP ignora grátis; Brasil ignora vendas; Alemanha por receita", () => {
  const f = { vendas: 10, pagos: 1500, gratis_audio: 6000, gratis_video: 6000 };
  expect(pontos(f, P("FR"))).toBeCloseTo(10 + 10, 9);
  expect(pontos(f, P("BR"))).toBeCloseTo(15 + 20 + 20, 9);
  expect(pontos(f, P("DE"))).toBeCloseTo(10 * 1.29 + 1500 * 0.008 + 12000 * 0.0008, 9);
});
test("UK: no máximo 3 por artista", () => {
  const l = ["a", "b", "c", "d"].map((t, i) => ms(t, { artistaPrincipal: "Mia", porPais: { SPOTIFY: pais(1000 - i) } }));
  l.push(ms("e", { artistaPrincipal: "Outro", porPais: { SPOTIFY: pais(1) } }));
  expect(calcularParada(l, P("UK"), "REINO UNIDO", 0.45).map((x) => x.tituloNorm)).toEqual(["a", "b", "c", "e"]);
});
test("UK: ACR usa 200/1200 quando caiu 3 semanas e semanas > 9", () => {
  const m = ms("a", { semanas: 10, streamsGlobaisAnteriores: [1800, 1900, 2000] });
  expect(emAcr(m, 1700, P("UK").acr!)).toBe(true);
  expect(emAcr({ ...m, semanas: 9 }, 1700, P("UK").acr!)).toBe(false);
  expect(emAcr({ ...m, streamsGlobaisAnteriores: [1800, 1700, 2000] }, 1700, P("UK").acr!)).toBe(false);
});
test("EUA: recorrência remove ≥20 semanas abaixo de #50 e sobe os de baixo", () => {
  const l = Array.from({ length: 60 }, (_, i) => ms(`m${i}`, { semanas: i === 55 ? 25 : 1, porPais: { SPOTIFY: new Map([["ESTADOS UNIDOS", 1000 - i]]) } }));
  const r = calcularParada(l, P("EUA"), "ESTADOS UNIDOS", 0.45);
  expect(r.length).toBe(50);
  expect(r.some((x) => x.tituloNorm === "m55")).toBe(false);
});
test("Excl. US = mundo − EUA", () => {
  const m = ms("a");
  const p = P("EXCL_US");
  const esperado = pontos(fontes(m, null, 0.45), p) - pontos(fontes(m, "ESTADOS UNIDOS", 0.45), p);
  expect(calcularParada([m], p, "ESTADOS UNIDOS", 0.45)[0].val).toBe(Math.round(esperado));
});
test("resolverPaisParada: aliases sem acento; ausente → parada omitida", () => {
  expect(resolverPaisParada(P("EUA"), new Set(["EUA"]))).toBe("EUA");
  expect(resolverPaisParada(P("AU"), new Set(["AUSTRALIA"]))).toBe("AUSTRALIA");
  const r = paradasDaSemana([ms("a")], [], REGRAS_PADRAO, new Set(["REINO UNIDO"]));
  expect(r.map((x) => x.parada.id)).toEqual(["UK"]);
  expect(r[0].linhas[0].st).toBe("NEW");
});
```

(Review Focus 3 — mesma música entre plataformas — é coberto na Task 5, onde as entradas são montadas por `titulo_norm`.)

- [ ] **Step 2: Run** — Expected: FAIL. **Step 3: Implement.** **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(charts): metodologias das paradas oficiais"`

---

### Task 5: Orquestrador da semana + schema + ingestão

**Files:**
- Create: `backend/src/services/chartsD1/semanaPaises.ts`
- Modify: `backend/src/services/chartsD1/repo.ts` (schema, `ingerirSemana`, `gravarArtistasEPesos`, `CATALOGO_SQL`, remover `linhasPaises`), `backend/src/services/chartsD1/artistas.ts` (`MusicaCatalogo.codigoUnico`, `LinhaCatalogo.codigo_unico`)
- Test: `scripts/charts-paises.test.ts` (com o SQLite em memória já usado pela carga local — ver `scripts/charts-d1-carga-inicial.ts --local` para o adaptador `D1DatabaseLike`)

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces:
  - Schema novo em `CHARTS_D1_SCHEMA`: `CREATE TABLE IF NOT EXISTS chart_regras_semana (data TEXT PRIMARY KEY, versao INTEGER NOT NULL, regras TEXT NOT NULL)` + `...FOCO_SCHEMA`.
  - Na ingestão (`ingerirSemana`, depois do batch da semana): `INSERT OR IGNORE INTO chart_regras_semana (data, versao, regras) VALUES (?, 1, ?)` com `JSON.stringify(regrasDeConfig(cfg))`.
  - `export const ROTULO_PARADAS = "PARADAS OFICIAIS"`
  - `interface SemanaPaises { countries: Map<"SPOTIFY" | "APPLE MUSIC" | "YOUTUBE", LinhaPaisApi[]>; paradas: LinhaPaisApi[] }` — em `paradas`, `pais` = nome da parada, e linha extra opcional `ordem: number`, `desc: string`.
  - `async function calcularSemanaPaises(db: D1DatabaseLike, dataBr: string, cat: Map<string, MusicaCatalogo>, fotos: Map<string, string>): Promise<SemanaPaises>`

Algoritmo de `calcularSemanaPaises` (o que os testes não determinam):
1. Datas: semana `d` e as 3 anteriores **do Global 100** (`SELECT DISTINCT data FROM chart_semana WHERE chart='BILLBOARD HOT 100' AND data <= ? ORDER BY data DESC LIMIT 4`).
2. Uma consulta: `SELECT chart, data, titulo, titulo_norm, valor, artistas, semanas FROM chart_semana WHERE data IN (?,?,?,?)` (≈2.000 linhas no máximo).
3. Em paralelo: `pais_peso`, `chart_config`, `artista_info` (nacionalidade), `carregarFocos`, `SELECT data, regras FROM chart_regras_semana WHERE data IN (d, d-1)`.
4. Regras da semana: linha de `chart_regras_semana`; senão `REGRAS_PADRAO` (semente "padrão", decisão do construtor no spec §10 — escolhida: **sem semear linhas**; semana sem linha usa `REGRAS_PADRAO` versão 1, que é congelada no código). **Não** usar `chart_config` atual para semana sem linha.
5. Pesos de DIGITAL SALES = linhas `plataforma='DIGITAL SALES'` de `pais_peso` se existirem; senão (o normal — spec rev. 5) os de APPLE MUSIC. Nenhuma planilha/script muda.
6. Para `d` e `d-1`: por plataforma, `EntradaMusica[]` (nacionalidade como em `linhasPaises` de hoje; foco = `focoVigente(h, buscarNoCatalogo(titulo, cat)?.codigoUnico, data)` resolvido para o nome em `pais_peso` sem acento/caixa); `valoresPorPais` → `porPais`; `rankingsPorPais` → `countries` (só d).
7. `MusicaSemana` por `titulo_norm` (junta as 4 plataformas; `semanas` = do Global 100 se presente, senão máximo; `streamsGlobaisAnteriores` das semanas d-1..d-3).
8. `paradasDaSemana(atual, anterior, regras, new Set(pesos.keys()))` → linhas `{ pais: parada.nome, pos, tit, val: fmt(val), mes: dataBr, art, capa, st, ordem, desc }`.

- [ ] **Step 1: Write the failing test** (SQLite em memória, 2 semanas, 4 plataformas, 3 países):

```ts
test("calcularSemanaPaises: COUNTRIES e paradas; mesma música em 4 plataformas não duplica; fixo por data", async () => {
  const db = await bancoDeTeste(); // helper no próprio arquivo: schema + 2 semanas + pais_peso + artista_info + musica_foco
  const a = await calcularSemanaPaises(db, "11/11/2026", new Map(), new Map());
  const b = await calcularSemanaPaises(db, "11/11/2026", new Map(), new Map());
  expect(a).toEqual(b);
  const uk = a.paradas.filter((l) => l.pais === "UK Official Charts");
  expect(new Set(uk.map((l) => l.tit)).size).toBe(uk.length);
  expect(a.countries.get("SPOTIFY")!.length).toBeGreaterThan(0);
  // mudar chart_config não muda semana que já tem regras gravadas
  await db.prepare("INSERT OR REPLACE INTO chart_config (chave, valor) VALUES ('nac_max','9')").run();
  expect(await calcularSemanaPaises(db, "11/11/2026", new Map(), new Map())).toEqual(a);
});
test("semana só com Spotify/YouTube/Global (antes de Apple e Sales): paradas sem NaN", async () => {
  const db = await bancoDeTeste({ semApple: true, semSales: true });
  const r = await calcularSemanaPaises(db, "11/11/2026", new Map(), new Map());
  expect(r.paradas.every((l) => !String(l.val).includes("NaN"))).toBe(true);
});
```

- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** o orquestrador e as mudanças em `repo.ts`/`artistas.ts`. Remover `linhasPaises` e `rankingsDaSemana` da regra B.
- [ ] **Step 4: Run** `bun test scripts/charts-paises.test.ts scripts/charts-d1.test.ts && bunx tsc --noEmit -p .` — Expected: PASS, sem erros de tipo.
- [ ] **Step 5: Commit** `git commit -m "feat(charts): cálculo da semana por país e paradas; regras por semana"`

---

### Task 6: API de charts (COUNTRIES + PARADAS OFICIAIS) com cache

**Files:**
- Modify: `backend/src/controllers/chartsController.ts`
- Test: `scripts/charts-paises.test.ts` (teste de `chartD1DaAba` se exportado) + verificação manual

**Interfaces:**
- Consumes: `calcularSemanaPaises`, `ROTULO_PARADAS` (Task 5).
- Produces:
  - `chartD1DaAba("PARADAS OFICIAIS")` → `{ chart: "BILLBOARD HOT 100", paises: true, paradas: true }`.
  - `fetchF("PARADAS OFICIAIS")` → `{ dates: datas do Global 100, styles: [] }`.
  - `fetchC("PARADAS OFICIAIS", date)` → `semana.paradas`; `fetchC("<X> COUNTRIES", date)` → `semana.countries.get(X)`.
  - Cache por isolate `semanaPaisesCache: Map<dataBr, { valor: Promise<SemanaPaises>; expiresAt }>` com TTL `CHARTS_RESPONSE_CACHE_TTL_MS` para a semana mais recente e 24 h para as anteriores; limpo em `limparCacheCharts`.
  - `Cache-Control: public, max-age=86400` na resposta de `/api/charts` quando `date` ≠ semana mais recente; atual mantém o que já existe.

- [ ] **Step 1:** Exportar `chartD1DaAba` e escrever teste: `expect(chartD1DaAba("PARADAS OFICIAIS")).toEqual({ chart: "BILLBOARD HOT 100", paises: true, paradas: true })`.
- [ ] **Step 2: Run** — Expected: FAIL. **Step 3: Implement.** **Step 4: Run** testes + `bunx tsc --noEmit -p .` — Expected: PASS.
- [ ] **Step 5: Verificação manual:** `bun run dev` (ou `wrangler dev`) com D1 local populado por `bun scripts/charts-d1-carga-inicial.ts --dados ... --pesos ... --local`; `curl "localhost:PORT/api/charts?action=getChart&tab=PARADAS%20OFICIAIS&date=11/11/2026"` devolve linhas com `pais` = nomes das paradas. Duas chamadas → JSON idêntico.
- [ ] **Step 6: Commit** `git commit -m "feat(charts): endpoint das paradas oficiais com cache por semana"`

---

### Task 7: Foco — API e trava

**Files:**
- Create: `backend/src/controllers/musicaFocoController.ts`
- Modify: `backend/src/routes/api.ts` (rotas novas na lista de paths e no roteador)
- Test: `scripts/charts-paises.test.ts` (função pura `validarGravacaoFoco`)

**Interfaces:**
- Consumes: `FOCO_SCHEMA`, `carregarFocos` (Task 3); `requestProvesAdmin` (`backend/src/services/sessionService.ts`).
- Produces:
  - `validarGravacaoFoco(atual: { pais: string; desde: string }[] , novoPais: string, paisesValidos: Set<string>, ehAdmin: boolean): { ok: true } | { ok: false; status: 400 | 403 | 409; erro: string }` — país precisa estar em `paisesValidos` ou ser `GLOBAL` (400 "País inválido."); já tem foco e não é admin → 409 "O foco deste lançamento já foi definido. Peça à administração para alterar."; mesmo país do vigente → 409 "Esse já é o foco atual.".
  - `GET /api/musica-foco?codigo=EMP123` → `{ success: true, foco: { pais, desde } | null, travado: boolean }`.
  - `GET /api/musica-foco/paises` → `{ success: true, paises: string[] }` (distintos de `pais_peso`, ordem alfabética, sem duplicatas por acento).
  - `POST /api/musica-foco` body `{ codigo: string; pais: string }` → grava `(codigo, pais, hoje ISO UTC, ehAdmin?1:0)`; se já existir linha com `desde` = hoje para o código (admin trocando duas vezes no dia), `UPDATE` dessa linha. Resposta `{ success: true, foco }`. Limpa o cache de charts (`limparCacheCharts`).

- [ ] **Step 1: Write the failing test**

```ts
test("validarGravacaoFoco: trava após definido; admin troca; país inválido recusado", () => {
  const P = new Set(["BRASIL", "REINO UNIDO"]);
  expect(validarGravacaoFoco([], "BRASIL", P, false)).toEqual({ ok: true });
  expect(validarGravacaoFoco([], "GLOBAL", P, false)).toEqual({ ok: true });
  expect(validarGravacaoFoco([], "MARTE", P, false)).toMatchObject({ ok: false, status: 400 });
  const h = [{ pais: "BRASIL", desde: "2026-11-01" }];
  expect(validarGravacaoFoco(h, "REINO UNIDO", P, false)).toMatchObject({ ok: false, status: 409 });
  expect(validarGravacaoFoco(h, "REINO UNIDO", P, true)).toEqual({ ok: true });
  expect(validarGravacaoFoco(h, "BRASIL", P, true)).toMatchObject({ ok: false, status: 409 });
});
```

- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** testes + `tsc` — PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(foco): API do foco do lançamento com trava e exceção do admin"`

---

### Task 8: Foco no front (cadastro, publicar faixa, edição)

**Files:**
- Create: `src/lib/focoMusica.ts`, `src/components/EmpirePlay/FocoSelect.tsx`
- Modify: `src/components/EmpirePlay/Gestao.tsx` (form de música ~L527 estado, ~L1003 payload, ~L1031 pós-criação, ~L1888 UI ao lado de "Tipo de Single"; e o fluxo de faixas de álbum ~L1334/L1488 quando `tipoSingle !== "TRACKLIST ALBUM"`), `src/components/EmpirePlay/EditModal.tsx` (publicar faixa ~L510, nova faixa ~L450, edição de música ~L661/L680), `src/components/EmpirePlay/LancarFaixaAlbumModal.tsx` (se oferecer tipo single)

**Interfaces:**
- Consumes: endpoints da Task 7; `authHeaders()` de `src/lib/api.ts` (admin).
- Produces:
  - `listarPaisesFoco(): Promise<string[]>` (cache em memória do módulo)
  - `lerFoco(codigo: string): Promise<{ foco: { pais: string; desde: string } | null; travado: boolean }>`
  - `salvarFoco(codigo: string, pais: string): Promise<void>` (envia `authHeaders()`; erro → `throw new Error(mensagem do backend)`)
  - `<FocoSelect value: string; onChange(v: string); disabled?: boolean; obrigatorio?: boolean />` — `<select>` com opção vazia "Escolha o foco…" (quando obrigatório), "Global / sem foco" (`GLOBAL`) e os países; ajuda: "País onde você quer focar este lançamento. Depois de salvo, só a administração pode alterar."

Regras de UI:
- Gestão (single novo): botão de registrar bloqueado e mensagem "Escolha o foco do lançamento." enquanto vazio; o foco entra no resumo de confirmação (`{ label: "Foco do lançamento", valor }`); após sucesso, `salvarFoco(codigoUnicoNovo, foco)` (mesmo padrão do `saveExtraMaterial` em ~L1031). Se `salvarFoco` falhar, a música já foi criada: mostrar aviso "Música registrada, mas o foco não foi salvo. Defina na edição." (não desfaz o cadastro).
- Fluxos que criam single a partir de faixa (publicar faixa, nova faixa com tipo ≠ TRACKLIST ALBUM, faixas de álbum lançadas como single): mesmo select obrigatório; salvar com o `codigoUnico` devolvido.
- Edição de música (EditModal) para item com `codigoUnico`: mostra o foco atual; sem foco → select + botão "Salvar foco"; com foco → texto só leitura + "Para alterar, fale com a administração."; admin (`isAdminUser`) vê o select habilitado sempre.
- Regras de botões do `CLAUDE.md` em qualquer botão novo.

- [ ] **Step 1:** Implementar `focoMusica.ts` e `FocoSelect.tsx`.
- [ ] **Step 2:** Integrar nos fluxos acima.
- [ ] **Step 3: Run** `bunx tsc --noEmit -p . && bun run lint` — Expected: sem erros.
- [ ] **Step 4: Verificação manual** (dev server, skill `run`): cadastrar single sem foco → bloqueado; com foco → `GET /api/musica-foco?codigo=…` devolve o país; tentar trocar como não admin → mensagem de trava; screenshot do formulário a 390 px de largura sem texto cortado.
- [ ] **Step 5: Commit** `git commit -m "feat(foco): campo de foco do lançamento no cadastro e na edição"`

---

### Task 9: Tela de Charts (rótulos + Paradas Oficiais)

**Files:**
- Modify: `src/routes/charts.tsx` (`CATEGORIES` L47–61, `ChartsCountryView` L564), `src/routes/artistas.$nome.index.tsx:847`, `src/routes/index.tsx:597,616`

**Interfaces:**
- Consumes: `/api/charts` com `tab=PARADAS OFICIAIS` (Task 6); linhas com `ordem` e `desc`.

Mudanças:
- `hot100.label` → "Global 100"; `spotify.label` → "Spotify Global"; HOF (`artistas.$nome.index.tsx:847`) "Hot 100" → "Global 100"; `index.tsx` "Billboard Hot 100" → "Global 100".
- Nova categoria após `hot100`: `{ id: "paradas", label: "Paradas Oficiais", tab: "PARADAS OFICIAIS", icon: Globe, color: "text-amber-300", paradas: true }`; `TabId` e `VALID_TABS` ganham `"paradas"`.
- `ChartsCategoryView`: para `paradas`, renderiza `ChartsCountryView tab="PARADAS OFICIAIS" ordenarPor="ordem"` direto (sem sub-abas).
- `ChartsCountryView`: prop opcional `ordenarPor?: "ordem"` — lista de opções do seletor ordenada por `ordem` em vez de alfabética; seletor de opções rolável (o `PillScroller` existente, conferir que usa `useDragScroll` + setas; pills `shrink-0` com `px-3`, sem `truncate`); abaixo do título selecionado, linha `desc` em `text-xs text-muted-foreground`; rótulo do seletor "Parada" em vez de "País" quando `ordenarPor`.

- [ ] **Step 1:** Implementar.
- [ ] **Step 2: Run** `bunx tsc --noEmit -p . && bun run lint` — sem erros.
- [ ] **Step 3: Verificação manual** (skill `run`, Playwright a 390 px e 1280 px): aba "Paradas Oficiais" aparece depois de "Global 100"; seletor mostra "Global Excl. US" primeiro e rola; nenhum nome cortado; trocar de semana funciona; abrir a mesma semana duas vezes → mesma lista.
- [ ] **Step 4: Commit** `git commit -m "feat(charts): aba Paradas Oficiais e rótulos Global 100 / Spotify Global"`

---

### Task 10: Documentação para mantenedores

**Files:**
- Create: `docs/charts-regras-paises.md`

(Spec rev. 5: nenhuma mudança no `EnvioD1.gs` nem em planilhas; Digital Sales usa os pesos do Apple Music.)

Conteúdo, em português simples: o listado no spec §13, com os números reais de `REGRAS_PADRAO`, os dois exemplos numéricos (australiana com foco nos EUA; hit 1.000.000 vs nativo 200.000/500.000 num país de 2%, iguais aos testes da Task 2), a tabela das 12 paradas, cada chave de `chart_config` (`nac_min`, `nac_max`, `foco_min`, `foco_max`, `bonus_teto`, `variacao`, `top_pais`, `fracao_paga_spotify`, `paradas`) com efeito de aumentar/diminuir e o comando SQL pronto para o Console do D1 (`INSERT INTO chart_config (chave, valor) VALUES ('nac_max','5') ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor`), como dar pesos próprios ao Digital Sales (`INSERT INTO pais_peso (plataforma, pais, peso) VALUES ('DIGITAL SALES','BRASIL',0.05) ...`; sem linhas = pesos do Apple Music), como incluir uma parada (exemplo de JSON), por que é fixo por data (`sorteio01` + `chart_regras_semana`; semanas sem linha usam `REGRAS_PADRAO` v1 do código, que não pode ser editado — mudança de fórmula = `versao` 2), o que ainda muda o passado (nacionalidade, `pais_peso`), foco (vigência, trava, admin), e como rodar os testes.

- [ ] **Step 1:** Escrever o documento.
- [ ] **Step 2: Verificação:** conferir que cada chave citada existe em `backend/src/services/chartsD1/regras.ts` e que os exemplos batem com os testes da Task 2.
- [ ] **Step 3: Commit** `git commit -m "docs(charts): regras de países e paradas oficiais"`

---

## Self-review (feito)

- Cobertura do spec: regra C (T2), fixo por data (T1, T5), foco dados/trava/UI (T3, T7, T8), paradas e metodologias (T4), Excl. US (T4), Digital Sales pesos = Apple (T5), API/cache (T6), front e rótulos (T9), documento (T10), histórico sem gravação em massa (T5 passo 4: semanas sem linha usam `REGRAS_PADRAO` congelado). IFPI fora (não-objetivo).
- Decisão do construtor tomada aqui: semente do histórico = nenhuma linha; `REGRAS_PADRAO` v1 é o congelamento das semanas antigas (zero escritas). Consequência documentada em T10: `REGRAS_PADRAO` v1 não pode ser editado.
- Nomes consistentes: `sorteio01`, `RegrasSemana`, `fatiasRegraC`, `rankingsPorPais`, `MusicaSemana`, `calcularParada`, `paradasDaSemana`, `calcularSemanaPaises`, `focoVigente`, `validarGravacaoFoco`.
