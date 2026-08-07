
# Empresas com lucro recorrente + Bolsa de Valores (empresas + turnês)

Hoje a Incubadora só registra a fundação como item no Market — não há receita recorrente, nem visão consolidada. Vamos criar de fato uma economia diária no Google Apps Script e uma tela de Bolsa unificada no app.

## 1. Google Apps Script (`scriptatual2.txt`)

### 1.1 Nova aba `EMPRESAS`
Colunas: `id | dono | nome | segmento | capital_inicial | valor_atual | lucro_acumulado | criada_em | ativa`.

### 1.2 Novas ações no `processAction`
- `fundar_empresa` → valida saldo do artista, debita `capital_inicial` da `DB_ARTISTAS`, cria linha em `EMPRESAS` com `valor_atual = capital_inicial`. Registra em `REGISTROS` (artista, "FUNDAÇÃO EMPRESA", valor).
- `listar_empresas` → todas as empresas ativas (para visão global da bolsa).
- `minhas_empresas` (por `tgId`) → empresas do jogador.
- `historico_bolsa` (por artista, opcional) → últimas N linhas do log para o gráfico.

### 1.3 Nova aba `BOLSA_LOG`
Colunas: `data | artista | tipo (EMPRESA/TOUR) | ref_id | resultado_dia | saldo_apos`. Serve de fonte para mini-gráficos no app.

### 1.4 Função `tickBolsaDiario()` (gatilho time-driven diário)
Para cada empresa ativa:
- Calcula variação do dia = `valor_atual * fator`, onde `fator`:
  - base por segmento: tech ±12%, beauty ±7%, food ±3%
  - modificador de tendência global do dia (um único `Math.random()` que sobe/desce o mercado entre -3% e +3%)
  - bônus de prestígio do dono: `+prestigio/2000` (cap em +2%)
- Atualiza `valor_atual` (mínimo 0), soma em `lucro_acumulado`.
- Credita o `resultado_dia` no `saldo` da `DB_ARTISTAS` (pró-labore — vira fortuna).
- Loga em `BOLSA_LOG` e em `REGISTROS`.

Para turnês: para cada linha de `CONTROLE_TOURS` ativa, pega shows do dia via `_tour_tick_status_`, calcula bilheteria do dia (porte × continente, fórmula já usada hoje) e credita no artista + loga em `BOLSA_LOG` como `tipo=TOUR`. Isso unifica tudo num só lugar.

Instalar trigger com helper `instalarTriggerBolsa()` (chamada manual uma vez no editor).

## 2. Frontend

### 2.1 `src/lib/api.ts`
Adicionar: `fundarEmpresa`, `listarEmpresas`, `minhasEmpresas`, `historicoBolsa`.

### 2.2 `src/routes/incubadora.tsx`
Trocar a chamada `comprarMarket` por `api.fundarEmpresa(...)`. Manter o layout atual; após sucesso, redirecionar para `/bolsa`.

### 2.3 Nova rota `src/routes/bolsa.tsx` (global)
- Header com índice geral do dia (soma de `resultado_dia` de hoje).
- Tabs: **Empresas** | **Turnês**.
- Lista cada ativo com nome, dono, valor atual, variação 24h (verde/vermelho), sparkline a partir de `BOLSA_LOG`.

### 2.4 Aba "Portfólio" dentro do artista
Em `src/routes/artistas.$nome.index.tsx`, adicionar seção "Portfólio na Bolsa" listando as empresas e turnês do artista com resultado do dia e total acumulado.

### 2.5 Menu
Adicionar `Bolsa` no menu hambúrguer (categoria Empire Extras).

## Detalhes técnicos

- Fórmula final por empresa por dia:
  `resultado = valor_atual * (volBase * (rand*2-1) + tendenciaGlobal + min(prestigio/2000, 0.02))`
- `valor_atual` nunca < 0; se empresa zerar 3 dias seguidos → `ativa=false` (falência) e gera entrada no `RADAR_FEED`.
- O crédito vai sempre na coluna `saldo` (col D da `DB_ARTISTAS`) — exatamente como já fazem `handleQueridometroVotar` e `handleCompraTour`, garantindo que entra na fortuna.
- Nada do que existe hoje em `incubadora.tsx`, `tours.index.tsx` ou `__root.tsx` é removido — só estendido.

## Arquivos tocados
- `scriptatual2.txt` (você cola no Apps Script depois)
- `src/lib/api.ts`
- `src/routes/incubadora.tsx`
- `src/routes/bolsa.tsx` (novo)
- `src/routes/artistas.$nome.index.tsx`
- `src/routes/__root.tsx` (item de menu)
