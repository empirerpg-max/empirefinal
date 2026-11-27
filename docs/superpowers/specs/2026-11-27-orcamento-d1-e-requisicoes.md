# Orçamento diário do D1 e das requisições (plano gratuito) — análise

Data: 2026-11-27 · Base: código da branch `claude/nice-euler-1yslj3` (com a
`main` até `e5cbbcd`), o design `2026-11-26-d1-rows-read-reducao-design.md`
(números reais do painel em 25/11) e os recursos novos do Beta e da sala da TV.

## Limites que importam (Cloudflare, plano gratuito, por dia)

| Recurso | Limite | O que acontece ao passar |
|---|---|---|
| D1: linhas lidas | 5.000.000 | todas as consultas ao D1 falham até 00:00 UTC |
| D1: linhas gravadas | 100.000 | gravações falham até 00:00 UTC |
| Workers: requisições | 100.000 | o app inteiro dá erro até 00:00 UTC |
| KV: leituras / gravações | 100.000 / 1.000 | — |

Arquivos estáticos (JS, CSS, imagens do app) **não** contam nas requisições.
O vídeo do player do app vem direto da Kick: **não conta** em nada.

## 1. Onde estamos

- Em 25/11: **76% das leituras** (~3,8 M/dia). O top 10 somava ~4,5 M.
- Etapa 1 da redução (já na `main`: ticker, cron de vídeos 1×/hora, datas
  dos Charts): previsão de **~1,5 M/dia (30%)**. **Conferir no painel**
  (D1 › Métricas e Consultas) se caiu mesmo; daqui não dá para ler o painel.
- O que ainda pesa (etapa 2, ainda não feita):

| Consulta | Linhas/dia | Por quê |
|---|---|---|
| `SELECT * FROM musicas` (Catálogo) | ~560 mil | lê a tabela inteira (~1.000 músicas) a cada abertura do Catálogo, sem cache |
| catálogo dos Charts (`musicas`) | ~430 mil | idem, para cruzar os charts |
| semana por país (`chart_semana`) | ~375 mil | lê a semana inteira por chamada |
| cron de likes de vídeo | ~170 mil | recalcula todos os vídeos a cada 10 min |

## 2. Encontrado e corrigido agora (sala da TV, desta branch)

| Problema | Custo antes | Correção | Custo depois |
|---|---|---|---|
| O círculo "Sua participação" de **cada pessoa** lia a presença da **sala inteira** a cada 60 s | 200 pessoas × 2 h: **~4,8 M linhas** (quase o limite do dia num evento só) | lê só a linha da pessoa (busca pela chave) | ~50 mil linhas |
| Aba Participantes aberta: sala inteira a cada 30 s | 20 pessoas com a aba aberta × 2 h: ~1 M | a cada 60 s | ~480 mil (só se 20 pessoas ficarem 2 h na aba) |
| Aba Enquetes aberta atualizava a cada 5 s **mesmo sem enquete aberta** | 720 pedidos/hora por pessoa | a cada 5 s **só com enquete aberta**; enquete nova chega pelo aviso do chat | 0 fora das enquetes |

## 3. Conta de um dia típico (depois das correções)

Cenário: **500 jogadores ativos/dia** e **1 transmissão de 2 h com 200
pessoas** e 3 enquetes de 5 min.

**Leituras do D1**

| Fonte | Linhas/dia |
|---|---|
| Base atual (depois da etapa 1, a confirmar no painel) | ~1.500.000 |
| Sala: círculo (200 × 120 min × ~2 linhas) | ~50.000 |
| Sala: aba Participantes (estimativa: 10 pessoas × 2 h) | ~240.000 |
| Sala: enquetes (100 pessoas com a enquete na tela × 3 × 5 min × 12/min × ~3 linhas) | ~54.000 |
| Processamento da participação (1×, sala inteira) | ~200 |
| Beta: chart run e perfil do artista (mesma consulta de hoje) | 0 a mais |
| Beta: ouvintes mensais e ranking do mês (planilha mensal, não D1) | 0 |
| Beta: "Uso do app" (tela do admin, tabela somada) | < 5.000 |
| **Total** | **~1,85 M (37%)** |

**Gravações do D1**

| Fonte | Linhas/dia |
|---|---|
| Espelho das planilhas e ações do app (hoje) | a conferir no painel |
| Sala: presença (200 × 1 a cada 5 min × 2 h) | ~4.800 |
| Sala: votos (200 × 3 enquetes × 2 linhas) | ~1.200 |
| Beta: "Uso do app" (500 × ~60) | ~30.000 |
| **Total do que é novo** | **~36.000 (36% das 100 mil)** |

O "Uso do app" é o maior gasto novo de gravações. Já está previsto no design
(6.15): passar a enviar a cada 5 min ou amostrar 50% se passar de ~1.500
ativos/dia. **Recomendação:** começar com envio a cada 5 min. Gasta metade e
a tela do admin continua igual.

## 4. O risco maior não é o D1: são as requisições do Worker

Cada pessoa **dentro da sala** faz por minuto:

| Pedido | Por minuto | Desde |
|---|---|---|
| Grade da TV (`/api/tv/programas`) | 5 | já existia |
| "Está ao vivo?" na Kick (função do servidor) | 5 | já existia |
| Enquete antiga da planilha (`EnqueteBanner`) | 3 | já existia |
| Círculo de participação | 1 | novo (substitui o heartbeat de 30 s: −1/min) |
| Presença (envio a cada 5 min) | 0,2 | novo |
| Enquetes do chat (só com enquete aberta e na tela) | 12 | novo, só nesses minutos |

**~14 pedidos/min por pessoa** (antes desta branch eram ~17). Para uma
transmissão de 2 h:

| Pessoas na sala | Pedidos no evento | % das 100 mil/dia |
|---|---|---|
| 50 | ~84 mil | 84% |
| 100 | ~168 mil | **passa do limite** |
| 200 | ~336 mil | **passa do limite** |

Se as transmissões já passam de ~60 pessoas por 2 h, o limite diário de
requisições do Worker é o primeiro a estourar, com ou sem o Beta.
**Conferir no painel:** Workers › tanstack-start-app › Métricas ›
Requisições, no dia de um evento.

### Como reduzir sem perder fluidez (recomendado)

1. **Dentro da sala, grade e "ao vivo?" a cada 60 s** em vez de 12 s
   (−8/min por pessoa). O vídeo já toca pelo player; a grade só serve
   para notar mudança de status. Fora da sala (lista da TV), fica em 12 s.
2. **Desligar o `EnqueteBanner` antigo** (a enquete da planilha), que foi
   substituído pelas enquetes do chat (−3/min). Antes, confirmar que a aba
   "Enquete" da planilha não é mais usada.
3. **Juntar "grade + ao vivo" num pedido só** (o servidor já sabe os canais):
   −5/min.

4. **Enquetes do chat a cada 10 s** em vez de 5 s, só durante a enquete
   (o placar ainda parece ao vivo).

| Com | Pedidos/min por pessoa | 200 pessoas × 2 h (+ 3 enquetes) |
|---|---|---|
| hoje (branch) | ~14 | ~336 mil |
| 1 + 2 | ~3,2 | ~77 mil + ~18 mil das enquetes ≈ **95 mil** (no limite) |
| 1 + 2 + 3 + 4 | ~2,2 | ~53 mil + ~9 mil ≈ **62 mil** |

Nenhum deles muda o que o jogador vê. Só a grade passa a notar uma mudança
de status dentro da sala em até 60 s, e o placar da enquete se atualiza a
cada 10 s.

Outros pedidos periódicos do app (fora da sala):
- sininho de notificações a cada 60 s (inclusive com o app escondido);
- Charts › Ao vivo a cada 30 s;
- playlists do Catálogo a cada 30 s (só visível).

**Sugestão:** o sininho só com o app visível. É a mesma regra das
playlists.

## 5. Etapa 2 do D1 (quando quiser descer mais)

O D1 não tem cache compartilhado entre pedidos (cada pedido cai numa cópia
nova do Worker), e o cache da Cloudflare não funciona no domínio
`workers.dev`. A saída gratuita é o **KV**:

- O cron de 10 min (ou cada gravação do catálogo) gera **uma "foto" do
  catálogo de músicas** e guarda no KV (≤ 144 gravações/dia, limite 1.000).
- O Catálogo e o cruzamento dos Charts leem a foto do KV (1 leitura de KV)
  em vez de ~1.000 linhas do D1.
- O mesmo vale para a semana por país (2 a 4 MB: não cabe numa linha do D1,
  mas cabe no KV, que aceita até 25 MB por valor).
- Economia: ~1,36 M linhas/dia (de ~37% para ~10%).
- **Nenhuma regra ou cálculo dos charts muda**: só de onde os mesmos dados
  são lidos. Precisa de aprovação, porque mexe no caminho dos Charts.

## 6. Resumo das decisões pedidas ao usuário

1. Conferir no painel da Cloudflare: linhas lidas do D1 (depois da etapa 1)
   e requisições do Worker num dia de transmissão.
2. Aprovar as reduções de requisições da sala (seção 4: itens 1 a 4).
3. Aprovar a etapa 2 do D1 com KV (seção 5).
4. "Uso do app" com envio a cada 5 min desde o início (seção 3).
