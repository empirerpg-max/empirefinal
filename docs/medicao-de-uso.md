# Medição de uso — manual de manutenção

Atualizado em 2026-11-27 (fase 0a do plano de reorganização). Este documento
explica **o que a medição guarda, o que ela NÃO guarda, onde fica cada coisa e
como ligar, desligar e conferir**. Lembrete: o app roda no **Cloudflare
Workers** (não no Telegram).

Objetivo: medir, por cerca de 4 semanas, como a base usa a versão de hoje
(telas, ações, aparelhos) antes do Beta. **Nada muda para o jogador**; a única
tela nova é só para admin.

Documentos de apoio:
- Plano: `docs/superpowers/plans/2026-11-27-medicao-de-uso.md`.
- Design do Beta (seção 6.15 e tabela de fases, seção 8): `docs/superpowers/specs/2026-11-25-reorganizacao-do-app-design.md`.
- Orçamento do plano gratuito: `docs/superpowers/specs/2026-11-27-orcamento-d1-e-requisicoes.md`.

---

## 1. O que é medido e o que NÃO é

| Medido | Como aparece |
|---|---|
| **Telas** abertas | id da rota (ex.: `/social`) + valor curto da aba (`aba`/`tab`/`view`), ex.: `/social › feed` |
| **Ações**: POST/PUT/PATCH/DELETE que deram certo | caminho da API normalizado (ex.: `/api/social/posts`) |
| Ações especiais | `buscar` (GET `/api/busca`, no máximo 1 a cada 10 s) e `tocar_musica` (player de música) |
| **Caminhos** | `<ação> ← <tela>`: em que tela a ação foi feita |
| **Aparelho** | pela largura da janela: `< 768` celular, `< 1024` tablet, senão computador |
| **Jogadores distintos** | só nas tabelas `uso_jogador_dia` e `uso_jogador_tela_dia` (id do jogador) |

Regras de privacidade (valem para qualquer mudança futura):

- **Query string descartada** (tudo depois de `?` ou `#`). Texto de busca, filtros e ids em query nunca saem do aparelho.
- **Segmentos de caminho em lista de permissão**: só segmento que é palavra de rota (minúsculas ASCII, até 4 partes ligadas por hífen, até 32 caracteres; regex `SEGMENTO_DE_ROTA` em `src/lib/uso/coletor.ts`) é mantido. Qualquer outro (número, maiúscula, uuid, slug longo) vira `:id`.
- **Valor de aba** só entra se a rota o aceitar no `validateSearch` (o app passa a `_strictSearch` do match, não a query crua da URL) e se for curto e sem sequência de 4+ dígitos (`telaDaRota`). Ex.: `/charts?tab=hot100` vira `/charts › hot100`; `/social?tab=qualquer` vira só `/social`.
- **Nunca se lê corpo de requisição ou resposta.** Conteúdo de comentários/posts, dados pessoais e texto de busca não entram.
- **Nenhum conteúdo de usuário pode entrar em `alvo`.** Risco residual aceito: um slug todo minúsculo com até 4 palavras (ex.: `joao-silva`) passa na lista de permissão; por isso valores de usuário devem ir na query string, não no caminho.
- **POSTs automáticos em segundo plano são ignorados** (não são ações do jogador), lista `IGNORADOS` em `coletor.ts`: `/api/uso`, `/api/log-error`, `/api/flags`, `/api/auth/heartbeat`, `/api/tv/presenca`, `/api/notificacoes/push/inscrever`.
- O **id do jogador** só é gravado nas duas tabelas de "jogadores distintos". O token de sessão (header ou campo `token` do corpo, no `sendBeacon`) só serve para descobrir o id e **nunca é guardado**.

---

## 2. Mapa dos arquivos

| Parte | Arquivos |
|---|---|
| Coletor puro (acumula contagens, normaliza caminhos, nome da tela, aparelho) | `src/lib/uso/coletor.ts` |
| Envio em lote (timer, `sendBeacon`, `localStorage` de telas do dia, desligar) | `src/lib/uso/envio.ts` |
| Nomes amigáveis e períodos da tela admin | `src/lib/uso/nomes.ts` |
| Ligação no app: conta a tela (`MedicaoTelaAtual`) e a ação de cada `window.fetch` (`contarAcaoDeUso`) | `src/routes/__root.tsx` |
| Ação "tocar música" | `src/components/EmpirePlay/PlayerContext.tsx` (`usoGlobal()?.acao("tocar_musica")`) |
| Tela admin "Uso do app" (`/uso-do-app`) | `src/routes/uso-do-app.tsx`; link em `src/routes/perfil.tsx` (só admin) |
| Cliente da API (`api.resumoUso(de, ate)`) | `src/lib/api.ts` |
| Servidor: validação, gravação, resumo, limpeza | `backend/src/services/usoService.ts` |
| Servidor: rotas HTTP, liga/desliga, limpeza diária | `backend/src/controllers/usoController.ts` |
| Rotas da API | `backend/src/routes/api.ts` (`POST /api/uso`, `GET /api/uso/resumo`) |
| Limpeza no cron | `src/server.ts` (chama `limparUsoDiaria`) |
| Tabelas do D1 | `d1/schema.sql` (`uso_diario`, `uso_jogador_dia`, `uso_jogador_tela_dia`) |
| Testes | `scripts/uso-coletor.test.ts`, `uso-nomes.test.ts`, `uso-rotas.test.ts` (inclui o teste ponta a ponta: lote real do `ColetorUso` → `registrarUsoController` → D1), `uso-service.test.ts` |

---

## 3. Como os dados andam

```
tela muda / fetch (POST...) ──► ColetorUso (memória do aparelho)
                                   │  a cada 5 min (aba visível, fetch keepalive)
                                   │  ou ao esconder/fechar a página (sendBeacon, com `token` no corpo)
                                   ▼
                              POST /api/uso  (lote: versao, aparelho, eventos[], telas[])
                                   │  medicaoUsoLigada() confere o KV; limparLote() valida o formato e corta
                                   ▼
                              D1: gravarLoteUso() — soma por dia UTC
```

1. **Coletor** (`ColetorUso`): só soma contagens em memória; não usa DOM nem rede.
2. **Envio** (`envio.ts`): um lote **a cada 5 min enquanto a aba está visível** (`INTERVALO_ENVIO_MS`) e outro em `pagehide`/`visibilitychange→hidden` via `navigator.sendBeacon` (que não passa pelo wrapper de `window.fetch` e não manda cabeçalho, por isso o token vai no corpo). Nunca uma requisição por clique. A versão enviada é sempre `"anterior"` nesta fase.
3. **Telas do dia**: o aparelho lembra no `localStorage` (`uso-telas-AAAA-MM-DD`) as telas já mandadas hoje, para mandar só as novas (o servidor também deduplica). Dias velhos são apagados. **Sem token (não logado) o lote vai sem `telas` e nada é marcado como enviado** (`telasDoLote` em `coletor.ts`): o servidor não grava telas sem jogador, e assim uma tela vista antes do login ainda conta quando o jogador a abrir de novo logado.
4. **Servidor** (`registrarUsoController`): se desligado responde `{ ok:true, ativo:false }`; senão descobre o jogador (sessão no cabeçalho ou `token` no corpo), valida o lote e grava.
   - **Formato do `alvo` conferido no servidor** (`limparLote` em `usoService.ts`), para ninguém pôr texto arbitrário na tela admin com um POST feito à mão: `tela` começa com `/` (sem `←` nem caracteres de controle); `acao` é `/api` + segmentos já normalizados (palavra de rota ou `:id`, regex `ACAO_API_RE`) **ou** uma das `ACOES_ESPECIAIS` (`buscar`, `tocar_musica`); `caminho` é `<ação válida> ← <tela válida>`. O que não bate é descartado. O mesmo vale para a lista `telas`.
   - **Lote sem sessão válida** (qualquer um pode mandar): no máximo **20 eventos e 10 telas**. Com sessão: 200 e 50.
5. **Gravação** (`gravarLoteUso`): soma eventos repetidos do lote, e grava com **várias linhas por instrução** (UPSERT `contagem = contagem + excluded.contagem`) num único `db.batch`. Respeita os limites do D1: **≤ 100 parâmetros por instrução** (16 eventos × 6 = 96; 33 telas × 3 = 99) e **≤ 50 instruções por invocação** (200 eventos → 13 instruções + 1 jogador + até 2 de telas).

Tetos por lote (coletor e servidor iguais): 200 eventos, 50 telas, `alvo` até 120 caracteres, `n` até 1000 por evento (sem sessão o servidor corta em 20 eventos e 10 telas).

---

## 4. As três tabelas (`d1/schema.sql`)

Todas `WITHOUT ROWID`, criadas sob demanda (`garantirTabelasUso`, `CREATE TABLE IF NOT EXISTS`) e também no `schema.sql`. `dia` é o dia **UTC** (`AAAA-MM-DD`).

| Tabela | Chave primária | Colunas | Para quê |
|---|---|---|---|
| `uso_diario` | `(dia, versao, aparelho, evento, alvo)` | `contagem` | Contadores: `evento` é `tela`, `acao` ou `caminho` |
| `uso_jogador_dia` | `(dia, jogador)` | `versao` | Quantos jogadores distintos usaram o app no dia |
| `uso_jogador_tela_dia` | `(dia, tela, jogador)` | — | Quantos jogadores distintos abriram cada tela |

Só `uso_jogador_dia` e `uso_jogador_tela_dia` têm o id do jogador. Jogador não logado (sem token válido) conta nos contadores, mas não nas tabelas de distintos.

---

## 5. Ligar e desligar sem deploy

A chave fica dentro do KV `home-config` (o mesmo valor das flags da Home), no campo `medicaoUso`:

```json
{ "medicaoUso": { "enabled": false } }
```

- **Ausente = ligada.** Só `enabled: false` desliga. Erro de leitura do KV também deixa ligada.
- Mantenha os outros campos que já existem no `home-config`; mexa só em `medicaoUso`.
- Dá para editar no **painel da Cloudflare**: Storage & Databases › KV › namespace `empire_feature_flags` › chave `home-config`.
- Desligado, `POST /api/uso` responde `{ ok:true, ativo:false }` sem gravar nada, e o app daquele aparelho **para de medir até recarregar a página**.

---

## 6. Retenção (90 dias)

`limparUsoDiaria` (chamada pelo cron em `src/server.ts`, mesmo padrão de `limparPresencaTVDiaria`) apaga das 3 tabelas os dias com mais de 90 dias, **no máximo 1 vez por dia UTC**: o último dia limpo fica no KV `FLAGS`, chave `uso-limpeza-dia`. Para forçar uma limpeza no mesmo dia, apague essa chave. Nunca lança erro; o log `[scheduled] Uso antigo apagado do D1: N linha(s).` aparece quando apagou algo.

---

## 7. Custo (plano gratuito)

- **Requisições**: 1 por envio, ou seja, **1 a cada 5 min por aba visível** (mais 1 ao fechar/esconder).
- **Gravações no D1** ≈ chaves distintas do lote (cada instrução multi-linha grava várias chaves; o D1 conta por linha escrita). Meta: **≤ ~60 gravações por jogador ativo por dia, em média** — é uma média: uma sessão longa (muitas telas e ações diferentes, vários envios de 5 min) pode passar de 150 num dia. Para isso: telas só novas do dia, `n` somado antes de enviar, ações/caminhos como contador (não evento a evento), nada de requisição por clique.
- **Leituras do resumo (tela admin)**: o D1 conta **linhas lidas**, e cada resumo lê todas as linhas do período nas 3 tabelas (pela chave que começa por `dia`, `BETWEEN`, no máximo 90 dias). São 3 consultas: **uma só varredura de `uso_diario`** (telas, ações, caminhos e aparelho saem dela), `uso_jogador_dia` e `uso_jogador_tela_dia` (a maior: ~1 linha por jogador × tela × dia). Estimativa com ~500 jogadores ativos/dia: **~70 mil linhas** para "Esta semana" e **~300 mil** para "Últimos 30 dias" (o plano gratuito dá 5 milhões de linhas lidas por dia). Não é barato; por isso há cache:
  - **no aparelho**: a tela guarda o resultado de cada período já buscado enquanto está aberta (trocar de pílula e voltar não busca de novo);
  - **no servidor**: cache na memória do isolate por **5 min** por `(de, ate)` (`CACHE_RESUMO_MS` em `usoController.ts`). Os números podem atrasar até 5 min.
  - Só admin dispara.

---

## 8. Como ler a tela "Uso do app" (admin)

Caminho: **Perfil › "Uso do app (admin)"** (aparece só para admin) → `/uso-do-app`.

- **Períodos** (fileira rolável): "Esta semana" (hoje e os 6 dias anteriores), "Semana anterior" (dias -13 a -7) e "Últimos 30 dias". **Os dias são UTC**, não o horário de Brasília: o "hoje" vira às 21h no Brasil.
- Cartões de topo: **Jogadores** (distintos no período), **Telas abertas** e **Ações** (somas dos contadores).
- Listas de **telas** (com quantos jogadores distintos abriram), **ações** e **caminhos**, com nomes amigáveis quando existem (`nomes.ts`); o resto mostra o próprio caminho.
- **"Atividade por aparelho"** soma **telas + ações + caminhos** por aparelho. Serve para comparar a proporção entre celular/tablet/computador, **não** é número de sessões nem de pessoas.
- A API `GET /api/uso/resumo?de=AAAA-MM-DD&ate=AAAA-MM-DD` exige admin (403 se não), período válido e no máximo 90 dias.
- Os números podem estar **até 5 min atrasados** (cache do servidor) e não mudam enquanto a tela fica aberta no mesmo período (cache da tela); para ver o mais novo, saia e entre de novo depois de 5 min.

---

## 9. Como mudar as coisas

| Quero... | Faça |
|---|---|
| Mudar o intervalo de envio | `INTERVALO_ENVIO_MS` em `src/lib/uso/envio.ts` (hoje 5 min). Mais curto = mais requisições e gravações; reconferir o orçamento |
| Dar nome amigável a uma ação | Adicionar em `NOMES_DE_ACAO` em `src/lib/uso/nomes.ts` (chave = o `alvo`, ex.: `"/api/forum/comment"`) |
| Ignorar um novo POST automático | Adicionar o caminho em `IGNORADOS` em `src/lib/uso/coletor.ts`. **Toda chamada nova em segundo plano (timer, check-in, presença, reinscrição) precisa entrar aí**, senão infla "Ações" |
| Medir outra ação que não é HTTP (como `tocar_musica`) | `usoGlobal()?.acao("nome_curto")` no ponto do código; sem conteúdo de usuário no nome. **E adicionar o nome em `ACOES_ESPECIAIS` em `backend/src/services/usoService.ts`**, senão o servidor descarta |
| Medir uma tela com outro formato de nome | O servidor só aceita tela que começa com `/` (`TELA_RE` em `usoService.ts`); mude os dois lados juntos |
| Mudar os limites do período da tela | `intervaloDoPeriodo` em `nomes.ts` |
| Mudar a retenção | `DIAS_GUARDAR_USO` em `usoController.ts` (e o limite de 90 dias do resumo) |

Se mexer em `usoService.ts`, **respeite os limites do D1** (≤ 100 parâmetros por instrução, ≤ 50 instruções por invocação).

---

## 10. Limitações conhecidas

- **Telas acima de 50 e eventos acima de 200 por lote são descartados** (ficam os mais contados; o coletor zera o acúmulo ao retirar o lote). Com envio a cada 5 min isso é raro.
- **Segmentos com dígitos ou maiúsculas viram `:id`**, mesmo que fossem palavras de rota; isso protege a privacidade, ao custo de juntar rotas distintas num mesmo `:id`.
- **O desligamento só chega ao aparelho no próximo envio** (até 5 min depois): o aparelho só descobre `ativo:false` pela resposta do envio por `fetch`. Via `sendBeacon` a resposta não é lida.
- **Em desenvolvimento, o React StrictMode conta a primeira tela duas vezes** (efeito roda 2x). Em produção não acontece.
- Telas que ficam abertas sem trocar de rota contam 1 abertura; não há tempo de uso.
- O dia é UTC (ver seção 8).
- O resumo pode atrasar até 5 min (cache do servidor; ver seção 7).
- Lote sem sessão: só 20 eventos e 10 telas por envio; o excesso de um visitante não logado muito ativo se perde.

---

## 11. Testes

```bash
bun test scripts/uso-*.test.ts          # os 4 arquivos da medição
bash scripts/rodar-testes-isolados.sh   # roda cada arquivo que usa mock.module em processo próprio
```

Alguns testes usam `mock.module`, que no bun vale para o processo inteiro; por isso o script isolado existe. Para rodar um arquivo específico no isolado: `bash scripts/rodar-testes-isolados.sh scripts/uso-rotas.test.ts`.

---

## 12. Como conferir em produção

No dia seguinte ao deploy:

1. No D1 (console da Cloudflare, ou `wrangler d1 execute`): `SELECT COUNT(*) FROM uso_diario;` deve ser maior que 0. Também `SELECT COUNT(*) FROM uso_jogador_dia;`.
2. Painel de métricas do D1: gravações por dia dentro da meta (≤ ~60 por jogador ativo).
3. Tela `/uso-do-app` mostrando dados em "Esta semana".
4. Se nada aparece: conferir se `home-config` não tem `medicaoUso.enabled:false` e se o log do Worker não mostra `[registrarUsoController] Falhou`.
