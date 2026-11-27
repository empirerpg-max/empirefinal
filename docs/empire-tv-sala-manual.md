# Sala da Empire TV — manual de manutenção

Atualizado em 2026-11-27 (merge do PR #956). Este documento explica **como a
sala funciona hoje, onde fica cada coisa e o que fazer quando algo dá errado**.
Lembrete: o app roda no **Cloudflare Workers** (não no Telegram).

Documentos de apoio:
- Plano e decisões da construção: `docs/superpowers/plans/2026-11-26-sala-empire-tv.md`
  e `…-registro.md`.
- Orçamento do plano gratuito: `docs/superpowers/specs/2026-11-27-orcamento-d1-e-requisicoes.md`.
- Design do Beta (seções 6.19.x): `docs/superpowers/specs/2026-11-25-reorganizacao-do-app-design.md`.

---

## 1. Mapa rápido (onde fica cada coisa)

| Parte | Arquivos |
|---|---|
| Tela da sala (layout, chat, abas, controles do vídeo) | `src/routes/tv.tsx` |
| Player do app (vídeo HLS da Kick, som, tela cheia, volta para a Kick) | `src/components/EmpireTV/PlayerAppHls.tsx` |
| Escolha de player salva no aparelho | `src/lib/tvPlayerModo.ts` (chave `tvPlayerModo` no localStorage) |
| Mini player | `src/components/EmpireTV/TvMiniPlayer.tsx`, `TvPlayerContext.tsx` |
| Contagem de presença (cliente) | `src/components/EmpireTV/PresencaTVTracker.tsx`, `src/lib/tvPresencaCliente.ts` |
| Presença (servidor + D1) | `backend/src/services/tvPresenca.ts`, `backend/src/controllers/tvController.ts` |
| Enquetes (cliente) | `src/components/EmpireTV/EnquetesPanel.tsx`, `EnqueteFaixa.tsx`, `NovaEnqueteSheet.tsx`, `useEnquetesTV.ts` |
| Enquetes (servidor + D1) | `backend/src/services/tvEnquetes.ts`, `tvController.ts` |
| Grade da TV + "está ao vivo?" da Kick | `getProgramasTVController` em `tvController.ts`, `backend/src/services/kickStatus.ts` |
| Rotas da API | `backend/src/routes/api.ts` (`/api/tv/...`) |
| Tabelas do D1 | `d1/schema.sql` (`tv_presenca`, `tv_enquete`, `tv_enquete_voto`) |
| Não recarregar durante a transmissão | `src/lib/salaAtiva.ts`, `src/lib/staleChunk.ts`, `src/lib/pwa.ts` |
| Rolagem e gestos do chat | `src/lib/tvChatRolagem.ts`, `src/hooks/useArrastarParaResponder.ts` |
| Limpeza diária da presença (> 30 dias) | `src/server.ts` (`limparPresencaTVDiaria`) |
| Páginas de diagnóstico (só admin) | `/tv-teste-som` e `/tv-teste-hls` (`src/routes/tv-teste-*.tsx`) |
| Link de teste automático | `.github/workflows/preview-sala-tv.yml` |
| Testes | `scripts/tv-*.test.ts` (alguns rodam por `bash scripts/rodar-testes-isolados.sh`) |

## 2. Como cada parte funciona

### 2.1 Vídeo e som (player do app)
- A grade (`GET /api/tv/programas?kick=1`) traz, junto, o status de cada canal
  da Kick, inclusive o `playback_url` (o vídeo HLS). O app toca esse vídeo num
  `<video>` próprio (hls.js; no iPhone, o player nativo como reserva).
- O botão "Ativar som" é do app, então **um toque liga o som** (no player da
  Kick o navegador exigia o toque dentro do player dela).
- **Volta automática para a Kick** (aviso "O player do app falhou — voltando
  para o player da Kick") quando:
  - o vídeo não começa em 20 s;
  - dá erro sem conserto (antes tenta 3 recomeços de rede e 1 recuperação de mídia);
  - para por 25 s duas vezes (na 1ª recarrega com o link mais novo).
- Botão ⇄ troca entre player do app e da Kick; a escolha fica salva no aparelho.
- **Controles limpos:** no player do app, os ícones somem 3,5 s depois do
  último toque e voltam ao tocar no vídeo; o "Ativar som" fica enquanto mudo.
  No player da Kick ficam sempre à vista (o toque não chega ao app).
- Risco conhecido: o `playback_url` não é API oficial da Kick. Se ela
  bloquear, todo mundo cai sozinho no player da Kick (como era antes). Plano B
  documentado: cópia própria da transmissão no R2 (ver design 6.19.2).

### 2.2 Participação (porcentagem)
- O aparelho marca um minuto a cada 30 s enquanto a **sala ou o mini player**
  está aberto, e envia a cada 5 min (`POST /api/tv/presenca`).
- O D1 guarda **uma linha por pessoa por transmissão** (`tv_presenca`).
- Porcentagem = minutos presentes ÷ minutos entre **Início e Término** (vindos
  do `transmissao.py` do repo `empiretv` ou dos botões de admin na sala).
  Buracos de até 2 min contam como presença.
- O cron (a cada 10 min) processa as transmissões encerradas e grava na
  REGISTRO / Presenca_TV como antes (faixas da aba "Regras", prestígio
  `assistir_tv` ≥ 90%).
- O círculo "Sua participação" lê **só a linha da pessoa** (`?jogador_id=`);
  a aba Participantes lê a sala inteira (a cada 60 s, só com a aba aberta).

### 2.3 Enquetes do chat
- Só admin cria (📊). Escolha única ou múltipla; voto **anônimo ou público**;
  "resultado só no fim"; encerrar sozinho em 2/5/10/15 min (relógio do servidor).
- Publicar uma enquete nova encerra a anterior.
- No chat entra só um aviso de uma linha (`ENQ::id` / `ENQRES::id`, enviados
  pelo usuário `empire-tv` no Supabase) e uma faixa no topo que expande.
- O placar atualiza a cada 10 s **só com enquete aberta** e a aba/faixa na tela.
- Ao encerrar, o resultado vai para a aba **`Enquetes_TV`** da planilha
  Agenda_TV (`Data | Programa | Pergunta | Tipo | Opção | Votos | %`). **A aba
  precisa existir** (a conta de serviço não cria abas); se faltar, a enquete
  encerra normalmente e só a cópia na planilha não é gravada (fica um aviso no
  log do Worker).
- A enquete antiga da planilha (aba ENQUETES, `EnqueteBanner`) foi
  **desligada** em 2026-11-27 por decisão do usuário.

### 2.4 Chat
- Supabase em tempo real (`tv_chat_messages`). Não puxa para baixo quem está
  lendo ("↓ N novas"), carrega as antigas ao rolar ou em "↑ Ver mensagens
  anteriores", guarda no máximo ~150 mensagens na tela.
- Arrastar a mensagem responde; segurar abre "Responder" e "Copiar texto".
- Layout: celular em pé (vídeo fixo no topo), deitado (chat ao lado),
  computador ≥ 760 px (chat na coluna da direita).
- A sala fica no endereço (`/tv?sala=ID`); se a página recarregar, volta para
  a mesma sala. Com a sala aberta o app não recarrega sozinho para atualizar:
  mostra a pílula "Atualizar".

## 3. Custos (plano gratuito) — o que vigiar

| Recurso | Limite/dia | Uso medido/estimado |
|---|---|---|
| D1 linhas lidas | 5 M | ~1 M/dia medido em 27/11 (~20%) |
| D1 linhas gravadas | 100 mil | ~2% medido; presença ≈ 1 linha a cada 5 min por espectador |
| Requisições do Worker | 100 mil | ~2 pedidos/min por pessoa dentro da sala |

Onde olhar: Cloudflare › D1 › `empire-hub-catalogo` › Métricas e Workers &
Pages › `tanstack-start-app` › Métricas › **Solicitações** (o gráfico de
"assets" não conta no limite).

**Regras para quem mexer depois:** nada que rode a cada poucos segundos por
pessoa pode ler a sala inteira no D1; prefira busca pela chave
(`programa_id`, `jogador_id`); todo intervalo novo deve pausar com a página
escondida.

## 4. Problemas comuns e o que fazer

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| Vídeo sem som e "Ativar som" não aparece | a pessoa está no player da Kick | tocar em ⇄ para voltar ao player do app |
| Todos caindo no player da Kick | a Kick bloqueou/mudou o `playback_url` | abrir `/tv-teste-hls` (admin) com o canal ao vivo e ver a linha "Lista do vídeo"; se bloqueado, seguir o plano B (R2) |
| Enquete não grava na planilha | aba `Enquetes_TV` não existe ou mudou de nome | criar/renomear a aba com o cabeçalho certo |
| Porcentagem estranha | Início/Término errados ou faltando | conferir os botões de admin na sala; o `transmissao.py` também avisa início e fim |
| Sala "pesada" ou recarregando | memória (GIFs) ou versão nova do app | GIFs fora da tela já liberam memória; a recarga fica adiada enquanto a sala está aberta |
| Painel do D1 subindo muito | algum intervalo novo lendo tabela inteira | ver o "top consultas" no painel e aplicar a regra da seção 3 |

## 5. Como testar uma mudança sem publicar

1. Envie a mudança para a branch de trabalho (hoje `claude/nice-euler-1yslj3`).
2. O GitHub Actions roda `preview-sala-tv.yml` e sobe uma **versão de prévia**:
   https://sala-tv-tanstack-start-app.empirerpg-forum.workers.dev
   (o link do log de cada execução também aparece no resumo do Actions).
3. A prévia usa os **mesmos dados de produção** (D1, planilhas, chat): teste
   numa sala de teste, fora do horário de eventos.
4. Publicar de verdade = merge na `main` (o `deploy.yml` publica).

## 6. Histórico desta entrega (PR #956)

- Participação pelo tempo (D1), botões de admin Início/Término.
- Chat novo (layout por aparelho, rolagem, gestos, sala no endereço).
- Enquetes no chat (anônima/pública, só no fim, encerramento automático, CSV).
- Player do app com som em um toque, troca para a Kick, volta automática.
- Economia: grade + Kick num pedido; 60 s dentro da sala; círculo lê só a
  linha da pessoa; enquetes só atualizam com enquete aberta (a cada 10 s);
  enquete antiga da planilha desligada.
- Controles do vídeo minimalistas (somem sozinhos).
- Social: legenda opcional em Story/Feed/TikTok com mídia (correção no
  servidor; não é da sala, mas foi junto).
