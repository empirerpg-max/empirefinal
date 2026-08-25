import {
  googleSheetsService,
  normalizeHeader,
  normalizeText,
  normalizeComparison,
  dedupeHeaders,
} from "../services/googleSheetsService";

const ARTISTAS_SHEET = "ARTISTAS";
const USUARIOS_SHEET = "Usuários";

// Planilha usa "2.019.325,96" (ponto como separador de milhar) — mesmo
// parser usado no resto do backend pra números em formato BR.
function parseNumeroBR(v: string): number {
  const cleaned = normalizeText(v).replace(/\./g, "").replace(",", ".");
  return parseFloat(cleaned) || 0;
}

/**
 * Resolve um "usuario" (login) pro ID (telegram_id histórico), via a aba
 * Usuários — usado só quando a chamada vem com `usuario` em vez de
 * `telegramId` direto.
 */
async function resolveIdByUsuario(usuario: string): Promise<string> {
  const rawRows = await googleSheetsService.usuarios.readValues(USUARIOS_SHEET).catch(() => []);
  if (!rawRows || rawRows.length < 2) return "";
  const headers = dedupeHeaders(
    USUARIOS_SHEET,
    rawRows[0].map((h, i) => normalizeHeader(h) || `coluna_${i + 1}`),
  );
  const usuarioCol = headers.indexOf("usuario");
  const nomeCol = headers.indexOf("nome");
  const idCol = headers.indexOf("id");
  if (idCol === -1 || (usuarioCol === -1 && nomeCol === -1)) return "";
  const normUsuario = normalizeComparison(usuario);
  const row = rawRows
    .slice(1)
    .find(
      (r) =>
        (usuarioCol !== -1 && normalizeComparison(r[usuarioCol]) === normUsuario) ||
        (nomeCol !== -1 && normalizeComparison(r[nomeCol]) === normUsuario),
    );
  return row ? normalizeText(row[idCol]) : "";
}

/**
 * Lê a aba "ARTISTAS" da planilha "Usuários" (nova fonte de verdade da
 * associação artista↔dono, substituindo o Apps Script legado que lê de
 * outra planilha e estava com dados incorretos/desatualizados). O dono de
 * cada artista é a coluna "ID Usuário" (telegram_id) — direto, sem precisar
 * de nome. Devolve pares [nomeDoArtista, idDoDono].
 */
async function readArtistOwnerPairs(): Promise<[string, string][]> {
  const rawRows = await googleSheetsService.usuarios.readValues(ARTISTAS_SHEET).catch(() => []);
  if (!rawRows || rawRows.length < 2) return [];

  const headers = dedupeHeaders(
    ARTISTAS_SHEET,
    rawRows[0].map((h, i) => normalizeHeader(h) || `coluna_${i + 1}`),
  );
  const artCol = headers.indexOf("nome");
  const ownerCol = headers.indexOf("id_usuario");
  if (artCol === -1 || ownerCol === -1) return [];

  const pairs: [string, string][] = [];
  for (const row of rawRows.slice(1)) {
    const artista = normalizeText(row[artCol]);
    const dono = normalizeText(row[ownerCol]);
    if (artista && dono) pairs.push([artista, dono]);
  }
  return pairs;
}

/**
 * GET /api/artistas/meus-nomes?telegramId=... ou ?usuario=NomeOuUsuarioDoLogin
 * Devolve só os NOMES dos artistas do jogador logado — a lista completa de
 * cada artista continua vindo do Apps Script legado (/listar_todos), o
 * frontend cruza os dois. `usuario`, quando vier sem `telegramId`, é
 * resolvido pro ID via a aba Usuários antes de casar com ARTISTAS.
 */
/**
 * Nomes dos artistas de um dono, direto da aba ARTISTAS (fonte de verdade).
 * Reaproveitada por qualquer feature que precise saber "quais artistas são
 * meus" a partir de um telegram_id (ex.: Ponto).
 */
// Caminho inverso de getArtistNamesForOwner: dado o nome do artista,
// devolve o telegram_id do dono — usado pra vincular conteúdo criado
// internamente (ex: migração de álbuns legados) ao dono de verdade, senão
// ele nunca aparece como editável pro jogador certo.
export async function getOwnerIdForArtist(nomeArtista: string): Promise<string> {
  if (!nomeArtista) return "";
  const normNome = normalizeComparison(nomeArtista);
  const pairs = await readArtistOwnerPairs();
  const match = pairs.find(([artista]) => normalizeComparison(artista) === normNome);
  return match?.[1] || "";
}

// Soma `valor` na coluna "Fortuna Turnês" do artista (nunca sobrescreve —
// acumula em cima do que já tiver lá). Usada quando uma turnê é finalizada,
// pra creditar o corte do jogo em cima do arrecadado.
export async function creditarFortunaTurnes(nomeArtista: string, valor: number): Promise<void> {
  if (!nomeArtista || !valor) return;
  const rows = await readArtistasRows();
  const normNome = normalizeComparison(nomeArtista);
  const row = rows.find((r) => normalizeComparison(r.rec["nome"]) === normNome);
  if (!row) return;
  const atual = parseNumeroBR(row.rec["fortuna_turnes"] || "0");
  const novo = atual + valor;
  const col = colIndexToA1Letter(row.headers.indexOf("fortuna_turnes"));
  const novoFormatado = novo.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  await googleSheetsService.usuarios
    .updateValues(ARTISTAS_SHEET, `${col}${row.rowIndex}`, [[novoFormatado]])
    .catch(() => {});
}

export async function getArtistNamesForOwner(telegramId: string): Promise<string[]> {
  if (!telegramId) return [];
  const normId = normalizeComparison(telegramId);
  const pairs = await readArtistOwnerPairs();
  return Array.from(
    new Set(pairs.filter(([, dono]) => normalizeComparison(dono) === normId).map(([artista]) => artista)),
  );
}

function colIndexToA1Letter(colIndex: number): string {
  let temp = colIndex;
  let letter = "";
  while (temp >= 0) {
    letter = String.fromCharCode((temp % 26) + 65) + letter;
    temp = Math.floor(temp / 26) - 1;
  }
  return letter;
}

interface ArtistasRow {
  rec: Record<string, string>;
  rowIndex: number;
  headers: string[];
}

async function readArtistasRows(): Promise<ArtistasRow[]> {
  const rawRows = await googleSheetsService.usuarios.readValues(ARTISTAS_SHEET).catch(() => []);
  if (!rawRows || rawRows.length < 2) return [];
  const headers = dedupeHeaders(
    ARTISTAS_SHEET,
    rawRows[0].map((h, i) => normalizeHeader(h) || `coluna_${i + 1}`),
  );
  const out: ArtistasRow[] = [];
  rawRows.slice(1).forEach((row, i) => {
    if (!row.some((cell) => normalizeText(cell))) return;
    const rec: Record<string, string> = {};
    headers.forEach((h, hi) => {
      rec[h] = normalizeText(row[hi]);
    });
    out.push({ rec, rowIndex: i + 2, headers });
  });
  return out;
}

/**
 * GET /api/artistas/disponiveis
 * Artistas da aba ARTISTAS sem dono (coluna "ID Usuário" vazia) — candidatos
 * a vínculo. Cada artista livre já existe como linha própria na aba (não
 * precisa criar linha nova pra vincular, só preencher o dono).
 */
export async function getArtistasDisponiveisController(): Promise<Response> {
  try {
    const rows = await readArtistasRows();
    const disponiveis = rows
      .filter((r) => r.rec["nome"] && !r.rec["id_usuario"])
      .map((r) => ({
        nome: r.rec["nome"],
        foto: r.rec["foto"] || "",
        gravadora: r.rec["gravadora"] || "",
      }));
    return new Response(JSON.stringify({ success: true, data: disponiveis }), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  } catch (error: any) {
    console.error("[getArtistasDisponiveisController] Erro:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message || "Erro ao listar artistas disponíveis." }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}

export interface VincularArtistaBody {
  nome: string;
  telegramId: string;
}

/**
 * POST /api/artistas/vincular
 * Vincula um artista SEM dono (linha já existe na aba ARTISTAS) ao jogador —
 * preenche "ID Usuário" e recalcula "ID_unico" (padrão Nome+ID já usado nas
 * linhas vinculadas). Recusa se o artista já tiver dono, pra nunca roubar
 * vínculo de outro jogador.
 */
export async function vincularArtistaController(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as VincularArtistaBody;
    const nome = (body.nome || "").trim();
    const telegramId = (body.telegramId || "").trim();

    if (!nome || !telegramId) {
      return new Response(JSON.stringify({ ok: false, erro: "nome e telegramId são obrigatórios." }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const rows = await readArtistasRows();
    const normNome = normalizeComparison(nome);
    const match = rows.find((r) => normalizeComparison(r.rec["nome"]) === normNome);

    if (!match) {
      return new Response(JSON.stringify({ ok: false, erro: "Artista não encontrado." }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (match.rec["id_usuario"]) {
      return new Response(JSON.stringify({ ok: false, erro: "Esse artista já tem dono." }), {
        status: 409,
        headers: { "Content-Type": "application/json" },
      });
    }

    const idUsuarioCol = match.headers.indexOf("id_usuario");
    const idUnicoCol = match.headers.indexOf("id_unico");
    if (idUsuarioCol === -1) {
      return new Response(
        JSON.stringify({ ok: false, erro: "Coluna 'ID Usuário' não encontrada na aba ARTISTAS." }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }

    await googleSheetsService.usuarios.updateValues(
      ARTISTAS_SHEET,
      `${colIndexToA1Letter(idUsuarioCol)}${match.rowIndex}`,
      [[telegramId]],
    );
    if (idUnicoCol !== -1) {
      await googleSheetsService.usuarios.updateValues(
        ARTISTAS_SHEET,
        `${colIndexToA1Letter(idUnicoCol)}${match.rowIndex}`,
        [[`${match.rec["nome"]}${telegramId}`]],
      );
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("[vincularArtistaController] Erro:", error);
    return new Response(JSON.stringify({ ok: false, erro: error.message || "Erro ao vincular artista." }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

export interface CriarArtistaBody {
  nome: string;
  foto: string;
  gravadora: string;
  telegramId: string;
}

/**
 * POST /api/artistas/criar
 * Cria um artista novo (que ainda não existe na aba ARTISTAS) já vinculado
 * ao jogador que criou. Recusa nome duplicado, pra não colidir com um
 * artista já existente (vinculado ou livre).
 */
export async function criarArtistaController(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as CriarArtistaBody;
    const nome = (body.nome || "").trim();
    const gravadora = (body.gravadora || "").trim();
    const foto = (body.foto || "").trim();
    const telegramId = (body.telegramId || "").trim();

    if (!nome || !gravadora || !telegramId) {
      return new Response(
        JSON.stringify({ ok: false, erro: "nome, gravadora e telegramId são obrigatórios." }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    const rows = await readArtistasRows();
    const normNome = normalizeComparison(nome);
    if (rows.some((r) => normalizeComparison(r.rec["nome"]) === normNome)) {
      return new Response(JSON.stringify({ ok: false, erro: "Já existe um artista com esse nome." }), {
        status: 409,
        headers: { "Content-Type": "application/json" },
      });
    }

    const headers =
      rows[0]?.headers ||
      [
        "nome",
        "foto",
        "status",
        "saldo",
        "gravadora",
        "fortuna_real",
        "fortuna_de_bens",
        "fortuna_total",
        "prestigio",
        "fadiga",
        "id_usuario",
        "data_contrato",
        "meses_contrato",
        "multa",
        "fortuna_calculo",
        "id_unico",
      ];
    const values: Record<string, string> = {
      nome,
      foto,
      gravadora,
      id_usuario: telegramId,
      id_unico: `${nome}${telegramId}`,
    };
    const row = headers.map((h) => values[h] ?? "");

    await googleSheetsService.usuarios.appendRow(ARTISTAS_SHEET, row);
    await registrarGravadoraNoBancoDeDados(nome, gravadora);

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("[criarArtistaController] Erro:", error);
    return new Response(JSON.stringify({ ok: false, erro: error.message || "Erro ao criar artista." }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

const BANCO_DADOS_ARTISTAS_SHEET = "Banco de Dados Artistas";

// Além da aba ARTISTAS (planilha de usuários, dono do vínculo com o
// jogador), a gravadora escolhida na criação também precisa aparecer em
// "Banco de Dados Artistas" (planilha edicaoCharts) — coluna A = nome do
// artista, coluna B = gravadora. Atualiza a linha se o artista já existir
// lá, senão cria uma nova.
async function registrarGravadoraNoBancoDeDados(nome: string, gravadora: string): Promise<void> {
  try {
    const rows = await googleSheetsService.edicaoCharts.readValues(BANCO_DADOS_ARTISTAS_SHEET, "A2:A5000");
    const normNome = normalizeComparison(nome);
    let linhaExistente = -1;
    for (let i = 0; i < rows.length; i++) {
      if (normalizeComparison(rows[i]?.[0]) === normNome) {
        linhaExistente = i + 2;
        break;
      }
    }
    if (linhaExistente !== -1) {
      await googleSheetsService.edicaoCharts.updateValues(
        BANCO_DADOS_ARTISTAS_SHEET,
        `B${linhaExistente}`,
        [[gravadora]],
      );
      return;
    }
    // Mesmo padrão de "computar a próxima linha vazia via coluna-âncora e
    // gravar com updateValues" usado em EDIÇÃO CHARTS — :append nessa
    // planilha (edicaoCharts) já se mostrou pouco confiável pra achar a
    // linha real quando há colunas distantes preenchidas por fórmula.
    let ultimaLinhaComNome = 1; // linha 1 = cabeçalho
    for (let i = 0; i < rows.length; i++) {
      if ((rows[i]?.[0] || "").trim()) ultimaLinhaComNome = i + 2;
    }
    const linhaAlvo = ultimaLinhaComNome + 1;
    await googleSheetsService.edicaoCharts.updateValues(BANCO_DADOS_ARTISTAS_SHEET, `A${linhaAlvo}:B${linhaAlvo}`, [
      [nome, gravadora],
    ]);
  } catch (err) {
    console.warn("[registrarGravadoraNoBancoDeDados] Erro ao gravar em Banco de Dados Artistas:", err);
  }
}

const INFOS_ACTS_SHEET = "INFOS ACTS";

/**
 * GET /api/artistas/infos?nome=<nome>
 * Biografia (e foto "de origem") do artista — vive numa aba própria
 * ("INFOS ACTS", planilha registrosCharts): A nome | C foto | E biografia.
 * O dono do artista edita a biografia direto nessa aba (não tem tela de
 * edição no app pra isso — só leitura aqui). O upload de foto novo (quando
 * existir essa feature) deve gravar em F, não em C.
 */
export async function getArtistInfoController(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const nome = normalizeText(url.searchParams.get("nome"));
    if (!nome) {
      return new Response(JSON.stringify({ success: false, error: "nome é obrigatório." }), {
        status: 400,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }

    const rows = await googleSheetsService.registrosCharts.readValues(INFOS_ACTS_SHEET).catch(() => []);
    const normNome = normalizeComparison(nome);
    const row = rows.slice(1).find((r) => normalizeComparison(r[0]) === normNome);

    return new Response(
      JSON.stringify({
        success: true,
        data: {
          foto: row ? normalizeText(row[2]) : "",
          biografia: row ? normalizeText(row[4]) : "",
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
    );
  } catch (error: any) {
    console.error("[getArtistInfoController] Erro:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message || "Erro ao buscar informações do artista." }),
      { status: 500, headers: { "Content-Type": "application/json; charset=utf-8" } },
    );
  }
}

/**
 * POST /api/artistas/foto
 * Grava o link do novo upload de foto do artista na coluna I da aba
 * "INFOS ACTS" — é literalmente o campo com esse propósito na planilha
 * ("Caso deseje uma nova capa pro seu act, insira no seu Google Drive >
 * Clique em Compartilhar > Insira o link aqui"). Nunca sobrescreve a
 * coluna C (foto "oficial", editada à mão pelo dono/admin direto na
 * planilha) nem a F/F1 (flags de admin, não é campo de link). Cria a linha
 * se o artista ainda não tiver uma nessa aba.
 */
export async function setArtistFotoController(request: Request): Promise<Response> {
  try {
    const body = (await request.json().catch(() => ({}))) as { nome?: string; fotoUrl?: string };
    const nome = (body.nome || "").trim();
    const fotoUrl = (body.fotoUrl || "").trim();
    if (!nome || !fotoUrl) {
      return new Response(JSON.stringify({ success: false, error: "nome e fotoUrl são obrigatórios." }), {
        status: 400,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }

    const rows = await googleSheetsService.registrosCharts.readValues(INFOS_ACTS_SHEET).catch(() => []);
    const normNome = normalizeComparison(nome);
    const rowIndex = rows.findIndex((r, i) => i > 0 && normalizeComparison(r[0]) === normNome);

    if (rowIndex !== -1) {
      await googleSheetsService.registrosCharts.updateValues(INFOS_ACTS_SHEET, `I${rowIndex + 1}`, [[fotoUrl]]);
    } else {
      await googleSheetsService.registrosCharts.appendRow(INFOS_ACTS_SHEET, [
        nome, "", "", "", "", "", "", "", fotoUrl,
      ]);
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  } catch (error: any) {
    console.error("[setArtistFotoController] Erro:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message || "Erro ao gravar foto do artista." }),
      { status: 500, headers: { "Content-Type": "application/json; charset=utf-8" } },
    );
  }
}

/**
 * GET /api/artistas/listar-todos
 * Substitui o `listar_todos` do Apps Script legado — lê a aba ARTISTAS
 * (mesma fonte já usada pra posse/vínculo) e devolve todo mundo com os
 * mesmos campos que o front espera (ver `normalizeArtist` em src/lib/api.ts).
 * Colunas que não existem na aba (seguidores, vendas_total, descricao,
 * genero, pais) saem vazias/zeradas — o front já trata isso como padrão.
 */
export async function getAllArtistasController(): Promise<Response> {
  try {
    const rows = await readArtistasRows();
    // A coluna "foto" da aba costuma vir com "-" como placeholder de "vazio"
    // (em vez de célula em branco) — sem tratar isso como vazio, o fallback
    // pra INFOS ACTS logo abaixo nunca disparava.
    const fotoValida = (v: string) => (/^[-—]+$/.test(v.trim()) ? "" : v);
    const mapped = rows
      .filter((r) => r.rec["nome"])
      .map((r) => ({
        nome: r.rec["nome"],
        foto: fotoValida(r.rec["foto"] || ""),
        status: r.rec["status"] || "Livre",
        saldo: r.rec["saldo"] || "0",
        gravadora: r.rec["gravadora"] || "Independent",
        fortuna_vendas: r.rec["fortuna_vendas"] || "",
        fortuna_turnes: r.rec["fortuna_turnes"] || "",
        fortuna_total: r.rec["fortuna_total"] || "",
        prestigio: r.rec["prestigio"] || "0",
        fadiga: r.rec["fadiga"] || "0",
        seguidores: r.rec["seguidores"] || "0",
        vendas_total: r.rec["vendas_total"] || "0",
        telegram_id: r.rec["id_usuario"] || "",
        descricao: r.rec["descricao"] || "",
        genero: r.rec["genero"] || "",
        pais: r.rec["pais"] || "",
      }));

    // A aba ARTISTAS tem algumas linhas duplicadas pro mesmo artista (nome
    // repetido, geralmente uma linha "quebrada"/desatualizada ao lado da
    // linha certa) — sem isso, o mesmo artista aparecia várias vezes na
    // lista e na busca. Mantém só uma linha por nome: a que tiver o maior
    // "Fortuna Total" (a mais completa/atualizada).
    // normalizeComparison só dá trim() nas pontas — linhas duplicadas na
    // planilha continuavam contando como nomes diferentes quando tinham
    // espaço duplo, espaço não-quebrável (copiar/colar de outro lugar) ou
    // caractere invisível no meio do nome ("Jessica  Johnson" com 2
    // espaços, por exemplo). Aqui colapsa qualquer sequência de espaço em
    // branco (normal ou não) pra um espaço só, garantindo que essas
    // variações batam como o mesmo artista.
    const chaveDedupe = (nome: string) =>
      normalizeComparison(nome)
        .replace(/[\u200B-\u200D\uFEFF]/g, "") // caracteres invisiveis (zero-width)
        .replace(/\s+/g, " ")
        .trim();

    // "Mais completa" não é só quem tem mais fortuna — uma linha duplicada
    // pode ter fortuna maior só por coincidência de cálculo e ainda assim
    // estar com a foto/dono em branco (foi o caso do SA5M: a linha mantida
    // tinha mais fortuna, mas sem foto, então o perfil aparecia com imagem
    // quebrada). Prioriza ter foto e dono preenchidos antes de olhar pra
    // fortuna.
    const pontuacaoCompletude = (a: (typeof mapped)[number]) =>
      (a.foto.trim() ? 2 : 0) + (a.telegram_id.trim() ? 1 : 0);

    const porNome = new Map<string, (typeof mapped)[number]>();
    for (const artista of mapped) {
      const chave = chaveDedupe(artista.nome);
      const atual = porNome.get(chave);
      if (!atual) {
        porNome.set(chave, artista);
        continue;
      }
      const pontosNovo = pontuacaoCompletude(artista);
      const pontosAtual = pontuacaoCompletude(atual);
      if (
        pontosNovo > pontosAtual ||
        (pontosNovo === pontosAtual && parseNumeroBR(artista.fortuna_total) > parseNumeroBR(atual.fortuna_total))
      ) {
        porNome.set(chave, artista);
      }
    }
    let data = Array.from(porNome.values());

    // A coluna "foto" da própria aba ARTISTAS é esparsa — a foto "oficial",
    // mantida pelo dono do artista, vive em INFOS ACTS (planilha
    // registrosCharts, ver getArtistInfoController). O antigo Apps Script
    // legado usava essa fonte mais completa; a migração pro backend Cloudflare
    // passou a ler só ARTISTAS!foto, deixando vários artistas sem imagem.
    // Preenche aqui o que faltar, sem sobrescrever quem já tem foto na
    // própria aba.
    const semFoto = data.filter((a) => !a.foto.trim());
    if (semFoto.length > 0) {
      const infosRows = await googleSheetsService.registrosCharts.readValues(INFOS_ACTS_SHEET).catch(() => []);
      const fotoPorNome = new Map<string, string>();
      for (const row of infosRows.slice(1)) {
        const nome = normalizeComparison(row[0]);
        const foto = normalizeText(row[2]);
        if (nome && foto && !fotoPorNome.has(nome)) fotoPorNome.set(nome, foto);
      }
      data = data.map((a) =>
        a.foto.trim() ? a : { ...a, foto: fotoPorNome.get(normalizeComparison(a.nome)) || "" },
      );
    }

    return new Response(JSON.stringify({ success: true, data }), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  } catch (error: any) {
    console.error("[getAllArtistasController] Erro:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message || "Erro ao listar artistas." }),
      { status: 500, headers: { "Content-Type": "application/json; charset=utf-8" } },
    );
  }
}

export interface RescisaoBody {
  nome: string;
  destino: string;
}

/**
 * POST /api/artistas/rescisao
 * Substitui o `acao: "rescisao"` do Apps Script legado — rescinde o contrato
 * do artista com a gravadora atual, gravando o "destino" (nova gravadora,
 * geralmente "Independent") direto na coluna "gravadora" da aba ARTISTAS.
 */
export async function rescisaoController(request: Request): Promise<Response> {
  try {
    const body = (await request.json().catch(() => ({}))) as RescisaoBody;
    const nome = (body.nome || "").trim();
    const destino = (body.destino || "").trim();

    if (!nome || !destino) {
      return new Response(JSON.stringify({ ok: false, erro: "nome e destino são obrigatórios." }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const rows = await readArtistasRows();
    const normNome = normalizeComparison(nome);
    const match = rows.find((r) => normalizeComparison(r.rec["nome"]) === normNome);
    if (!match) {
      return new Response(JSON.stringify({ ok: false, erro: "Artista não encontrado." }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    const gravadoraCol = match.headers.indexOf("gravadora");
    if (gravadoraCol === -1) {
      return new Response(
        JSON.stringify({ ok: false, erro: "Coluna 'gravadora' não encontrada na aba ARTISTAS." }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }

    await googleSheetsService.usuarios.updateValues(
      ARTISTAS_SHEET,
      `${colIndexToA1Letter(gravadoraCol)}${match.rowIndex}`,
      [[destino]],
    );

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("[rescisaoController] Erro:", error);
    return new Response(JSON.stringify({ ok: false, erro: error.message || "Erro ao processar rescisão." }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

export async function getMeusArtistasNomesController(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    let telegramId = normalizeText(url.searchParams.get("telegramId"));
    const usuario = normalizeText(url.searchParams.get("usuario") || url.searchParams.get("nome"));

    if (!telegramId && usuario) {
      telegramId = await resolveIdByUsuario(usuario);
    }

    if (!telegramId) {
      return new Response(JSON.stringify({ success: true, data: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }

    const nomes = await getArtistNamesForOwner(telegramId);

    return new Response(JSON.stringify({ success: true, data: nomes }), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  } catch (error: any) {
    console.error("[getMeusArtistasNomesController] Erro:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message || "Erro ao buscar meus artistas." }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}
