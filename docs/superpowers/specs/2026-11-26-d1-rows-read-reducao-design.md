# Redução de linhas lidas no D1 (plano gratuito) — design curto

Data: 2026-11-26 · Status: proposto (aguardando aprovação)

## Por quê

Em 25/11 a Cloudflare avisou: o D1 chegou a **76% do limite diário gratuito de
5.000.000 linhas lidas**. Passar do limite derruba todas as requisições ao D1
até 00:00 UTC. O objetivo é manter o app no plano gratuito com folga no uso do
dia a dia.

Painel D1 → Consultas (top 10 ≈ 4,5M linhas/dia):

| # | Consulta | Chamadas | Linhas | % |
|---|---|---|---|---|
| 1 | `planilha_virtual` (abas Music Videos / Comentarios_MV) | 4.270 | 2,45M | 55% |
| 2 | `SELECT * FROM musicas` | 560 | 558k | 12% |
| 3 | catálogo dos Charts (`titulo, codigo_unico, artista…` de `musicas`) | 433 | 432k | 10% |
| 4 | semana por país (`chart_semana` charts × datas) | 147 | 375k | 8% |
| 5 | `SELECT data FROM chart_datas WHERE chart = ? ORDER BY data DESC` | 1.581 | 327k | 7% |
| 6+ | artistas, comentarios_videos (cron), vídeos… | — | ~330k | 7% |

Causas:

- Desde 19/11 ("D1 primeiro", `porteiroD1.ts`) toda leitura das abas `Music Videos`
  (~296 linhas) e `Comentarios_MV` (~871) vai ao D1 **inteira**. O caminho antigo
  (planilha) tinha cache de 15 s; o novo não tem.
- O **ticker "Atividade recente"** da Home (`ActivityTicker.tsx`) chama
  `/api/forum/atividade-recente` a cada 60 s por aba aberta, mesmo escondida. Cada
  chamada lê as duas abas inteiras (~1.170 linhas) para mostrar 8 comentários de vídeo.
- O cron de 10 min (`src/server.ts`) lê as duas abas e as tabelas `videos` e
  `comentarios_videos` inteiras para conferir o espelho (~3,5k linhas × 144/dia).
- Cache em memória quase não ajuda: `catalogo_estado_aba` tem cache de 30 s e
  mesmo assim teve 3.784 consultas (as requisições caem em isolates sempre novos).
  **A redução precisa vir de ler menos linhas por consulta, não de cache por isolate.**

## Objetivos / não-objetivos / anti-objetivos

- **Objetivo:** cortar as fontes 1 e 5 e o cron, levando o uso de ~4,5M para ~1,5M/dia.
- **Não-objetivo (etapa 2, separada):** cache compartilhado do catálogo de músicas
  (fontes 2 e 3) e da semana por país (fonte 4, 2–4 MB por semana, não cabe numa linha do D1).
- **Anti-objetivo:** nada pode mudar o que o usuário vê (mesmo conteúdo no ticker,
  nas datas dos Charts e no espelho), nem enfraquecer a rede de segurança do espelho
  a ponto de uma divergência ficar mais de 1 h sem correção.

## Abordagens consideradas

- **A. Ler só o necessário (escolhida pelo usuário).** Consultas por faixa ou
  índice no lugar de abas e tabelas inteiras, cron menos frequente e ticker pausado
  quando escondido. Não depende de cache e funciona mesmo com a troca constante de isolates.
- B. Workers Paid (US$ 5/mês): resolve sem código, mas o usuário quer seguir gratuito.
  Fica como plano de segurança.
- C. Só cache em memória (15 s como a planilha tinha): o painel mostra que o
  cache por isolate quase não acerta. Descartada.

## Design

1. **Leitura das últimas N linhas de uma aba do porteiro.** Nova função
   `lerUltimasLinhas(aba, n)` no `googleSheetsService`:
   - Aba do porteiro ligada: `MAX(linha)` pela PK (1 linha lida) e depois
     `lerIntervalo` só da faixa `max-n+1..max` (n linhas lidas).
   - Outras abas: lê a planilha como hoje (com o cache de 15 s), sem gasto no D1.

2. **Ticker (`getAtividadeRecenteController`).**
   - `Comentarios_MV` passa a usar `lerUltimasLinhas(…, 8)`.
   - O título dos vídeos deixa de vir da aba `Music Videos` inteira. Vem de
     `SELECT id_topico, titulo… FROM videos WHERE id_topico IN (…)` só com os ≤ 8
     ids (PK; ≤ 8 linhas lidas).
   - Se o D1 falhar, cai para a leitura antiga, para o ticker nunca ficar vazio por erro.
   - Frontend (`ActivityTicker.tsx`): só recarrega com a aba visível e recarrega na
     hora ao voltar a ela (o mesmo padrão de `PlaylistsInicio.tsx`).
   - Custo: de ~1.170 para ~17 linhas por chamada.

3. **Cron (`src/server.ts`).** `reconciliarVideosD1` roda 1 vez por hora (ciclo com
   `getUTCMinutes() < 10`), não mais a cada 10 min. Os demais jobs ficam como estão.
   O espelho em tempo real (`aposEscritaNaPlanilha`) continua valendo; a conferência
   é só a rede de segurança.

4. **Datas dos Charts (`datasDoChart`).** A lista de datas de cada chart passa a ser
   guardada pronta numa linha de `chart_config` (`datas:<CHART>`, JSON), gravada no
   mesmo lote que já altera `chart_datas` na ingestão/remoção de semana. A leitura
   vira 1 linha. Se a linha não existir (antes da primeira ingestão após o deploy),
   usa a consulta atual e grava a linha pronta. Nenhum chamador muda.

## Decisões minhas (o builder pode corrigir)

- N = 8 no ticker, igual ao que ele já mostra hoje por tipo.
- 1 h para a conferência de vídeos: equilíbrio entre gasto e tempo de correção.
- O cron de likes de vídeo (~170k/dia, 4%) fica fora desta etapa.
- Testes no padrão do repositório para `lerUltimasLinhas`, o ticker com D1
  falso e a lista de datas (linha pronta, fallback e atualização na ingestão).

## Como medir o resultado

Painel D1 → Consultas, 24–48 h depois do deploy: `planilha_virtual` deve cair de
~2,45M para algumas centenas de milhares e `chart_datas … ORDER BY data DESC`
deve sumir do top 10. O total do dia deve ficar perto de 30% do limite.
