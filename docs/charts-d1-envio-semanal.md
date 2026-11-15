# Envio semanal dos charts para o app (Google → Cloudflare D1)

Toda quinta-feira, depois que a aba **DADOS** da planilha EMPIRE - CHARTS recebe
a semana nova, um script do Google manda essa semana para o app. O app calcula
posição anterior, peak, semanas e países e grava no banco. O app **não lê mais**
a planilha.

## 1. Instalar o script (uma vez)

1. Abra o projeto **atualizacaocharts** em [script.google.com](https://script.google.com)
   (não precisa abrir pela planilha: o script abre a EMPIRE - CHARTS sozinho
   pelo ID).
2. Na barra da esquerda, clique em **+** ao lado de "Arquivos" > **Script**.
   Dê o nome `EnvioD1` e apague o conteúdo que vier.
3. Abra o arquivo `scripts/apps-script/EnvioD1.gs` do repositório, copie tudo e
   cole nesse arquivo novo. Clique em **Salvar** (ícone de disquete).
4. Se o projeto já tiver outra função chamada `onOpen`, **não deixe duas**:
   copie só a linha `.addItem('Enviar ao app', 'enviarSemanaAoAppPeloMenu')` para
   dentro do `onOpen` que já existe e apague o `onOpen` do `EnvioD1`.

## 2. Configurar endereço e senha (Propriedades do script)

1. Na barra da esquerda, clique na engrenagem **Configurações do projeto**.
2. Role até **Propriedades do script** > **Adicionar propriedade do script**.
3. Crie:
   | Propriedade | Valor |
   |---|---|
   | `CHARTS_INGEST_URL` | `https://SEU-APP/api/charts/ingest` (o endereço do app + `/api/charts/ingest`) |
   | `CHARTS_INGEST_TOKEN` | a senha do envio, a mesma guardada como secret `CHARTS_INGEST_TOKEN` no Cloudflare |
   | `CHARTS_SPREADSHEET_ID` (opcional) | ID da planilha EMPIRE - CHARTS, só se ela mudar (o ID atual já vem no script) |
   | `STATUS_CELL` (opcional) | uma célula livre, ex.: `DADOS!N1`, onde o script escreve o resultado |
4. **Salvar propriedades do script.**

A senha nunca vai para dentro do código nem para o repositório: fica só aqui.

## 3. Criar o gatilho das quintas (uma vez)

1. No editor, escolha a função **criarGatilhoQuinta** na lista ao lado do botão
   **Executar** e clique em **Executar**.
2. Na primeira vez o Google pede autorização: **Revisar permissões** > escolha
   sua conta > **Avançado** > **Acessar atualizacaocharts (não seguro)** >
   **Permitir**. (É seguro: é o seu próprio script. As permissões são ler as
   planilhas e fazer o envio para a internet.)
3. Pronto: toda quinta por volta das 10h o envio roda sozinho. Para conferir,
   abra o relógio **Acionadores** na barra da esquerda: deve haver um acionador
   `enviarSemanaAoApp` semanal.

Rodar `criarGatilhoQuinta` de novo não duplica o gatilho.

## 4. Reenviar à mão

Abra a planilha EMPIRE - CHARTS (se o projeto estiver vinculado a ela, o menu **Empire** aparece ao recarregar; se não, rode `enviarSemanaAoApp` no editor). Clique em
**Empire > Enviar ao app**. Uma mensagem no canto da tela mostra o resultado; se
der erro, abre um aviso. Reenviar a mesma semana é seguro: o app regrava a semana
sem duplicar.

## 5. Como ler os erros

O resultado aparece na mensagem do menu, na célula `STATUS_CELL` (se configurada)
e em **Execuções** (barra da esquerda do editor > clique na execução > Registro).

| Mensagem | O que significa / o que fazer |
|---|---|
| `OK - 11/11/2026 - 12/11/2026 10:02 (500 linhas)` | Deu certo. |
| `Faltam as propriedades CHARTS_INGEST_URL...` | Faça o passo 2. |
| `HTTP 401 ... token recusado` | A senha está diferente da do Cloudflare. Corrija `CHARTS_INGEST_TOKEN`. |
| `HTTP 400 ... faltando chart / posição repetida / duas datas` | A semana na aba DADOS está incompleta ou misturada. Corrija a aba (5 charts x 100 posições, uma única data) e envie de novo pelo menu. |
| `HTTP 503 ... banco D1 indisponível` | Problema no app/Cloudflare. Tente de novo mais tarde; se persistir, avise quem cuida do app. |
| `Aba "DADOS" não encontrada` | O nome da aba mudou. Ela precisa se chamar exatamente `DADOS`. |

Se o envio falhar na quinta, nada é gravado pela metade: corrija e reenvie.

## 6. Carga inicial do histórico (automática, pelo GitHub)

As semanas antigas (CSV da aba DADOS, guardado no repositório em
`scripts/fixtures/charts-d1-dados.csv.gz`) vão para o D1 **sozinhas**, pelo
workflow **charts-d1-carga** do GitHub Actions. Ele envia as semanas para o
próprio app (`POST /api/charts/ingest`, a mesma entrada do envio semanal) usando
o secret `CHARTS_INGEST_TOKEN` do GitHub — o app calcula e grava no D1.

- **Roda todo dia** às 03:17 (UTC) e envia as próximas semanas que faltam, da
  mais antiga para a mais nova, semana inteira por vez, até **25.000 linhas**
  (~3 escritas por linha ≈ 78 mil das 100 mil escritas/dia do plano grátis).
- São ~102 mil linhas: **5 dias**. Na execução em que não sobra semana
  pendente, ele **liga a leitura do D1** (`charts_d1_ativo = '1'`). Até lá o app
  continua lendo a planilha.
- Depois de ativado, cada execução não envia nada. Pode desligar o agendamento
  em **Actions > charts-d1-carga > ... > Disable workflow**.
- Semana que der erro continua pendente e é reenviada no dia seguinte; reenviar
  uma semana substitui, não duplica.

### Rodar na hora (sem esperar o horário)

GitHub do repositório > **Actions** > **charts-d1-carga** (lista da esquerda) >
**Run workflow** > **Run workflow**. Não rode duas vezes no mesmo dia: cada
parte gasta ~78 mil das 100 mil escritas diárias (duas execuções ao mesmo tempo
nunca acontecem; a segunda espera a primeira).

### Acompanhar o progresso

- Abra a execução em **Actions > charts-d1-carga**: o **Summary** mostra o
  resumo do dia (semanas enviadas, linhas, erros, quantas semanas faltam). O
  mesmo texto fica no artefato `charts-d1-carga-resumo`.
- "Faltam N semana(s)" = ainda em andamento; "leitura do D1 ativada" = terminou.
- Direto no banco (painel da Cloudflare > D1 > `empire-hub-catalogo` > Console):
  `SELECT COUNT(DISTINCT data) FROM chart_datas` (semanas gravadas, ~256 no fim)
  e `SELECT valor FROM chart_config WHERE chave = 'charts_d1_ativo'` (`1` =
  ativado).

### Teste local (opcional)

```bash
bun scripts/charts-d1-carga-inicial.ts --dados DADOS.csv --pesos PESOS.csv --local
```

Calcula tudo num banco em memória, sem tocar na produção (imprime nº de datas,
anomalias e o #1 do Hot 100 mais recente).
