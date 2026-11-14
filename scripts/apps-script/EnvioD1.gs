/**
 * EnvioD1.gs — empurra a semana mais recente da aba DADOS (e os dados de
 * artistas da aba INFOS ACTS) para o app (Cloudflare), que grava no D1.
 *
 * Instalação: veja docs/charts-d1-envio-semanal.md.
 *
 * Propriedades do script (Configurações do projeto > Propriedades do script):
 *   CHARTS_INGEST_URL    obrigatória  ex.: https://SEU-APP/api/charts/ingest
 *   CHARTS_INGEST_TOKEN  obrigatória  o mesmo valor do secret CHARTS_INGEST_TOKEN do Worker
 *   CHARTS_SPREADSHEET_ID opcional    ID da planilha EMPIRE - CHARTS (padrão: o embutido em PLANILHA_CHARTS_ID)
 *   STATUS_CELL          opcional     ex.: DADOS!N1 — célula onde gravar "OK - data - hora" ou o erro
 */

var ENVIO_D1 = {
  ABA_DADOS: 'DADOS',
  ABA_INFOS: 'INFOS ACTS',
  PLANILHA_CHARTS_ID: '1Px2y5F25rlK-rKHk4Hnfr9QGsiiElczYffn4PXGYobM', // EMPIRE - CHARTS (troca via propriedade CHARTS_SPREADSHEET_ID)
  PLANILHA_INFOS_ID: '1wNbtP78MrtrOc2Jb1ejXcHVjqndR2Vm4-3EIVqa8aOg',
  LINHAS_FINAIS: 600 // quantas linhas do fim da aba DADOS são lidas
};

/** Menu "Empire" na planilha. */
function onOpen() {
  var ui;
  try { ui = SpreadsheetApp.getUi(); } catch (e) { return; }
  ui
    .createMenu('Empire')
    .addItem('Enviar ao app', 'enviarSemanaAoAppPeloMenu')
    .addToUi();
}

/** Chamada pelo menu: roda o envio e mostra o resultado na tela. */
function enviarSemanaAoAppPeloMenu() {
  var r = enviarSemanaAoApp();
  try {
    var ativa = SpreadsheetApp.getActiveSpreadsheet();
    if (ativa) ativa.toast(r.mensagem, 'Empire → app', 10);
    if (!r.ok) SpreadsheetApp.getUi().alert('Falha no envio ao app', r.mensagem, SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (e) { /* sem interface (ex.: gatilho): o resultado já está no Logger */ }
}

/** Envio semanal (gatilho de quinta-feira e menu). Nunca lança: devolve { ok, mensagem }. */
function enviarSemanaAoApp() {
  var resultado;
  try {
    resultado = enviarSemana_();
  } catch (e) {
    resultado = { ok: false, mensagem: 'ERRO - ' + (e && e.message ? e.message : e) };
  }
  Logger.log(resultado.mensagem);
  gravarStatus_(resultado.mensagem);
  return resultado;
}

function enviarSemana_() {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty('CHARTS_INGEST_URL');
  var token = props.getProperty('CHARTS_INGEST_TOKEN');
  if (!url || !token) {
    throw new Error('Faltam as propriedades CHARTS_INGEST_URL e/ou CHARTS_INGEST_TOKEN (Configurações do projeto > Propriedades do script).');
  }

  // getDisplayValues: devolve o texto como aparece na planilha ("1.175", "11/11/2026"),
  // que é o que o app espera (formato pt-BR).
  var aba = abrirChartsOuErro_().getSheetByName(ENVIO_D1.ABA_DADOS);
  if (!aba) throw new Error('Aba "' + ENVIO_D1.ABA_DADOS + '" não encontrada na planilha EMPIRE - CHARTS.');
  var ultima = aba.getLastRow();
  var inicio = Math.max(2, ultima - ENVIO_D1.LINHAS_FINAIS);
  if (ultima < inicio) throw new Error('A aba DADOS está vazia.');
  var todas = aba.getRange(inicio, 1, ultima - inicio + 1, 12).getDisplayValues();

  // Data mais recente (dd/mm/aaaa) entre as linhas lidas.
  var maisRecente = '';
  var chaveMax = '';
  for (var i = 0; i < todas.length; i++) {
    var d = String(todas[i][1]).trim();
    var m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(d);
    if (!m) continue;
    var chave = m[3] + ('0' + m[2]).slice(-2) + ('0' + m[1]).slice(-2);
    if (chave > chaveMax) { chaveMax = chave; maisRecente = d; }
  }
  if (!maisRecente) throw new Error('Nenhuma data válida (dd/mm/aaaa) encontrada nas últimas linhas da aba DADOS.');
  var linhas = todas.filter(function (l) { return String(l[1]).trim() === maisRecente && String(l[0]).trim() !== ''; });

  // INFOS ACTS é complemento: se falhar, o chart é enviado mesmo assim.
  var artistas = [];
  try {
    artistas = lerArtistas_();
  } catch (e) {
    Logger.log('AVISO - não li INFOS ACTS, enviando só os charts: ' + (e && e.message ? e.message : e));
  }
  var payload = { linhas: linhas, artistas: artistas, modo: 'semanal' };
  var resp = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  var codigo = resp.getResponseCode();
  var corpo = resp.getContentText();
  var json = null;
  try { json = JSON.parse(corpo); } catch (e) { /* resposta não era JSON */ }

  if (codigo === 200 && json && json.ok) {
    return { ok: true, mensagem: 'OK - ' + maisRecente + ' - ' + horaAgora_() + ' (' + linhas.length + ' linhas)' };
  }
  var detalhe = json && json.erros ? json.erros.join('; ') : corpo.slice(0, 300);
  if (codigo === 401) detalhe = 'token recusado (confira CHARTS_INGEST_TOKEN). ' + detalhe;
  return { ok: false, mensagem: 'ERRO - ' + maisRecente + ' - HTTP ' + codigo + ' - ' + detalhe };
}

/** Abre a planilha EMPIRE - CHARTS pelo ID (não depende de planilha ativa/script vinculado). */
function abrirChartsOuErro_() {
  var id = PropertiesService.getScriptProperties().getProperty('CHARTS_SPREADSHEET_ID') || ENVIO_D1.PLANILHA_CHARTS_ID;
  try {
    return SpreadsheetApp.openById(id);
  } catch (e) {
    throw new Error('Não consegui abrir a planilha EMPIRE - CHARTS (ID ' + id + '): ' + (e && e.message ? e.message : e));
  }
}

/** INFOS ACTS: col A nome, G foto, N nacionalidade → [nome, nacionalidade, foto]. */
function lerArtistas_() {
  var aba = SpreadsheetApp.openById(ENVIO_D1.PLANILHA_INFOS_ID).getSheetByName(ENVIO_D1.ABA_INFOS);
  if (!aba) throw new Error('Aba "' + ENVIO_D1.ABA_INFOS + '" não encontrada na planilha de INFOS.');
  var ultima = aba.getLastRow();
  if (ultima < 2) return [];
  return aba.getRange(2, 1, ultima - 1, 14).getDisplayValues()
    .map(function (r) { return [r[0], r[13], r[6]]; })
    .filter(function (r) { return String(r[0]).trim() !== ''; });
}

function horaAgora_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm');
}

/** Escreve o status na célula configurada em STATUS_CELL (ex.: "DADOS!N1"), se houver. */
function gravarStatus_(mensagem) {
  try {
    var ref = PropertiesService.getScriptProperties().getProperty('STATUS_CELL');
    if (!ref) return;
    var partes = ref.split('!');
    var planilha = abrirChartsOuErro_();
    var aba = partes.length > 1 ? planilha.getSheetByName(partes[0].replace(/^'|'$/g, '')) : planilha.getSheets()[0];
    if (aba) aba.getRange(partes[partes.length - 1]).setValue(mensagem);
  } catch (e) {
    Logger.log('Não consegui gravar STATUS_CELL: ' + e);
  }
}

/** Rode UMA vez: cria o gatilho semanal, quintas às 10h (fuso do projeto). Não duplica. */
function criarGatilhoQuinta() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'enviarSemanaAoApp') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('enviarSemanaAoApp')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.THURSDAY)
    .atHour(10)
    .create();
  Logger.log('Gatilho criado: enviarSemanaAoApp, toda quinta por volta das 10h.');
}
