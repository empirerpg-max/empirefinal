# Playlists do Empire Play — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trocar os 4 cards da tela inicial do Empire Play por um destaque "Mais quente agora" + prateleiras de playlists (globais ao vivo, Top 50 por país, paradas oficiais, gêneros, Hot), tocáveis pelo catálogo, com as playlists do YouTube numa vitrine de clipes.

**Architecture:** Serviço novo `playlistsEmpirePlay.ts` monta, a partir de dados que já existem (EM Alta via `fetchRTBruto`, `calcularAoVivoPaises`, `calcularSemanaPaises`, `chart_semana`, D1 `musicas`/`videos`), um índice pequeno e cada playlist pronta para tocar; nova rota `/api/empire-play/playlists`; a tela troca os cards por destaque + prateleiras e reaproveita a tela cheia de playlist e o `VideoPlayer`.

**Tech Stack:** TypeScript, Cloudflare Workers + D1, Bun tests, React + Tailwind.

**Spec:** `docs/superpowers/specs/2026-11-24-playlists-empire-play-design.md` (rev. 2)

## Global Constraints

- Nenhuma leitura de planilha nova: catálogo e clipes vêm do D1 (as funções D1-first existentes caem na planilha só se o D1 estiver desligado); a tela deixa de chamar `/api/top-playlists` e `/api/lancamentos`.
- Nenhuma escrita no D1.
- Caches: índice/playlists ao vivo ≤ 30 s e nunca mais velhos que a leitura da EM Alta; catálogo (capas/áudio/gênero) e clipes 15 min; referências do ao vivo (`calcularAoVivoPaises`) passam de 5 para **15 min**; Hot 5 min (query indexada `ORDER BY data_lancamento_iso DESC LIMIT 30`).
- Capa de cada playlist = capa da música #1 (catálogo), senão foto do artista #1, senão cor da plataforma/país.
- Títulos sempre completos: nenhum `truncate`/`line-clamp`/`text-overflow: ellipsis` em título de playlist ou de música nas telas novas/alteradas; quebra com `overflow-wrap: anywhere`. Regras de pills/tabs do `CLAUDE.md`.
- Textos em português; app roda no Cloudflare.
- Mesmo instante → mesma resposta (sem `Math.random`).

## Review Focus

1. **Música do chart sem correspondência no catálogo ou sem áudio:** aparece em cinza "Sem áudio no catálogo", não some, a posição continua fiel; o player pula ela. → testes Task 2 e Task 5.
2. **`id` de playlist inválido / país inexistente / parada inexistente:** 404 com mensagem em português, sem quebrar o índice. → Task 3.
3. **Nenhum dado (D1 desligado, semana vazia, EM Alta vazia):** índice com prateleiras vazias e a tela mostra "Sem dados agora." sem erro. → Task 3 e Task 4.
4. **Lista ao vivo muda enquanto a música toca:** a música atual continua tocando; a lista se reordena pela chave estável. → Task 5.
5. **Título muito longo** (ex.: "Top 50 Coreia do Sul", "Billboard Argentina Hot 100", títulos de música com feat.): aparece inteiro, quebrando linha, em destaque, card e lista. → Task 4 e Task 6 (verificação visual a 390 px).

---

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `backend/src/services/playlistsEmpirePlay.ts` (novo) | ids, catálogo tocável (cache 15 min), montar playlist por id, montar índice + destaque |
| `backend/src/controllers/playlistsEmpirePlayController.ts` (novo) + `backend/src/routes/api.ts` | rota `/api/empire-play/playlists` |
| `backend/src/services/chartsD1/aoVivoPaises.ts` | cache de referências 5 → 15 min |
| `src/lib/playlistsEmpirePlay.ts` (novo) | cliente da rota + tipos |
| `src/components/EmpirePlay/PlaylistsInicio.tsx` (novo) | destaque + prateleiras |
| `src/components/EmpirePlay/VitrineClipes.tsx` (novo) | playlist do YouTube estilo YouTube |
| `src/routes/empire-play.index.tsx` | troca os 4 cards; tela cheia de playlist genérica |
| `scripts/playlists-empire-play.test.ts` (novo) | testes |

---

### Task 1: Catálogo tocável e ids de playlist

**Files:** Create `backend/src/services/playlistsEmpirePlay.ts`; Test `scripts/playlists-empire-play.test.ts`

**Interfaces:**
- Consumes: `readMusicasFromD1()` + `buildCleanItem(sheetName, record, index)` (`backend/src/controllers/empirePlayController.ts`, o mesmo mapeamento que `/api/empire-play/musicas` usa); para clipes, `linhasDaAbaDeVideo` + `linhasParaObjetos` + `buildCleanItem` (o mesmo que `/api/empire-play/videos` usa), filtrando `tipo_video === "Music Video"`; `indexarCatalogo`/`buscarNoCatalogo`/`chaveMusica`/`semAcentoMaiusculo` (`backend/src/services/chartsD1/artistas.ts`). Se reaproveitar essas funções criar import circular, extraia o necessário para um módulo compartilhado em vez de duplicar.
- Produces:
  - `type PlataformaPlaylist = "spotify" | "apple" | "youtube"`
  - `type IdPlaylist = { tipo: "ao-vivo"; plataforma: PlataformaPlaylist } | { tipo: "pais"; plataforma: PlataformaPlaylist; pais: string } | { tipo: "global100" } | { tipo: "parada"; parada: string } | { tipo: "genero"; genero: string } | { tipo: "hot" }`
  - `parseIdPlaylist(id: string): IdPlaylist | null` e `formatarIdPlaylist(p: IdPlaylist): string` — formatos `ao-vivo:spotify`, `pais:spotify:BRASIL`, `semana:global100`, `semana:parada:UK`, `semana:genero:POP`, `semana:hot`; país e gênero comparados sem acento/caixa; ida e volta estáveis.
  - `interface FaixaPlaylist { chave: string; pos: number; valor: string; titulo: string; artista: string; capa_url: string | null; tocavel: boolean; musica: EmpirePlayCleanItem | null; clipe: EmpirePlayCleanItem | null }` — `chave` = `codigo_unico` do catálogo, senão `chaveMusica(titulo do chart)`.
  - `async function carregarCatalogoTocavel(): Promise<CatalogoTocavel>` (cache de módulo 15 min, promessa compartilhada, descartada se rejeitar) e `ligarFaixa(cat: CatalogoTocavel, tituloChart: string, pos: number, valor: string): FaixaPlaylist` — liga por `buscarNoCatalogo`; `tocavel = !!musica?.audioUrl`; `clipe` = Music Video com o mesmo `codigo_unico`; `capa_url` = capa da música, senão foto do artista.
  - `limparCachePlaylists()`.

- [ ] **Step 1: Write the failing tests**

```ts
test("ids de playlist: ida e volta; inválidos dão null", () => {
  for (const id of ["ao-vivo:spotify", "pais:youtube:REINO UNIDO", "semana:global100", "semana:parada:UK", "semana:genero:POP", "semana:hot"])
    expect(formatarIdPlaylist(parseIdPlaylist(id)!)).toBe(id);
  expect(parseIdPlaylist("pais:tiktok:BRASIL")).toBeNull();
  expect(parseIdPlaylist("qualquer")).toBeNull();
});
test("ligarFaixa: casa música e clipe pelo código único; sem catálogo fica não tocável", () => {
  const cat = catalogoDeTeste([
    { titulo: "Sweet Spot", artista: "Jessica Johnson", codigo_unico: "EMP1", audioUrl: "a.mp3", coverUrl: "c.jpg" },
  ], [{ titulo: "Sweet Spot (Clipe)", codigo_unico: "EMP1", tipo_video: "Music Video", videoUrl: "v.mp4", thumb: "t.jpg" }]);
  const f = ligarFaixa(cat, "Jessica Johnson - Sweet Spot", 1, "187.049.605");
  expect(f).toMatchObject({ chave: "EMP1", tocavel: true, capa_url: "c.jpg" });
  expect(f.clipe?.videoUrl ?? f.clipe).toBeTruthy();
  const g = ligarFaixa(cat, "Ninguém - Inexistente", 2, "10");
  expect(g).toMatchObject({ tocavel: false, musica: null, clipe: null, pos: 2 });
});
```

(`catalogoDeTeste` = helper do próprio arquivo de teste que monta um `CatalogoTocavel` a partir de itens já no formato `EmpirePlayCleanItem`; exporte do serviço uma função pura `montarCatalogoTocavel(musicas, clipes)` para isso.)

- [ ] **Step 2: Run** `bun test scripts/playlists-empire-play.test.ts` — FAIL. **Step 3: Implement.** **Step 4: Run** + `bunx tsc --noEmit -p .` (só o erro pré-existente `adminAlbunsD1Controller.ts:175`) — PASS.
- [ ] **Step 5: Commit** `feat(empire-play): catálogo tocável e ids de playlist`

---

### Task 2: Montar cada playlist

**Files:** Modify `backend/src/services/playlistsEmpirePlay.ts`; Test `scripts/playlists-empire-play.test.ts`

**Interfaces:**
- Consumes: Task 1; `fetchRTBruto()` (chartsController.ts, itens `{t, n, s, p, c}` por plataforma); `calcularAoVivoPaises(db, emAlta, cat)` (`LinhaAoVivoPais {pais,pos,t,s,c,art}`); `calcularSemanaPaises(db, dataBr, cat, fotos)` (`.paradas` com `pais` = nome da parada, `ordem`, `desc`); `linhasDoChart` / leitura do Global 100 da última semana já usada pelo `chartsController` (use a mesma função, não SQL novo, se existir); D1 `musicas` para Hot.
- Produces:
  - `interface Playlist { id: string; titulo: string; subtitulo: string; plataforma: PlataformaPlaylist | null; aoVivo: boolean; capa_url: string | null; faixas: FaixaPlaylist[] }`
  - `async function montarPlaylist(id: IdPlaylist, fontes: FontesPlaylists): Promise<Playlist | null>` — `null` se o país/parada/gênero não existe.
  - `interface FontesPlaylists { emAlta(): Promise<…>; aoVivoPaises(): Promise<…>; semana(): Promise<{ global100: {titulo,valor}[]; paradas: LinhaPaisApi[] }>; hot(): Promise<EmpirePlayCleanItem[]>; catalogo(): Promise<CatalogoTocavel> }` — injetável para testes; a versão real (`fontesReais(db)`) usa os caches existentes.
  - Títulos exibidos: `Top 100 Spotify Global`, `Top 100 Apple Music`, `Top 100 YouTube Hits`, `Top 50 {País em Título}` (ex. "Top 50 Reino Unido"), `Global 100`, nome da parada, `Top {Gênero em Título}`, `Hot`. Subtítulos: "Ao vivo · atualiza a cada 30 s", "{Plataforma} · ao vivo", "Da semana · fecha quinta", "Lançamentos recentes".
  - Gênero: Global 100 da semana filtrado por `musicas.genero` (sem acento/caixa) da faixa ligada; faixa sem catálogo não entra.
  - Hot: 30 mais recentes do D1 (`ORDER BY data_lancamento_iso DESC LIMIT 30`, sem pendentes), cache 5 min.
  - `capa_url` da playlist = `faixas[0].capa_url`.

- [ ] **Step 1: Write the failing tests** — com `FontesPlaylists` falsas: (a) `ao-vivo:spotify` mantém a ordem da EM Alta e formata `valor` "187.049.605"; (b) `pais:spotify:REINO UNIDO` devolve só as linhas desse país, título "Top 50 Reino Unido"; país inexistente → `null`; (c) `semana:genero:POP` só com faixas de gênero Pop/POP/pop; (d) faixa sem catálogo vem `tocavel: false` na posição certa; (e) `capa_url` da playlist = capa da #1.
- [ ] **Step 2–4:** FAIL → implementar → PASS (+ tsc).
- [ ] **Step 5: Commit** `feat(empire-play): montar playlists a partir dos charts`

---

### Task 3: Índice, destaque e rota

**Files:** Modify `backend/src/services/playlistsEmpirePlay.ts`, `backend/src/services/chartsD1/aoVivoPaises.ts` (TTL das referências 15 min); Create `backend/src/controllers/playlistsEmpirePlayController.ts`; Modify `backend/src/routes/api.ts` (lista de paths ~L631 e roteador ~L783, mesmo padrão de `/api/empire-play/home`); Test `scripts/playlists-empire-play.test.ts`

**Interfaces:**
- Produces:
  - `interface CartaoPlaylist { id: string; titulo: string; subtitulo: string; capa_url: string | null; aoVivo: boolean }`
  - `interface IndicePlaylists { destaque: { id: string; titulo: string; musica: string; subiu: number; valor: string; capa_url: string | null } | null; globais: CartaoPlaylist[]; paises: Record<PlataformaPlaylist, CartaoPlaylist[]>; paradas: CartaoPlaylist[]; generos: CartaoPlaylist[] /* + Hot no fim */ }`
  - `async function montarIndice(fontes: FontesPlaylists): Promise<IndicePlaylists>` — `globais` = 3 ao vivo + Global 100; `paises` na ordem do peso; `paradas` na ordem `ordem`; `generos` = gêneros com ≥ 10 faixas no Global 100 (ordem por quantidade desc, empate por nome) + Hot por último.
  - **Destaque:** entre as playlists ao vivo (3 plataformas + todos os países), a que tem a #1 com a maior subida = posição da mesma música (`chave`) no último chart semanal correspondente (plataforma global ou recorte por país da semana) − posição ao vivo (1). Música que não estava no chart semanal conta como subida = (tamanho do chart semanal + 1) − 1. Empate: maior valor ao vivo, depois `id`. Nenhuma subida > 0 → `ao-vivo:spotify` com `subiu: 0`.
  - Rota: `GET /api/empire-play/playlists` → `{ success: true, data: IndicePlaylists }`; `GET /api/empire-play/playlists?id=…` → `{ success: true, data: Playlist }`; id inválido ou inexistente → 404 `{ success: false, error: "Playlist não encontrada." }`. Cache de resposta: 30 s, limitado à validade da leitura da EM Alta (mesma regra de `getRealTimePaises`); limpa em `limparCacheCharts`.

- [ ] **Step 1: Write the failing tests** — (a) índice com fontes falsas: ordem das prateleiras e gêneros ≥ 10; (b) destaque escolhe a maior subida e cai no Spotify Global sem subida; (c) handler: `?id=pais:spotify:MARTE` → 404 com a mensagem exata; sem D1 → índice com listas vazias e `destaque: null`, status 200; (d) duas chamadas em < 30 s leem a EM Alta 1 vez.
- [ ] **Step 2–4:** FAIL → implementar → PASS (+ tsc).
- [ ] **Step 5: Commit** `feat(empire-play): índice de playlists, destaque e rota`

---

### Task 4: Tela — destaque + prateleiras

**Files:** Create `src/lib/playlistsEmpirePlay.ts`, `src/components/EmpirePlay/PlaylistsInicio.tsx`; Modify `src/routes/empire-play.index.tsx` (cards L164-255 saem; `getSlidingPlaylistItems`/`activeSlidingPlaylist` passam a usar `id` de playlist)

**Interfaces:**
- `src/lib/playlistsEmpirePlay.ts`: `getIndicePlaylists(): Promise<IndicePlaylists>`, `getPlaylist(id: string): Promise<Playlist>` (fetch direto, sem cache de sessão; mantém o último valor bom em erro/vazio, como `fetchAoVivo`). Tipos espelham a Task 3.
- `<PlaylistsInicio onAbrir(id: string) />`.

Comportamento:
- Destaque (modelo C do mockup https://claude.ai/artifact/At5D4YSEnUswTS7o9n4Lm8): fundo = `capa_url` escurecida (gradiente para leitura), selo "● Mais quente agora", título grande, linha "{música} subiu N posições desde o último chart · {valor}" (sem subida: "Ao vivo agora · {valor}"). Toque abre a playlist.
- Prateleiras (modelo A): "Charts globais", "Top 50 por país" (pills Spotify | Apple Music | YouTube ao lado do título da prateleira), "Paradas oficiais", "Por gênero" (Hot por último). Cada uma rola para o lado com `useDragScroll` + `StickyScrollArrowLeft/Right` (ver `src/routes/social.tsx`). Card quadrado: fundo = `capa_url` (fallback `DynamicCoverCard` com a plataforma), título por cima **quebrando linha, sem cortar** (fonte reduz por `clamp`, nunca "…"), legenda embaixo (subtítulo).
- Atualiza o índice a cada 30 s só com a tela visível (`document.visibilityState` e enquanto nenhuma playlist está aberta).
- Vazio: "Sem dados agora."

- [ ] **Step 1:** Implementar.
- [ ] **Step 2:** `bunx tsc --noEmit -p .` sem erros novos.
- [ ] **Step 3: Verificação visual:** renderizar com `fetch` simulado (o `bun run dev` não sobe neste container) e screenshots Playwright a 390 px e 1280 px, incluindo títulos longos ("Top 50 Coreia do Sul", "Billboard Argentina Hot 100"): nenhum texto cortado, prateleiras rolam, destaque legível.
- [ ] **Step 4: Commit** `feat(empire-play): destaque e prateleiras de playlists`

---

### Task 5: Tela cheia da playlist (áudio)

**Files:** Modify `src/routes/empire-play.index.tsx` (tela deslizante ~L258-548)

Comportamento:
- Abre por `id` (via `getPlaylist`), cabeçalho com `capa_url`, título completo (quebra linha), subtítulo e número de músicas.
- Cada faixa: posição, capa, título e artista **completos** (sem `line-clamp`/`truncate`), `valor` à direita.
- `tocavel: false` → linha em cinza com "Sem áudio no catálogo"; tocar a playlist pula essas faixas.
- Playlist ao vivo: recarrega a cada 30 s enquanto aberta e visível; atualiza a lista pela `chave` sem alterar a música que está tocando nem a fila em andamento.
- Plataforma `youtube` → abre a `VitrineClipes` (Task 6) em vez desta lista.

- [ ] **Step 1:** Implementar. **Step 2:** tsc. **Step 3:** screenshot com `fetch` simulado (uma faixa sem áudio, um título longo). **Step 4: Commit** `feat(empire-play): tela de playlist por id`

---

### Task 6: Vitrine de clipes do YouTube

**Files:** Create `src/components/EmpirePlay/VitrineClipes.tsx`; Modify `src/routes/empire-play.index.tsx`

**Interfaces:** `<VitrineClipes playlist: Playlist; onFechar(): void />`; usa `VideoPlayer` (`src/components/EmpirePlay/VideoPlayer.tsx`, props `video`, `onClose`, `relatedVideos`, `onSelectVideo`) e `toPlayableVideo` (mappers.ts) sobre `faixa.clipe`.

Comportamento:
- Estilo YouTube: lista de cards com miniatura 16:9 (`clipe` → `poster_url`/thumb; sem clipe → capa do material com selo "Sem clipe"), posição, título e artista completos, `valor` (número cheio formatado, como nas outras playlists).
- Tocar uma faixa com clipe abre o `VideoPlayer` com `relatedVideos` = os outros clipes da playlist na ordem; `onSelectVideo` troca o vídeo.
- Tocar uma faixa sem clipe toca o áudio (se `tocavel`), senão nada além do selo.
- Ao vivo: atualiza a cada 30 s como a Task 5, sem fechar o vídeo aberto.

- [ ] **Step 1:** Implementar. **Step 2:** tsc + `bun test scripts/playlists-empire-play.test.ts scripts/charts-paises.test.ts scripts/charts-d1.test.ts`. **Step 3:** screenshots 390/1280 com `fetch` simulado (com e sem clipe, título longo). **Step 4: Commit** `feat(empire-play): vitrine de clipes do YouTube`

---

## Self-review (feito)

- Cobertura: destaque C (T3, T4), prateleiras A (T4), Top 50 por país com filtro (T3, T4), paradas/gêneros/Hot (T2, T3), capas = material (T1–T4), tocar + sem áudio (T1, T5), YouTube vitrine via código único (T1, T6), títulos completos (T4–T6), custos/caches 15 min/Hot indexado (T1–T3), zero planilha nova (Global Constraints).
- Nomes consistentes: `PlataformaPlaylist`, `IdPlaylist`, `parseIdPlaylist`, `formatarIdPlaylist`, `FaixaPlaylist`, `CatalogoTocavel`, `montarCatalogoTocavel`, `carregarCatalogoTocavel`, `ligarFaixa`, `Playlist`, `FontesPlaylists`, `montarPlaylist`, `CartaoPlaylist`, `IndicePlaylists`, `montarIndice`, `limparCachePlaylists`, `getIndicePlaylists`, `getPlaylist`.
