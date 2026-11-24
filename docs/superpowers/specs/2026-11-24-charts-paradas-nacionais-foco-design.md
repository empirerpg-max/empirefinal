# Paradas oficiais por país, foco do lançamento e pesos imprevisíveis — design

Data: 2026-11-24 · Status: aprovado (rev. 4 — Digital Sales fora do que é novo)

Base: `docs/superpowers/specs/2026-11-14-charts-d1-design.md` (charts no D1,
regra B de países). Este documento troca a regra de países e cria as paradas
oficiais por país.

## 1. Intenção e porquê

Hoje o ranking por país usa só a nacionalidade dos artistas, com bônus fixo
(+0,20). Fica **previsível**: um australiano razoável está sempre no topo da
Austrália, e em país pequeno nenhum hit mundial lidera. O usuário quer:

1. **Nacionalidade** como fator principal; **foco do lançamento** (país
   escolhido no cadastro do single) como fator secundário, mais fraco.
2. Resultados **imprevisíveis** semana a semana, mas **fixos por data**: todo
   jogador vê o mesmo resultado para a mesma semana, hoje e no futuro.
3. Um hit mundial deve conseguir estar no topo de vários países.
4. **Paradas oficiais por país** (Hot 100 dos EUA, UK, ARIA, Oricon…), cada
   uma com a **metodologia do país real**, calculada sobre os resultados
   **daquele país** em cada plataforma (Spotify UK, YouTube UK, Apple Music
   UK).

**Digital Sales (decisão do usuário, rev. 4):** continua só como o chart
que já é hoje. Não entra na distribuição por país nem nas paradas oficiais,
e nenhuma planilha/aba/script muda por causa deste projeto.
5. Documento no repositório explicando as regras para ajustes futuros.

## 2. Objetivos

- **Os 5 charts enviados pela planilha continuam sendo os dados principais e
  nunca mudam** (aba DADOS → `POST /api/charts/ingest`). Para cada música e
  plataforma, a soma de todos os países + "resto do mundo" = exatamente o
  total global recebido (100%).
- Regra nova de distribuição por país ("regra C"), fixa por data.
- Campo **foco** no cadastro do single.
- 11 paradas oficiais por país (Top 50) + Global Excl. US, com metodologia própria.
- Renomear "Hot 100" (chart global do jogo) → **Global 100** e "Spotify" →
  **Spotify Global** (só rótulo).
- Histórico completo desde 2020, sem regravação em massa.
- Documento para mantenedores (`docs/charts-regras-paises.md`).

## 3. Não-objetivos

- IFPI anual (próxima leva).
- Billboard Japan (o Japão usa a Oricon).
- Mudar qualquer coisa do Global 100 além do nome.
- Rádio, CD/vinil, karaokê, BGM: o jogo não tem esses dados; as metodologias
  usam só o que existe.
- Álbuns, Mensal, Ao Vivo. Foco em mais de um país.

## 4. Anti-objetivos (fracasso mesmo "funcionando")

- Jogador A ver um ranking de 14/11 e jogador B ver outro para a mesma data.
- Soma dos países ≠ total global da música numa plataforma.
- Nativo **sempre** no topo do próprio país; hit mundial nunca liderando em
  país pequeno.
- Preencher/trocar o foco hoje mudar semanas passadas.
- Estourar o D1 gratuito (escritas em massa; leituras por jogador).
- Texto de tab cortado com "..." (regra do `CLAUDE.md`).

## 5. Estrutura geral (3 camadas)

```
CAMADA 0 — recebido da planilha (intocado)
  Global 100 (antigo Hot 100) · Spotify · Apple Music · YouTube · Digital Sales
  total global de cada música por semana
        │
        │  regra C (pesos por país + nacionalidade + foco + sorteio fixo)
        ▼
CAMADA 1 — resultado de cada música em cada país, por plataforma
  v[plataforma, país, música]   (Spotify UK, Apple UK, YouTube UK…)
  Σ países + resto = total global  → é o que os recortes "COUNTRIES" mostram
        │
        │  metodologia do país (taxas de conversão + regras)
        ▼
CAMADA 2 — paradas oficiais
  UK Official = Spotify/Apple UK pagos ÷100 + gratuitos ÷600 …
  Top 50 por parada · Global Excl. US (Top 100)
```

O Global 100 não participa das camadas 1 e 2: é exibido como chega.

## 6. Abordagens consideradas

**Onde a conta acontece**
- **A) Na leitura + cache (escolhida).** Como `linhasPaises` hoje
  (`backend/src/services/chartsD1/repo.ts`): o servidor lê as semanas
  necessárias, calcula e devolve; resposta em cache. Escritas novas: 1 linha
  de regras por semana + foco.
- B) Calcular na quinta e gravar pronto. Descartada: milhares de linhas por
  semana e histórico desde 2020 estouram as escritas diárias; ajuste de regra
  exige regravar.
- C) No navegador. Descartada: semana inteira no celular, regra exposta, risco
  de resultado diferente entre aparelhos.

**Como montar a parada de um país**
- Fatia do Global 100 por país. Descartada: não reflete o consumo do país.
- Mistura das plataformas pelo perfil de cada música. Descartada: ainda é só
  uma fatia do Global 100.
- **Metodologia própria do país sobre os resultados do país em cada plataforma
  (escolhida pelo usuário).**

## 7. Camada 1 — regra C (distribuição por país)

Vale para Spotify, Apple Music e YouTube (os pesos de `pais_peso` que já
existem; Digital Sales fica de fora). Para cada
música *s*, plataforma *p*, semana *d*:

- `pb[c]` = peso base do país *c* na plataforma *p* (`pais_peso`).
- `N(s)` = países de nacionalidade dos artistas 1..5 (`artista_info`, como
  hoje).
- `F(s,d)` = país de foco vigente na semana *d* (seção 9), se não for
  "GLOBAL" e não estiver em `N(s)`.
- `r(s,c,d,k)` ∈ [0,1) = hash determinístico de `d|titulo_norm|c|k` (ex.:
  FNV-1a 32 bits ÷ 2^32). `k` ∈ {`nac`, `foco`, `var`}. Nada é gravado; dá
  sempre o mesmo valor. **Não depende da plataforma**: a música tem o mesmo
  "humor" num país em todas as plataformas da semana.

```
mult      = nac_min  + r(nac)  × (nac_max  − nac_min)    se c ∈ N(s)
          = foco_min + r(foco) × (foco_max − foco_min)   se c = F(s,d)
          = 0                                            caso contrário
bonus[c]  = min(pb[c] × mult, bonus_teto)
var[c]    = 1 + variacao × (2·r(var) − 1)
w[c]      = (pb[c] + bonus[c]) × var[c]

resto     = max(0, 1 − Σ pb)
share[c]  = w[c] / (Σ w + resto)
v[p,c,s]  = total_global_p(s) × share[c]
```

Nacionalidade e foco nunca somam no mesmo país; foco "GLOBAL" ou no próprio
país não dá nada.

**Por que bônus proporcional ao peso do país:** com +0,20 fixo, numa
Austrália de 2% o nativo recebe 11× a fatia de um estrangeiro de mesmo total —
nativo mediano vence qualquer hit. Com 1,5×–4× o peso, o nativo precisa de
~1/4 do total do hit para vencê-lo; hit mundial lidera em vários países;
nativo forte vence em casa; o sorteio varia semana a semana.

Os recortes existentes **Spotify / Apple Music / YouTube COUNTRIES** passam a
mostrar a camada 1 (Top 50 por país, ordenado por `v`).

## 8. Camada 2 — paradas oficiais

### Fontes por país (o que o jogo tem)

Para cada música *s* no país *c*, semana *d*:

| Fonte | Origem | Observação |
|---|---|---|
| `pagos` | `v[APPLE MUSIC,c,s]` + `fracao_paga_spotify × v[SPOTIFY,c,s]` | streams de assinantes |
| `gratis_audio` | `(1 − fracao_paga_spotify) × v[SPOTIFY,c,s]` | Spotify Free |
| `gratis_video` | `v[YOUTUBE,c,s]` | YouTube |

`fracao_paga_spotify` inicial = 0,45 (config). Escala dos dados conferida no
export (semana 11/11/2026): Spotify #1 ≈ 187 mi, YouTube #1 ≈ 61 mi, Apple #1
≈ 28 mi — as taxas reais (100:1 etc.) fazem sentido
nessa escala.

**Universo:** todas as músicas que aparecem em qualquer um dos 4 charts de
plataforma na semana (até ~400). Música ausente de uma plataforma tem 0
naquela fonte.

### Fórmula genérica

```
unidades(s,c) = pagos/tp + gratis_audio/tga + gratis_video/tgv
```

`tp`, `tga`, `tgv` = taxas (streams por 1 unidade); taxa `0` = fonte não
conta. A Alemanha usa receita em vez de unidades (mesma forma, com preços).
Ranking por `unidades` (sem arredondar), desempate pelo maior total global
somado, depois título. Exibe `unidades` arredondadas (Alemanha: valor em €).

### Metodologias (valores iniciais — call meu, tudo em `chart_config`)

| Parada | País | Fórmula | Regras extras |
|---|---|---|---|
| Billboard Hot 100 | EUA | pagos ÷100 + grátis ÷300 (áudio e vídeo) | recorrência |
| Billboard Canadian Hot 100 | Canadá | igual ao Hot 100 | recorrência |
| UK Official Charts | Reino Unido | pagos ÷100 + grátis ÷600 | ACR; máx. 3 por artista |
| ARIA Charts | Austrália | pagos ÷100 + grátis ÷600 (áudio e vídeo) | — |
| Offizielle Deutsche Charts | Alemanha | **receita**: pagos × 0,008 + grátis × 0,0008 | — |
| SNEP | França | só pagos ÷150 (grátis não conta) | — |
| Oricon | Japão | todos os streams ÷300 (pago = grátis) | — |
| Circle Chart | Coreia do Sul | pagos ÷100 + grátis ÷200 | — |
| Billboard Brasil Hot 100 | Brasil | pagos ÷100 + grátis ÷300 | — |
| Billboard Argentina Hot 100 | Argentina | só streaming, igual ao Brasil | — |
| Billboard México | México | só streaming, igual ao Brasil | — |
| Global Excl. US | todos menos EUA | unidades do mundo (fórmula do Hot 100, aplicada aos totais globais) − unidades dos EUA | Top 100 |

(11 paradas por país + Global Excl. US. Japão = Oricon. A versão anterior
deste design tinha a "Billboard Japan", que saiu.)

### Regras extras

- **Recorrência (EUA, Canadá):** depois de calcular o ranking, remove a música
  com `semanas ≥ 20` e posição > 50, ou `semanas ≥ 52` e posição > 25; quem
  está abaixo sobe. `semanas` = semanas da música no **Global 100**
  (`chart_semana.semanas`); se ela não está no Global 100, o maior `semanas`
  entre as plataformas. Sem cálculo em cadeia.
- **ACR (UK):** se `semanas > 9` e o total de streams globais da música
  (Spotify + Apple + YouTube, camada 0) caiu em cada uma das 3 últimas
  semanas, usa taxas 200 (pagos) e 1200 (grátis). Precisa das 3 semanas
  anteriores das plataformas (lidas uma vez, ver custo).
- **Máx. 3 por artista (UK):** só as 3 músicas de maior unidade do mesmo
  artista principal entram; as outras saem e quem está abaixo sobe.
- **`st` (↑ ↓ = NEW):** contra a mesma parada calculada para a semana
  anterior (mesma função, dados da semana anterior). RE-ENTRY = NEW, como hoje.

### Formato da configuração

`chart_config`, chave `paradas` (JSON), uma entrada por parada:

```json
{
  "id": "UK", "nome": "UK Official Charts", "pais": "REINO UNIDO",
  "tipo": "unidades", "top": 50,
  "a": 1, "tp": 100, "tga": 600, "tgv": 600,
  "acr": { "semanas": 9, "quedas": 3, "tp": 200, "tga": 1200, "tgv": 1200 },
  "max_por_artista": 3, "recorrencia": null
}
```

Incluir/renomear/ajustar parada = editar o JSON, sem deploy. `ordem` define a
ordem no seletor (a da tabela).

## 9. Foco do lançamento

### Dados — tabela própria `musica_foco` (D1 do catálogo)

| Coluna | Significado |
|---|---|
| `codigo_unico` | código único da música (estável; a `chave` pode ser re-keyada) |
| `pais` | país como em `pais_peso` (caixa alta) ou `GLOBAL` |
| `desde` | data ISO em que este foco passou a valer |
| `por_admin` | 1 se foi troca feita pela administração |

PK `(codigo_unico, desde)`. Tabela só do D1, sem coluna na planilha: os
re-syncs da planilha para `musicas` (`adminFix*D1Sync*`, re-key, upserts da
Gestão) não a sobrescrevem.

**Vigência:** na semana *d* vale a linha com o maior `desde < d`; sem linha =
sem foco. Troca pelo admin = **nova linha**, então semanas anteriores mantêm o
foco antigo. Lida inteira junto com o catálogo, no mesmo cache de isolate
(`chartsController.ts`). Ligação música do chart → `codigo_unico` pelo
cruzamento que já existe para capa/gênero (`titulo_norm` ↔ catálogo).

### Regras de edição

- **Obrigatório em todo fluxo que transforma música em single daqui pra
  frente:** cadastro na Gestão (`Gestao.tsx`, `POST /api/gestao/musica`),
  publicar faixa como single (`EditModal.tsx`), troca de `tipoSingle` de
  "TRACKLIST ALBUM" para single, lançamento de faixa de álbum como single.
  Faixa de álbum que não é single não pede foco.
- Opções: "Global / sem foco" + países de `pais_peso` (alfabético). Ajuda:
  "País onde você quer focar este lançamento. Depois de salvo, só a
  administração pode alterar."
- **Singles anteriores ao deploy:** foco opcional, o dono preenche **uma vez**
  (tela de edição, `editController.ts`).
- **Depois de preenchido:** travado; o backend recusa nova linha do dono.
  Admin pode trocar (exceção pedida à administração).

## 10. Fixo por data

- **Sorteio:** hash determinístico (seção 7), sem estado.
- **Regras por semana — `chart_regras_semana`:** `data` (ISO, PK), `versao`,
  `regras` (JSON com os parâmetros da regra C + `fracao_paga_spotify` +
  `paradas`). Gravada na ingestão (1 escrita/semana, `INSERT OR IGNORE`, um
  reenvio da semana mantém a linha). A leitura usa **as regras da semana**:
  mudar `chart_config` hoje só afeta semanas futuras.
- **Histórico (combinado):** no deploy, todas as semanas antigas — inclusive
  os recortes COUNTRIES que já existem — passam **uma vez** para a regra C e
  ganham as paradas; daí ficam fixas. Semente: 1 linha "padrão" `versao=1`
  usada por semanas sem registro (ou uma linha por semana, ~256 escritas —
  construtor decide). A regra B pode sair do código.
- `versao` permite mudar a fórmula no futuro sem reescrever o passado (o
  código mantém as versões antigas).
- **O que ainda muda o passado (aceito):** nacionalidade (`artista_info`) e
  pesos base (`pais_peso`) são lidos como estão hoje; mudam raramente e
  normalmente são correções. Se virar problema: incluir no snapshot.

## 11. Leitura, API, cache e custo

- **Cálculo por semana inteira:** ao pedir qualquer parada ou recorte de uma
  semana, o servidor calcula **a semana toda de uma vez** (camada 1 das 4
  plataformas + todas as paradas + semana anterior para `st`) e guarda o
  resultado em cache; os pedidos seguintes da mesma semana (outras paradas,
  outros países) saem do cache.
- **Leituras D1 por cálculo de semana (cache frio):** 4 plataformas × 100
  linhas × (semana atual + 3 anteriores para ACR/`st`) ≈ 1.600 linhas +
  `pais_peso` + `artista_info` + `musica_foco` + `chart_regras_semana`.
  Catálogo já em cache de isolate.
- **Cache:** o cache de resposta por URL que já existe + cache da semana
  calculada; usar também a Cache API do Cloudflare (`caches.default`) para
  compartilhar entre isolates (construtor avalia). Semana passada: cache
  longo; semana atual: curto e limpo na ingestão (como hoje).
- **Escritas:** +1/semana (`chart_regras_semana`), foco no cadastro, semente
  do histórico uma vez.
- **API:** `GET /api/charts?tab=PARADAS&parada=<id>&date=dd/mm/aaaa`
  (forma exata: construtor). Linhas no formato de COUNTRIES (`pos, tit, val,
  art, capa, st`). `getFilters` devolve as datas e a lista de paradas da
  semana.

## 12. Front (`src/routes/charts.tsx`)

- Rótulos: "Hot 100" → **Global 100**; "Spotify" → **Spotify Global**. Ids
  internos (`BILLBOARD HOT 100`, `SPOTIFY`) não mudam. Banners/Hall of Fame
  que dizem "Hot 100" para o chart global passam a "Global 100".
- Tab nova **Paradas Oficiais**, depois do Global 100.
- Dentro dela: seletor de parada **rolável horizontal** (`useDragScroll` +
  `StickyScrollArrowLeft/Right`, padrão de `src/routes/social.tsx`; pills
  `shrink-0`, padding real, sem truncar). Seletor de semana como nos
  COUNTRIES. Uma linha curta embaixo do nome: país + fontes usadas (ex.:
  "Reino Unido · streaming pago e grátis").
- A barra de tabs principal ganha um item: se for `grid-cols-N`, vira fileira
  rolável (regra do `CLAUDE.md`).
- Cadastro do single: campo **Foco do lançamento** (select) ao lado de "Tipo
  de Single", obrigatório; na edição, preenchível uma vez, depois só leitura
  (admin edita).

## 13. Documento para mantenedores

`docs/charts-regras-paises.md`, em português simples:
- de onde vêm os dados (camadas 0/1/2) e o que nunca muda;
- regra C com exemplo numérico (australiano com foco nos EUA; hit mundial vs
  nativo num país de 2%);
- cada parada: fontes, taxas, regras extras, e o que acontece ao mexer em cada
  número;
- todas as chaves de `chart_config` e o efeito de aumentar/diminuir;
- como incluir/remover uma parada (editar o JSON `paradas`);
- por que é fixo por data (hash + `chart_regras_semana`) e o que ainda muda
  o passado;
- foco: vigência, trava, exceção do admin;
- como criar uma `versao` nova da fórmula sem mexer no histórico.

## 14. Testes esperados

- Camada 1: para qualquer música/plataforma, Σ `v` + resto × total = total.
- Determinismo: mesma entrada → mesmos rankings; ordem de iteração não importa.
- Foco: não vale em semana ≤ `desde`; troca do admin não muda semanas
  anteriores; foco no país de nacionalidade e "GLOBAL" não somam.
- Hit mundial vence nativo num país de 2% quando é ~4× maior; nativo vence
  quando está perto.
- Paradas: SNEP ignora grátis; Alemanha ordena por
  receita; UK limita 3 por artista; ACR troca as taxas; recorrência remove e
  sobe os de baixo; Excl. US = mundo − EUA.
- Regras por semana: mudar `chart_config` não muda uma semana que já tem
  linha em `chart_regras_semana`.
- Trava do foco: dono não altera foco preenchido; admin altera.

## 15. Decisões que ficam com o construtor

- Função de hash exata (determinística, sem dependência do runtime).
- Semente do histórico: 1 linha padrão ou 1 por semana.
- Forma exata da API, nomes internos, estrutura do cache da semana.
- Como o admin edita o foco (reaproveitar o controle de admin existente).
- Correspondência de nomes de país com `pais_peso` (sem acento/caixa, como
  já é feito).

## 16. Calls feitos por mim (conferir)

- Valores iniciais: nacionalidade 1,5×–4×, foco 0,5×–1,5×, teto 0,20,
  variação ±15%, `fracao_paga_spotify` 0,45.
- Apple Music = pago, YouTube = grátis (vídeo), Spotify = misto.
- Taxas iniciais da tabela da seção 8 (inspiradas nas reais, adaptadas aos
  dados do jogo): Hot 100/Canadá 100/300, UK e ARIA 100/600, SNEP 150 só
  pagos, Oricon streams ÷300, Circle 100/200, Alemanha por
  receita (0,008 / 0,0008), Brasil/Argentina/México
  100/300.
- Argentina e México usam a fórmula do Brasil (só streaming).
- Global Excl. US Top 100; demais Top 50.
- Sorteio igual entre plataformas para a mesma música/país/semana.
- Foco numa tabela própria com histórico; obrigatório em todo fluxo que
  cria single.
