# Playlists do Empire Play (painel ao vivo) — design

Data: 2026-11-24 · Status: aguardando aprovação

Mockup aprovado (modelo B, com títulos sempre completos):
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

- Topo da tela: **placar ao vivo** com o top 3 de Spotify, Apple Music e
  YouTube (streams ao vivo da EM Alta), atualizando a cada 30 s. Tocar numa
  coluna abre o Top 100 ao vivo daquela plataforma.
- Embaixo: **filtro de plataforma** (Spotify · Apple Music · YouTube) que
  troca a grade **Top 50 por país** (recorte ao vivo por país, o mesmo do
  "Ao vivo por país" dos Charts).
- Seção **Da semana**: Global 100, Paradas oficiais (uma playlist por
  parada), Top por gênero (Global 100 filtrado pelo gênero do catálogo) e Hot
  (lançamentos, como hoje).
- Toda playlist abre a **tela cheia que já existe** (capa grande, lista,
  tocar) e **toca** as músicas pelo catálogo.
- **Títulos sempre completos**, sem "…" em lugar nenhum (placar, cards,
  lista da playlist): o texto quebra linha (regra do `CLAUDE.md` + pedido do
  usuário).
- Capas geradas pelo app (cor da plataforma/país + título), sem arte nova.

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
  devolve o índice (placar + lista de playlists) e outra devolve uma
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
  - `placar`: `{ spotify|apple|youtube: [{pos, titulo, artista, valor}] }` (top 3).
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
construtor). **YouTube:** as playlists do YouTube tocam o áudio da música como
as outras. *Call meu* — tocar o clipe exigiria ligar cada música ao vídeo, que
é outro cruzamento.

### Tela (modelo B)

```
● EM TEMPO REAL
┌ SPOTIFY ─────┐┌ APPLE ───────┐┌ YOUTUBE ─────┐
│1 Sweet Spot  ││1 Backstreet- ││1 Sweet Spot  │   títulos quebram linha,
│  187.049     ││  Boy  28.122 ││  61.430      │   nunca "…"
│2 …           ││2 …           ││2 …           │
└──────────────┘└──────────────┘└──────────────┘
Valores em mil streams · toque numa coluna para abrir o Top 100
[Spotify] [Apple Music] [YouTube]           ← filtro (rola se precisar)
Top 50 por país · ao vivo
[BR Top 50 Brasil] [US Top 50 EUA]          ← grade 2 colunas, texto quebra
[UK Top 50 Reino Unido] …
Da semana · fecha quinta
[100 Global 100] [HOT Paradas…] [POP Top Pop] [NEW Hot]
```

- Substitui os 4 cards atuais no topo de `empire-play.index.tsx`; o resto da
  tela não muda.
- Placar e grade de países atualizam a cada 30 s só enquanto a tela está
  visível (pausa quando o jogador sai da aba/abre a playlist). *Call meu.*
- Grade de países: mostra os 8 primeiros e um "Ver todos os países" que
  expande. *Call meu* (são ~80 países por plataforma).
- Playlist aberta: a tela cheia atual, com `pos` e `valor` à direita de cada
  faixa; playlists ao vivo atualizam a lista a cada 30 s enquanto abertas,
  sem interromper a música tocando.
- Regras do `CLAUDE.md`: pills `shrink-0` com padding real; **nenhum texto
  com `truncate`/`line-clamp` nos títulos de playlist e de música** (quebra
  de linha com `overflow-wrap: anywhere`).

## Custo

- Planilha: zero leituras novas (EM Alta já é lida pelo ao vivo, 1×/30 s por
  isolate; as 3 abas de top deixam de ser lidas pela tela).
- D1: reaproveita os caches existentes (semana, ao vivo por país, catálogo).
- Celular: índice pequeno a cada 30 s (~top 3 × 3 + nomes); playlist só
  quando aberta (≤ 100 faixas).

## Testes esperados

- Índice: placar com 3 plataformas × top 3; países na ordem do peso;
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
- YouTube toca o áudio (não o clipe).
- Grade de países mostra 8 + "Ver todos os países".
- Atualização pausa quando a tela não está visível.
- `/api/top-playlists` continua no código, só deixa de ser usado pela tela.
- Hot passa a vir do D1 (não da planilha).
- Badge do país = 2 primeiras letras; valor cheio formatado (sem "mil streams").
