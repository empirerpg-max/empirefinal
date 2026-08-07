# Empire Telegram Media

Serviço separado (Render.com) que loga como **bot** via MTProto (não a API
HTTP do bot) e transmite vídeos grandes do grupo pra dentro do app. Via
MTProto o limite de 20MB da API HTTP não existe — o bot consegue ler
arquivos grandes normalmente. Nenhuma credencial chega ao navegador: o
`empirefinal` fala com esse serviço por trás (`src/server.ts` →
`/api/telegram-video/:messageId`).

Por que Render e não o Cloudflare Workers do resto do app: o protocolo do
Telegram (MTProto) precisa de conexão TCP persistente, o que o Workers não
suporta — precisa de um container Node.js de verdade. O Render foi escolhido
por não pedir cartão de crédito nem conta de faturamento no plano gratuito
(diferente de Fly.io e Google Cloud Run).

**Único porém do plano gratuito:** o serviço "dorme" depois de 15 minutos
sem uso, e a primeira chamada depois disso demora ~30-50s pra acordar. Isso
não quebra nada — o bot loga de novo sozinho a cada vez que acorda — só
deixa o primeiro vídeo depois de um tempo parado um pouco mais lento pra
começar a carregar.

## 1. Conecte o repositório no Render (sem cartão)

1. Crie conta em **render.com** (dá pra usar login do GitHub direto, sem pedir cartão)
2. **New → Blueprint**
3. Selecione o repositório `empirerpg-max/empirefinal`
4. O Render vai encontrar o arquivo `render.yaml` (na raiz do repo) sozinho e mostrar o serviço `empire-telegram-media` pra criar
5. Antes de confirmar, ele vai pedir pra preencher as variáveis marcadas como secretas — preencha:

| Variável | O que é | Onde conseguir |
|---|---|---|
| `TELEGRAM_API_ID` | ID do app | my.telegram.org → API development tools |
| `TELEGRAM_API_HASH` | Hash do app | my.telegram.org → API development tools |
| `TELEGRAM_BOT_TOKEN` | Token do bot | @BotFather no Telegram |
| `ADMIN_TOKEN` | Uma senha forte qualquer, você inventa | — |

6. Clique em **Apply** — o Render builda e sobe sozinho

A partir daí, todo push na branch `main` que mexer em `telegram-media/`
redeploya automaticamente (o Render já fica de olho no repositório, não
precisa de nenhum GitHub Action).

## 2. Adicione o bot ao grupo

O bot precisa estar **dentro** do grupo `-1004353239109` (o pra onde você
encaminhou os vídeos) pra conseguir ler as mensagens. Adicione ele como
membro normal (não precisa ser admin, só conseguir ver as mensagens).

## 3. Confirme que subiu

A URL já é previsível — não precisa copiar nada, `wrangler.jsonc` já aponta
pra ela:

```
curl https://empire-telegram-media.onrender.com/health
```

Deve responder `{"ok":true,"loggedIn":true}` (pode demorar até 1 minuto na
primeira chamada, o serviço ainda está "acordando").

Se o nome `empire-telegram-media` já estiver em uso por outra pessoa no
Render, o serviço sobe com outro subdomínio — nesse caso me avisa a URL real
que eu atualizo o `wrangler.jsonc`.

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
  token no lado do servidor (a mesma senha que você colocou em `ADMIN_TOKEN`
  no Render deve ser cadastrada como o secret `TELEGRAM_MEDIA_ADMIN_TOKEN`
  no GitHub, aba Settings → Secrets → Actions do repo `empirefinal`).
