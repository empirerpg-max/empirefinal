// Nomes amigáveis para a tela admin "Uso do app". Ações conhecidas ganham um
// nome em português; o resto mostra o próprio caminho (nada some da lista).

const NOMES_DE_ACAO: Record<string, string> = {
  "/api/forum/comment": "Comentar no Fórum",
  "/api/social/posts": "Postar no Social",
  "/api/social/curtir": "Curtir post",
  "/api/ponto/:id": "Ponto",
  "/api/gestao/faixa/publicar": "Publicar faixa",
  tocar_musica: "Tocar música",
  buscar: "Buscar",
};

/** Nome amigável de uma ação medida; desconhecida → o próprio caminho. */
export function nomeDaAcao(alvo: string): string {
  return NOMES_DE_ACAO[alvo] ?? alvo;
}

/** Tela (routeId, opcionalmente " › aba"): "/" vira "Início", sem "/" no fim. */
export function nomeDaTela(alvo: string): string {
  const [rota, ...aba] = alvo.split(" › ");
  const limpa = rota === "/" || rota === "" ? "Início" : rota.replace(/\/+$/, "") || "Início";
  return aba.length ? `${limpa} › ${aba.join(" › ")}` : limpa;
}

/** Caminho "<ação> ← <tela>" com os dois lados em nome amigável. */
export function nomeDoCaminho(alvo: string): string {
  const i = alvo.indexOf(" ← ");
  if (i < 0) return nomeDaAcao(alvo);
  return `${nomeDaAcao(alvo.slice(0, i))} ← ${nomeDaTela(alvo.slice(i + 3))}`;
}

export type PeriodoUso = "semana" | "anterior" | "30dias";

function diaUtc(base: Date, menosDias: number): string {
  const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate() - menosDias));
  return d.toISOString().slice(0, 10);
}

/** Intervalo (dias UTC, inclusivo) de cada período da tela. */
export function intervaloDoPeriodo(periodo: PeriodoUso, agora: Date = new Date()): { de: string; ate: string } {
  if (periodo === "anterior") return { de: diaUtc(agora, 13), ate: diaUtc(agora, 7) };
  if (periodo === "30dias") return { de: diaUtc(agora, 29), ate: diaUtc(agora, 0) };
  return { de: diaUtc(agora, 6), ate: diaUtc(agora, 0) };
}
