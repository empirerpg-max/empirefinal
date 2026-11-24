# Regras dos países e das paradas oficiais (charts)

Guia para quem for mexer nos números dos charts por país. O app roda no
Cloudflare (Workers) e guarda tudo no banco D1. Os valores abaixo vêm do
código (`backend/src/services/chartsD1/regras.ts`); se este texto e o código
discordarem, **vale o código**.

## 1. De onde vêm os dados (3 camadas)

- **Camada 0 (nunca muda):** o que a planilha EMPIRE - CHARTS manda toda
  quinta-feira (Global 100 e totais de Spotify, Apple Music, YouTube e Digital
  Sales). Fica gravado como chegou. Nenhuma regra deste documento altera isso.
  Nenhuma mudança foi necessária na planilha nem no Apps Script
  (`EnvioD1.gs`).
- **Camada 1 (COUNTRIES):** quanto cada música teve em cada país, por
  plataforma (Spotify, Apple Music, YouTube). Calculado pela **regra C**
  (seção 2).
- **Camada 2 (aba "PARADAS OFICIAIS"):** 12 paradas que imitam charts reais
  (Hot 100, UK, Oricon...), calculadas a partir da camada 1 (seção 3).
  **Digital Sales participa** (são as "vendas"), mas não tem aba própria de
  países.

O Global 100 não passa pelas camadas 1 e 2: aparece como chega.

## 2. Regra C: como o mundo vira países

Cada país tem um peso (`pais_peso`, ex.: Austrália 0,02 = 2% do total
mundial). Para cada música e país:

1. Parte do peso do país (`pb`).
2. Se o artista é **nativo** daquele país (nacionalidade em `artista_info`),
   ganha um bônus de `pb × mult`, com `mult` sorteado entre `nac_min` e
   `nac_max`. Se o país é o **foco** do lançamento (seção 6) ganha o bônus com
   `mult` entre `foco_min` e `foco_max`. Nacionalidade e foco **nunca somam**
   no mesmo país (vale a nacionalidade).
3. O bônus nunca passa de `bonus_teto` (0,20 = 20 pontos percentuais do mundo
   todo).
4. Aplica-se uma variação aleatória de ±`variacao` (±15%) por música e país.
5. A parte do mundo que não está em nenhum país da tabela (1 − soma dos pesos)
   entra como "resto" no divisor, então as fatias nunca passam do total.

Fórmula: `w = (pb + min(pb × mult, bonus_teto)) × variação`;
`fatia = w ÷ (soma de todos os w + resto)`; valor no país = total mundial ×
fatia.

O "sorteio" **não é aleatório de verdade**: é uma conta fixa (hash) sobre
`data | música | país | tipo`. A mesma música na mesma semana dá sempre o
mesmo resultado, em todos os aparelhos e plataformas.

### Exemplo A: australiano com foco nos EUA

Pesos: EUA 0,30; Austrália 0,02. Artista nascido na Austrália, lançamento com
foco nos EUA, valores padrão.

- Austrália (nativo): bônus = 0,02 × (1,5 a 4) = 0,03 a 0,08.
- EUA (foco): bônus = 0,30 × (0,5 a 1,5) = 0,15 a 0,45, limitado ao teto
  **0,20**. Então o bônus nos EUA fica entre 0,15 e 0,20.

O teto existe para o foco num país grande não "engolir" o resto do mundo.

### Exemplo B: hit mundial contra nativo num país de 2%

Pesos: EUA 0,30; Austrália 0,02; Brasil 0,05; nacionalidade fixa em 3x e
variação desligada (é o teste do código). Resto = 1 − 0,37 = 0,63.

- Hit americano com 1.000.000: na Austrália ele fica com 0,02 de peso.
  Divisor = 0,50 (EUA com bônus) + 0,02 + 0,05 + 0,63 = 1,20.
  Valor = 1.000.000 × 0,02 ÷ 1,20 ≈ **16.667**.
- Nativo australiano com **200.000**: peso 0,02 + 0,06 = 0,08.
  Divisor = 0,30 + 0,08 + 0,05 + 0,63 = 1,06.
  Valor = 200.000 × 0,08 ÷ 1,06 ≈ **15.094**. O hit ganha (4x maior).
- Nativo com **500.000**: ≈ 37.736. O nativo ganha (está perto do hit).

Resumo: ser nativo ajuda, mas não compensa ser 4x menor que um hit mundial.

## 3. As 12 paradas oficiais (REGRAS_PADRAO v1)

Cada parada é um país mais uma fórmula. Pontos = `a × vendas` + pagos ÷ `tp`
+ grátis-áudio ÷ `tga` + grátis-vídeo ÷ `tgv` (taxa 0 = aquela fonte não
conta). Na parada "por receita" (Alemanha) as taxas são preços e
**multiplicam**. Fontes: vendas = Digital Sales; pagos = Apple Music + 45% do
Spotify; grátis-áudio = 55% do Spotify; grátis-vídeo = YouTube.

| # | id | Parada | País | a | tp | tga | tgv | Top | Extras |
|---|----|--------|------|---|----|-----|-----|-----|--------|
| 1 | EUA | Billboard Hot 100 | Estados Unidos | 1 | 100 | 300 | 300 | 50 | Recorrência |
| 2 | UK | UK Official Charts | Reino Unido | 1 | 100 | 600 | 600 | 50 | ACR; máx. 3 por artista |
| 3 | AU | ARIA Charts | Austrália | 1 | 100 | 600 | 600 | 50 | |
| 4 | JP | Oricon | Japão | 2 | 300 | 300 | 300 | 50 | Vendas pesam o dobro |
| 5 | KR | Circle Chart | Coreia do Sul | 1 | 100 | 200 | 200 | 50 | |
| 6 | DE | Offizielle Deutsche Charts | Alemanha | 1,29 | 0,008 | 0,0008 | 0,0008 | 50 | Por receita |
| 7 | FR | SNEP | França | 1 | 150 | 0 | 0 | 50 | Só vendas e streaming pago |
| 8 | CA | Billboard Canadian Hot 100 | Canadá | 1 | 100 | 300 | 300 | 50 | Recorrência |
| 9 | BR | Billboard Brasil Hot 100 | Brasil | 0 | 100 | 300 | 300 | 50 | Só streaming |
| 10 | AR | Billboard Argentina Hot 100 | Argentina | 0 | 100 | 300 | 300 | 50 | Só streaming |
| 11 | MX | Billboard México | México | 0 | 100 | 300 | 300 | 50 | Só streaming |
| 12 | EXCL_US | Global Excl. US | (mundo sem EUA) | 1 | 100 | 300 | 300 | **100** | Mundo menos EUA |

Regras extras:

- **Recorrência** (EUA e Canadá): música com 20 ou mais semanas no chart que
  estiver abaixo da posição 50, ou com 52 ou mais semanas abaixo da 25, sai da
  parada e as de baixo sobem.
- **ACR** (UK): música com mais de 9 semanas que caiu nas últimas 3 semanas
  seguidas passa a valer com taxas mais duras: tp 200, tga 1200, tgv 1200.
- **Máx. 3 por artista** (UK): só as 3 melhores do mesmo artista entram.
- Se o país da parada não existe em `pais_peso`, a parada some (os apelidos de
  nome, como "EUA"/"USA", ficam no campo `paises`).

**Mexer nos números:** aumentar `tp`/`tga`/`tgv` (dividem) faz aquela fonte
valer **menos**; aumentar `a` faz vendas valerem **mais**; na Alemanha (que
multiplica) é o contrário: aumentar o preço faz a fonte valer mais.

## 4. Chaves do `chart_config`

Tabela `chart_config` (colunas `chave` e `valor`). Valor vazio ou inválido
volta ao padrão. Rodar no Console do D1; modelo:

```sql
INSERT INTO chart_config (chave, valor) VALUES ('nac_max','5')
ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor;
```

| Chave | Padrão | Aumentar | Diminuir |
|-------|--------|----------|----------|
| `nac_min` | 1.5 | Nativo ganha mais bônus, mesmo no piso | Nativo perde força |
| `nac_max` | 4 | Teto do multiplicador de nativo sobe (mais variação entre músicas) | Nativos ficam mais parecidos; o ideal é não ficar abaixo de `nac_min` (o app **não valida** isso) |
| `foco_min` | 0.5 | Foco vale mais, mesmo no piso | Foco quase sem efeito |
| `foco_max` | 1.5 | Foco pode render mais | Foco rende menos |
| `bonus_teto` | 0.2 | Países grandes (EUA) podem receber bônus maior | Bônus cortado cedo; país grande quase sem efeito |
| `variacao` | 0.15 | Mais "humor" por música/país (0 = nenhum) | Ranking mais previsível |
| `top_pais` | 50 | Mais posições por país na camada 1 | Menos posições |
| `fracao_paga_spotify` | 0.45 | Mais Spotify vira "pago" (mais peso nas paradas que ignoram grátis, ex. SNEP) | O inverso |
| `paradas` | (JSON) | Ver seção 5 | Ver seção 5 |

Dica: o ideal é manter `foco_max` menor ou igual a `nac_min` (hoje 1.5 e 1.5),
para o foco nunca render mais que a nacionalidade. O app **não valida** isso:
se a regra for quebrada, o cálculo roda normalmente com os valores informados.

**Importante:** a mudança só vale para semanas **novas** (seção 7). A chave
antiga `bonus_nacionalidade` ainda existe na tabela, mas **não é mais usada**;
não mexa nela esperando efeito.

## 5. Incluir ou tirar uma parada

A chave `paradas` guarda a lista completa em JSON. Se existir, **substitui**
todas as 12 (então copie a lista inteira e edite). Se estiver vazia, o JSON
for inválido ou algum item estiver incompleto (precisa de `id` e `nome` em texto,
`paises` em lista, `tipo` válido e `top`, `ordem`, `a`, `tp`, `tga`, `tgv`
numéricos), vale a lista padrão inteira. Exemplo de uma parada nova (Itália):

```json
{
  "id": "IT", "nome": "FIMI", "paises": ["ITÁLIA"], "tipo": "unidades",
  "top": 50, "ordem": 12, "a": 1, "tp": 100, "tga": 300, "tgv": 300,
  "descricao": "Itália · vendas + streaming"
}
```

- **Taxa 0 desliga a fonte** (nunca divide por zero): ex. `"a": 0` ignora as
  vendas daquela parada.
- `tipo`: `unidades`, `receita` ou `excl` (mundo menos o país).
- `ordem`: posição no seletor (menor aparece primeiro).
- Opcionais: `acr`, `max_por_artista`, `recorrencia` (veja `regras.ts`).
- Para tirar uma parada, grave a lista sem ela.
- O país precisa existir em `pais_peso`, senão a parada é omitida.

Para gravar a chave `paradas` no Console do D1, use SQL com o JSON entre aspas
simples. Dentro do JSON, toda aspa simples (`'`) precisa ser **dobrada** (`''`),
senão o SQL quebra (ex.: `Côte d'Ivoire` vira `Côte d''Ivoire`). Modelo com uma
parada só (lembre: a lista inteira substitui as 12, então inclua todas):

```sql
INSERT INTO chart_config (chave, valor) VALUES ('paradas',
'[{"id":"IT","nome":"FIMI","paises":["ITÁLIA"],"tipo":"unidades","top":50,"ordem":12,"a":1,"tp":100,"tga":300,"tgv":300,"descricao":"Itália · vendas + streaming"},
{"id":"CI","nome":"Top Côte d''Ivoire","paises":["COSTA DO MARFIM"],"tipo":"unidades","top":20,"ordem":13,"a":0,"tp":300,"tga":300,"tgv":300,"descricao":"Costa do Marfim · só streaming"}]')
ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor;
```

## 6. Foco do lançamento

- O dono do single escolhe o foco (país ou GLOBAL) no cadastro. Fica na tabela
  `musica_foco` (`codigo_unico`, `pais`, `desde`, `por_admin`).
- **Vigência:** o foco só vale para semanas **depois** do dia em que foi
  gravado (`desde` estritamente anterior à data do chart). GLOBAL = sem foco.
  Trocar o foco não muda semanas passadas.
- **Trava:** depois de definido, o dono não consegue trocar (erro 409: "Peça à
  administração para alterar"). **Só o admin** troca; a troca vira uma linha
  nova no histórico (ou atualiza a linha do mesmo dia).
- API: `GET /api/musica-foco?codigo=...` (foco atual e se está travado),
  `GET /api/musica-foco/paises` (lista de países), `POST` com `codigo` e `pais`. Gravar **não** limpa o cache
  dos charts: o novo foco só vale para semanas depois de `desde`, ainda não calculadas.

## 7. Por que o passado não muda (e o que ainda muda)

- **Fixo por data:** o sorteio usa a data da semana como parte da chave (hash
  `sorteio01`), então a mesma semana dá sempre o mesmo resultado.
- **Regras gravadas por semana:** ao receber uma semana, o app grava as regras
  em vigor na tabela `chart_regras_semana` (`data`, `versao`, `regras`), uma
  vez só (reenviar a semana não troca). Mudar o `chart_config` afeta só
  semanas que chegarem depois.
- **Semanas ingeridas antes desta mudança não têm linha congelada** em
  `chart_regras_semana`. Reenviar uma dessas semanas congela as regras
  **atuais** do `chart_config` para ela. Por isso: só altere o `chart_config`
  depois de reenviar essas semanas, ou mantenha-o no padrão.
- **Semanas sem linha** em `chart_regras_semana` usam `REGRAS_PADRAO` versão 1,
  que está **congelada no código**. **Nunca edite `REGRAS_PADRAO`**: isso
  mudaria todo o histórico antigo.
- **Fórmula nova** (mudar a conta, não só números): criar `versao` 2 no código
  (novo tipo de regras e leitura por versão), sem tocar na versão 1.
- **O que ainda muda o passado** (porque é dado de entrada, não regra):
  - nacionalidade do artista (`artista_info`);
  - pesos dos países (`pais_peso`).
  Se corrigir um desses, as semanas antigas serão recalculadas na próxima
  leitura. O foco, não: ele só vale daí para frente.
- O resultado calculado de cada semana é guardado em cache (5 minutos para a
  semana mais recente, 24 horas para semanas antigas) e limpo a cada envio.

## 8. Digital Sales e pesos por país

Digital Sales usa, por padrão, **os pesos do Apple Music** que já estão em
`pais_peso`. Se existirem linhas com `plataforma = 'DIGITAL SALES'`, essas
passam a valer. SQL pronto (repita por país; peso é fração, 0,05 = 5%):

```sql
INSERT INTO pais_peso (plataforma, pais, peso) VALUES ('DIGITAL SALES','BRASIL',0.05)
ON CONFLICT(plataforma, pais) DO UPDATE SET peso = excluded.peso;
```

Apagar as linhas de Digital Sales volta ao padrão (pesos do Apple Music). O
nome do país deve estar em CAIXA ALTA igual aos demais de `pais_peso`
(ex.: `AUSTRÁLIA`). Atenção: se for usar pesos próprios, defina para todos os
países, senão os que faltarem ficam de fora.

## 9. Como rodar os testes

Na raiz do repositório:

```
bun test scripts/charts-paises.test.ts
```

Cobre regra C (incluindo os exemplos acima), paradas, regras por semana, foco
e a API.
