import {
  googleSheetsService,
  normalizeHeader,
  normalizeText,
  normalizeComparison,
  dedupeHeaders,
} from "./googleSheetsService";

const USUARIOS_SHEET = "Usuários";
const PRESTIGIO_SHEET = "Prestígio";
const NIVEIS_SHEET = "Níveis";
const PRESTIGIO_LOG_SHEET = "Prestigio_Log";

// Log de auditoria — sem isso, nenhuma subida de prestígio tem como ser
// explicada depois ("por que subiu do nada?"), só dá pra adivinhar lendo
// código. Best-effort: nunca deve travar o crédito real por causa de uma
// falha ao gravar o log.
async function registrarLogPrestigio(
  identificador: { telegramId?: string; usuario?: string },
  chave: string,
  valor: number,
  saldoAntes: number,
  saldoDepois: number,
): Promise<void> {
  try {
    await googleSheetsService.usuarios.appendRow(
      PRESTIGIO_LOG_SHEET,
      [
        new Date().toISOString(),
        identificador.telegramId || "",
        identificador.usuario || "",
        chave,
        String(valor),
        String(saldoAntes),
        String(saldoDepois),
      ],
      "A:G",
    );
  } catch (err) {
    console.warn("[prestigioService] Falha ao gravar log de prestígio:", err);
  }
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

interface RegraPrestigio {
  chave: string;
  acao: string;
  valor: number;
  ativo: boolean;
}

/**
 * Lê as regras de pontuação direto da aba "Prestígio" (planilha "usuarios")
 * — fonte única de verdade, gerenciável sem deploy. Cada linha precisa de
 * uma coluna "Chave" (identificador técnico fixo, ex: "login_diario") além
 * da legenda em "Ação"; "Valor" é o quanto soma; "Ativo?" liga/desliga a
 * regra sem precisar apagar a linha (qualquer coisa diferente de
 * "não"/"false"/"0" conta como ativo).
 */
export async function getRegrasPrestigio(): Promise<Map<string, RegraPrestigio>> {
  const rows = await googleSheetsService.usuarios.readValues(PRESTIGIO_SHEET).catch(() => []);
  const map = new Map<string, RegraPrestigio>();
  if (!rows || rows.length < 2) return map;

  const headers = dedupeHeaders(
    PRESTIGIO_SHEET,
    rows[0].map((h, i) => normalizeHeader(h) || `coluna_${i + 1}`),
  );
  const chaveCol = headers.indexOf("chave");
  const acaoCol = headers.indexOf("acao");
  const valorCol = headers.indexOf("valor");
  const ativoCol = headers.indexOf("ativo");
  if (chaveCol === -1 || valorCol === -1) return map;

  rows.slice(1).forEach((row) => {
    const chave = normalizeComparison(row[chaveCol]);
    if (!chave) return;
    const valor = parseInt(normalizeText(row[valorCol]), 10) || 0;
    const ativoRaw = ativoCol !== -1 ? normalizeComparison(row[ativoCol]) : "";
    const ativo = !["nao", "false", "0"].includes(ativoRaw);
    map.set(chave, {
      chave,
      acao: acaoCol !== -1 ? normalizeText(row[acaoCol]) : "",
      valor,
      ativo,
    });
  });

  return map;
}

interface UsuarioRow {
  rec: Record<string, string>;
  rowIndex: number;
  headers: string[];
}

async function findUsuarioRow(identificador: {
  telegramId?: string;
  usuario?: string;
}): Promise<UsuarioRow | null> {
  const rawRows = await googleSheetsService.usuarios.readValues(USUARIOS_SHEET).catch(() => []);
  if (!rawRows || rawRows.length < 2) return null;

  const headers = dedupeHeaders(
    USUARIOS_SHEET,
    rawRows[0].map((h, i) => normalizeHeader(h) || `coluna_${i + 1}`),
  );
  const idCol = headers.indexOf("id");
  const usuarioCol = headers.indexOf("usuario");
  const normId = identificador.telegramId ? normalizeComparison(identificador.telegramId) : "";
  const normUsuario = identificador.usuario ? normalizeComparison(identificador.usuario) : "";

  for (let i = 1; i < rawRows.length; i++) {
    const row = rawRows[i];
    const matchId = !!normId && idCol !== -1 && normalizeComparison(row[idCol]) === normId;
    const matchUsuario =
      !!normUsuario && usuarioCol !== -1 && normalizeComparison(row[usuarioCol]) === normUsuario;
    if (matchId || matchUsuario) {
      const rec: Record<string, string> = {};
      headers.forEach((h, hi) => {
        rec[h] = normalizeText(row[hi]);
      });
      return { rec, rowIndex: i + 1, headers };
    }
  }
  return null;
}

/**
 * Soma o prestígio da `chave` (ver getRegrasPrestigio) pro usuário
 * identificado por telegramId ou usuario. Silencioso em qualquer falha
 * (regra desativada/inexistente, usuário não encontrado, erro de rede) —
 * gamificação nunca deve travar a ação principal que a disparou.
 */
export async function somarPrestigio(
  identificador: { telegramId?: string; usuario?: string },
  chave: string,
): Promise<void> {
  try {
    const regras = await getRegrasPrestigio();
    const regra = regras.get(normalizeComparison(chave));
    if (!regra || !regra.ativo || regra.valor <= 0) return;

    const usuarioRow = await findUsuarioRow(identificador);
    if (!usuarioRow) return;

    const prestigioColIndex = usuarioRow.headers.indexOf("prestigio");
    if (prestigioColIndex === -1) return;

    const atual = parseInt(usuarioRow.rec["prestigio"] || "0", 10) || 0;
    const novo = atual + regra.valor;
    const colLetter = colIndexToA1Letter(prestigioColIndex);
    await googleSheetsService.usuarios.updateValues(
      USUARIOS_SHEET,
      `${colLetter}${usuarioRow.rowIndex}`,
      [[novo]],
    );
    await registrarLogPrestigio(identificador, chave, regra.valor, atual, novo);
  } catch (err) {
    console.warn("[prestigioService] Falha ao somar prestígio:", err);
  }
}

/**
 * Desconta prestígio do usuário (compras no Empire Market). Lança erro se o
 * usuário não existir ou não tiver saldo suficiente — ao contrário de
 * somarPrestigio, aqui o erro precisa chegar até o jogador, então não é
 * silencioso.
 */
export async function gastarPrestigio(
  identificador: { telegramId?: string; usuario?: string },
  valor: number,
): Promise<number> {
  const usuarioRow = await findUsuarioRow(identificador);
  if (!usuarioRow) throw new Error("Usuário não encontrado.");

  const prestigioColIndex = usuarioRow.headers.indexOf("prestigio");
  if (prestigioColIndex === -1) throw new Error("Coluna de prestígio não encontrada.");

  const atual = parseInt(usuarioRow.rec["prestigio"] || "0", 10) || 0;
  if (atual < valor) throw new Error("Prestígio insuficiente.");

  const novo = atual - valor;
  const colLetter = colIndexToA1Letter(prestigioColIndex);
  await googleSheetsService.usuarios.updateValues(
    USUARIOS_SHEET,
    `${colLetter}${usuarioRow.rowIndex}`,
    [[novo]],
  );
  return novo;
}

export interface NivelInfo {
  nivel: number;
  fase: string;
  nome: string;
  badge: string;
  prestigio: number;
}

export async function getNiveis(): Promise<NivelInfo[]> {
  const rows = await googleSheetsService.usuarios.readValues(NIVEIS_SHEET).catch(() => []);
  if (!rows || rows.length < 2) return [];

  const headers = dedupeHeaders(
    NIVEIS_SHEET,
    rows[0].map((h, i) => normalizeHeader(h) || `coluna_${i + 1}`),
  );
  const nivelCol = headers.indexOf("nivel");
  const faseCol = headers.indexOf("fase");
  const nomeCol = headers.indexOf("nome");
  const badgeCol = headers.indexOf("badge");
  const prestigioCol = headers.indexOf("prestigio");
  if (nivelCol === -1 || prestigioCol === -1) return [];

  return rows
    .slice(1)
    .filter((r) => normalizeText(r[nivelCol]))
    .map((r) => ({
      nivel: parseInt(normalizeText(r[nivelCol]), 10) || 0,
      fase: faseCol !== -1 ? normalizeText(r[faseCol]) : "",
      nome: nomeCol !== -1 ? normalizeText(r[nomeCol]) : "",
      badge: badgeCol !== -1 ? normalizeText(r[badgeCol]) : "",
      prestigio: parseInt(normalizeText(r[prestigioCol]), 10) || 0,
    }))
    .sort((a, b) => a.prestigio - b.prestigio);
}

export interface NivelAtual {
  prestigioAtual: number;
  nivelAtual: NivelInfo | null;
  proximoNivel: NivelInfo | null;
  progresso: number; // 0..1 rumo ao próximo nível (1 = nível máximo atingido)
}

export async function getNivelAtual(identificador: {
  telegramId?: string;
  usuario?: string;
}): Promise<NivelAtual> {
  const [niveis, usuarioRow] = await Promise.all([getNiveis(), findUsuarioRow(identificador)]);
  const prestigioAtual = usuarioRow ? parseInt(usuarioRow.rec["prestigio"] || "0", 10) || 0 : 0;

  let nivelAtual: NivelInfo | null = null;
  let proximoNivel: NivelInfo | null = null;
  for (const n of niveis) {
    if (n.prestigio <= prestigioAtual) nivelAtual = n;
    else {
      proximoNivel = n;
      break;
    }
  }

  const base = nivelAtual?.prestigio ?? 0;
  const alvo = proximoNivel?.prestigio ?? base;
  const progresso = proximoNivel && alvo > base ? Math.min(1, (prestigioAtual - base) / (alvo - base)) : 1;

  return { prestigioAtual, nivelAtual, proximoNivel, progresso };
}

const CORRECAO_CHAT_TV_MARCADOR = "correcao_remove_chat_tv";

export interface CorrecaoChatTVResultado {
  jaAplicado: boolean;
  corrigidos: { telegramId: string; usuario: string; valorRevertido: number; saldoAntes: number; saldoDepois: number }[];
}

/**
 * Correção pontual, de uso único: reverte todo o prestígio já concedido pela
 * chave "chat_tv" (removida do código — contava mensagem de chat de
 * qualquer momento da transmissão, inclusive retroativo/antigo, e não dava
 * pra impedir spam de comentário por comentário). Usa o Prestigio_Log como
 * fonte de verdade pra saber exatamente quanto cada jogador ganhou por essa
 * chave, e desconta isso do saldo atual. Idempotente: se já rodou uma vez
 * (log tem uma entrada com a chave de correção), não roda de novo.
 */
export async function corrigirPrestigioChatTV(): Promise<CorrecaoChatTVResultado> {
  const logRows = await googleSheetsService.usuarios.readValues(PRESTIGIO_LOG_SHEET).catch(() => []);
  if (!logRows || logRows.length < 2) return { jaAplicado: false, corrigidos: [] };

  const jaAplicado = logRows.slice(1).some((r) => normalizeText(r[3]) === CORRECAO_CHAT_TV_MARCADOR);
  if (jaAplicado) return { jaAplicado: true, corrigidos: [] };

  const porUsuario = new Map<string, { telegramId: string; usuario: string; total: number }>();
  for (const row of logRows.slice(1)) {
    if (normalizeText(row[3]) !== "chat_tv") continue;
    const telegramId = normalizeText(row[1]);
    const usuario = normalizeText(row[2]);
    const chave = telegramId || usuario;
    if (!chave) continue;
    const valor = parseInt(normalizeText(row[4]), 10) || 0;
    const atual = porUsuario.get(chave) || { telegramId, usuario, total: 0 };
    atual.total += valor;
    porUsuario.set(chave, atual);
  }

  const corrigidos: CorrecaoChatTVResultado["corrigidos"] = [];
  for (const { telegramId, usuario, total } of porUsuario.values()) {
    if (total <= 0) continue;
    const usuarioRow = await findUsuarioRow({
      telegramId: telegramId || undefined,
      usuario: usuario || undefined,
    });
    if (!usuarioRow) continue;
    const prestigioColIndex = usuarioRow.headers.indexOf("prestigio");
    if (prestigioColIndex === -1) continue;

    const saldoAntes = parseInt(usuarioRow.rec["prestigio"] || "0", 10) || 0;
    const saldoDepois = Math.max(0, saldoAntes - total);
    const colLetter = colIndexToA1Letter(prestigioColIndex);
    await googleSheetsService.usuarios.updateValues(
      USUARIOS_SHEET,
      `${colLetter}${usuarioRow.rowIndex}`,
      [[saldoDepois]],
    );
    await registrarLogPrestigio(
      { telegramId, usuario },
      CORRECAO_CHAT_TV_MARCADOR,
      -(saldoAntes - saldoDepois),
      saldoAntes,
      saldoDepois,
    );
    corrigidos.push({ telegramId, usuario, valorRevertido: saldoAntes - saldoDepois, saldoAntes, saldoDepois });
  }

  return { jaAplicado: false, corrigidos };
}

const CORRECAO_ASSISTIR_TV_MARCADOR = "correcao_assistir_tv_duplicado";
// Cron da Empire TV roda a cada 10 min — créditos do mesmo jogador
// separados por menos que isso só podem vir de "transmissões" que na
// prática são a mesma live sendo processada em sequência (linhas de teste
// na Agenda_TV, cada uma virando um grupo/sala tecnicamente distinto).
const JANELA_DUPLICATA_MS = 12 * 60 * 1000;

/**
 * Correção pontual, de uso único: acha créditos de "assistir_tv" pro mesmo
 * jogador que caíram em sequência, com menos de ~12 min entre um e outro —
 * padrão batendo com o intervalo do cron (10 min), sinal de que não foram
 * transmissões de verdade diferentes, e sim um lote de linhas de teste na
 * Agenda_TV (ex: "empirehits_20260602_2000".."_2015", uma salinha nova a
 * cada minuto) sendo processadas uma por ciclo do cron. Mantém só o
 * primeiro crédito de cada sequência e reverte os demais. Idempotente:
 * não roda de novo se já tiver uma entrada com a chave de correção no log.
 */
export async function corrigirPrestigioAssistirTvDuplicado(): Promise<CorrecaoChatTVResultado> {
  const logRows = await googleSheetsService.usuarios.readValues(PRESTIGIO_LOG_SHEET).catch(() => []);
  if (!logRows || logRows.length < 2) return { jaAplicado: false, corrigidos: [] };

  const jaAplicado = logRows.slice(1).some((r) => normalizeText(r[3]) === CORRECAO_ASSISTIR_TV_MARCADOR);
  if (jaAplicado) return { jaAplicado: true, corrigidos: [] };

  const porUsuario = new Map<string, { telegramId: string; usuario: string; entradas: { ts: number; valor: number }[] }>();
  for (const row of logRows.slice(1)) {
    if (normalizeText(row[3]) !== "assistir_tv") continue;
    const telegramId = normalizeText(row[1]);
    const usuario = normalizeText(row[2]);
    const chave = telegramId || usuario;
    if (!chave) continue;
    const ts = new Date(normalizeText(row[0])).getTime();
    if (!Number.isFinite(ts)) continue;
    const valor = parseInt(normalizeText(row[4]), 10) || 0;
    const atual = porUsuario.get(chave) || { telegramId, usuario, entradas: [] };
    atual.entradas.push({ ts, valor });
    porUsuario.set(chave, atual);
  }

  const corrigidos: CorrecaoChatTVResultado["corrigidos"] = [];
  for (const { telegramId, usuario, entradas } of porUsuario.values()) {
    entradas.sort((a, b) => a.ts - b.ts);
    let excedente = 0;
    let ultimoTs: number | null = null;
    for (const e of entradas) {
      if (ultimoTs !== null && e.ts - ultimoTs <= JANELA_DUPLICATA_MS) {
        excedente += e.valor;
      }
      ultimoTs = e.ts;
    }
    if (excedente <= 0) continue;

    const usuarioRow = await findUsuarioRow({
      telegramId: telegramId || undefined,
      usuario: usuario || undefined,
    });
    if (!usuarioRow) continue;
    const prestigioColIndex = usuarioRow.headers.indexOf("prestigio");
    if (prestigioColIndex === -1) continue;

    const saldoAntes = parseInt(usuarioRow.rec["prestigio"] || "0", 10) || 0;
    const saldoDepois = Math.max(0, saldoAntes - excedente);
    const colLetter = colIndexToA1Letter(prestigioColIndex);
    await googleSheetsService.usuarios.updateValues(
      USUARIOS_SHEET,
      `${colLetter}${usuarioRow.rowIndex}`,
      [[saldoDepois]],
    );
    await registrarLogPrestigio(
      { telegramId, usuario },
      CORRECAO_ASSISTIR_TV_MARCADOR,
      -(saldoAntes - saldoDepois),
      saldoAntes,
      saldoDepois,
    );
    corrigidos.push({ telegramId, usuario, valorRevertido: saldoAntes - saldoDepois, saldoAntes, saldoDepois });
  }

  return { jaAplicado: false, corrigidos };
}
