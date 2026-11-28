# Fundações do Beta (fase 0) — manual

Peças compartilhadas que toda tela nova do Beta usa. Nada visível mudou para o
jogador nesta fase; a única tela nova é a vitrine **`/beta-pecas`** (só admin,
sem link em menu nenhum), que mostra as peças para conferir no navegador.

Spec: `docs/superpowers/specs/2026-11-25-reorganizacao-do-app-design.md`
(5.9 a 5.11, 6.1 a 6.3, 6.20). Plano: `docs/superpowers/plans/2026-11-27-fundacoes-beta.md`.

| Peça | Arquivo | Lógica pura (testada) | Para que serve |
|---|---|---|---|
| `ScrollRow` | `src/components/ScrollRow.tsx` | `src/lib/scrollRow.ts` | toda fileira de abas/filtros/pílulas |
| `useHistoryOverlay` | `src/hooks/useHistoryOverlay.ts` | `src/lib/historicoOverlay.ts` | toda camada por cima (folha, modal, player, tela deslizante) |
| `ActionSheet` | `src/components/ActionSheet.tsx` | `src/lib/acoesMenu.ts` | todo menu ⋯ |
| `useJogador` / `useIsAdmin` | `src/hooks/useJogador.ts` | `src/lib/jogador.ts` | quem é o jogador e se é admin |
| `TEMPOS_CACHE` / `opcoesConsulta` | `src/lib/consultas.ts` | (o próprio) | tempo de cache do React Query por tipo de dado |
| Tokens de cor | `src/styles.css` | — | cores semânticas (escuro hoje, claro pronto) |

---

## ScrollRow — fileira rolável com setas

Fileira horizontal que rola (arrastar com o mouse, toque, trackpad) com seta
redonda só do lado que ainda tem conteúdo. A seta fica numa faixa de 56 px
com degradê da cor do fundo; o círculo tem 32 px e a área de toque 44 px.
Toque na seta avança "uma página" e **para no começo de um item** (snap).
O `selecionado` sempre aparece inteiro: ao abrir (sem animação), ao trocar
(suave) e também se os itens mudarem de largura depois de montar (fonte da
web chegando tarde), enquanto o jogador não mexeu na fileira. Teclado:
←/→/Home/End movem o foco entre os itens.

```tsx
<ScrollRow rotulo="Filtros" selecionado={aba} className="-mx-4">
  {ABAS.map((a) => (
    <div key={a.id} data-scroll-item={a.id} className="shrink-0 py-1 pr-2">
      <button
        type="button"
        aria-pressed={a.id === aba}
        onClick={() => setAba(a.id)}
        className="shrink-0 whitespace-nowrap rounded-full px-4 py-2 text-sm font-bold"
      >
        {a.rotulo}
      </button>
    </div>
  ))}
</ScrollRow>
```

- Cada filho **direto** tem `data-scroll-item={id}` (o id que vai em `selecionado`).
- Item com `shrink-0` + padding real; o texto **inteiro** (nunca `truncate`
  nem `min-w-0` num item desta fileira — aba nunca aparece com "…").
- `rotulo` vira o `aria-label` do grupo.

## useHistoryOverlay — voltar fecha só a camada de cima

```tsx
const [aberta, setAberta] = useState(false);
const { fechar } = useHistoryOverlay(aberta, () => setAberta(false));
// X / seta / fundo escurecido / Esc:
<button onClick={() => fechar()}>…</button>
// ação que muda de tela a partir da camada:
fechar(() => router.navigate({ to: "/perfil" }));
```

- Ao abrir empurra uma entrada própria (marca em `history.state.__overlays`).
- O voltar do celular/navegador fecha **só** esta camada (só quando a
  entrada dela saiu).
- `fechar()` consome a entrada dela só se ainda for a atual (nunca deixa
  entrada órfã nem desfaz a navegação de outra tela).
- `fechar(depois)`: fecha e só roda `depois` quando a entrada já saiu do
  histórico (conferido no popstate e a cada 250 ms; teto de 3 s em que roda
  assim mesmo). Use para qualquer ação que **navega**.
- **Troca no mesmo toque**: se uma camada fecha e outra abre no mesmo handler
  (sem `await`/`setTimeout` no meio), a nova reaproveita a entrada da que
  fechou — fica exatamente uma entrada por camada visível.
- A camada **não** se fecha sozinha quando o router faz push para outra rota:
  quem hospeda desmonta (ou põe `aberto=false`) na troca de rota.

## ActionSheet — menu ⋯

```tsx
const [menu, setMenu] = useState(false);
const acoes: AcaoMenu[] = [
  { id: "editar", rotulo: "Editar", icone: Pencil, aoEscolher: () => setEditando(true) },
  { id: "perfil", rotulo: "Ver perfil", icone: User, navega: true,
    aoEscolher: () => router.navigate({ to: "/perfil" }) },
  { id: "excluir", rotulo: "Excluir", icone: Trash2, destrutiva: true, aoEscolher: excluir },
];
<button aria-label="Mais opções" onClick={() => setMenu(true)}>⋯</button>
<ActionSheet aberto={menu} titulo="Opções" acoes={acoes} aoFechar={() => setMenu(false)} />
```

- Folha de baixo (no desktop, centralizada), ícone + texto, destrutivas em
  vermelho **e por último** (a ordem dada é mantida no resto), "Cancelar".
- Fundo escurecido, "Cancelar", Esc e voltar fecham. Foco vai para a folha
  e volta para o botão ⋯ ao fechar; Tab fica preso dentro.
- **Ação que navega leva `navega: true`** (roda só depois que a entrada da
  folha saiu). Ação comum roda no mesmo toque; se abrir outra folha, abra
  de forma síncrona (`setOutra(true)`) — ela reaproveita a entrada.

## useJogador / useIsAdmin

```tsx
const { jogador, carregado } = useJogador(); // { id, ... } | null
const isAdmin = useIsAdmin();               // critério único (isAdminLogin)
if (!carregado) return null;                // não pisca "não encontrada"
```

- Login salvo primeiro, senão o id antigo do `useTelegramUser` (nome legado;
  o app roda no Cloudflare). SSR-safe: no servidor e no 1º render `null`.
- Admin = `tipoPerfil` "Admin" **ou** o id antigo — mesmo critério no
  front, **exceto** editar álbum antigo (`empire-play.albuns-antigos.$id.tsx`)
  e editar revista do acervo (`acervo.tsx`, `RevistaViewer`): ali o servidor
  ainda só aceita o id antigo, então o botão usa `ehAdminPorIdLegado` (só o
  id antigo) e admin só por `tipoPerfil` **não** vê "Editar" nesses dois
  lugares. Só decide o que mostrar; o backend confere de novo pela sessão.

## Tempos de cache (React Query)

```ts
useQuery({ queryKey: ["lancamentos"], queryFn, ...opcoesConsulta("catalogo") });
```

`aoVivo` 30 s · `catalogo` 5 min (sem refetch ao voltar à aba) · `social`
30 s. **Charts não usa** — mantém o comportamento de hoje.

## Tokens de cor

Registrados como utilitários Tailwind (`bg-superficie-1`, `text-texto-secundario`,
`border-linha`, `bg-destaque`, `text-ao-vivo`, `text-alta`, `text-queda`, `text-ouro`).

| Token | Escuro (= hoje) | Claro (`.tema-claro`) |
|---|---|---|
| `--superficie-1` | `bg-white/5` | `#f2f2f7` |
| `--superficie-2` | `bg-white/10` | `#e5e5ea` |
| `--texto-secundario` | `text-muted-foreground` | `#55555c` |
| `--linha` | `border-white/10` | `rgba(0,0,0,.1)` |
| `--destaque` | `#957af8` | `#6c4ce8` |
| `--ao-vivo` | `#dc2626` | `#d61f35` |
| `--alta` | `#10b981` | `#087a54` |
| `--queda` | `#f87171` | `#d1323a` |
| `--ouro` | `#fbbf24` | `#92400e` |

- **Escuro = o que o app mostra hoje** (valores em `:root`).
- **Claro definido, não aplicado**: nada recebe `.tema-claro` nesta fase
  (só a caixa de amostras da vitrine). Liga na fase 5.
- Valores do claro e o "Ao vivo" seguem a **spec 6.20 item 2** (contraste AA
  4,5:1): texto secundário `#55555c` (não `#6b6b73`), ouro `#92400e`, alta
  `#087a54`, Ao vivo escuro `#dc2626`.

## Regras (valem para toda tela nova do Beta)

1. **Voltar = tela anterior**: toda camada usa `useHistoryOverlay`.
2. **Ação de menu que navega** leva `navega: true`; fora de menu, `fechar(depois)`.
3. **Troca de folha no mesmo toque** (sem `await` entre fechar e abrir).
4. **Fileira de abas/filtros = `ScrollRow`**, nunca `grid-cols-N` com texto.
5. **Botões com texto** (CLAUDE.md): `min-w-0` no item flex, padding ≥ `px-1`,
   ícone `shrink-0`, texto `truncate` — exceto itens de fileira de abas,
   que ficam inteiros e a fileira rola.
6. **Admin** só por `useIsAdmin()`; jogador por `useJogador()`.
7. **Cores novas** por token, não por classe solta (`bg-white/5` etc.).

## Limites conhecidos

- Se um `history.go()` de fechamento nunca gerar um popstate que assente
  (improvável), o coordenador fica esperando e a próxima camada não troca
  a entrada.
- Se quem hospeda fecha a camada **e** navega no mesmo instante (sem
  `fechar(depois)`), a entrada da camada fica órfã por baixo da rota nova.
- Camada aberta num tick **posterior** a um `go()` em voo (ex.: depois de
  `setTimeout(0)`) pisca e fecha, sobrando 1 entrada. Abra no mesmo handler.
- Ação `navega` roda mesmo se o host desmontar durante a espera (até 3 s) —
  de propósito, para a navegação nunca se perder.
- `ActionSheet` usa `z-[300]`, o maior do app (toasts ficam por cima — ok).
- A trava de rolagem do `ActionSheet` mexe no `body`, mas o app rola num
  container interno: o fundo escurecido é que segura os toques.
- **Defeito antigo (não desta fase)**: `empire_tg_id` nunca é gravado no
  app, então a checagem de dono/admin em álbum, editar álbum, playlist e
  editar playlist quase nunca reconhece ninguém hoje. Corrigir na fase 3
  migrando essas telas para `useJogador`.
- StrictMode (só dev) empurra e consome uma entrada extra ao montar.
- **Admin no backend ainda não unificado (pendente, decisão do usuário por
  ser de segurança)**: `playlistsController.ts` 187-188, 1768
  (`podeEditarAlbumAntigo`) e 1982-1983, e `acervoController.ts` 205-206 só
  aceitam o id antigo. Até unificar, os dois botões acima seguem só pelo id
  antigo (`ehAdminPorIdLegado`); depois, trocar por `useIsAdmin()`.
- **Camadas antigas não convivem com as novas**: `use-back-close.ts:21`,
  `NovaEnqueteSheet.tsx:56`, `VitrineClipes.tsx:98`, `empire-play.index.tsx:25`
  e `tv.tsx:1040`/`1934` trocam o `history.state` inteiro e apagam
  `__overlays`. Abrir uma delas a partir de uma camada nova (ou uma nova por
  cima de uma antiga) deixa entrada órfã ou fecha as duas. Regra: migrar a
  camada antiga para `useHistoryOverlay` antes de misturar.
- **`router.navigate({ replace: true })` com camada aberta** apaga
  `__overlays` e a entrada fica órfã depois. Regra: não navegar com
  `replace` com camada aberta (ou passar `state: true` para manter o state).
- **Folha aberta por troca** (ex.: "Abrir outra folha" no ⋯) deve focar em
  efeito passivo (`useEffect`, só ao abrir), não no ref callback — senão o
  foco volta ao ⋯ atrás dela quando o ActionSheet devolve o foco.

## Testes

```bash
bun test scripts/beta-*.test.ts          # lógica pura das peças
bash scripts/rodar-testes-isolados.sh   # testes com mock.module, um por processo
bunx tsc --noEmit -p .
bun run build
```

Conferência no navegador (automática, `scripts/navegador/beta-pecas.mjs`,
Playwright): `bun run build`, depois
`bunx wrangler dev -c dist/tanstack_start_app/wrangler.json --local --port 8799`
(em outro terminal) e `node scripts/navegador/beta-pecas.mjs`. Entra como
admin e abre `/beta-pecas` em 320, 390 e 1300 px — setas nas pontas, seta
parando no começo de item, selecionado inteiro, ←/→, voltar fechando só a
folha de cima (inclusive depois de "Ir para o Perfil"), Esc, foco voltando
ao ⋯, ⋯ empilhado por cima da folha (voltar fecha só ele; X da folha de
baixo fecha as duas sem sobrar entrada; ação `navega` no ⋯ de cima vai para
`/perfil` e 1 voltar volta sem nada aberto); jogador comum vê "Página não
encontrada.".

---

# Beta test: chave, escolha e reportes (fase 1a, 2026-11-28)

Plano: `docs/superpowers/plans/2026-11-28-fase-1a-beta-test-base.md`. Design:
seção 6.11 de `docs/superpowers/specs/2026-11-25-reorganizacao-do-app-design.md`.

## Para que serve

É a **base** do Beta test: o jeito de o app saber se o jogador está na
versão **beta** ou na **anterior**, deixar o admin ligar e desligar o Beta
sem publicar o app de novo, e receber **reportes** dos jogadores. A casca
nova (topo, barras, telas novas) ainda **não existe**: vem na fase 1b. Hoje
trocar de versão só mostra/esconde o selo BETA e a faixa; a versão
"beta" ainda tem as mesmas telas de sempre.

## Mapa dos arquivos

| Parte | Arquivos |
|---|---|
| Regras puras (modos, quem vê o quê, motivos, estado seguro, ação de uso) | `src/lib/beta/regras.ts` (usado no app e no Worker) |
| Cliente (estado guardado no aparelho, dados técnicos do reporte) | `src/lib/beta/cliente.ts` |
| Últimos erros da página (para os dados técnicos) | `src/lib/beta/errosRecentes.ts` |
| Estado no app (`BetaProvider`/`useBeta`/`useTelaAtual`) | `src/hooks/useBeta.tsx`, ligado em `src/routes/__root.tsx` |
| Chamadas da API | `src/lib/api.ts` (`betaEstado`, `betaEscolher`, `betaReportar`, `betaListarReportes`, `betaMudarStatus`, `betaConfig`, `betaSalvarConfig`); o token de sessão vai direto no cabeçalho (`authHeaders()`), sem depender do fetch embrulhado do `AuthGate` (instalado depois da 1ª consulta) |
| Telas do jogador | `src/components/Beta/` (`Folha` base, `FaixaVersaoAnterior`, `SeloBeta`, `FolhaBeta`, `FolhaVoltarVersao`, `FolhaReportar`) |
| Tela do admin | `src/routes/beta-admin.tsx` (`/beta-admin`); atalho em `src/routes/perfil.tsx` |
| Aviso no sino | `src/components/NotificationBell.tsx` (evento `reporte_beta`) |
| Rotas | `backend/src/controllers/betaController.ts`, ramos em `backend/src/routes/api.ts` |
| Banco | `backend/src/services/betaService.ts`, `d1/schema.sql` |
| Aviso ao admin | `reporte_beta` em `backend/src/services/webPushService.ts` e `notificacoesController.ts` |
| Medição | `definirVersaoUso` em `src/lib/uso/envio.ts`; `docs/medicao-de-uso.md` |
| Testes | `scripts/beta-test-*.test.ts`, roteiro `scripts/navegador/beta-test-base.mjs` |

## Rotas `/api/beta/*`

Resposta sempre JSON: `{ ok: true, ... }` ou `{ ok: false, erro: "texto em português" }`.
Método errado responde 405 com "Use GET/POST para ...".

| Rota | Quem | Entrada | Saída | Erros |
|---|---|---|---|---|
| `GET /estado` | qualquer um; sem sessão recebe "sem Beta" | — | `modo`, `podeVer`, `podeVoltar`, `versao`, `boasVindasVistas` | 500 falha ao ler; 503 sem banco. Com `desligado` e não admin responde "sem Beta" sem tocar no D1 |
| `POST /escolha` | jogador logado | `versao` (`beta`/`anterior`), opcional `motivo`, `texto`, `tela`, `rota` | `{ ok, versao }`; com motivo ou texto grava também um reporte (erro nesse reporte não derruba a troca já gravada) | 400 versão inválida; 401 sem sessão; 403 Beta não liberado para o jogador; 409 não pode voltar (modo obrigatório); 500; 503 |
| `POST /reporte` | jogador logado | `texto` (obrigatório), `tela`, `rota`, `versao`, `printUrl`, `tecnico` | `{ ok, id }` | 400 sem texto; 401; 403 "O Beta test não está aberto para você." (quem não pode ver o Beta; admin sempre pode); 429 "muitos reportes hoje"; 500; 503 |
| `GET /reportes` | admin | `status` (`novo`/`visto`/`resolvido`, opcional), `antesDe` (criado_em, para a próxima página) | `{ ok, reportes }` (20 por página) | 403 "Só o admin."; 500; 503 |
| `POST /reporte/status` | admin | `id`, `status` | `{ ok }` | 400; 403; 404 reporte não encontrado; 500; 503 |
| `GET /config` | admin | — | `{ ok, config }` (lida direto do KV, sem o cache de 60 s) | 403 |
| `POST /config` | admin | `modo`, `convidados` | `{ ok, config }` (convidados já limpos) | 400 "Configuração inválida." (corpo não-objeto ou `modo` ausente/desconhecido; nada é gravado); 403; 503 armazenamento indisponível; 500 |

"Admin" aqui é `requestProvesAdmin` (o mesmo das outras rotas de admin).

## Onde ficam os dados

**D1** (criadas sob demanda por `garantirTabelasBeta` e também no `d1/schema.sql`):

- `beta_jogador`: `jogador_id` (chave), `versao` (`beta`/`anterior`/vazio = nunca escolheu), `boas_vindas_em` (reservado para o aviso de boas-vindas, fase 1c; hoje ninguém grava), `atualizado_em`.
- `beta_reporte`: `id`, `jogador_id`, `usuario`, `versao`, `tela`, `rota`, `texto`, `motivo`, `print_url`, `tecnico`, `status` (`novo`/`visto`/`resolvido`), `criado_em`. Índices por (status, data) e (jogador, data).

**KV** (`__FLAGS_KV__`), chave `beta-config`: JSON `{ "modo": "desligado|convidados|todos|obrigatorio", "convidados": ["usuario", ...] }`.

- **Chave ausente, JSON quebrado ou modo desconhecido = desligado.** Nada muda para ninguém até o admin salvar.
- Convidados: sem `@`, sem repetir, até 500. Vale o id **ou** o @usuario do jogador (sem diferenciar maiúsculas).
- **Cache de 60 s por isolate** na leitura da config para o estado e o reporte. Somado à propagação do próprio KV entre locais (até ~60 s), uma mudança pode levar **até ~2 min** para valer no Worker. O `GET /config` do admin lê o KV direto, sem o cache (ainda pode ver a propagação do KV); o `POST /config` zera o cache do isolate que recebeu.

## Os 4 modos

| Modo | Quem vê o Beta | Versão ao abrir | Pode voltar? |
|---|---|---|---|
| `desligado` (padrão) | só o admin | anterior (o admin pode escolher o beta) | sim, só o admin |
| `convidados` | quem está na lista e o admin | beta (ou a escolha do jogador) | sim |
| `todos` | todos | beta (ou a escolha do jogador) | sim |
| `obrigatorio` | todos | sempre beta | **não** (sem faixa, sem "Voltar") |

- O **admin vê o Beta em qualquer modo** (para testar antes de ligar).
- "Admin" no estado é o **id antigo `ADMIN_TG_ID`**. Quem é admin só pelo "Tipo de Perfil" **não** ganha essa regra: para testar, precisa se pôr na lista de convidados (modo `convidados`).
- Quem não pode ver o Beta não vê nada novo: nem faixa, nem selo, nem tela.
- Sem sessão (ou erro de rede/servidor) o app usa o estado seguro: sem Beta, versão anterior.

## Como ligar, desligar e trocar

**Admin:** Perfil › bloco admin › "Beta test (reportes e chave)" abre `/beta-admin` (só admin; os outros veem "Só o admin pode ver esta tela."). Aba **Chave do Beta**: escolher o modo, editar os convidados e **Salvar** (pede confirmação; "Obrigatório" aparece em vermelho). Aba **Reportes**: lista com filtro Novos/Vistos/Resolvidos/Todos, print, dados técnicos e ⋯ para marcar o status. No lançamento: ligar "Ligado para todos".

**Jogador (quem pode ver o Beta):**
- Na versão **anterior**: faixa fixa "Versão anterior" com o botão para ir ao Beta (se a troca falhar: toast "Não deu para abrir o Beta agora. Tente de novo." e a faixa fica).
- Na versão **beta**: selo amarelo **BETA** ao lado do logo. Tocar abre a folha "Você está no Beta test": Reportar um problema · Como usar · Voltar para a versão anterior (com motivo e texto opcionais).
- **A troca não recarrega a página** (o player continua tocando): o estado muda na memória, no aparelho e no servidor. No aparelho o estado é **por jogador**: localStorage `empireBetaEstado:<id>` e queryKey `["beta", "estado", id]` (dois logins no mesmo aparelho não herdam o estado um do outro; sem jogador, estado seguro). A chave antiga sem id é ignorada.
- A **mudança de modo** feita pelo admin chega aos jogadores em até ~5 min (cache do estado no app, sem refetch ao focar) ou ao reabrir o app; mais até 60 s do cache do Worker e até ~60 s de propagação do KV.
- A versão do Beta também alimenta a medição de uso (`definirVersaoUso`; ao voltar conta `beta:voltar:<motivo>`; ver `docs/medicao-de-uso.md`).

## Reportes

- Campos: texto (obrigatório, **corta em 2.000**), tela (nome amigável da rota, nunca o caminho com ids; 120), rota (sem query; 300), versão em uso, motivo (se veio da volta), print (só link `https://` de `drive.google.com` ou `lh3.googleusercontent.com`, senão fica vazio; 500) e dados técnicos (**corta em 4.000**).
- **Limite: 10 reportes por jogador por dia UTC** (o dia zera às 21h de Brasília). O 11º dá 429 ("Você já enviou muitos reportes hoje"). Reporte que vem junto de uma troca de versão que estoura o limite é ignorado em silêncio (a troca vale).
- **Dados técnicos** (só se o jogador deixar marcado): versão, rota sem query, aparelho (pela largura), largura, navegador (user agent, 300), build, e os **últimos 5 erros de JavaScript** (mensagem + 1ª linha da pilha, 300 cada). Se passar do corte, saem os erros mais antigos. Nenhum conteúdo de usuário.
- **Print**: sobe para o Drive na pasta `socialPosts` (`PASTA_PRINT_REPORTE` em `FolhaReportar.tsx`) até existir uma pasta própria do Beta; máximo 8 MB, só imagem. O `uploadToDrive` devolve a página do Drive (`drive.google.com/file/d/<id>/view`), então o `/beta-admin` mostra pelo proxy de imagem: `driveImg(url, 400)` na miniatura e `driveImgWide` na folha grande.
- **Aviso ao admin**: sino do app e notificação no celular, evento `reporte_beta` (texto "enviou um reporte do Beta" com o nome da tela via `nomeDaTela`, abre `/beta-admin`). Roda em segundo plano com `ctx.waitUntil` (o Worker não corta o aviso ao responder). Se o admin é quem reporta, não recebe aviso de si mesmo.

## Custo (plano gratuito)

Por abertura do app: **1 pedido** (`GET /api/beta/estado`, fora da medição de uso) + **1 leitura de KV** (com cache de 60 s por isolate) + **1 linha lida no D1** (`beta_jogador`). Com o Beta `desligado`, jogador comum não lê nada no D1. **Gravações só ao trocar de versão ou reportar** (1 linha por troca, 1 por reporte). A tela do admin só lê quando aberta.

## Testes e conferência

```bash
bun test scripts/beta-test-regras.test.ts scripts/beta-test-service.test.ts scripts/beta-test-cliente.test.ts scripts/beta-test-telas.test.ts
bash scripts/rodar-testes-isolados.sh scripts/beta-test-rotas.test.ts   # usa mock.module
```

Roteiro no navegador (Playwright, rotas `/api/beta/*` interceptadas — `/estado` sem `Authorization` responde "sem sessão", como o servidor — e hosts de fora bloqueados, menos a imagem do print no `lh3`, que é respondida localmente): `bun run build`, depois
`bunx wrangler dev -c dist/tanstack_start_app/wrangler.json --local --port 8799`
(em outro terminal) e `node scripts/navegador/beta-test-base.mjs`
(opcional: `BASE=http://localhost:8799`, `FOTOS=pasta` para os prints). Confere, em 320 e 390 px: nada novo com o Beta desligado; faixa e selo sem texto cortado nem rolagem horizontal; troca sem recarregar; folhas (voltar fecha só a de cima, sem entrada órfã); envio do reporte; e a tela `/beta-admin` (admin e não admin).

## Pendências conhecidas (fase 1a)

- O botão "Voltar" compartilhado (`BackButton`) tem 24 px de altura (abaixo de 40 px); componente fora desta fase.
- A **casca nova** (topo, barras, telas novas) vem na **fase 1b**.
- O "Como usar" do selo leva ao `/tutorial` **antigo** até a **fase 1c**.
