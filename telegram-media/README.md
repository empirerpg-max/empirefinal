# Empire Telegram Media

Serviço separado (Fly.io) que loga como **bot** via MTProto (não a API HTTP
do bot) e transmite vídeos grandes do grupo pra dentro do app. Via MTProto o
limite de 20MB da API HTTP não existe — o bot consegue ler arquivos grandes
normalmente. Nenhuma credencial chega ao navegador: o `empirefinal` fala com
esse serviço por trás (`src/server.ts` → `/api/telegram-video/:messageId`).

## 1. Secrets no GitHub (repo `empirefinal`, aba Settings → Secrets → Actions)

| Secret | O que é | Onde conseguir |
|---|---|---|
| `FLY_API_TOKEN` | Token da sua conta Fly.io | Fly.io dashboard → Account → Tokens |
| `TELEGRAM_API_ID` | ID do app | my.telegram.org → API development tools |
| `TELEGRAM_API_HASH` | Hash do app | my.telegram.org → API development tools |
| `TELEGRAM_BOT_TOKEN` | Token do bot | @BotFather no Telegram |
| `TELEGRAM_MEDIA_ADMIN_TOKEN` | Uma senha forte qualquer, você inventa | — |

## 2. Adicione o bot ao grupo

O bot precisa estar **dentro** do grupo `-1004353239109` (o pra onde você
encaminhou os vídeos) pra conseguir ler as mensagens. Adicione ele como
membro normal (não precisa ser admin, só conseguir ver as mensagens).

## 3. Deploy

Cadastre os 5 secrets acima e dê push (ou rode manualmente o workflow
"Deploy Telegram Media Service" na aba Actions do GitHub). Não tem passo de
login manual — o bot loga sozinho a cada vez que o serviço sobe.

Confirme que subiu:

```
curl https://empire-telegram-media.fly.dev/health
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
