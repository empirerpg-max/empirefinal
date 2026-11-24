# Paradas nacionais, foco do lançamento e pesos imprevisíveis — design

Data: 2026-11-24 · Status: aguardando aprovação (rev. 2, após revisão)

Base: `docs/superpowers/specs/2026-11-14-charts-d1-design.md` (charts no D1,
regra B de países). Este documento muda a regra de países e adiciona paradas
nacionais.

## Intenção e porquê

Hoje o ranking por país usa só a nacionalidade dos artistas, com bônus fixo
(+0,20). Isso deixa os países **previsíveis**: um artista australiano
razoável fica sempre no topo da Austrália, e em país pequeno nenhum hit
mundial consegue liderar. O usuário quer:

1. Nacionalidade continua como fator **principal**; o **foco do lançamento**
   (país escolhido pelo artista no cadastro do single) entra como fator
   **secundário**, mais fraco. Ex.: australiano com foco nos EUA pesa menos nos
   EUA do que um americano.
2. Resultados **imprevisíveis** semana a semana, mas **fixos por data**: todo
   jogador vê o mesmo resultado para a mesma semana, hoje e no futuro.
3. Um hit mundial deve conseguir estar no topo de vários países.
4. Paradas nacionais com nome das paradas reais (Hot 100 dos EUA, UK, ARIA…),
   tiradas do chart global do jogo.
5. Um documento no repositório explicando as regras, para ajustes futuros.

## Objetivos

- **O total global nunca muda.** Os 5 charts enviados pela planilha (aba
  DADOS → `POST /api/charts/ingest`) continuam sendo os dados principais. Para
  cada música, a soma de todos os países + "resto do mundo" = exatamente o
  total global (100%).
- Regra nova de fatias por país (abaixo), aplicada a **todas** as visões por
  país: recortes Spotify/Apple Music/YouTube COUNTRIES (já existentes) e as
  paradas nacionais novas.
- Campo **foco** no cadastro do single.
- Renomear "Billboard Hot 100" (chart global do jogo) para **Global 100**;
  "Spotify" passa a ser exibido como **Spotify Global**.
- Paradas nacionais **Top 50** + **Global Excl. US**.
- Histórico completo: as paradas nacionais existem para todas as semanas já no
  D1 (desde 2020), sem regravação em massa.
- Documento de regras para mantenedores (`docs/charts-regras-paises.md`).

## Não-objetivos

- **IFPI anual** (ranking do ano somando semanas): próxima leva.
- Oricon em paralelo à Billboard Japan (mesmos dados, não faz sentido).
- Mudar o chart global (posições, valores, movimento, peak etc.). Só o nome.
- Álbuns, Mensal, Ao Vivo: fora.
- Foco em mais de um país.

## Anti-objetivos (fracasso mesmo "funcionando")

- Jogador A ver um ranking de 14/11 e jogador B ver outro para a mesma data.
- Soma dos países diferente do total global da música.
- Nativo **sempre** no topo do próprio país (previsível de novo).
- Hit mundial nunca liderando em país pequeno.
- Preencher o foco hoje mudar semanas passadas.
- Estourar o limite gratuito do D1 (escritas em massa, leituras por jogador).
- Texto de tab cortado com "..." (regra do `CLAUDE.md`).

## Restrições

- Cloudflare Workers + D1 gratuito (100 mil escritas/dia; leituras contam).
- A planilha manda 100 posições por chart/semana; todo ranking nacional é uma
  reordenação desse universo de 100.
- O app não lê a planilha.
- Pesos e faixas ajustáveis sem deploy (`chart_config`).

## Abordagens consideradas (onde a conta acontece)

- **A) Calcular na leitura + cache (escolhida pelo usuário).** Igual a hoje
  (`linhasPaises` em `backend/src/services/chartsD1/repo.ts`): ao abrir uma
  parada, o servidor lê as 100 linhas da semana + a anterior (para ↑↓), aplica
  a regra e devolve o Top 50. A resposta fica em cache (o cache por URL que já
  existe em `chartsController.ts` + `Cache-Control` para semanas passadas).
  Escritas novas: só uma linha de regras por semana e o foco no catálogo.
- **B) Calcular na quinta e gravar rankings prontos.** Descartada: ~11 paradas
  × 50 + recortes de plataforma por semana, e o histórico desde 2020 estouraria
  as escritas diárias por vários dias; qualquer ajuste de regra exige regravar.
- **C) Calcular no navegador.** Descartada: manda a semana inteira ao celular,
  expõe a regra e abre risco de resultado diferente entre aparelhos.

## Regra de fatias por país (nova "regra C")

Para cada música *s* numa plataforma/chart *p*, semana *d*:

- `pb[c]` = peso base do país *c* (`pais_peso`). Para o Global 100, que não
  tem pesos próprios: **média** dos pesos de SPOTIFY, APPLE MUSIC e YOUTUBE
  para o país (média sobre as plataformas que têm o país; país sem peso em
  nenhuma fica de fora).
- `N(s)` = países de nacionalidade dos artistas 1..5 (como hoje, via
  `artista_info`).
- `F(s,d)` = país de foco vigente na semana *d* (ver "Foco"), se não for
  "Global" e não estiver em `N(s)`.
- `r(s,c,d,k)` = número pseudoaleatório em [0,1) **determinístico**: hash da
  string `d|titulo_norm|c|k` (ex.: FNV-1a 32 bits / 2^32). `k` distingue os
  sorteios (`nac`, `foco`, `var`). Não é gravado: dá sempre o mesmo valor.

Peso bruto:

```
mult_nac  = nac_min  + r(s,c,d,"nac")  × (nac_max  − nac_min)    se c ∈ N(s)
mult_foco = foco_min + r(s,c,d,"foco") × (foco_max − foco_min)   se c = F(s,d)
bonus[c]  = min(pb[c] × mult, teto)     (0 se c não é nacional nem foco;
                                         nacional e foco nunca somam no mesmo c)
var[c]    = 1 + variacao × (2·r(s,c,d,"var") − 1)
w[c]      = (pb[c] + bonus[c]) × var[c]
```

Normalização (igual à regra B, garante 100%):

```
resto     = max(0, 1 − Σ pb)
share[c]  = w[c] / (Σ w + resto)
valor[c]  = total_global(s) × share[c]
```

Ranking de cada país = músicas ordenadas por `valor[c]` (sem arredondar), Top
50; `st` contra o ranking do mesmo país/parada na semana anterior.

**Por que proporcional ao peso do país (e não +0,20 fixo):** com +0,20, numa
Austrália de 2% o nativo recebe 11× a fatia de um estrangeiro de mesmo total
— um nativo mediano vence qualquer hit mundial. Com bônus proporcional
(1,5×–4× o peso), o nativo precisa ter ao menos ~1/4 do total do hit para
vencê-lo. Hits mundiais lideram em vários países; nativo forte ainda vence em
casa; o sorteio por semana faz o resultado variar.

### Parâmetros (`chart_config`, valores iniciais — call meu, ajustáveis)

| Chave | Inicial | Significado |
|---|---|---|
| `nac_min` / `nac_max` | 1.5 / 4.0 | faixa do multiplicador de nacionalidade |
| `foco_min` / `foco_max` | 0.5 / 1.5 | faixa do multiplicador de foco (sempre abaixo da nacionalidade) |
| `bonus_teto` | 0.20 | teto absoluto do bônus em qualquer país (evita EUA explodir: 30% × 4) |
| `variacao` | 0.15 | variação ±15% na fatia de cada país |
| `top_pais` | 50 | tamanho das paradas/recortes |

`bonus_nacionalidade` (regra B) deixa de ser usado; fica no banco só como
histórico.

### Fixo por data: tabela `chart_regras_semana`

Uma linha por semana (`data` ISO PK, `regras` JSON com os parâmetros acima +
`versao` da regra). Gravada na ingestão da semana (1 escrita/semana) com os
valores de `chart_config` daquele momento. A leitura usa **as regras da
semana**, não as atuais: mudar `chart_config` hoje só afeta semanas futuras.

- **Histórico (decidido com o usuário):** todas as semanas antigas, inclusive
  os recortes Spotify/Apple/YouTube COUNTRIES que já existem, passam **uma
  vez** para a regra C no deploy, e daí ficam fixas. A regra B não precisa
  continuar no código. Semanas sem linha em `chart_regras_semana` usam a
  semente `versao=1` (~256 linhas, ou 1 linha "padrão para semanas sem
  registro" — decisão do construtor).
- Reenvio de uma semana mantém a linha que já existe (`INSERT OR IGNORE`).
- `versao` permite mudar a fórmula no futuro sem reescrever o passado
  (código mantém as versões antigas).

### O que pode mudar o passado (aceito pelo usuário)

- **Nacionalidade** continua lida do cadastro atual (`artista_info`). Mudança é
  rara e normalmente correção; o histórico do artista acompanha.
- **Pesos base** (`pais_peso`) continuam os atuais (como hoje). *Call meu:*
  aceitar, pois mudam raramente; se virar problema, incluir `pais_peso` no
  snapshot de `chart_regras_semana`.

## Foco do lançamento

### Dados

Tabela nova e própria no D1 do catálogo, **`musica_foco`** (histórico do
foco), em vez de colunas em `musicas`:

| Coluna | Significado |
|---|---|
| `codigo_unico` | código único da música (estável; `chave` pode ser re-keyada por ferramentas admin) |
| `pais` | país como em `pais_peso` (caixa alta) ou `GLOBAL` |
| `desde` | data ISO em que este foco passou a valer |
| `por_admin` | 1 se foi troca feita pela administração |

PK `(codigo_unico, desde)`. **Por quê (call meu):** `musicas` recebe
upserts/re-syncs a partir da planilha (fluxos de Gestão, ferramentas
`adminFix*D1Sync*`, re-key); uma tabela só do D1, sem coluna na planilha, não
é sobrescrita por nenhum deles. E guardar o histórico resolve a troca pelo
admin sem mudar o passado.

**Vigência:** para a semana *d*, o foco da música é a linha com o maior
`desde < d`. Sem linha → sem foco. Troca pelo admin = **nova linha** (as
semanas anteriores continuam com o foco antigo). Semana igual a `desde` não
conta.

**Leitura:** `musica_foco` é lida inteira (poucas linhas, 1 por single com
foco) junto com o catálogo e entra no mesmo cache de isolate do catálogo
(`chartsController.ts`). Custo: 1 consulta pequena por recarga do cache.
Ligação música do chart → `codigo_unico` pelo mesmo cruzamento já usado para
capa/gênero (`titulo_norm` ↔ catálogo).

### Regras de edição

- **Single novo:** campo obrigatório no cadastro (Gestão → formulário de
  música, `src/components/EmpirePlay/Gestao.tsx`, `POST /api/gestao/musica`).
  Lista: "Global / sem foco" + países de `pais_peso` (ordem alfabética).
- **Single existente sem foco:** o dono pode preencher **uma vez** (tela de
  edição, `EditModal.tsx` / `editController.ts`).
- **Depois de preenchido:** travado. O backend recusa nova linha se a música
  já tem foco, exceto para admin (exceção pedida à administração). Troca pelo
  admin = nova linha em `musica_foco` (vale dali pra frente).
- Faixa de álbum não é single e não pede foco. **Todo fluxo que transforma
  uma música em single daqui pra frente exige o foco** (cadastro na Gestão,
  publicar faixa como single no `EditModal`, troca de `tipoSingle` de
  "TRACKLIST ALBUM" para single, lançamento de faixa de álbum como single).
  Singles **anteriores** a este deploy: foco opcional, preenchível uma vez.
  *Call meu, coerente com "a partir de agora o artista precisa decidir".*

Texto de ajuda no campo: "País onde você quer focar este lançamento. Depois de
salvo, só a administração pode alterar."

## Paradas nacionais

Todas = recorte por país do **Global 100** (antigo "BILLBOARD HOT 100"),
regra C, **Top 50**.

| País (`pais_peso`) | Parada |
|---|---|
| EUA | Billboard Hot 100 |
| Reino Unido | UK Official Charts |
| Austrália | ARIA Charts |
| Japão | Billboard Japan Hot 100 |
| Coreia do Sul | Circle Chart |
| Alemanha | Offizielle Deutsche Charts |
| França | SNEP |
| Canadá | Billboard Canadian Hot 100 |
| Brasil | Billboard Brasil Hot 100 |
| Argentina | Billboard Argentina Hot 100 |
| México | Billboard México |

- Mapeamento país → nome em `chart_config` (chave `paradas_nacionais`, JSON
  `{ "PAÍS": "Nome" }`): incluir/renomear sem deploy.
- **Global Excl. US:** cada música com `valor = total × (1 − share[EUA])`,
  reordenado, Top 100 (o universo inteiro). `st` contra a semana anterior do
  mesmo recorte.
- Os recortes Spotify/Apple Music/YouTube COUNTRIES continuam (agora com a
  regra C).

### Nomes de exibição

- "Hot 100" (tab do Global) → **Global 100**. Id interno `BILLBOARD HOT 100`
  no D1/planilha **não muda** (só rótulo).
- "Spotify" → **Spotify Global** (só rótulo).
- Banners/Hall of Fame que dizem "Hot 100" para o chart global passam a dizer
  "Global 100".

### Front (`src/routes/charts.tsx`)

- Tab nova **Paradas Oficiais**, após o Global 100.
- Dentro dela, seletor de parada **rolável horizontal** (`useDragScroll` +
  `StickyScrollArrowLeft/Right`, padrão de `src/routes/social.tsx`; cada pill
  `shrink-0`, padding real, sem truncar — regra do `CLAUDE.md`). Itens: Global
  Excl. US + as paradas da tabela, na ordem da tabela.
- Seletor de semana igual aos COUNTRIES de hoje.
- Linhas no formato já existente de COUNTRIES (`pos, tit, val, art, capa, st`).
- A barra de tabs principal ganha um item: conferir se ela é `grid-cols-N`; se
  for, virar fileira rolável (regra do `CLAUDE.md`).

### API

`GET /api/charts?tab=PARADAS&parada=<PAÍS|EXCL_US>&date=dd/mm/aaaa` (forma
exata: construtor). `getFilters` devolve as datas do Global 100 e a lista de
paradas de `chart_config`.

## Custo (D1)

- Escritas: +1 por semana (`chart_regras_semana`) + foco no cadastro.
  Semente do histórico: ≤ 256 escritas, uma vez.
- Leitura por parada não cacheada: ~200 linhas de `chart_semana` + config +
  `artista_info` (já lidos hoje nos COUNTRIES). Catálogo já em cache de
  isolate.
- Cache: o cache de resposta por URL que já existe + `Cache-Control`
  (semana passada: longo; semana atual: curto, e limpo na ingestão como hoje).

## Documento para mantenedores

`docs/charts-regras-paises.md` (em português, linguagem simples): de onde vêm
os dados; a fórmula com um exemplo numérico (o australiano com foco nos EUA e
o hit mundial); o que cada chave de `chart_config` faz e o efeito de
aumentar/diminuir; como incluir uma parada nacional; por que o resultado é
fixo por data (hash + `chart_regras_semana`); o que muda o passado e o que não
muda; como o foco trava e como o admin libera; como criar uma `versao` nova da
fórmula sem mexer no histórico.

## Testes esperados

- Soma: para qualquer música, Σ valor[c] + resto × total = total (tolerância
  de ponto flutuante).
- Determinismo: mesma entrada → mesmo ranking; ordem de iteração não importa.
- Foco: não vale em semana ≤ `desde`; troca do admin não muda semanas anteriores; foco no país de
  nacionalidade não soma; "Global" não soma.
- Hit mundial: cenário de exemplo em que um hit 4× maior vence o nativo num
  país de 2%.
- Regras por semana: mudar `chart_config` não muda o ranking de uma semana que
  já tem linha em `chart_regras_semana`.
- Trava do foco: dono não altera foco preenchido; admin altera.

## Decisões que ficam com o construtor

- Função de hash exata (determinística, sem dependência do runtime).
- Semente do histórico: 256 linhas ou 1 linha "padrão".
- Forma exata dos parâmetros da API e nomes internos.
- Como o admin edita o foco (campo na tela de edição visível só para admin,
  reaproveitando o controle de admin existente).
- Correspondência de nomes de país (EUA vs ESTADOS UNIDOS etc.) com
  `pais_peso`, sem acento/caixa, como já é feito.

## Calls feitos por mim (conferir)

- Valores iniciais das faixas (1,5–4 nacionalidade, 0,5–1,5 foco, teto 0,20,
  ±15%).
- Pesos do Global 100 = média de Spotify/Apple/YouTube.
- Pesos base fora do snapshot por semana.
- Foco numa tabela própria `musica_foco` com histórico (não em `musicas` nem na planilha).
- Foco obrigatório em todo fluxo que transforma música em single daqui pra frente.
- Global Excl. US com 100 posições (os nacionais, 50).
- Tab "Paradas Oficiais" após o Global 100.
