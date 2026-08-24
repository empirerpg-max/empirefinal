import { googleSheetsService, ensureSheetTab } from "./googleSheetsService";

// Log didático do sistema — planilha própria (ver SPREADSHEETS.logsSistema),
// pensada pra ser lida por gente não-técnica: cada linha já vem com o que
// aconteceu em português simples, a causa mais provável e um passo a passo
// de como resolver quando dá pra saber de antemão. O detalhe técnico cru
// fica numa coluna à parte, só pra quem quiser ir fundo.
//
// LOGS: A Data/Hora | B Categoria | C O que aconteceu | D Onde | E Causa
// provável | F Como resolver | G Detalhe técnico
const SHEET_LOGS = "LOGS";

export type CategoriaLog = "Falha de escrita" | "Erro do app" | "Ação concluída";

interface RegistrarLogParams {
  categoria: CategoriaLog;
  oQueAconteceu: string;
  onde: string;
  causaProvavel?: string;
  comoResolver?: string;
  detalheTecnico?: string;
}

let tabGarantida = false;

async function garantirAba(): Promise<void> {
  if (tabGarantida) return;
  try {
    await ensureSheetTab("logsSistema", SHEET_LOGS);
    const rows = await googleSheetsService.logsSistema.readValues(SHEET_LOGS, "A1:A1");
    if (!rows.length) {
      await googleSheetsService.logsSistema.appendRow(
        SHEET_LOGS,
        ["Data/Hora", "Categoria", "O que aconteceu", "Onde", "Causa provável", "Como resolver", "Detalhe técnico"],
        "A:G",
      );
    }
    tabGarantida = true;
  } catch (err) {
    console.warn("[logSistemaService] Não consegui garantir a aba LOGS:", err);
  }
}

// Nunca lança erro — logar não pode nunca ser a causa de uma falha em
// cascata. Se o próprio log falhar, só um console.warn mesmo.
export async function registrarLogSistema(params: RegistrarLogParams): Promise<void> {
  try {
    await garantirAba();
    await googleSheetsService.logsSistema.appendRow(
      SHEET_LOGS,
      [
        new Date().toISOString(),
        params.categoria,
        params.oQueAconteceu,
        params.onde,
        params.causaProvavel || "",
        params.comoResolver || "",
        params.detalheTecnico || "",
      ],
      "A:G",
    );
  } catch (err) {
    console.warn("[logSistemaService] Falha ao gravar log didático:", err);
  }
}

// Traduz mensagens técnicas comuns da API do Google Sheets pra causa
// provável + passo a passo, em português simples. Cai num fallback
// genérico quando não reconhece o padrão.
export function traduzirErroEscrita(mensagem: string): { causaProvavel: string; comoResolver: string } {
  const m = mensagem.toLowerCase();

  if (m.includes("protected cell") || m.includes("protected range") || m.includes("protected sheet")) {
    return {
      causaProvavel:
        "A aba (ou um intervalo de colunas dela) está protegida na planilha, e a conta do app não está na lista de quem pode editar apesar da proteção. Ser \"Editor\" da planilha inteira não é suficiente — proteção de intervalo tem sua própria lista de permissão.",
      comoResolver:
        "1) Abra a planilha e a aba mencionada. 2) Menu Dados → Intervalos e planilhas protegidos. 3) Clique na proteção que cobre essa aba/colunas. 4) Em \"Definir permissões\", adicione o e-mail da service account (empire-play-worker@empire-play-504020.iam.gserviceaccount.com) na lista de quem pode editar, ou troque pra \"Qualquer pessoa com acesso de editor pode editar\". 5) Salve.",
    };
  }
  if (m.includes("permission") || m.includes("403") || m.includes("caller does not have permission")) {
    return {
      causaProvavel:
        "A conta do app (service account) não tem acesso a essa planilha — geralmente porque o e-mail dela não foi compartilhado como Editor, ou o compartilhamento foi removido/alterado.",
      comoResolver:
        "1) Abra a planilha. 2) Clique em \"Compartilhar\". 3) Adicione empire-play-worker@empire-play-504020.iam.gserviceaccount.com como Editor. 4) Confirme e tente de novo.",
    };
  }
  if (m.includes("not found") || m.includes("404") || m.includes("unable to parse range")) {
    return {
      causaProvavel:
        "A aba com esse nome não existe mais na planilha (foi renomeada, apagada, ou o nome usado no código não bate com o nome real da aba).",
      comoResolver:
        "Confira se o nome da aba na planilha é exatamente igual ao que o app espera (maiúsculas/minúsculas e acentos importam). Se foi renomeada de propósito, avise pra ajustar o código.",
    };
  }
  if (m.includes("quota") || m.includes("rate limit") || m.includes("429")) {
    return {
      causaProvavel: "Limite de requisições da API do Google Sheets foi atingido temporariamente (muita coisa acontecendo ao mesmo tempo).",
      comoResolver: "Normalmente se resolve sozinho em alguns segundos/minutos. Se continuar acontecendo com frequência, precisamos espaçar melhor as chamadas no código.",
    };
  }
  return {
    causaProvavel: "Não reconheci automaticamente esse tipo de erro — veja o detalhe técnico ao lado.",
    comoResolver: "Copie a mensagem de \"Detalhe técnico\" e mande pro Claude investigar; ele consegue ler o erro exato e apontar a causa.",
  };
}
