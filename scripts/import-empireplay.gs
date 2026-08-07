/**
 * Empire Play — Importador Google Apps Script
 * Planilha de origem: [Empire Hub] Empire Play
 * ID: 1XYa6Pzd-lou3fzqaZgjhBYNb3Je2PB9Slu7ozzOghUo
 *
 * Como usar:
 *  1. Abra a planilha no Google Sheets.
 *  2. Extensões → Apps Script → cole este arquivo.
 *  3. Configure a propriedade SUPABASE_SERVICE_KEY nas
 *     Configurações do projeto (⚙️ > Propriedades do script).
 *  4. Execute importarTudo() ou cada função separadamente.
 */

// ─── CONFIGURAÇÃO ────────────────────────────────────────────────────────────
const SUPABASE_URL       = 'https://rqwprnvlrobabfotmmnf.supabase.co';
const SUPABASE_SERVICE_KEY = PropertiesService.getScriptProperties()
                               .getProperty('SUPABASE_SERVICE_KEY') || '';
const SHEET_ID           = '1XYa6Pzd-lou3fzqaZgjhBYNb3Je2PB9Slu7ozzOghUo';
// ─────────────────────────────────────────────────────────────────────────────

function importarTudo() {
  importarMusicas();
  importarAlbuns();
  importarVideos();
  importarMusicVideos();
  importarTop50Spotify();
  importarTopAppleMusic();
  importarTopVideosYT();
  importarComentariosMusicas();
  importarComentariosVideos();
  importarComentariosAlbuns();
  Logger.log('✅ Importação concluída.');
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function lerAba(nomeAba) {
  const ss    = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(nomeAba);
  if (!sheet) { Logger.log('⚠️  Aba não encontrada: ' + nomeAba); return []; }
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0].map(h => String(h).trim());
  return values.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => { if (h) obj[h] = (row[i] === '' ? null : row[i] ?? null); });
    return obj;
  }).filter(r => Object.values(r).some(v => v !== null));
}

/**
 * Garante que TODOS os objetos do array tenham EXATAMENTE as mesmas chaves
 * definidas em `schema` (objeto com chaves → valor padrão).
 * Isso evita o erro PGRST102 do PostgREST.
 */
function normalizar(schema, obj) {
  const out = {};
  Object.keys(schema).forEach(k => {
    const v = obj[k];
    out[k] = (v === undefined || v === '') ? null : v;
  });
  return out;
}

function upsertSupabase(tabela, registros) {
  if (!registros.length) { Logger.log('⚠️  Sem registros para ' + tabela); return; }
  const BATCH = 500;
  for (let i = 0; i < registros.length; i += BATCH) {
    const lote    = registros.slice(i, i + BATCH);
    const endpoint = SUPABASE_URL + '/rest/v1/' + encodeURIComponent(tabela);
    const options  = {
      method      : 'POST',
      contentType : 'application/json',
      headers     : {
        'apikey'        : SUPABASE_SERVICE_KEY,
        'Authorization' : 'Bearer ' + SUPABASE_SERVICE_KEY,
        'Prefer'        : 'resolution=merge-duplicates,return=minimal',
      },
      payload    : JSON.stringify(lote),
      muteHttpExceptions: true,
    };
    const resp = UrlFetchApp.fetch(endpoint, options);
    const code = resp.getResponseCode();
    if (code >= 200 && code < 300) {
      Logger.log('✅ ' + tabela + ' — lote ' + (i / BATCH + 1) + ' (' + lote.length + ' linhas)');
    } else {
      Logger.log('❌ Erro em ' + tabela + ' lote ' + (i / BATCH + 1) + ': HTTP ' + code + ' — ' + resp.getContentText());
    }
  }
}

// ─── IMPORTADORES ─────────────────────────────────────────────────────────────

function importarMusicas() {
  const SCHEMA = { 'Nome': null, 'Artista': null, 'Album': null, 'Capa da Musica': null, 'Link do audio': null, telegram_file_id: null, telegram_topic_id: null };
  const ABAS   = ['Musicas', 'Músicas', 'musicas', 'Songs'];
  let rows = [];
  for (const aba of ABAS) { rows = lerAba(aba); if (rows.length) break; }

  const registros = rows.map(r => normalizar(SCHEMA, {
    'Nome'           : r['Nome'] || r['Nome da música'] || r['Título'] || r['titulo'] || null,
    'Artista'        : r['Artista'] || r['Nome do Artista'] || r['artista'] || null,
    'Album'          : r['Album'] || r['Álbum'] || null,
    'Capa da Musica' : r['Capa da música'] || r['Capa da Musica'] || r['Capa'] || r['capa'] || null,
    'Link do audio'  : r['Link do áudio'] || r['Link do audio'] || r['link_audio'] || null,
    telegram_file_id : r['telegram_file_id'] || r['Telegram File ID'] || null,
    telegram_topic_id: Number(r['telegram_topic_id'] || r['ID do Tópico'] || 0) || null,
  })).filter(r => r['Nome']);

  upsertSupabase('Musicas', registros);
}

function importarAlbuns() {
  const SCHEMA = { 'Nome do Album': null, 'Nome do Artista': null, 'Capa do Album': null, 'Link do audio': null, telegram_topic_id: null };
  const ABAS   = ['Albuns', 'Álbuns', 'Albums'];
  let rows = [];
  for (const aba of ABAS) { rows = lerAba(aba); if (rows.length) break; }

  const registros = rows.map(r => normalizar(SCHEMA, {
    'Nome do Album'  : r['Nome do Album'] || r['Nome'] || r['Título'] || null,
    'Nome do Artista': r['Nome do Artista'] || r['Artista'] || null,
    'Capa do Album'  : r['Capa do Album'] || r['Capa'] || null,
    'Link do audio'  : r['Link do áudio'] || r['Link do audio'] || null,
    telegram_topic_id: Number(r['telegram_topic_id'] || r['ID do Tópico'] || 0) || null,
  })).filter(r => r['Nome do Album']);

  upsertSupabase('Albuns', registros);
}

function importarVideos() {
  const SCHEMA = { 'Titulo': null, 'Artista': null, 'Capa': null, telegram_file_id: null, telegram_topic_id: null };
  const ABAS   = ['Videos', 'Vídeos', 'videos'];
  let rows = [];
  for (const aba of ABAS) { rows = lerAba(aba); if (rows.length) break; }

  const registros = rows.map(r => normalizar(SCHEMA, {
    'Titulo'         : r['titulo'] || r['Titulo'] || r['Nome'] || r['Título'] || null,
    'Artista'        : r['artista'] || r['Artista'] || r['enviado_por'] || null,
    'Capa'           : r['thumbnail_url'] || r['Capa'] || r['capa'] || null,
    telegram_file_id : r['telegram_file_id'] || null,
    telegram_topic_id: Number(r['telegram_topic_id'] || r['ID do Tópico'] || 0) || null,
  })).filter(r => r['Titulo']);

  upsertSupabase('Videos', registros);
}

function importarMusicVideos() {
  const SCHEMA = { 'Titulo': null, 'Artista': null, 'Capa': null, telegram_file_id: null, telegram_topic_id: null };
  const ABAS   = ['Music Videos', 'MusicVideos', 'MVs', 'Music_Videos'];
  let rows = [];
  for (const aba of ABAS) { rows = lerAba(aba); if (rows.length) break; }

  const registros = rows.map(r => normalizar(SCHEMA, {
    'Titulo'         : r['Nome'] || r['Titulo'] || r['Título'] || null,
    'Artista'        : r['Nome do criador'] || r['Artista Principal'] || r['Artista'] || null,
    'Capa'           : r['Thumb'] || r['thumbnail_url'] || r['Capa'] || null,
    telegram_file_id : r['telegram_file_id'] || r['ID do arquivo'] || null,
    telegram_topic_id: Number(r['telegram_topic_id'] || r['ID do Tópico'] || 0) || null,
  })).filter(r => r['Titulo']);

  upsertSupabase('Music Videos', registros);
}

function importarTop50Spotify() {
  const SCHEMA = { posicao: null, nome_musica: null, capa_musica: null, link_audio: null, telegram_topic_id: null };
  const ABAS   = ['Top_50_Spotify', 'Top 50 Spotify', 'Top50Spotify'];
  let rows = [];
  for (const aba of ABAS) { rows = lerAba(aba); if (rows.length) break; }

  const registros = rows.map((r, i) => normalizar(SCHEMA, {
    posicao          : Number(r['Posição'] || r['posicao'] || r['#'] || i + 1) || i + 1,
    nome_musica      : r['Nome da música'] || r['Nome'] || r['Título'] || null,
    capa_musica      : r['Capa da música'] || r['Capa'] || null,
    link_audio       : r['Link do áudio'] || r['Link do audio'] || null,
    telegram_topic_id: Number(r['ID do tópico'] || r['telegram_topic_id'] || 0) || null,
  })).filter(r => r['nome_musica']);

  upsertSupabase('Top_50_Spotify', registros);
}

function importarTopAppleMusic() {
  const SCHEMA = { posicao: null, nome_musica: null, capa_musica: null, link_audio: null, telegram_topic_id: null };
  const ABAS   = ['Top_Songs_Apple_Music', 'Top Songs Apple Music', 'TopApple'];
  let rows = [];
  for (const aba of ABAS) { rows = lerAba(aba); if (rows.length) break; }

  const registros = rows.map((r, i) => normalizar(SCHEMA, {
    posicao          : Number(r['Posição'] || r['posicao'] || r['#'] || i + 1) || i + 1,
    nome_musica      : r['Nome da música'] || r['Nome'] || r['Título'] || null,
    capa_musica      : r['Capa da música'] || r['Capa'] || null,
    link_audio       : r['Link do áudio'] || r['Link do audio'] || null,
    telegram_topic_id: Number(r['ID do tópico'] || r['telegram_topic_id'] || 0) || null,
  })).filter(r => r['nome_musica']);

  upsertSupabase('Top_Songs_Apple_Music', registros);
}

function importarTopVideosYT() {
  const SCHEMA = { posicao: null, nome_video: null, thumb: null, link_audio: null, telegram_topic_id: null };
  const ABAS   = ['Top_Videos_YT', 'Top Videos YT', 'TopYT'];
  let rows = [];
  for (const aba of ABAS) { rows = lerAba(aba); if (rows.length) break; }

  const registros = rows.map((r, i) => normalizar(SCHEMA, {
    posicao          : Number(r['Posição'] || r['posicao'] || r['#'] || i + 1) || i + 1,
    nome_video       : r['Nome do vídeo'] || r['Nome'] || r['Título'] || null,
    thumb            : r['Thumb'] || r['thumbnail_url'] || r['Capa'] || null,
    link_audio       : r['Link do áudio'] || r['Link do audio'] || null,
    telegram_topic_id: Number(r['ID do tópico'] || r['telegram_topic_id'] || 0) || null,
  })).filter(r => r['nome_video']);

  upsertSupabase('Top_Videos_YT', registros);
}

function importarComentariosMusicas() {
  const SCHEMA = { telegram_topic_id: null, id_jogador: null, nome_jogador: null, comentario: null };
  const ABAS   = ['Comentarios_Musicas', 'Comentários Músicas', 'ComentariosMusicas'];
  let rows = [];
  for (const aba of ABAS) { rows = lerAba(aba); if (rows.length) break; }

  const registros = rows.map(r => normalizar(SCHEMA, {
    telegram_topic_id: Number(r['ID do tópico'] || r['telegram_topic_id'] || 0) || null,
    id_jogador       : String(r['ID do jogador'] || r['id_jogador'] || '') || null,
    nome_jogador     : r['Nome do jogador'] || r['nome_jogador'] || null,
    comentario       : r['Comentário'] || r['comentario'] || null,
  })).filter(r => r['comentario']);

  upsertSupabase('Comentarios_Musicas', registros);
}

function importarComentariosVideos() {
  const SCHEMA = { telegram_topic_id: null, id_usuario: null, autor: null, texto: null, data: null, reacoes: null };
  const ABAS   = ['Comentarios_Videos', 'Comentários Vídeos', 'ComentariosVideos'];
  let rows = [];
  for (const aba of ABAS) { rows = lerAba(aba); if (rows.length) break; }

  const registros = rows.map(r => normalizar(SCHEMA, {
    telegram_topic_id: Number(r['telegram_topic_id'] || r['ID do tópico'] || 0) || null,
    id_usuario       : String(r['id_usuario'] || r['ID do jogador'] || '') || null,
    autor            : r['autor'] || r['Nome do jogador'] || null,
    texto            : r['texto'] || r['Comentário'] || null,
    data             : r['data'] ? String(r['data']) : null,
    reacoes          : r['reacoes'] || r['Reações'] || null,
  })).filter(r => r['texto']);

  upsertSupabase('Comentarios_Videos', registros);
}

function importarComentariosAlbuns() {
  const SCHEMA = { telegram_topic_id: null, id_jogador: null, nome_jogador: null, comentario: null, data: null };
  const ABAS   = ['Comentarios_Albuns', 'Comentários Álbuns', 'ComentariosAlbuns'];
  let rows = [];
  for (const aba of ABAS) { rows = lerAba(aba); if (rows.length) break; }

  const registros = rows.map(r => normalizar(SCHEMA, {
    telegram_topic_id: Number(r['ID do tópico'] || r['telegram_topic_id'] || 0) || null,
    id_jogador       : String(r['ID do jogador'] || r['id_jogador'] || '') || null,
    nome_jogador     : r['Nome do jogador'] || r['nome_jogador'] || null,
    comentario       : r['Comentário'] || r['comentario'] || null,
    data             : r['Data'] ? String(r['Data']) : null,
  })).filter(r => r['comentario']);

  upsertSupabase('Comentarios_Albuns', registros);
}
