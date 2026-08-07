# Empire Telegram Media

Serviço separado (Fly.io) que autentica como usuário do Telegram (MTProto,
não Bot API) e transmite vídeos grandes do grupo pra dentro do app, sem
expor nenhuma credencial pro navegador. O `empirefinal` fala com ele por
trás (`src/server.ts` → `/api/telegram-video/:messageId`).

## 1. Secrets no GitHub (repo `empirefinal`, aba Settings → Secrets → Actions)

| Secret | O que é |
|---|---|
| `FLY_API_TOKEN` | Token da sua conta Fly.io (dashboard → Account → Tokens) |
| `TELEGRAM_API_ID` | Gerado em my.telegram.org |
| `TELEGRAM_API_HASH` | Gerado em my.telegram.org |
| `TELEGRAM_MEDIA_ADMIN_TOKEN` | Uma senha forte qualquer, você inventa (protege as rotas do serviço) |
| `TELEGRAM_SESSION` | Deixe **vazio** no primeiro deploy — vem do passo 3 |

Depois de cadastrar os 4 primeiros, dê push (ou rode o workflow "Deploy
Telegram Media Service" manualmente na aba Actions) pra criar o serviço.

## 2. Confirme que subiu

```
curl https://empire-telegram-media.fly.dev/health
```

## 3. Login único (uma vez só, depois nunca mais precisa)

```
# Passo A — pede o código de confirmação
curl -X POST https://empire-telegram-media.fly.dev/auth/send-code \
  -H "x-admin-token: SEU_TELEGRAM_MEDIA_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"phone": "+5511999999999"}'
```

Isso te devolve um `phoneCodeHash` e manda um código no seu Telegram.

```
# Passo B — confirma com o código recebido
curl -X POST https://empire-telegram-media.fly.dev/auth/confirm \
  -H "x-admin-token: SEU_TELEGRAM_MEDIA_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"phone": "+5511999999999", "code": "12345", "phoneCodeHash": "HASH_DO_PASSO_A"}'
```

Se sua conta tem senha de duas etapas, adicione `"password": "sua senha"` no
corpo do passo B.

A resposta traz `sessionString`. **Copie esse valor**, cole no secret do
GitHub `TELEGRAM_SESSION`, e rode o workflow de novo (push vazio ou "Run
workflow" na aba Actions) pra persistir o login.

## 4. Como a planilha deve referenciar o vídeo

Na aba **Music Videos**, para cada linha que usa o Telegram:
- Coluna de fonte (`arquivo_fonte`/`fonte`): `telegram`
- Coluna do arquivo (`telegram_file_id`): o **ID da mensagem** no grupo
  `https://web.telegram.org/a/#-1004353239109` (o número que aparece na URL
  ao abrir a mensagem do vídeo lá dentro, ex: `.../1004353239109/842` → ID é `842`)

## 5. Segurança

- `x-admin-token` protege as 3 rotas (`/auth/*` e `/video/*`) — sem ele, 401.
- O navegador do jogador **nunca** vê esse token: quem chama `/video/*` é o
  Worker do `empirefinal`, que injeta o token no lado do servidor.
