# Empire Telegram Media

Serviço separado (Google Cloud Run) que loga como **bot** via MTProto (não a
API HTTP do bot) e transmite vídeos grandes do grupo pra dentro do app. Via
MTProto o limite de 20MB da API HTTP não existe — o bot consegue ler
arquivos grandes normalmente. Nenhuma credencial chega ao navegador: o
`empirefinal` fala com esse serviço por trás (`src/server.ts` →
`/api/telegram-video/:messageId`).

Por que Cloud Run e não o Cloudflare Workers do resto do app: o protocolo do
Telegram (MTProto) precisa de conexão TCP persistente, o que o Workers não
suporta — mas o Cloud Run roda um container Node.js de verdade, igual ao que
o Google AI Studio já usa por trás dos panos.

## 1. Secrets no GitHub (repo `empirefinal`, aba Settings → Secrets → Actions)

| Secret | O que é | Onde conseguir |
|---|---|---|
| `GCP_PROJECT_ID` | ID do seu projeto Google Cloud | Console do Google Cloud |
| `GCP_SA_KEY` | Chave JSON de uma conta de serviço com permissão de deploy no Cloud Run | Console → IAM → Contas de serviço → Chaves (dê os papéis "Cloud Run Admin" e "Service Account User") |
| `TELEGRAM_API_ID` | ID do app | my.telegram.org → API development tools |
| `TELEGRAM_API_HASH` | Hash do app | my.telegram.org → API development tools |
| `TELEGRAM_BOT_TOKEN` | Token do bot | @BotFather no Telegram |
| `TELEGRAM_MEDIA_ADMIN_TOKEN` | Uma senha forte qualquer, você inventa | — |

## 2. Adicione o bot ao grupo

O bot precisa estar **dentro** do grupo `-1004353239109` (o pra onde você
encaminhou os vídeos) pra conseguir ler as mensagens. Adicione ele como
membro normal (não precisa ser admin, só conseguir ver as mensagens).

## 3. Deploy

Cadastre os 6 secrets acima e dê push (ou rode manualmente o workflow
"Deploy Telegram Media Service" na aba Actions do GitHub). Não tem passo de
login manual — o bot loga sozinho a cada vez que o serviço sobe.

Depois do primeiro deploy, pegue a URL do serviço nos logs do workflow
(campo "URL" no final do passo "Deploy no Cloud Run" — algo como
`https://empire-telegram-media-xxxxxxxx.a.run.app`) e:

1. Cole essa URL em `wrangler.jsonc` (raiz do repo), no campo `TELEGRAM_MEDIA_SERVICE_URL`
2. Dê commit/push pra redeployar o `empirefinal` com a URL certa

Confirme que o serviço subiu:

```
curl https://SUA-URL-AQUI.a.run.app/health
```

Deve responder `{"ok":true,"loggedIn":true}`.

## 4. Como a planilha deve referenciar o vídeo

Na aba **Music Videos**, para cada linha que usa o Telegram:
- Coluna de fonte (`arquivo_fonte`/`fonte`): `telegram`
- Coluna do arquivo (`telegram_file_id`): o **ID da mensagem** no grupo
  `https://web.telegram.org/a/#-1004353239109` (o número que aparece na URL
  ao abrir a mensagem do vídeo lá dentro, ex: `.../1004353239109/842` → ID é `842`)

## 5. Segurança

- `x-admin-token` protege a rota `/video/*` — sem ele, 401.
- O navegador do jogador **nunca** vê esse token nem as credenciais do
  Telegram: quem chama `/video/*` é o Worker do `empirefinal`, que injeta o
  token no lado do servidor (secret `TELEGRAM_MEDIA_ADMIN_TOKEN` também
  cadastrado lá).
- O serviço aceita chamadas sem autenticação do próprio Cloud Run
  (`--allow-unauthenticated`) porque a proteção é feita pela própria
  aplicação (`x-admin-token`), não pelo IAM do Google Cloud.
