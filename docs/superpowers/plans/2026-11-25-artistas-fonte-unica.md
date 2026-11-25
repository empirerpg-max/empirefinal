# Artistas: fonte única — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tabela D1 `artistas` (espelho da aba ARTISTAS) vira a fonte de leitura de todo o app; o dono edita foto, capa, biografia, estilo e nacionalidade (travada) pelo app; admin pode "Atualizar a partir da planilha"; o app para de ler a INFOS ACTS.

**Architecture:** Serviço `artistasD1.ts` (schema, mapeamento linha↔registro, importação com complemento da INFOS ACTS, leitura com cache, gravação + cópia para a planilha em segundo plano). Rotas de perfil/admin. Os leitores atuais (perfil, prêmios, lista de artistas, charts) trocam INFOS ACTS/`artista_info` pelo espelho.

**Tech Stack:** TypeScript, Cloudflare Workers + D1, Bun tests, React + Tailwind.

**Spec:** `docs/superpowers/specs/2026-11-25-artistas-fonte-unica-design.md` (rev. 2)

## Global Constraints

- Fonte de leitura: D1 `artistas`. Nenhum código do app (fora `adminDiag*`/`adminFix*`/`adminBackfill*`) lê a aba INFOS ACTS depois deste plano.
- Fortuna/contrato **fora** do espelho e sem mudança de comportamento.
- Edição: D1 primeiro; cópia para a aba ARTISTAS em segundo plano (`ctx.waitUntil` quando disponível), falha da cópia não desfaz a edição.
- Só dono (ID Usuário = usuário da sessão, conferido no servidor) ou admin (`requestProvesAdmin`) grava.
- Nacionalidade: dono preenche **uma vez** (vazia → valor); depois só admin. Mensagem: "A nacionalidade já foi definida. Peça à administração para alterar."
- Reconciliação planilha→D1 nunca sobrescreve foto/capa/biografia/gênero principal/país; o botão de admin "Atualizar a partir da planilha" sobrescreve **tudo**.
- Textos em português; regras de botões e de "voltar = tela anterior" do `CLAUDE.md`.

## Review Focus

1. **Artista renomeado** (nome ≠ ID_unico, ex. "Sebastian" / "Tyler Strand…"): identidade é `id_unico`; busca por nome atual funciona. → teste Task 1.
2. **Nome com acento/caixa diferente** na URL ("Aimê" vs "aime"): encontra o mesmo artista. → teste Task 1.
3. **Google recusa a cópia para a planilha**: a edição continua valendo no app e a falha fica no log. → teste Task 2.
4. **Admin "atualiza da planilha" com PAÍS vazio**: nacionalidade volta a ficar livre para o dono. → teste Task 2.
5. **Charts por país** depois da troca de fonte: mesmo resultado para artista cuja nacionalidade não mudou. → teste Task 4.

---

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `backend/src/services/artistasD1.ts` (novo) | schema, `registroDaLinha`, importação, leitura/cache, gravação + cópia |
| `backend/src/controllers/artistasPerfilController.ts` (novo) + `backend/src/routes/api.ts` | GET/POST perfil, rotas admin (importar, atualizar um/todos) |
| `backend/src/controllers/artistasController.ts` | foto/bio/capa/info/lista/criação passam pelo espelho; sem INFOS ACTS |
| `backend/src/controllers/awardsController.ts` | fallback de foto pelo espelho |
| `backend/src/services/chartsD1/*`, `backend/src/services/playlistsEmpirePlay.ts`, `backend/src/controllers/chartsController.ts` | nacionalidade/foto/gênero do espelho no lugar de `artista_info` |
| `src/routes/artistas.$nome.index.tsx`, `src/lib/api.ts` | aba Gestão: nacionalidade, estilo; botão admin |
| `src/components/EmpirePlay/Gestao.tsx` | aviso "Complete o perfil" |
| painel de admin existente (achar onde ficam os botões admin, ex. `PainelCatalogoD1.tsx`) | "Atualizar todos os artistas a partir da planilha" |
| `scripts/artistas-d1.test.ts` (novo) | testes |

---

### Task 1: Espelho D1 — schema, mapeamento e leitura

**Files:** Create `backend/src/services/artistasD1.ts`; Test `scripts/artistas-d1.test.ts`

**Interfaces (produz):**
- `ARTISTAS_SCHEMA: string[]` — `CREATE TABLE IF NOT EXISTS artistas (id_unico TEXT PRIMARY KEY, nome TEXT NOT NULL, nome_chave TEXT NOT NULL, id_usuario TEXT, gravadora TEXT, foto_url TEXT, capa_perfil_url TEXT, capa_perfil_mobile_url TEXT, biografia TEXT, genero_principal TEXT, pais TEXT, pais_definido_em TEXT, ano_inicio TEXT, sexo TEXT, artista_base TEXT, linha_planilha INTEGER, atualizado_em TEXT NOT NULL)` + índice em `nome_chave`. `nome_chave = semAcentoMaiusculo(nome)` (`backend/src/services/chartsD1/artistas.ts`).
- `interface Artista { idUnico; nome; idUsuario; gravadora; fotoUrl; capaPerfilUrl; capaPerfilMobileUrl; biografia; generoPrincipal; pais; paisDefinidoEm; anoInicio; sexo; artistaBase; linhaPlanilha }` (strings ou `null`).
- `registroDaLinha(cabecalho: string[], linha: string[], linhaPlanilha: number): Artista | null` — por **nome de coluna** (normalizado sem acento/caixa): "Nome", "ID Usuário", "Gravadora", "ID_unico", "BIOGRAFIA", "FOTO" (senão "Foto"), "GÊNERO PRINCIPAL", "PAÍS", "CAPA PERFIL", "CAPA PERFIL MOBILE", "ANO EM QUE INICIOU A CARREIRA", "GÊNERO" (→ sexo), "ARTISTA BASE". Atenção: há "Foto" e "FOTO" e "GÊNERO" e "GÊNERO PRINCIPAL" — casar o nome exato normalizado, não prefixo. Sem nome → `null`; ID_unico vazio → `nome + idUsuario`.
- `async carregarArtistas(db): Promise<Map<string /*nome_chave*/, Artista>>` — cache de módulo 5 min (promessa compartilhada, descartada se rejeitar); `limparCacheArtistas()`.
- `async buscarArtista(db, nome: string): Promise<Artista | null>` — por `nome_chave`.

- [ ] **Step 1: Write the failing tests** — `registroDaLinha` com o cabeçalho real (copiar: `["Nome","Foto","Status","Saldo","Gravadora","Fortuna Vendas","Fortuna Turnês","Fortuna Total","Prestígio","Fadiga","ID Usuário","Data_Contrato","Meses_Contrato","Multa","Fortuna Cálculo","ID_unico","Fortuna Charts","BIOGRAFIA","FOTO","GÊNERO PRINCIPAL","PAÍS","CAPA PERFIL","ANO EM QUE INICIOU A CARREIRA","GÊNERO","ARTISTA BASE"]`) e a linha da Raven → `{ nome:"Raven", idUnico:"Raven1198902945", idUsuario:"1198902945", generoPrincipal:"POP", pais:"PORTO RICO", sexo:"MULHER", artistaBase:"Selena Gomez", fotoUrl: <col FOTO> }`; FOTO vazia cai em "Foto"; `buscarArtista(db, "aime")` acha "Aimê"; renomeado (nome "Sebastian", ID_unico "Tyler Strand272193453") é achado por "sebastian" com `idUnico` "Tyler Strand272193453".
- [ ] **Step 2–4:** FAIL → implementar → PASS (`bun test scripts/artistas-d1.test.ts`, `bunx tsc --noEmit -p .`; só o erro pré-existente `adminAlbunsD1Controller.ts:175`).
- [ ] **Step 5: Commit** `feat(artistas): espelho D1 da aba ARTISTAS`

---

### Task 2: Importação, reconciliação, atualização pelo admin e gravação

**Files:** Modify `backend/src/services/artistasD1.ts`; Test `scripts/artistas-d1.test.ts`

**Interfaces (produz):**
- `async importarArtistas(db, fontes: { artistas(): Promise<string[][]>; infosActs(): Promise<string[][]> }): Promise<{ total: number; complementados: number }>` — grava todos; onde país/foto/biografia/capa estiverem vazios na ARTISTAS e a INFOS ACTS tiver (por nome sem acento/caixa: A nome, C/G foto, E biografia, N nacionalidade, R capa, S capa mobile), usa o da INFOS ACTS e devolve a lista de células para escrever na ARTISTAS. Marca `artistas_d1_importado = '1'` em `chart_config`. `pais` preenchido → `pais_definido_em` = data da importação.
- `async reconciliarArtistas(db, linhasArtistas): Promise<number>` — só roda com a marca; cria os que faltam; atualiza **apenas** `nome`, `id_usuario`, `gravadora`, `ano_inicio`, `sexo`, `artista_base`, `linha_planilha`.
- `async atualizarDaPlanilha(db, linhasArtistas, idUnico?: string): Promise<{ id: string; campos: string[] }[]>` — sobrescreve **todos** os campos do(s) artista(s); país vazio → `pais` e `pais_definido_em` = null; devolve quais campos mudaram.
- `type CamposEditaveis = { fotoUrl?: string; capaPerfilUrl?: string; capaPerfilMobileUrl?: string; biografia?: string; generoPrincipal?: string; pais?: string }`
- `async gravarPerfil(db, idUnico, campos: CamposEditaveis, ehAdmin: boolean, copiar: (celulas: {coluna: string; valor: string}[], linha: number) => Promise<void>): Promise<{ ok: true; artista: Artista } | { ok: false; status: 400 | 404 | 409; erro: string }>` — `pais` com valor atual não vazio e `!ehAdmin` → 409 com a mensagem exata; `pais` fora da lista de `pais_peso` → 400 "País inválido."; grava no D1, limpa caches de artistas e de charts (`limparCacheCharts`), chama `copiar` (erros só logados). Coluna "CAPA PERFIL MOBILE" inexistente na aba → cria o cabeçalho no fim (mesmo padrão de `fortunaChartsController` ao criar coluna). *Call do plano.*
- Fonte real das linhas: `googleSheetsService.usuarios.readValues("ARTISTAS")` (rota admin/cron) e `googleSheetsService.registrosCharts.readValues("INFOS ACTS")` **só** dentro de `importarArtistas`.

- [ ] **Step 1: Write the failing tests** — (a) importação: ARTISTAS com PAÍS vazio + INFOS ACTS com N "ESTADOS UNIDOS" → espelho "ESTADOS UNIDOS" e célula para a planilha; ARTISTAS preenchida vence INFOS ACTS; (b) reconciliação não muda `biografia` editada no D1 mas muda `gravadora`; (c) `atualizarDaPlanilha` com PAÍS vazio libera o país e lista "País" em `campos`; (d) `gravarPerfil`: dono define país vazio → ok; segunda vez → 409 mensagem exata; admin troca → ok; `copiar` lançando erro → edição ok.
- [ ] **Step 2–4:** FAIL → implementar → PASS (+ tsc).
- [ ] **Step 5: Commit** `feat(artistas): importação, reconciliação e gravação do perfil`

---

### Task 3: Rotas e controllers do perfil (sem INFOS ACTS)

**Files:** Create `backend/src/controllers/artistasPerfilController.ts`; Modify `backend/src/routes/api.ts`, `backend/src/controllers/artistasController.ts` (`getArtistInfoController` ~L475, `setArtistFotoController` ~L525, `setArtistBiografiaController` ~L622, `setArtistCapaController` ~L682, `getAllArtistasController` ~L749/835, `garantirLinhaInfosActs` ~L419-460 na criação ~L296), `backend/src/controllers/awardsController.ts` (~L83-101), `src/server.ts` (cron de 10 min: chamar `reconciliarArtistas` no máximo 1×/hora, marcando hora em `chart_config`); Test `scripts/artistas-d1.test.ts`

**Interfaces (produz):**
- `GET /api/artistas/perfil?nome=` → `{ success, data: Artista }` (público; 404 "Artista não encontrado.").
- `POST /api/artistas/perfil` body `{ nome, fotoUrl?, capaPerfilUrl?, capaPerfilMobileUrl?, biografia?, generoPrincipal?, pais? }` → `gravarPerfil`; dono = `artista.idUsuario` igual ao usuário da sessão (`verifySessionToken(extractBearerToken(request))`, `sessionService.ts`), senão admin, senão 403 "Só o dono do artista pode editar.".
- `GET /api/artistas/generos` → lista fechada: distintos de `genero_principal` no espelho ∪ distintos de `musicas.genero`, em caixa alta, ordenados.
- Admin: `POST /api/admin/artistas/importar`, `POST /api/admin/artistas/atualizar-da-planilha` (`{ idUnico? }`; sem id = todos) → `{ success, data }`.
- Endpoints antigos (`/api/artistas/foto`, biografia, capa, info) passam a chamar `gravarPerfil`/`buscarArtista` **mantendo o mesmo formato de resposta** (o front atual continua funcionando). `getAllArtistasController` e `awardsController` tiram foto/bio do espelho. Criação de artista: em vez de `garantirLinhaInfosActs`, cria a linha no espelho.

- [ ] **Step 1: Write the failing tests** — handlers sobre SQLite em memória (`criarD1Sqlite`, injeção via `__CATALOGO_DB__` como nos testes de playlists): GET por nome; POST do dono; POST de outro usuário → 403; país 409; endpoint antigo de biografia devolve o formato antigo; **nenhuma leitura de "INFOS ACTS"** nas rotas (stub do sheets conta abas lidas).
- [ ] **Step 2–4:** FAIL → implementar → PASS (+ tsc).
- [ ] **Step 5: Commit** `feat(artistas): rotas de perfil e leitores sem INFOS ACTS`

---

### Task 4: Charts e playlists usam o espelho

**Files:** Modify `backend/src/services/chartsD1/repo.ts` (leituras de `artista_info` ~L582, ~L673-702, ~L797), `semanaPaises.ts` (~L157), `aoVivoPaises.ts` (~L148, ~L200), `backend/src/services/playlistsEmpirePlay.ts` (~L140), `backend/src/controllers/chartsController.ts` (~L53); Test `scripts/charts-paises.test.ts`, `scripts/charts-d1.test.ts`

**Interfaces:** substituir cada `SELECT … FROM artista_info` por uma função única em `artistasD1.ts`: `async referenciasArtistasParaCharts(db): Promise<{ nome_upper: string; nacionalidade: string; foto: string; genero: string }[]>` — mesmo formato que as consultas atuais devolvem (`nome_upper` = `UPPER(nome)` como hoje, `nacionalidade` = `pais`, `foto` = `foto_url`, `genero` = `genero_principal`). Sem linhas no espelho (antes da importação) → cai para `artista_info` (transição segura). A ingestão continua aceitando `payload.artistas` (não quebra o `EnvioD1.gs`), mas os leitores não dependem mais disso.

- [ ] **Step 1: Write the failing test** — banco com o mesmo artista em `artista_info` e em `artistas` com o mesmo país → `calcularSemanaPaises` igual antes/depois; país diferente no espelho → o espelho vence; espelho vazio → usa `artista_info`.
- [ ] **Step 2–4:** FAIL → implementar → PASS (todos os testes de charts e playlists + tsc).
- [ ] **Step 5: Commit** `feat(charts): nacionalidade/foto/gênero do espelho de artistas`

---

### Task 5: Telas — Gestão do artista, aviso e botões de admin

**Files:** Modify `src/routes/artistas.$nome.index.tsx` (aba Gestão ~L496, modais ~L501-512), `src/lib/api.ts`, `src/components/EmpirePlay/Gestao.tsx`, painel admin existente

Comportamento:
- Aba Gestão do dono ganha **Nacionalidade** (lista de `GET /api/musica-foco/paises`; vazia → select + "Salvar nacionalidade" com confirmação na tela: "Depois de salva, só a administração pode alterar."; preenchida → só leitura + "Para alterar, fale com a administração."; admin vê o select sempre) e **Estilo principal** (select de `GET /api/artistas/generos`, salvar sempre).
- Admin, no perfil do artista: botão **"Atualizar a partir da planilha"** com confirmação na tela; mostra "Atualizado: Foto, País" ou "Nada mudou.".
- `Gestao.tsx`: para cada artista do jogador sem país ou sem estilo, aviso "Complete o perfil de {artista}: {nacionalidade / estilo}" com botão que abre o perfil na aba Gestão.
- Painel admin: **"Atualizar todos os artistas a partir da planilha"** com confirmação e resumo ("{n} artistas atualizados").
- Botões: regras do `CLAUDE.md`; modais/telas por cima: regra "voltar = tela anterior".

- [ ] **Step 1:** Implementar. **Step 2:** `bunx tsc --noEmit -p .`. **Step 3:** screenshots Playwright a 390 px com `fetch` simulado (dono com país vazio, dono com país travado, admin). **Step 4: Commit** `feat(artistas): nacionalidade e estilo na Gestão; atualizar a partir da planilha`

---

## Estreia (depois do deploy)

A importação roda **sozinha** no primeiro ciclo do cron de 10 min depois do
deploy, se a marca `artistas_d1_importado` não existir (Task 3 liga isso no
`src/server.ts`); a rota admin fica para rodar de novo à mão. Até a
importação, os leitores usam o fallback (Task 4) e os endpoints antigos de
foto/bio continuam respondendo.

## Self-review (feito)

- Cobertura: espelho (T1), importação+INFOS ACTS 1×, reconciliação sem sobrescrever editáveis, botão admin um/todos, gravação+cópia (T2), rotas/dono/admin/409/leitores sem INFOS ACTS/criação (T3), charts/playlists (T4), telas+aviso (T5), fortuna intocada (Global Constraints).
- Nomes: `Artista`, `registroDaLinha`, `carregarArtistas`, `buscarArtista`, `limparCacheArtistas`, `importarArtistas`, `reconciliarArtistas`, `atualizarDaPlanilha`, `CamposEditaveis`, `gravarPerfil`, `referenciasArtistasParaCharts`.
