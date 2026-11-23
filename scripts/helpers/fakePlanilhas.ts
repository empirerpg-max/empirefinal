// Planilhas falsas em memória + DepsEscrita falso para os testes do pre-save
// em passos (executores e motor). Imita só o que importa:
// - Musicas: append na próxima linha (rows.length+1);
// - EDIÇÃO CHARTS: append depois da última linha com título (B), e o Código
//   único é POSICIONAL: "EMP" + (linha-1) com 3 dígitos (fórmula BD real);
// - Albuns / EDIÇÃO CHARTS ÁLBUMS / REGISTRO DE MÚSICA / PreSave_Album.
// `falhas` deixa um teste fazer uma operação lançar (uma vez ou sempre).
import type { DepsEscrita } from "../../backend/src/controllers/presaveLancamento/executores";

type Aba = string[][]; // índice 0 = linha 1
export const norm = (v: unknown) =>
  String(v ?? "").trim().normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ");

const COLS = (letras: string) => letras.split("").reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0) - 1;
function parseRange(range?: string): { r0: number; c0: number; r1: number | null } {
  if (!range) return { r0: 1, c0: 0, r1: null };
  const m = range.match(/^([A-Z]+)(\d*)(?::([A-Z]+)(\d*))?$/);
  if (!m) return { r0: 1, c0: 0, r1: null };
  return { r0: m[2] ? Number(m[2]) : 1, c0: COLS(m[1]), r1: m[4] ? Number(m[4]) : m[2] && !m[3] ? Number(m[2]) : null };
}
const codigoPosicional = (linha: number) => `EMP${String(linha - 1).padStart(3, "0")}`;

export class FakePlanilhas {
  abas = new Map<string, Aba>();
  escritas: { op: string; aba: string; linha: number }[] = [];
  mirrors: number[] = [];
  extras: unknown[] = [];
  /** nome da operação → quantas vezes ainda falhar (Infinity = sempre) */
  falhas = new Map<string, number>();

  constructor() {
    this.abas.set("principal/Musicas", [Array(26).fill("").map((_, i) => `col${i}`)]);
    this.abas.set("principal/Albuns", [["Data", "ID", "Capa", "Ref", "Criador", "Nome", "Nome", "", "", "Encarte", "Tipo", "Código", "Tracklist"]]);
    this.abas.set("edicaoCharts/EDIÇÃO CHARTS", [["Data", "Nome", "Tipo", "Tipo", "Album"]]);
    const cab = Array(20).fill("");
    cab[3] = "NOME DO ALBUM"; cab[17] = "Código único"; cab[18] = "PRE-SAVE";
    this.abas.set("edicaoCharts/EDIÇÃO CHARTS ÁLBUMS", [cab]);
    this.abas.set("registrosCharts/REGISTRO DE MÚSICA", [["", "Título", "Tipo", "Tipo", "ÁLBUM"]]);
    this.abas.set("principal/PreSave_Album", [["ID"]]);
  }

  aba(planilha: string, nome: string): Aba {
    const k = `${planilha}/${nome}`;
    if (!this.abas.has(k)) this.abas.set(k, []);
    return this.abas.get(k)!;
  }

  private talvezFalhar(op: string) {
    const n = this.falhas.get(op) ?? 0;
    if (n > 0) {
      this.falhas.set(op, n - 1);
      throw new Error(`falha simulada: ${op}`);
    }
  }

  linhasCom(planilha: string, nome: string, col: number, valor: string): number[] {
    return this.aba(planilha, nome)
      .map((r, i) => ({ r, l: i + 1 }))
      .filter(({ r }) => norm(r[col]) === norm(valor))
      .map(({ l }) => l);
  }

  private set(planilha: string, nome: string, linha: number, c0: number, valores: unknown[]) {
    const a = this.aba(planilha, nome);
    while (a.length < linha) a.push([]);
    const row = a[linha - 1];
    valores.forEach((v, j) => {
      while (row.length < c0 + j) row.push("");
      row[c0 + j] = String(v ?? "");
    });
  }

  deps(): DepsEscrita {
    const self = this;
    return {
      async readFresh(planilha, nome, range) {
        self.talvezFalhar("readFresh");
        const a = self.aba(planilha, nome).map((r) => [...r]);
        if (planilha === "edicaoCharts" && nome === "EDIÇÃO CHARTS") {
          a.forEach((r, i) => {
            if (i === 0) return;
            while (r.length < 56) r.push("");
            r[55] = (r[1] || "").trim() ? codigoPosicional(i + 1) : "";
          });
        }
        const { r0, c0, r1 } = parseRange(range);
        return a.slice(r0 - 1, r1 === null ? undefined : r1).map((r) => r.slice(c0));
      },
      async updateValues(planilha, nome, range, values) {
        self.talvezFalhar("updateValues");
        const { r0, c0 } = parseRange(range);
        values.forEach((v, i) => self.set(planilha, nome, r0 + i, c0, v));
        self.escritas.push({ op: "updateValues", aba: nome, linha: r0 });
        return true;
      },
      async gravarLinhaAlbumEmAlbuns(p) {
        self.talvezFalhar("gravarLinhaAlbumEmAlbuns");
        const a = self.aba("principal", "Albuns");
        const linha = a.length + 1;
        self.set("principal", "Albuns", linha, 0, [p.dataFormatada, p.albumTopicId, p.capaUrl, p.albumTopicId, p.jogadorId, p.nomeJogador, p.albumFullTitle, "", "", p.encartesStr, p.tipoAlbum]);
        self.escritas.push({ op: "album", aba: "Albuns", linha });
        return linha;
      },
      async registrarAlbumNaEdicaoChartsAlbuns(p) {
        self.talvezFalhar("registrarAlbumNaEdicaoChartsAlbuns");
        const a = self.aba("edicaoCharts", "EDIÇÃO CHARTS ÁLBUMS");
        const linha = a.length + 1;
        const codigo = `EMPALBM${String(linha - 1).padStart(3, "0")}`;
        const row = Array(18).fill("");
        row[0] = p.artistaAlbum; row[1] = p.dataFormatada; row[3] = p.albumFullTitle; row[4] = String(p.numeroFaixas); row[17] = codigo;
        self.set("edicaoCharts", "EDIÇÃO CHARTS ÁLBUMS", linha, 0, row);
        if (p.albumRowIndexEmAlbuns) self.set("principal", "Albuns", p.albumRowIndexEmAlbuns, 11, [codigo]);
        self.escritas.push({ op: "albumCharts", aba: "EDIÇÃO CHARTS ÁLBUMS", linha });
        return codigo;
      },
      async appendRowMusicasSeguro(values) {
        self.talvezFalhar("appendRowMusicasSeguro");
        const linha = self.aba("principal", "Musicas").length + 1;
        self.set("principal", "Musicas", linha, 0, values as unknown[]);
        self.escritas.push({ op: "musicas", aba: "Musicas", linha });
        return linha;
      },
      async registrarNaEdicaoCharts(p) {
        self.talvezFalhar("registrarNaEdicaoCharts");
        const a = self.aba("edicaoCharts", "EDIÇÃO CHARTS");
        let ultima = 1;
        a.forEach((r, i) => { if ((r[1] || "").trim()) ultima = i + 1; });
        const linha = ultima + 1;
        self.set("edicaoCharts", "EDIÇÃO CHARTS", linha, 0, [p.dataFormatada, p.fullTitle, p.tipoSingle, p.tipoMusica, p.album || ""]);
        self.escritas.push({ op: "charts", aba: "EDIÇÃO CHARTS", linha });
        return linha;
      },
      async lerCodigoUnicoGerado(linha) {
        const r = self.aba("edicaoCharts", "EDIÇÃO CHARTS")[linha - 1];
        return r && (r[1] || "").trim() ? codigoPosicional(linha) : "";
      },
      async registrarInfosMusicas() {
        self.escritas.push({ op: "infos", aba: "INFOS MÚSICAS", linha: 0 });
      },
      async registrarNoRegistroDeMusica(p) {
        self.talvezFalhar("registrarNoRegistroDeMusica");
        const linha = self.aba("registrosCharts", "REGISTRO DE MÚSICA").length + 1;
        self.set("registrosCharts", "REGISTRO DE MÚSICA", linha, 0, ["", p.songTitle, p.tipoSingle, p.tipoMusica, p.album]);
        self.escritas.push({ op: "registro", aba: "REGISTRO DE MÚSICA", linha });
      },
      async vincularFaixaExistenteAoAlbum(titulo, album, ordem) {
        self.talvezFalhar("vincularFaixaExistenteAoAlbum");
        const linhas = self.linhasCom("principal", "Musicas", 7, titulo);
        for (const l of linhas) self.set("principal", "Musicas", l, 10, [album]);
        for (const l of linhas) self.set("principal", "Musicas", l, 20, [String(ordem)]);
        return { musicasOk: linhas.length > 0, edicaoChartsOk: true, criada: false };
      },
      async mirrorMusicaRowParaD1(linha) {
        self.talvezFalhar("mirrorMusicaRowParaD1");
        self.mirrors.push(linha);
        return true;
      },
      async salvarExtra(body) {
        self.talvezFalhar("salvarExtra");
        self.extras.push(body);
        return true;
      },
      async somarPrestigio() {},
    };
  }
}
