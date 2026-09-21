import {
  googleSheetsService,
  readValues,
  normalizeText,
  normalizeComparison,
} from "../services/googleSheetsService";
import { buildCleanItem } from "./empirePlayController";

// Fonte: mesma planilha "premiacoes" usada em Perfil > Premiações
// (premiacoesController.ts), mas aqui é leitura pública/histórica pro botão
// "Awards" em Acervo — cada award tem sua própria aba, listada na aba
// mestre "Awards" (Award | Logo). Layout real das abas de cada award (não é
// o mesmo do premiacoesController.ts, que ficou desatualizado depois que a
// coluna D "Vencedor/Indicado" foi inserida):
// A=Ano | B=Segmento | C=Categoria | D=Vencedor/Indicado | E=Título | F=Artista
const SPREADSHEET_KEY = "premiacoes";
const AWARDS_MASTER_SHEET = "Awards";
const ARTISTAS_SHEET = "ARTISTAS";
const INFOS_ACTS_SHEET = "INFOS ACTS";

// Nunca deixa a página de detalhe do award travada esperando a resolução de
// capa (que lê o catálogo inteiro de Músicas/Álbuns/Artistas) — se essa
// busca auxiliar demorar demais, segue sem capa em vez de travar a resposta
// inteira (o essencial é a lista de vencedores/indicados, não a imagem).
async function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

/**
 * GET /api/awards
 * Lista os awards existentes (nome + foto), direto da aba mestre "Awards" —
 * nunca hardcoded, pra qualquer award novo adicionado lá aparecer sozinho.
 */
export async function getAwardsListController(): Promise<Response> {
  try {
    const rows = await readValues(SPREADSHEET_KEY, AWARDS_MASTER_SHEET, "A:B");
    const data = rows
      .slice(1)
      .map((row) => ({
        nome: normalizeText(row[0]),
        foto: normalizeText(row[1]),
      }))
      .filter((a) => a.nome);

    return jsonResponse({ success: true, data });
  } catch (error: any) {
    return jsonResponse({ success: false, error: error?.message || "Erro ao ler awards." }, 500);
  }
}

// Constrói um mapa "título normalizado" -> capa, lendo Musicas e Albuns da
// planilha principal e reusando buildCleanItem (mesma limpeza de
// título/artista/capa já usada em todo o Empire Play) — evita reimplementar
// a lógica de qual coluna é o título/a capa de verdade em cada aba.
async function buildCapaPorTitulo(): Promise<Map<string, string>> {
  const mapa = new Map<string, string>();
  const abas: Array<"Musicas" | "Albuns"> = ["Musicas", "Albuns"];
  for (const aba of abas) {
    const registros = await googleSheetsService.principal.readSheetObjects(aba).catch(() => []);
    registros.forEach((rec, i) => {
      const item = buildCleanItem(aba, rec, i);
      if (!item.coverUrl) return;
      const chave = normalizeComparison(item.title);
      if (chave && !mapa.has(chave)) mapa.set(chave, item.coverUrl);
    });
  }
  return mapa;
}

// Fallback: foto "oficial" do artista, mesma fonte usada no resto do app
// (aba ARTISTAS, com fallback pra INFOS ACTS quando a própria aba estiver
// sem foto) — ver getAllArtistasController em artistasController.ts.
async function buildFotoPorArtista(): Promise<Map<string, string>> {
  const mapa = new Map<string, string>();
  const rows = await googleSheetsService.usuarios.readValues(ARTISTAS_SHEET).catch(() => []);
  if (rows.length > 1) {
    const headers = rows[0].map((h) => normalizeText(h).toLowerCase());
    const nomeCol = headers.findIndex((h) => h.includes("nome"));
    const fotoCol = headers.findIndex((h) => h.includes("foto"));
    if (nomeCol >= 0 && fotoCol >= 0) {
      rows.slice(1).forEach((row) => {
        const nome = normalizeComparison(row[nomeCol]);
        const foto = normalizeText(row[fotoCol]);
        if (nome && foto && !/^[-—]+$/.test(foto) && !mapa.has(nome)) mapa.set(nome, foto);
      });
    }
  }

  const semFoto = await googleSheetsService.registrosCharts.readValues(INFOS_ACTS_SHEET).catch(() => []);
  semFoto.slice(1).forEach((row) => {
    const nome = normalizeComparison(row[0]);
    const foto = normalizeText(row[2]);
    if (nome && foto && !mapa.has(nome)) mapa.set(nome, foto);
  });

  return mapa;
}

type EntradaFlat = {
  award: string;
  ano: string;
  categoria: string;
  status: "vencedor" | "indicado";
  titulo?: string;
  artista: string;
};

// Lê a aba mestre "Awards" + TODAS as abas individuais listadas nela (nunca
// hardcoded) e devolve só as linhas com resultado de verdade (Artista
// preenchido) — base compartilhada pro agregado por artista (aba "Awards"
// no perfil) e pro badge de vencedor/indicado no Fórum.
async function readAllPremiacoesFlat(): Promise<EntradaFlat[]> {
  const awardsRows = await readValues(SPREADSHEET_KEY, AWARDS_MASTER_SHEET, "A:B");
  const awardNames = awardsRows.slice(1).map((row) => normalizeText(row[0])).filter(Boolean);

  const porAward = await Promise.all(
    awardNames.map(async (award) => {
      const rows = await readValues(SPREADSHEET_KEY, award, "A:F").catch(() => []);
      return rows
        .slice(1)
        .map((row): EntradaFlat | null => {
          const artista = normalizeText(row[5]);
          if (!artista) return null;
          const statusBruto = normalizeComparison(row[3]);
          const vencedor = statusBruto.includes("vencedor") || !statusBruto;
          return {
            award,
            ano: normalizeText(row[0]),
            categoria: normalizeText(row[2]),
            status: vencedor ? "vencedor" : "indicado",
            titulo: normalizeText(row[4]) || undefined,
            artista,
          };
        })
        .filter((e): e is EntradaFlat => !!e);
    }),
  );

  return porAward.flat();
}

// Um crédito de "Artista" pode ser uma combinação ("SA5M & Moon Girls",
// "Anníbal Páris feat. Karol Morris") — separa em partes pra contar a
// indicação/vitória também pro nome que aparece só como participante.
function partesDoArtista(artista: string): string[] {
  return artista
    .split(/,|&| feat\.?| ft\.?| e /i)
    .map((p) => normalizeComparison(p))
    .filter(Boolean);
}

/**
 * GET /api/awards/artista?nome=Rayna
 * Agregado de premiações de um artista: total de indicações, total de
 * vitórias, e o detalhamento por award — pra aba "Awards" no perfil.
 */
export async function getArtistAwardsController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const nome = (url.searchParams.get("nome") || "").trim();
  if (!nome) {
    return jsonResponse({ success: false, error: "Parâmetro 'nome' é obrigatório." }, 400);
  }

  try {
    const normNome = normalizeComparison(nome);
    const todas = await readAllPremiacoesFlat();
    const doArtista = todas.filter((e) => partesDoArtista(e.artista).includes(normNome));

    const porAward = new Map<string, { award: string; indicacoes: number; vencedor: number }>();
    for (const e of doArtista) {
      if (!porAward.has(e.award)) porAward.set(e.award, { award: e.award, indicacoes: 0, vencedor: 0 });
      const acc = porAward.get(e.award)!;
      acc.indicacoes++;
      if (e.status === "vencedor") acc.vencedor++;
    }

    return jsonResponse({
      success: true,
      data: {
        totalIndicacoes: doArtista.length,
        totalVencedor: doArtista.filter((e) => e.status === "vencedor").length,
        porAward: Array.from(porAward.values()).sort((a, b) => b.indicacoes - a.indicacoes),
        detalhes: doArtista,
      },
    });
  } catch (error: any) {
    return jsonResponse({ success: false, error: error?.message || "Erro ao ler premiações do artista." }, 500);
  }
}

/**
 * GET /api/awards/todos
 * Lista achatada de todo resultado premiado (todas as abas) — usada pelo
 * Fórum pra casar cada tópico/material com seu badge de vencedor/indicado,
 * sem precisar de 1 requisição por tópico.
 */
export async function getAwardsFlatController(): Promise<Response> {
  try {
    const data = await readAllPremiacoesFlat();
    return jsonResponse({ success: true, data });
  } catch (error: any) {
    return jsonResponse({ success: false, error: error?.message || "Erro ao ler premiações." }, 500);
  }
}

/**
 * GET /api/awards/detalhe?nome=Grammy%20Awards
 * Histórico completo de um award: linhas agrupadas por ano (mais recente
 * primeiro), cada uma já com status (vencedor/indicado) e capa resolvida
 * (capa da música/álbum quando encontrada, senão foto do artista). Linhas
 * sem título nem artista preenchido (categoria ainda sem resultado
 * cadastrado) não entram — "o que estiver sem informação, não precisa ser
 * exibido".
 */
export async function getAwardDetalheController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const nome = (url.searchParams.get("nome") || "").trim();
  if (!nome) {
    return jsonResponse({ success: false, error: "Parâmetro 'nome' é obrigatório." }, 400);
  }

  try {
    const [awardsRows, tabRows, capaPorTitulo, fotoPorArtista] = await Promise.all([
      readValues(SPREADSHEET_KEY, AWARDS_MASTER_SHEET, "A:B"),
      readValues(SPREADSHEET_KEY, nome, "A:F").catch(() => null),
      withTimeout(buildCapaPorTitulo().catch(() => new Map<string, string>()), 6000, new Map<string, string>()),
      withTimeout(buildFotoPorArtista().catch(() => new Map<string, string>()), 6000, new Map<string, string>()),
    ]);

    const awardInfo = awardsRows
      .slice(1)
      .map((row) => ({ nome: normalizeText(row[0]), foto: normalizeText(row[1]) }))
      .find((a) => normalizeComparison(a.nome) === normalizeComparison(nome));

    if (!awardInfo) {
      return jsonResponse({ success: false, error: "Award não encontrado." }, 404);
    }
    if (!tabRows) {
      return jsonResponse({ success: false, error: "Aba do award não encontrada." }, 404);
    }

    const entradas = tabRows
      .slice(1)
      .map((row) => {
        const ano = normalizeText(row[0]);
        const segmento = normalizeText(row[1]);
        const categoria = normalizeText(row[2]);
        const statusBruto = normalizeComparison(row[3]);
        const titulo = normalizeText(row[4]);
        const artista = normalizeText(row[5]);
        if (!titulo && !artista) return null;

        const vencedor = statusBruto.includes("vencedor") || !statusBruto;
        let capa = titulo ? capaPorTitulo.get(normalizeComparison(titulo)) || "" : "";
        if (!capa && artista) capa = fotoPorArtista.get(normalizeComparison(artista)) || "";

        return {
          ano,
          segmento: segmento || undefined,
          categoria,
          status: vencedor ? "vencedor" : "indicado",
          titulo: titulo || undefined,
          artista: artista || undefined,
          capa: capa || undefined,
        };
      })
      .filter((e): e is NonNullable<typeof e> => !!e && !!e.categoria);

    const porAno = new Map<string, typeof entradas>();
    for (const entrada of entradas) {
      const chave = entrada.ano || "—";
      if (!porAno.has(chave)) porAno.set(chave, []);
      porAno.get(chave)!.push(entrada);
    }
    const anos = Array.from(porAno.keys()).sort((a, b) => Number(b) - Number(a) || b.localeCompare(a));
    const edicoes = anos.map((ano) => ({ ano, categorias: porAno.get(ano)! }));

    return jsonResponse({
      success: true,
      data: { nome: awardInfo.nome, foto: awardInfo.foto || undefined, edicoes },
    });
  } catch (error: any) {
    return jsonResponse({ success: false, error: error?.message || "Erro ao ler award." }, 500);
  }
}
