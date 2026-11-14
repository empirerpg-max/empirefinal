# Charts semanais no D1 — design

Data: 2026-11-14 · Status: aguardando aprovação (rev. 4)

## Intenção e porquê

A aba Charts (exceto "Ao Vivo") hoje depende da planilha **[Empire] Base de
Dados** (`chartsBase`), que reorganiza dados com fórmulas pesadas (sobe/desce,
capa, ranking por país com pesos). Ela ficou pesada e quebra. A partir de agora
a **única fonte** dos 5 charts semanais é a aba **DADOS** da planilha
**EMPIRE - CHARTS** (`1Px2y5F25rlK-rKHk4Hnfr9QGsiiElczYffn4PXGYobM`, ~200 MB),
que traz o **total global** de cada música por semana. Todo o resto passa a ser
calculado pelo app (Worker) e guardado no D1, de graça e sem reler planilha.

## Objetivos

- Os 5 charts — BILLBOARD HOT 100, SPOTIFY, APPLE MUSIC, DIGITAL SALES,
  YOUTUBE — servidos do D1, com o **mesmo contrato** de `/api/charts`
  (`getFilters`, `getChart`, `getBannerN1s`, `getHOFProfile`/`getHOFList`
  na parte desses charts). A tela não muda.
- Calculado pelo app: sobe/desce (`↑`/`↓`/`=`), `NEW`, peak, semanas no chart,
  semanas no #1, chart run; capa da música ou foto do artista principal.
- Ranking por país **semanal** (Spotify, Apple Music, YouTube), Top 50 por
  país, pela regra de pesos + bônus de nacionalidade (abaixo).
- Filtro de gênero do Hot 100 vindo do catálogo de músicas (D1).
- Entrada semanal **empurrada pelo Google** (Apps Script), sem o app ler
  planilha.
- Carga inicial do histórico (desde 2020) a partir do export da aba DADOS.

## Não-objetivos (nesta leva)

- Álbuns (DADOS ÁLBUNS), Mensal, Top 50 artistas, Lançamentos, Em Alta
  ("Ao Vivo") continuam lendo as planilhas atuais. Migram depois, uma por vez.
- Parte de álbuns do Hall of Fame (`n1_bb200`, `alb`) continua vindo de onde
  vem hoje.
- Nenhuma mudança visual na tela de Charts, exceto o seletor de países passar
  de mês para semana.

## Anti-objetivos (seria fracasso mesmo "funcionando")

- O app abrir/reler a planilha de 200 MB (timeout, quebra — o problema de hoje).
- Semana publicada pela metade ou duplicada.
- Tela vazia/quebrada quando um envio falha (deve mostrar a última semana válida).
- Pesos fixos no código (precisam ser ajustáveis sem deploy).

## Fonte: formato da aba DADOS

Uma linha por posição de um chart numa semana:

| Col | Campo | Exemplo |
|---|---|---|
| A | CHART | BILLBOARD HOT 100 |
| B | DATA (dd/mm/aaaa) | 25/05/2020 |
| C | POSIÇÃO | 1 |
| D | MÚSICA/ALBUM ("Artista - Título") | Louise - Sober |
| E | PONTOS / VENDAS SEMANA (pt-BR, "1.175") | 1.175 |
| F | VENDAS GERAIS (pode vir vazio) | |
| G | (vazia) | |
| H–L | ARTISTA 1..5 | Louise, Destiny |

A posição global **já vem pronta**; o app não reordena o chart global.

**O que o export real mostrou (121 mil linhas, 25/05/2020 → 11/11/2026):**
- 6 valores em CHART: os 5 atuais + **iTUNES** (encerrado em 31/03/2025).
  iTUNES é importado só como histórico (não aparece na tela, não é exigido no
  envio semanal).
- Inícios diferentes: Apple Music desde 20/01/2022, Digital Sales desde
  11/04/2025.
- 11 semanas com anomalia histórica (200 linhas = semana duplicada; 99 e 101
  linhas). A carga inicial **deduplica** (mantém a primeira ocorrência de cada
  (chart, data, posição)) e aceita semanas incompletas, registrando-as no log
  `chart_ingestao`. A validação estrita vale só para o envio semanal.
- Colunas ARTISTA 1..5 vazias nas 2 últimas semanas (04/11 e 11/11/2026) e
  VENDAS GERAIS vazia no Hot 100 da última semana. Ver "Artistas" abaixo.

## Abordagens consideradas (entrada semanal)

1. **Google empurra os dados (escolhida).** Um arquivo novo e separado no
   projeto Apps Script (`EnvioD1.gs`), com gatilho próprio na quinta-feira e
   item de menu "Enviar ao app", lê as últimas linhas da aba DADOS *de dentro
   do Google* (rápido lá dentro), filtra a data mais recente e faz POST ao
   Worker. O script grande existente não é tocado.
2. **Worker lê a aba DADOS na quinta via Sheets API.** Descartada: mesmo
   pedindo poucas linhas, o Google precisa abrir a planilha de 200 MB → risco de
   timeout, que é exatamente o que se quer eliminar.
3. **1 + 2 como rede de segurança.** Descartada pelo mesmo motivo do 2.

## Design

### Tabelas D1 (banco existente `CATALOGO_DB`, migração nova em `d1/`)

- `chart_semana` — uma linha por (chart, data, posição): `chart`, `data`
  (ISO `aaaa-mm-dd`), `pos`, `titulo` (texto original col. D),
  `titulo_norm` (chave de identidade da música), `valor`, `valor_total`,
  `artista1..5`, e **calculados na ingestão**: `status` (`↑`/`↓`/`=`/`NEW`),
  `pos_anterior`, `peak`, `semanas`, `semanas_n1`. PK `(chart, data, pos)`;
  índices em `(chart, data)` e `(chart, titulo_norm)`.
- `chart_pais_semana` — (plataforma, data, país, pos, titulo_norm, titulo,
  valor, artista principal, status). Top 50 por país. PK
  `(plataforma, data, pais, pos)`.
- `pais_peso` — (plataforma, país, peso). Peso base de cada país por plataforma.
- `chart_config` — chave/valor: `bonus_nacionalidade` (padrão `0.20`),
  `top_pais` (padrão `50`).
- `artista_info` — cache de INFOS ACTS: nome, nacionalidade (col. N), gênero,
  foto (col. G, que já resolve a foto certa). Atualizado na ingestão semanal
  (ver "Dependências do Google" abaixo).
- `chart_ingestao` — log: data da semana, chart, linhas, status, mensagem,
  quando. Usado para diagnóstico.

### Endpoint de ingestão

`POST /api/charts/ingest` — protegido por segredo (header
`Authorization: Bearer <CHARTS_INGEST_TOKEN>`, guardado como secret do Worker e
como Propriedade do Script no Apps Script).

Corpo: `{ data: "dd/mm/aaaa", linhas: [[A..L], ...] }` (as linhas brutas da
semana) e, opcionalmente, `artistas: [[nome, nacionalidade, gênero, foto], ...]`.

Regras:
1. **Validação completa antes de gravar:** os 5 charts presentes; cada um com
   posições 1..N contíguas e sem duplicatas (N = 100 para todos hoje; o
   validador aceita o N que vier, desde que contíguo e ≥ 1 — ver "Decisões do
   construtor"); uma única data. Falhou → `400` com a lista de problemas,
   nada é gravado.
2. **Idempotente:** reenvio da mesma data apaga e regrava aquela semana
   (dentro de um `batch` do D1 — tudo ou nada).
3. Calcula, para cada chart, comparando com a semana anterior **do mesmo
   chart** já no D1 (por `titulo_norm`):
   - `NEW` se a música nunca apareceu naquele chart; `↑`/`↓`/`=` contra a
     posição da semana anterior; se esteve antes mas não na semana anterior,
     trata como `NEW` (o front hoje só conhece `↑ ↓ = NEW`; RE-ENTRY fica
     como melhoria futura).
   - `peak`, `semanas` (total de semanas no chart), `semanas_n1`.
4. Calcula o ranking por país (abaixo) e grava.
5. Recalcula a semana **seguinte**, se existir (caso de reenvio de semana
   antiga na carga/correção). Na operação normal não há seguinte.
6. Responde `200 { ok, data, linhas, paises }`.

### Ranking por país — regra B (soma global garantida)

Para cada música *s* numa plataforma *p* (Spotify, Apple Music, YouTube):

- `pb[c]` = peso base do país *c* em `pais_peso` para *p*.
- `N(s)` = países de nacionalidade dos artistas 1..5 de *s* (via `artista_info`).
- Peso bruto: `w[c] = pb[c] + bônus` se `c ∈ N(s)`, senão `pb[c]`.
- Se `Σ pb < 1`, existe um "resto do mundo" implícito `1 − Σ pb` que entra na
  normalização (não vira ranking). Se `Σ pb > 1` (YouTube hoje soma 119,96%),
  não há resto: a divisão por `Σ w` encolhe todos proporcionalmente.
- Pesos atuais (81 países): Spotify 99,15%, Apple Music 95,49%, YouTube
  119,96% — importados como estão do CSV de PAÍSES E PESOS.
- Fatia: `share[c] = w[c] / (Σ w + resto)` → a soma de todos os países + resto
  é **exatamente** o total global.
- Valor no país = `round(total_global × share[c])`.
- Ranking de cada país = músicas ordenadas por valor no país, Top 50;
  status por país comparando com a semana anterior do mesmo país/plataforma.

Sem nacionalidade cadastrada → música recebe só os pesos base. Bônus `0` em
`chart_config` desliga a regra (todos os países ficam com o ranking global).
O selo "Vem aí" foi substituído pela regra B ativa; regras futuras entram
como novos campos em `chart_config`.

### Artistas, capa e gênero — do catálogo (tabela `musicas` do D1)

Decisão do usuário: as colunas ARTISTA 1–5 da DADOS **pararam de ser
preenchidas**; quando vazias, o catálogo cobre os artistas. Capa e gênero vêm
sempre do catálogo (a DADOS não tem essas colunas). O catálogo já está no
mesmo D1 (`musicas`, ver `backend/src/services/musicasDbService.ts`), com
`artista`, `artista_2..6`, `capa_url`, `genero`, `tipo_single`.

- **Cruzamento:** col. D da DADOS ("Artista - Título") ↔ catálogo por chave
  normalizada (`normalizarTitulo` de "artista - titulo" e, como 2ª tentativa,
  só do título + artista principal). Se houver single e faixa de álbum com o
  mesmo título, vence o single (mesma regra de `buildCapaPorTituloCatalogo`).
- **Artistas** da música, nesta ordem de prioridade:
  1. colunas **H–L da DADOS**, quando preenchidas (todo o histórico até
     28/10/2026 e qualquer linha futura que vier preenchida);
  2. `artista..artista_6` do **catálogo**, quando H–L vierem vazias;
  3. extração do texto da col. D (reserva, ver abaixo).
  Os artistas alimentam a nacionalidade (bônus por país) e a foto.
- **Gênero** (filtro do Hot 100) = `musicas.genero` da própria música.
- **Capa** = `musicas.capa_url` → senão foto do artista principal
  (`artista_info.foto`) → senão vazio. Resolvida **na leitura**, para capas
  novas aparecerem sem reprocessar.
- **Sem H–L e fora do catálogo:** reserva = extrair artistas do texto da col. D
  (antes de " - " = principal; "feat./ft./&/x" = convidados), só aceitando
  nomes que existam em `artista_info`. Sem gênero. Registrada no log de
  ingestão para alguém cadastrar.
- Os artistas usados no cálculo de países são **gravados** junto da linha da
  semana (o ranking de países daquela semana não muda se o catálogo mudar
  depois).
- `artista_info` (nacionalidade col. N, foto col. G da INFOS ACTS) continua
  chegando pelo envio semanal do Apps Script — não há tabela de artistas no D1
  hoje.

### Leitura (`/api/charts`)

`chartsController.ts` troca a fonte para os 5 charts e seus `COUNTRIES`:
- `getFilters(tab)` → datas distintas de `chart_semana` (mais recente primeiro,
  formatadas `dd/mm/aaaa` como hoje) e gêneros.
- `getChart(tab, date)` → linhas da semana com o mesmo formato de hoje
  (`pos, tit, val, valTotal, art, st, capa, style`).
- `* COUNTRIES` → datas semanais; linhas `{pais, pos, tit, val, mes:<data>,
  art, capa, st}`.
- `getBannerN1s` → #1 da semana mais recente de cada chart (bb200 continua
  da planilha de álbuns).
- `getHOFProfile/getHOFList` → números e runs dos 5 charts calculados do D1;
  parte de álbuns segue da fonte atual; foto/país/gênero de `artista_info`.
- Respostas com cache curto (já existe cache por URL no front; adicionar
  `Cache-Control` no Worker).

### Front

Só o seletor de países: de mês para semana (rótulo e lista vêm de
`getFilters`). Respeitar as regras de botões/tabs do `CLAUDE.md`.

### Script do Google (`EnvioD1.gs`, arquivo novo)

- Abre EMPIRE - CHARTS, aba DADOS; lê só as últimas ~600 linhas
  (`getLastRow()` − 600 até o fim, colunas A:L).
- Pega a data mais recente, filtra as linhas dela.
- Lê INFOS ACTS (planilha registrosCharts) colunas necessárias e envia junto
  em `artistas` (mantém nacionalidade/gênero/foto atualizados no D1).
- POST com o token (Propriedade do Script). Mostra o resultado no log e numa
  célula de status (padrão do script atual, ex.: "OK - data - hora" / erro).
- Gatilho de tempo: quintas-feiras; item de menu "Enviar ao app" para reenvio
  manual. Entregue com passo a passo para colar e criar o gatilho.

### Carga inicial

Script local (`scripts/`) que lê o CSV exportado da aba DADOS + CSV de PAÍSES E
PESOS + INFOS ACTS e chama a mesma lógica de ingestão **semana a semana, em
ordem cronológica** (para status/peak saírem certos), gravando no D1 remoto via
`wrangler d1 execute` ou via o próprio endpoint. Pesos iniciais em `pais_peso`
vêm da aba PAÍSES E PESOS (ou, se faltar, dos `pb` da fórmula salva em
`adminRestoreFormulaPaisController.ts`).

### Corte (cutover)

1. Criar tabelas, carregar histórico, validar comparando algumas semanas com a
   tela atual.
2. Trocar a leitura no `chartsController` (com fallback para a planilha só
   enquanto o D1 estiver vazio para aquele chart).
3. Ativar o `EnvioD1.gs`. Remover o fallback depois de 2 semanas OK.

## Restrições

- Cloudflare Workers + D1 (plano gratuito); app não roda no Telegram.
- Limites D1: batch por request; por semana são ~500 linhas globais + 3
  plataformas × nº de países × 50 linhas de países — gravar em lotes.
- Planilha EMPIRE - CHARTS não pode ser lida pelo Worker.

## Decisões que ficam com o construtor

- Normalização de `titulo_norm` (reaproveitar `normalizarTitulo` existente).
- Tamanho dos lotes de insert e se `chart_pais_semana` guarda só Top 50 (sim,
  padrão) — isso reduz para ~3 plataformas × nº de países × 50 linhas.
- Formato exato do token/secret e nome do header.
- Se o validador exige exatamente 100 posições ou apenas contíguas.

## Calls feitos por mim (conferir)

- Escopo: só os 5 charts + países + parte deles no HOF/banners; resto depois.
- Status só `↑ ↓ = NEW` (RE-ENTRY conta como NEW), para não mexer no front.
- Gênero pela própria música no catálogo; nacionalidade por qualquer artista da música (como na fórmula antiga).
- Capa resolvida na leitura, não gravada.
- `valTotal`: usa VENDAS GERAIS (col. F) quando vier preenchida; se vazia,
  o app soma os valores semanais acumulados da música naquele chart.
- INFOS ACTS chega ao D1 junto com o envio semanal (o Worker não lê planilha
  nesse fluxo).
- Bônus padrão 0,20 (o mesmo da fórmula antiga), Top 50 por país.
