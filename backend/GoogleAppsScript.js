// ============================================================
// EMPIRE PLAY — Google Apps Script Unificado v2
// Planilha Empire Play: 1XYa6Pzd-lou3fzqaZgjhBYNb3Je2PB9Slu7ozzOghUo
//
// Cole no Apps Script como Code.gs (ou importe como GoogleAppsScript.js)
//
// Script Properties obrigatórias:
//   TELEGRAM_TOKEN   → Token do Bot (@BotFather)
//   TELEGRAM_CHAT_ID → ID numérico do canal de storage (ex: -1001234567890)
//
// Endpoints:
//   GET  ?acao=musicas|albuns|music_videos|videos|...  → leitura de abas
//   GET  ?acao=getComentarios&tipo=musicas&id=TPC_xxx  → comentários filtrados
//   POST { acao: "adicionarComentario", ... }           → novo comentário
//   POST { acao: "uploadMedia", base64, mimeType, ... } → upload Telegram + registro
//   POST { acao: "uploadArquivo", base64, mimeType, ... } → alias completo (retorna idTopico)
// ============================================================

// ── Constantes ───────────────────────────────────────────────────────────────

var SPREADSHEET_ID   = '1XYa6Pzd-lou3fzqaZgjhBYNb3Je2PB9Slu7ozzOghUo';
var TELEGRAM_TOKEN   = PropertiesService.getScriptProperties().getProperty('TELEGRAM_TOKEN');
var TELEGRAM_CHAT_ID = PropertiesService.getScriptProperties().getProperty('TELEGRAM_CHAT_ID');
var TELEGRAM_BASE    = 'https://api.telegram.org/bot' + TELEGRAM_TOKEN;
var TELEGRAM_FILE    = 'https://api.telegram.org/file/bot' + TELEGRAM_TOKEN;

// ── Mapeamento completo de abas ───────────────────────────────────────────────

var ABAS = {
  musicas:             'Musicas',
  comentarios_musicas: 'Comentarios_Musicas',
  music_videos:        'Music Videos',
  comentarios_mv:      'Comentarios_MV',
  videos:              'Videos',
  comentarios_videos:  'Comentarios_Videos',
  albuns:              'Albuns',
  comentarios_albuns:  'Comentarios_Albuns',
  top50spotify:        'Top_50_Spotify',
  topapple:            'Top_Songs_Apple_Music',
  topyt:               'Top_Videos_YT'
};

var ABAS_COMENTARIOS = {
  musicas: 'Comentarios_Musicas',
  mv:      'Comentarios_MV',
  videos:  'Comentarios_Videos',
  albuns:  'Comentarios_Albuns'
};

// Aba de destino por tipo de mídia no upload
var ABAS_UPLOAD = {
  musica: 'Musicas',
  mv:     'Music Videos',
  video:  'Videos',
  album:  'Albuns'
};

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Retorna uma resposta JSON com cabeçalho MIME correto.
 * O GAS Web App não suporta CORS de forma nativa; headers extras são ignorados,
 * mas o Content-Type application/json é essencial para o fetch() do front.
 */
function corsResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Gera um ID de tópico no formato TPC_<timestamp_base36><uuid_parcial>.
 * Ex: TPC_lnz4k8a2b3c4d5e6
 */
function gerarIdTopico() {
  var ts   = Date.now().toString(36);
  var uuid = Utilities.getUuid().replace(/-/g, '').substring(0, 8);
  return 'TPC_' + ts + uuid;
}

/**
 * Lê uma aba inteira e retorna array de objetos {chave: valor}.
 * A primeira linha é tratada como cabeçalho (normalizado para snake_case).
 */
function lerAba(ss, nomeAba) {
  var aba = ss.getSheetByName(nomeAba);
  if (!aba) return [];
  var dados = aba.getDataRange().getValues();
  if (dados.length < 2) return [];
  var cabecalho = dados[0].map(function(h) {
    return String(h).trim().toLowerCase().replace(/\s+/g, '_');
  });
  return dados.slice(1).map(function(row) {
    var obj = {};
    cabecalho.forEach(function(k, i) { obj[k] = row[i]; });
    return obj;
  });
}

// ── Telegram: envio de mensagem de texto ─────────────────────────────────────

function enviarMensagemTelegram(texto) {
  try {
    UrlFetchApp.fetch(TELEGRAM_BASE + '/sendMessage', {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({
        chat_id:              TELEGRAM_CHAT_ID,
        text:                 String(texto).substring(0, 4096),
        disable_notification: true
      }),
      muteHttpExceptions: true
    });
  } catch(err) {
    Logger.log('[enviarMensagemTelegram] ' + err.message);
  }
}

// ── Telegram: upload de arquivo (base64 → blob → Canal) ──────────────────────

/**
 * Faz upload de um arquivo para o canal Telegram de storage.
 *
 * @param {string} base64   - Conteúdo do arquivo em Base64
 * @param {string} mimeType - MIME type (ex: 'video/mp4', 'audio/mpeg')
 * @param {string} nome     - Nome do arquivo (usado como caption/título)
 * @returns {{ fileId: string, fileUrl: string, messageId: number }}
 * @throws {Error} se o Telegram retornar ok: false
 */
function enviarArquivoTelegram(base64, mimeType, nome) {
  var bytes    = Utilities.base64Decode(base64);
  var blob     = Utilities.newBlob(bytes, mimeType, nome || 'upload');

  // Seleciona endpoint e campo correto conforme o MIME type
  var isVideo   = mimeType.indexOf('video')  >= 0;
  var isAudio   = mimeType.indexOf('audio')  >= 0;
  var endpoint  = isVideo ? 'sendVideo'  : isAudio ? 'sendAudio'  : 'sendDocument';
  var fieldName = isVideo ? 'video'      : isAudio ? 'audio'      : 'document';

  var payload = {
    chat_id:              TELEGRAM_CHAT_ID,
    disable_notification: true,
    caption:              nome || ''
  };
  payload[fieldName] = blob;

  var response = UrlFetchApp.fetch(TELEGRAM_BASE + '/' + endpoint, {
    method:             'post',
    payload:            payload,
    muteHttpExceptions: true
  });

  var result = JSON.parse(response.getContentText());
  if (!result.ok) {
    throw new Error('Telegram ' + endpoint + ' falhou: ' + response.getContentText());
  }

  var msg      = result.result;
  var mediaObj = msg.video || msg.audio || msg.document || {};
  var fileId   = mediaObj.file_id || '';

  if (!fileId) throw new Error('file_id ausente na resposta do Telegram.');

  // ── Resolve file_path via getFile → monta URL direta .mp4 / .mpeg ──────────
  var fileResp = UrlFetchApp.fetch(
    TELEGRAM_BASE + '/getFile?file_id=' + encodeURIComponent(fileId),
    { muteHttpExceptions: true }
  );
  var fileData = JSON.parse(fileResp.getContentText());

  if (!fileData.ok || !fileData.result || !fileData.result.file_path) {
    throw new Error('getFile falhou: ' + fileResp.getContentText());
  }

  var filePath = fileData.result.file_path;
  // URL direta permanente enquanto o token não mudar
  // Ex: https://api.telegram.org/file/bot<TOKEN>/videos/file_0.mp4
  var fileUrl  = TELEGRAM_FILE + '/' + filePath;

  return {
    fileId:    fileId,
    fileUrl:   fileUrl,
    messageId: msg.message_id
  };
}

// ── Planilha: gravação na aba correta ─────────────────────────────────────────

/**
 * Grava uma linha na aba de conteúdo (Musicas, Videos, etc.).
 * Colunas: idTopico | titulo | artista | telegram_file_id | telegram_file_url | criado_em
 *
 * @returns {string} idTopico gerado
 */
function gravarNaPlanilha(ss, tipo, titulo, artista, fileId, fileUrl) {
  var nomeAba  = ABAS_UPLOAD[tipo] || 'Musicas';
  var aba      = ss.getSheetByName(nomeAba);
  if (!aba) {
    Logger.log('[gravarNaPlanilha] Aba não encontrada: ' + nomeAba);
    return '';
  }
  var idTopico  = gerarIdTopico();
  var timestamp = new Date().toISOString();
  aba.appendRow([idTopico, titulo, artista, fileId, fileUrl, timestamp]);
  return idTopico;
}

/**
 * Duplo registro na aba "Charts" (log consolidado para análise).
 * Colunas: id | tipo | titulo | artista | fileId | fileUrl | timestamp | plays
 * A aba é criada automaticamente se não existir.
 */
function gravarRegistroFinal(ss, tipo, titulo, artista, fileId, fileUrl, idTopico) {
  try {
    var abaCharts = ss.getSheetByName('Charts');
    if (!abaCharts) abaCharts = ss.insertSheet('Charts');
    abaCharts.appendRow([
      idTopico || Utilities.getUuid(),
      tipo,
      titulo,
      artista,
      fileId,
      fileUrl,
      new Date().toISOString(),
      0   // plays inicial
    ]);
  } catch(err) {
    Logger.log('[gravarRegistroFinal] ' + err.message);
  }
}

// ============================================================
// doGet — leitura de dados
// ============================================================

function doGet(e) {
  try {
    var params = e.parameter || {};
    var acao   = params.acao || '';
    var ss     = SpreadsheetApp.openById(SPREADSHEET_ID);

    // Leitura direta de qualquer aba mapeada
    if (ABAS[acao]) {
      var dados = lerAba(ss, ABAS[acao]);
      return corsResponse({ success: true, aba: ABAS[acao], total: dados.length, data: dados });
    }

    // Comentários filtrados por tópico
    if (acao === 'getComentarios') {
      var tipo    = params.tipo || 'musicas';
      var id      = params.id  || '';
      var nomAba  = ABAS_COMENTARIOS[tipo] || 'Comentarios_Musicas';
      var todos   = lerAba(ss, nomAba);
      var filtrado = id
        ? todos.filter(function(r) { return String(r.topico_id) === String(id); })
        : todos;
      return corsResponse({ success: true, data: filtrado });
    }

    // Health check
    if (acao === 'ping') {
      return corsResponse({ success: true, pong: true, ts: new Date().toISOString() });
    }

    return corsResponse({ success: false, error: 'Acao nao reconhecida: ' + acao });

  } catch(err) {
    Logger.log('[doGet] ' + err.message);
    return corsResponse({ success: false, error: err.message });
  }
}

// ============================================================
// doPost — escrita de dados
// ============================================================

function doPost(e) {
  var body = {};
  try {
    body = JSON.parse((e.postData && e.postData.contents) ? e.postData.contents : '{}');
  } catch(err) {
    return corsResponse({ success: false, error: 'JSON inválido no body: ' + err.message });
  }

  var acao = body.acao || '';
  var ss;

  try {
    ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  } catch(err) {
    return corsResponse({ success: false, error: 'Não foi possível abrir a planilha: ' + err.message });
  }

  // ── 1. Adicionar comentário ───────────────────────────────────────────────
  if (acao === 'adicionarComentario') {
    var tipo      = body.tipo      || 'musicas';
    var topicoId  = body.topico_id || '';
    var autor     = body.autor     || 'Anônimo';
    var texto     = body.texto     || '';
    var emoji     = body.emoji     || '';
    var timestamp = new Date().toISOString();

    var nomAba = ABAS_COMENTARIOS[tipo] || 'Comentarios_Musicas';
    var aba    = ss.getSheetByName(nomAba);
    if (!aba) return corsResponse({ success: false, error: 'Aba não encontrada: ' + nomAba });

    aba.appendRow([topicoId, autor, texto, emoji, timestamp]);

    // Notificação silenciosa no Telegram (não bloqueia resposta)
    enviarMensagemTelegram('[' + tipo + '/' + topicoId + '] ' + autor + ': ' + emoji + ' ' + texto);

    return corsResponse({ success: true, topico_id: topicoId });
  }

  // ── 2. Upload de arquivo (alias: uploadArquivo ou uploadMedia) ────────────
  //
  //  Fluxo completo:
  //    a. Recebe base64 do front
  //    b. Decodifica e envia ao Telegram (sendVideo / sendAudio / sendDocument)
  //    c. Captura file_id permanente
  //    d. Chama getFile → monta URL direta (https://api.telegram.org/file/bot...)
  //    e. Grava na aba correta da planilha (Musicas, Videos, etc.)
  //    f. Grava duplo registro na aba Charts
  //    g. Retorna { idTopico, fileId, fileUrl, messageId }
  //
  if (acao === 'uploadArquivo' || acao === 'uploadMedia') {
    var tipo2    = body.tipo     || 'musica';
    var titulo   = body.titulo   || 'Sem título';
    var artista  = body.artista  || '';
    var base64   = body.base64   || '';
    var mimeType = body.mimeType || 'video/mp4';
    var link     = body.link     || '';   // fallback: link externo (Drive / YouTube)

    var fileId2    = '';
    var fileUrl2   = '';
    var messageId2 = 0;

    if (base64) {
      // Upload direto ao Telegram
      try {
        var telegramResult = enviarArquivoTelegram(base64, mimeType, titulo);
        fileId2    = telegramResult.fileId;
        fileUrl2   = telegramResult.fileUrl;
        messageId2 = telegramResult.messageId;
      } catch(err) {
        Logger.log('[doPost/upload] Telegram error: ' + err.message);
        return corsResponse({ success: false, error: 'Falha no upload ao Telegram: ' + err.message });
      }
    } else if (link) {
      // Sem upload — apenas registra link externo
      fileUrl2 = link;
      fileId2  = '';
    } else {
      return corsResponse({ success: false, error: 'Forneça base64 ou link no body.' });
    }

    // Grava na aba de conteúdo e na aba Charts
    var idTopico2 = gravarNaPlanilha(ss, tipo2, titulo, artista, fileId2, fileUrl2);
    gravarRegistroFinal(ss, tipo2, titulo, artista, fileId2, fileUrl2, idTopico2);

    return corsResponse({
      success:   true,
      idTopico:  idTopico2,
      fileId:    fileId2,
      fileUrl:   fileUrl2,
      messageId: messageId2
    });
  }

  return corsResponse({ success: false, error: 'Acao nao reconhecida: ' + acao });
}
