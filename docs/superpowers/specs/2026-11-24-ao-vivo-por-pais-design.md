# Ao vivo por país — design (curto)

Data: 2026-11-24 · Status: aguardando aprovação

## Intenção e porquê

O jogador quer ver, **em tempo real**, como estão os recortes por país de
cada plataforma, do mesmo jeito que o "Ao vivo" de hoje mostra cada
plataforma no mundo. É uma prévia do recorte por país que sai na quinta.

## Objetivos

- No "Ao vivo", dentro de cada plataforma (Spotify, Apple Music, YouTube):
  alternar **Mundo | Por país** e escolher o país.
- Ranking de cada país = streams ao vivo da EM Alta × fatia do país pela
  **mesma regra C** dos charts semanais (pesos, nacionalidade, foco, sorteio).
- Mesmo resultado para todos os jogadores no mesmo momento; atualiza a cada
  30 s como hoje.

## Não-objetivos

- Paradas oficiais ao vivo (decisão do usuário: só recortes por plataforma).
- Tirar a EM Alta do Google (projeto futuro, se quiser).
- Mudar o "Ao vivo" mundial de hoje.

## Anti-objetivos

- Ranking por país "pulando" sem motivo entre atualizações.
- Mais leituras de planilha/banco por jogador com a tela aberta.
- Prévia diferente da regra que vai valer na quinta.

## Abordagens

- **A) Servidor calcula em cima da EM Alta + cache 30 s (escolhida).**
  Reaproveita `fetchRT` e a regra C; nenhuma ação manual.
- B) Levar a EM Alta para o D1 via Apps Script. Descartada agora: exige
  script novo e trabalho manual.
- C) Calcular no navegador. Descartada: regra exposta, risco de diferença
  entre aparelhos.

## Design

- **Sorteio fixo da semana em andamento:** a "data" do sorteio é a **próxima
  data de chart** (última data do Global 100 no D1 + 7 dias). Durante a
  semana a fatia de cada música em cada país não muda; só os streams ao vivo
  mudam.
- **Regras:** `regrasDeConfig(chart_config atual)` — é o que vai ser congelado
  na ingestão dessa semana, então a prévia segue a regra que vai valer.
- **Pesos:** `pais_peso` da plataforma (Spotify, Apple Music, YouTube).
- **Artistas/nacionalidade/foco:** título da EM Alta ↔ catálogo pelo mesmo
  cruzamento dos charts (`buscarNoCatalogo`), com o mesmo reserva de extrair
  artistas do título; nacionalidade de `artista_info`; foco vigente de
  `musica_foco` para a data da semana em andamento.
- **Saída por plataforma:** para cada país de `pais_peso`, Top 50 ordenado
  pelo valor (sem arredondar), com `{pais, pos, t, s, c, art}` (mesmo formato
  dos itens do ao vivo + país). Sem setas ↑↓ (o ao vivo de hoje não tem).
- **API:** nova ação em `/api/charts`, ex. `action=getRealTimePaises&plataforma=spotify`
  (forma exata: construtor). Cache por isolate de 30 s por plataforma,
  junto com a leitura da EM Alta já existente (uma leitura de planilha
  serve mundo e países).
- **Sem D1/sem pesos/erro:** devolve lista vazia; a tela mostra "Sem dados
  por país agora." e o Mundo continua funcionando.

### Tela (dentro de uma plataforma do Ao vivo)

```
‹ Ao vivo
SPOTIFY                [ Mundo | Por país ]
País: ‹ EUA · Reino Unido · Brasil · Alemanha … ›   (rolável)
 1  ▢ Artista - Música        124.300  ▇▇▇▇▇▇▇▇
 2  ▢ Artista - Música         98.100  ▇▇▇▇▇▇
```

- Países ordenados pelo peso na plataforma (maiores mercados primeiro).
  *Call meu.*
- Seletor de país rolável (`useDragScroll` + setas), pills `shrink-0`, sem
  cortar texto (regra do `CLAUDE.md`).
- O país escolhido continua selecionado nas atualizações de 30 s.

## Custo

- Planilha: antes desta mudança o `getRealTime` era servido de um cache de
  5 min; agora cada isolate ativo lê só a aba "EM Alta" no máximo uma vez a
  cada 30 s. As capas vêm do catálogo no D1 (sem ler a planilha Musicas); só
  sem D1 há fallback para a aba Musicas, em cache de 5 min.
- D1: `pais_peso`, `artista_info`, `musica_foco`, `chart_config` e a última
  data do Global 100, em cache por isolate (5 min, como o catálogo).

## Testes esperados

- Mesmo input → mesmo ranking (determinismo).
- Duas leituras na mesma semana com streams diferentes: a fatia de cada
  música por país é a mesma; só os valores mudam.
- Soma dos países + resto = streams ao vivo da música.
- Sem pesos → lista vazia sem erro.

## Calls meus (conferir)

- Data do sorteio = próxima data de chart.
- Regras = `chart_config` atual.
- Países ordenados pelo peso; Top 50 por país.
