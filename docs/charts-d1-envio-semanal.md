# Envio semanal dos charts para o app (Google → Cloudflare D1)

Toda quinta-feira, depois que a aba **DADOS** da planilha EMPIRE - CHARTS recebe
a semana nova, um script do Google manda essa semana para o app. O app calcula
posição anterior, peak, semanas e países e grava no banco. O app **não lê mais**
a planilha.

## 1. Instalar o script (uma vez)

1. Abra a planilha **EMPIRE - CHARTS** e vá em **Extensões > Apps Script**
   (abre o projeto **atualizacaocharts**).
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

Recarregue a planilha. Aparece o menu **Empire**. Clique em
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

## 6. Carga inicial do histórico (feita por quem cuida do app, uma vez)

Leva as semanas antigas (CSV da aba DADOS) para o D1. Precisa do
[Bun](https://bun.sh) e do repositório. A senha vai por variável de ambiente
(nunca na linha de comando):

```bash
export CHARTS_INGEST_TOKEN='...'   # a mesma senha do secret do Worker
bun scripts/charts-d1-carga-inicial.ts \
  --dados "EMPIRE - CHARTS - DADOS.csv" \
  --pesos "Empire Base de Dados - PAÍSES E PESOS.csv" \
  --url https://SEU-APP/api/charts/ingest \
  [--infos "INFOS ACTS.csv"]   # opcional: nacionalidade e foto dos artistas
```

- Antes, teste tudo num banco local, sem tocar na produção:
  `bun scripts/charts-d1-carga-inicial.ts --dados ... --pesos ... --local`
  (imprime nº de datas, anomalias e o #1 do Hot 100 mais recente).
- O script pergunta ao app quais datas já estão gravadas e **pula** essas; envia
  em ordem cronológica, semana inteira por vez.
- **Limite de 45.000 linhas por execução** (`--limite`, o plano grátis do D1
  aceita cerca de 45 mil escritas por dia). Ao chegar lá ele para e avisa
  **"retome amanhã"**. No dia seguinte rode o **mesmo comando**: ele continua de
  onde parou. Com ~121 mil linhas, são uns 3 dias.
- Erro numa semana não interrompe as outras; as que falharam aparecem no fim e
  são tentadas de novo na próxima execução.
