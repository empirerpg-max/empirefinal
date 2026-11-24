# Playlists do Empire Play (painel ao vivo) — design

Data: 2026-11-24 · Status: aprovado com ajustes (rev. 2)

Mockups (rev. 2 do usuário: **topo = destaque do modelo C, resto = prateleiras do modelo A**; títulos sempre completos):
https://claude.ai/artifact/At5D4YSEnUswTS7o9n4Lm8

## Intenção e porquê

A tela inicial do catálogo (Empire Play, `src/routes/empire-play.index.tsx`)
tem 4 cards quadrados iguais — Spotify Global, Apple Music, YouTube Hits, Hot —
que abrem uma playlist em tela cheia. O usuário acha repetitivo e quer algo
como o que Spotify/Apple Music/YouTube fazem: **muitas playlists** (por país,
da semana, por gênero) **e** playlists que **mudam em tempo real**, no
espírito da aba "Ao vivo" dos Charts.

Hoje as 3 playlists de top vêm de 3 abas da planilha principal
(`/api/top-playlists`, `getTopPlaylists` em `catalogController.ts`), lidas a
cada abertura da tela — não usam os charts do D1 e gastam cota do Google.

## Objetivos

- Topo da tela: **destaque "Mais quente agora"** (modelo C) com a playlist
  ao vivo que mais se mexeu, atualizando a cada 30 s.
- Embaixo: **prateleiras** (modelo A): Charts globais (Top 100 ao vivo de
  Spotify, Apple Music, YouTube + Global 100), **Top 50 por país** (com filtro
  de plataforma), Paradas oficiais, Por gênero + Hot.
- Toda playlist abre a **tela cheia que já existe** (capa grande, lista,
  tocar) e **toca** as músicas pelo catálogo.
- **Títulos sempre completos**, sem "…" em lugar nenhum (destaque, cards,
  lista da playlist): o texto quebra linha (regra do `CLAUDE.md` + pedido do
  usuário).
- Capas = capa da música #1 de cada playlist (material do catálogo), com o título por cima.

## Não-objetivos

- Playlists criadas por jogador, seguir playlist, favoritos.
- Mudar a tela de Charts.
- Paradas oficiais/gêneros "ao vivo" (são semanais).

## Anti-objetivos

- Celular baixando milhares de linhas a cada 30 s.
- Mais leituras de planilha (a tela nova não lê planilha para as playlists).
- Música que não toca sem explicação.
- Texto cortado com "…".

## Abordagens

- **A) Endpoint de playlists montado no servidor (escolhida).** Uma rota
  devolve o índice (destaque + prateleiras) e outra devolve uma
  playlist já com as músicas ligadas ao catálogo, prontas para tocar. Usa
  D1 + o ao vivo existente, com cache; o celular baixa só o que abriu.
- B) Montar no celular com as rotas atuais. Descartada: baixaria os recortes
  por país de todas as plataformas (milhares de linhas) a cada 30 s.
- C) Manter as 3 playlists da planilha e só acrescentar seções. Descartada:
  continua repetitivo e lendo a planilha.

## Design

### Fontes de dados (todas já existem)

| Playlist | Fonte | Atualiza |
|---|---|---|
| Top 100 Spotify / Apple Music / YouTube (ao vivo) | EM Alta (`fetchRTBruto`, cache 30 s) | 30 s |
| Top 50 {país} por plataforma | `calcularAoVivoPaises` (cache 30 s) | 30 s |
| Global 100 | `chart_semana` (última semana) | quinta |
| Paradas oficiais (uma por parada) | `calcularSemanaPaises(...).paradas` (cache da semana) | quinta |
| Top {gênero} | Global 100 da semana filtrado por `musicas.genero` | quinta |
| Hot | 30 lançamentos mais recentes do D1 `musicas` (`data_lancamento_iso` desc, sem faixas pendentes) — *não* usa mais `/api/lancamentos`, que lê a planilha | cache 5 min |

### API (nova, em `/api/empire-play/playlists`)

- `GET /api/empire-play/playlists` → índice:
  - `destaque`: `{ id, titulo, musica, subiu, valor, capa }`.
  - `capa` de cada playlist = capa da música #1 (catálogo), senão foto do artista #1.
  - `paises`: `{ spotify|apple|youtube: [{ id, pais, titulo: "Top 50 {país}" }] }`
    na ordem do peso do país.
  - `semana`: lista `{ id, titulo, subtitulo, tipo }` (Global 100, cada parada,
    cada gênero com ≥ 10 músicas no Global 100, Hot).
  - Cache de 30 s (mesma regra do ao vivo: nunca mais velho que a leitura da
    EM Alta).
- `GET /api/empire-play/playlists?id=<id>` → `{ id, titulo, subtitulo,
  atualizadoEm, faixas: [...] }`.
  - `id` estável e legível, ex.: `ao-vivo:spotify`, `pais:spotify:BRASIL`,
    `semana:global100`, `semana:parada:UK`, `semana:genero:POP`,
    `semana:hot`.
  - `faixas`: na ordem do chart, cada uma com `pos`, `valor` (texto formatado),
    e os campos que `toPlayableTrack` já entende (`titulo`, `artista`,
    `capa_url`, `audio_url`, `id_topico`/`codigo_unico`) vindos do catálogo
    D1 (`musicas`), ligados pelo mesmo cruzamento dos charts
    (`buscarNoCatalogo`).
  - Música do chart **sem** correspondência no catálogo ou sem áudio: entra na
    lista com `tocavel: false` (aparece em cinza com "Sem áudio no catálogo"),
    para a posição do chart continuar fiel. *Call meu.*
- `/api/top-playlists` (planilha) deixa de ser usado pela tela; a rota fica
  no código por enquanto (pode ter outros usos). *Call meu.*

### Ligação com o catálogo (respostas da revisão)

- **Como liga:** pelo título, com `buscarNoCatalogo` (o mesmo cruzamento que
  já dá capa e gênero aos charts). Não existe código único gravado nas
  linhas dos charts; título é o que há. O índice devolve, para diagnóstico,
  `semAudio: n` por playlist aberta (quantas faixas ficaram sem áudio).
- **Gênero:** `musicas.genero` em caixa alta sem acento (`POP` = `Pop`);
  música do Global 100 sem correspondência no catálogo fica fora das
  playlists de gênero.
- **Paradas oficiais:** uma playlist por parada; Top 50 (Global Excl. US:
  Top 100), na ordem da parada.
- **Países:** o `id` usa o nome do país exatamente como em `pais_peso`
  (caixa alta, com acento), codificado na URL. O título exibido é
  "Top 50 " + nome com só a primeira letra de cada palavra maiúscula
  ("Top 50 Reino Unido"). O quadradinho colorido mostra as 2 primeiras
  letras do nome (sem mapa de siglas). A ordem dos países vem de
  `calcularAoVivoPaises` (peso desc); cada plataforma tem a sua lista.
- **Valor:** o número exibido é o valor cheio formatado em pt-BR (ex.:
  187.049.605), igual ao "Ao vivo" dos Charts; a legenda "mil streams" do
  mockup sai.
- **Atualizar sem cortar a música:** cada faixa vem com uma chave estável
  (`codigo_unico` quando houver, senão a identidade do título do chart); a
  tela atualiza a lista pela chave e não mexe na fila que está tocando.

### Catálogo para tocar

Ler do D1 `musicas` os campos de reprodução (`audio_url`, `capa_url`,
`id_topico`, `codigo_unico`, artistas) — ampliar o carregamento de catálogo
usado pelos charts ou fazer uma leitura própria com cache de 5 min (decisão do
construtor). **YouTube:** ver "Playlists do YouTube = vitrine de clipes" abaixo.

### Tela (rev. 2: destaque do C + prateleiras do A)

```
┌──────────────────────────────────────────┐
│ ● MAIS QUENTE AGORA                        │  destaque grande; fundo = capa
│ TOP 50 BRASIL                              │  da música #1 da playlist
│ Rayna - Shapeshifter subiu 6 posições      │  (escurecida p/ leitura)
│ desde o último chart · 2.592.249           │
└──────────────────────────────────────────┘
Charts globais                     ver tudo
[capa #1 ▸ TOP 100 SPOTIFY GLOBAL] [APPLE MUSIC] [YOUTUBE HITS] [GLOBAL 100]
Top 50 por país        [Spotify|Apple|YouTube]
[capa #1 ▸ TOP 50 BRASIL] [EUA] [REINO UNIDO] …       rola p/ o lado
Paradas oficiais                     semanal
[capa #1 ▸ BILLBOARD HOT 100] [UK CHARTS] …
Por gênero                         Global 100
[capa #1 ▸ TOP POP] [TOP RAP] [TOP FUNK] … [HOT · lançamentos]
```

- **Capas = capas dos materiais.** Cada card de playlist usa como fundo a
  capa da música #1 daquela playlist (do catálogo D1; se não tiver, a foto
  do artista #1; se nada, a cor da plataforma/país) com o título por cima —
  como o `DynamicCoverCard` já faz hoje. Nenhuma capa "genérica" quando há
  material. (Pedido do usuário; álbuns serão reorganizados depois.)
- **Destaque "Mais quente agora"** (topo, modelo C): a playlist ao vivo
  (plataforma ou país) cuja música #1 mais subiu **em relação ao último chart
  semanal** daquela plataforma/país (posição ao vivo × posição no recorte da
  última semana). Texto: "{música} subiu N posições desde o último chart ·
  {streams}". Sem subida (empate ou sem dados) → mostra o Top 100 Spotify
  Global. Troca sozinho quando o índice atualiza (30 s). *Call meu* — não há
  histórico ao vivo por hora gravado, e gravar custaria escritas no D1.
- **Prateleiras** (modelo A), cada uma rolando para o lado
  (`useDragScroll` + setas, regra do `CLAUDE.md`): Charts globais (3 ao vivo +
  Global 100), Top 50 por país (com o filtro Spotify | Apple Music | YouTube
  no título da prateleira; países na ordem do peso; "ver tudo" abre a lista
  completa), Paradas oficiais, Por gênero (+ Hot no fim).
- Títulos sempre completos: os cards quebram linha (fonte se ajusta ao
  espaço; nunca "…").
- Atualização a cada 30 s só com a tela visível; a playlist aberta atualiza
  a lista pela chave estável sem cortar a música.

### Playlists do YouTube = vitrine de clipes

- Toda playlist cuja plataforma é YouTube (Top 100 YouTube Hits e Top 50
  {país} no YouTube) abre numa **tela estilo YouTube**: grade/lista de
  miniaturas de clipe (`thumb_url`), título e posição; tocar abre o
  `VideoPlayer` que já existe (com "próximos" = o resto da playlist).
- **Clipe pelo código único:** música do chart → catálogo (`musicas`,
  `buscarNoCatalogo`) → `codigo_unico` → `videos` com o mesmo
  `codigo_unico` e `tipo_video = 'Music Video'` (há índice em
  `videos(codigo_unico)`). Checado na produção (24/11): 189 dos 194 Music
  Videos têm código único e todos casam com uma música do catálogo.
- Música sem clipe: aparece com a capa do material e o selo "Sem clipe";
  tocar toca o áudio (se houver).

## Custo (plano gratuito)

Limites do plano gratuito: D1 = 5 milhões de linhas lidas/dia e 100 mil
escritas/dia; Google Sheets ≈ 60 leituras/min por usuário de serviço.

| Item | Como | Estimativa |
|---|---|---|
| Planilha | só a EM Alta, já lida pelo ao vivo: ≤ 1 leitura / 30 s por isolate ativo | ≤ 2/min por isolate (hoje a tela lê 3 abas a cada abertura → **diminui**) |
| D1 — referências do ao vivo (pesos, nacionalidade, foco, config) | cache **15 min** (hoje 5) | ~1.500 linhas × 96/dia ≈ 150 mil/dia por isolate sempre ativo |
| D1 — catálogo (capas, áudio, gênero) ~1.000 linhas | cache **15 min** | ~100 mil/dia por isolate |
| D1 — clipes (`videos` Music Video ~200 linhas) | cache 15 min | ~20 mil/dia |
| D1 — Hot | `ORDER BY data_lancamento_iso DESC LIMIT 30` (usa o índice `idx_musicas_data`), cache 5 min | ~10 mil/dia |
| D1 — semana (Global 100, paradas, gêneros) | cache da semana já existente | ~2 mil por cálculo, poucas vezes/dia |
| Escritas | nenhuma | 0 |

- Pior caso realista: 3 a 5 isolates com gente olhando o dia todo ≈ 1–1,5
  milhão de linhas/dia (20–30% do limite diário), sem escritas. Com pouco
  movimento, bem menos (isolates frios não leem nada).
- O celular recebe só o índice (pequeno) a cada 30 s e a playlist aberta.
- *Call meu:* subir de 5 para 15 min o cache das referências do ao vivo e do
  catálogo (capas/áudio novos aparecem em até 15 min).

## Testes esperados

- Índice: destaque escolhido pela maior subida (e Spotify Global sem subida); capa de cada playlist = capa da #1; países na ordem do peso;
  semana com Global 100, paradas existentes, gêneros com ≥ 10 músicas, Hot.
- Playlist: ordem igual à do chart; faixa sem catálogo vem com
  `tocavel: false`; `id` inválido → 404 com mensagem em português.
- Determinismo: mesmo instante → mesma resposta.
- Sem D1 / sem dados: índice com listas vazias, tela mostra "Sem dados agora."
  sem quebrar.

## Decisões que ficam com o construtor

- Forma de ler os campos de reprodução do catálogo D1 (ampliar o loader dos
  charts ou loader próprio).
- Estrutura exata do componente de tela e do cache do índice.
- Mínimo de músicas por gênero (proposto: 10).
- Se a rota `/api/top-playlists` e a `getRecentReleases` da planilha ficam ou saem do código.

## Calls meus (conferir)

- Faixa sem catálogo aparece em cinza, não some.
- Destaque "Mais quente agora" = maior subida do #1 ao vivo em relação ao último chart semanal.
- Cache de 15 min para referências do ao vivo e catálogo.
- Prateleira de países rola; "ver tudo" abre a lista completa.
- Atualização pausa quando a tela não está visível.
- `/api/top-playlists` continua no código, só deixa de ser usado pela tela.
- Hot passa a vir do D1 (não da planilha).
- Valor cheio formatado (sem "mil streams").
