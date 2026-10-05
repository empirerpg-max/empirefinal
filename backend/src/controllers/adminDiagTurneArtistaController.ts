import { googleSheetsService, normalizeText, normalizeComparison } from "../services/googleSheetsService";

// Diagnóstico pontual (só leitura): investigar por que a Fortuna Turnês de
// um artista específico não foi creditada — devolve, pra cada turnê dele
// em CONTROLE_TOURS, os campos que decidem se/quando o crédito dispara
// (status gravado vs. o que statusDinamico calcularia agora, datas,
// arrecadação em tempo real, se tem capa/é "sistema novo"), mais o valor
// atual de fortuna_turnes/fortuna_total na aba ARTISTAS.
const TOURS_SHEET = "CONTROLE_TOURS";
const ARTISTAS_SHEET = "ARTISTAS";

const TOUR_HEADERS = [
  "id_usuario",
  "artista",
  "id_unico",
  "nome_da_turne",
  "porte",
  "total_de_shows",
  "data_inicio",
  "data_termino",
  "agenda",
  "arrecadacao_em_tempo_real",
  "status",
  "show_atual",
  "show_anterior",
  "capa",
  "meta_de_lucro",
] as const;

function parseNumeroBR(v: string): number {
  const cleaned = normalizeText(v).replace(/\./g, "").replace(",", ".");
  return parseFloat(cleaned) || 0;
}

function parseDataBR(s: string): Date | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec((s || "").trim());
  if (!m) return null;
  const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  return Number.isNaN(d.getTime()) ? null : d;
}

function agoraBrasilia(): Date {
  return new Date(Date.now() - 3 * 60 * 60 * 1000);
}

function formatDataBR(d: Date): string {
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

export async function adminDiagTurneArtistaController(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const artista = (url.searchParams.get("artista") || "").trim();
  if (!artista) {
    return new Response(JSON.stringify({ success: false, error: "artista é obrigatório." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  const normAlvo = normalizeComparison(artista);

  const [tourRows, artistaRows] = await Promise.all([
    googleSheetsService.usuarios.readValues(TOURS_SHEET).catch(() => []),
    googleSheetsService.usuarios.readValues(ARTISTAS_SHEET).catch(() => []),
  ]);

  const get = (row: string[], key: (typeof TOUR_HEADERS)[number]) =>
    normalizeText(row[TOUR_HEADERS.indexOf(key)]);

  const hojeStr = formatDataBR(agoraBrasilia());
  const hoje = parseDataBR(hojeStr);

  const turnes = tourRows
    .slice(1)
    .map((row, i) => ({ row, linha: i + 2 }))
    .filter(({ row }) => normalizeComparison(get(row, "artista")) === normAlvo)
    .map(({ row, linha }) => {
      const capaUrl = get(row, "capa");
      const sistemaNovo = !!capaUrl;
      const dataInicio = get(row, "data_inicio");
      const dataTermino = get(row, "data_termino");
      const inicio = parseDataBR(dataInicio);
      const termino = parseDataBR(dataTermino);
      const statusGravado = get(row, "status");

      let statusDinamicoCalculado: string;
      if (!sistemaNovo) {
        statusDinamicoCalculado = "Finalizada (sistema antigo — sempre conta como finalizada)";
      } else if (!hoje || !inicio || !termino) {
        statusDinamicoCalculado = `${statusGravado || "Planejando"} (datas inválidas pra calcular: inicio="${dataInicio}" termino="${dataTermino}")`;
      } else if (hoje < inicio) {
        statusDinamicoCalculado = "Planejando";
      } else if (hoje > termino) {
        statusDinamicoCalculado = "Finalizada";
      } else {
        statusDinamicoCalculado = "Em andamento";
      }

      const arrecadacaoTempoReal = parseNumeroBR(get(row, "arrecadacao_em_tempo_real"));

      return {
        linha,
        idUnico: get(row, "id_unico"),
        nomeTurne: get(row, "nome_da_turne"),
        sistemaNovo,
        statusGravadoNaPlanilha: statusGravado,
        dataInicio,
        dataTermino,
        hojeUsadoNoCalculo: hojeStr,
        statusDinamicoCalculadoAgora: statusDinamicoCalculado,
        arrecadacaoTempoReal,
        valorQueSeriaCreditado65pct: arrecadacaoTempoReal * 0.65,
        jaDeveriaTerCreditado:
          sistemaNovo && statusGravado === "Finalizada" && arrecadacaoTempoReal > 0,
      };
    });

  const artistaHeaders = artistaRows[0] || [];
  const idxNome = artistaHeaders.findIndex((h) => normalizeComparison(h) === normalizeComparison("Nome"));
  const idxFortunaTurnes = artistaHeaders.findIndex(
    (h) => normalizeComparison(h).replace(/\s+/g, "_") === "fortuna_turnes",
  );
  const idxFortunaTotal = artistaHeaders.findIndex(
    (h) => normalizeComparison(h).replace(/\s+/g, "_") === "fortuna_total",
  );
  const linhaArtista = artistaRows
    .slice(1)
    .find((r) => normalizeComparison(r[idxNome >= 0 ? idxNome : 0]) === normAlvo);

  return new Response(
    JSON.stringify(
      {
        success: true,
        data: {
          artista,
          turnes,
          artistasSheetHeaders: artistaHeaders,
          fortunaTurnesAtual: linhaArtista && idxFortunaTurnes >= 0 ? linhaArtista[idxFortunaTurnes] : null,
          fortunaTotalAtual: linhaArtista && idxFortunaTotal >= 0 ? linhaArtista[idxFortunaTotal] : null,
        },
      },
      null,
      2,
    ),
    { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
}
