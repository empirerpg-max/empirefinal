"""
Empire Play — Importador Python
================================
Pré-requisitos (instale uma vez):
    pip install gspread supabase

Autenticação Google Sheets:
    1. Acesse https://console.cloud.google.com/
    2. Crie um projeto > Ative "Google Sheets API" e "Google Drive API"
    3. Crie uma Conta de Serviço > gere a chave JSON > salve como
       credentials.json na mesma pasta deste script
    4. Compartilhe a planilha com o e-mail da conta de serviço
       (termina em @...iam.gserviceaccount.com) com permissão de Leitor

Autenticação Supabase:
    Defina as variáveis de ambiente antes de rodar:
        export SUPABASE_URL="https://rqwprnvlrobabfotmmnf.supabase.co"
        export SUPABASE_KEY="sua_service_role_key"

    Ou edite as constantes SUPABASE_URL / SUPABASE_KEY abaixo.

Execução:
    python import-empireplay.py
"""

import os
import gspread
from supabase import create_client, Client

# ─── CONFIGURAÇÃO ────────────────────────────────────────────────────────────
SHEET_ID      = "1XYa6Pzd-lou3fzqaZgjhBYNb3Je2PB9Slu7ozzOghUo"
CREDENTIALS   = "credentials.json"          # caminho para o JSON da conta de serviço
SUPABASE_URL  = os.getenv("SUPABASE_URL",  "https://rqwprnvlrobabfotmmnf.supabase.co")
SUPABASE_KEY  = os.getenv("SUPABASE_KEY",  "")   # service_role key
# ─────────────────────────────────────────────────────────────────────────────

def conectar():
    gc = gspread.service_account(filename=CREDENTIALS)
    sh = gc.open_by_key(SHEET_ID)
    sb: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
    return sh, sb


def ler_aba(sh, *nomes_possiveis):
    """Tenta abrir a aba por cada nome na lista; retorna lista de dicts."""
    for nome in nomes_possiveis:
        try:
            ws = sh.worksheet(nome)
            records = ws.get_all_records(default_blank=None)
            print(f"  ✔ Aba '{nome}' — {len(records)} linhas")
            return records
        except gspread.WorksheetNotFound:
            continue
    print(f"  ⚠ Nenhuma aba encontrada para: {nomes_possiveis}")
    return []


def normalizar(schema: dict, obj: dict) -> dict:
    """Garante que o dict tenha exatamente as chaves do schema (None se ausente)."""
    return {k: (obj.get(k) or None) for k in schema}


def upsert(sb: Client, tabela: str, registros: list):
    if not registros:
        print(f"  ⚠ Sem registros para {tabela}")
        return
    BATCH = 500
    for i in range(0, len(registros), BATCH):
        lote = registros[i:i + BATCH]
        try:
            sb.table(tabela).upsert(lote).execute()
            print(f"  ✅ {tabela} — lote {i//BATCH + 1} ({len(lote)} linhas)")
        except Exception as e:
            print(f"  ❌ Erro em {tabela} lote {i//BATCH + 1}: {e}")


# ─── IMPORTADORES ────────────────────────────────────────────────────────────

def importar_musicas(sh, sb):
    print("\n▶ Musicas")
    SCHEMA = {
        "Nome":              None,
        "Artista":           None,
        "Album":             None,
        "Capa da Musica":    None,
        "Link do audio":     None,
        "telegram_file_id":  None,
        "telegram_topic_id": None,
        "genero":            None,
        "tipo_single":       None,
        "tipo_musica":       None,
        "data_lancamento":   None,
        "ordem":             None,
    }
    rows = ler_aba(sh, "Musicas", "Músicas")
    registros = []
    for r in rows:
        nome = r.get("Nome da música") or r.get("Nome") or None
        if not nome:
            continue
        registros.append(normalizar(SCHEMA, {
            "Nome":              nome,
            "Artista":           r.get("ACT PRINCIPAL") or r.get("Artista") or None,
            "Album":             r.get("ALBUM") or r.get("Álbum") or None,
            "Capa da Musica":    r.get("Capa da música") or r.get("Capa da Musica") or None,
            "Link do audio":     r.get("Link do áudio") or r.get("Link do audio") or None,
            "telegram_file_id":  r.get("ID do arquivo") or None,
            "telegram_topic_id": int(r["ID do tópico"]) if r.get("ID do tópico") else None,
            "genero":            r.get("GÊNERO") or None,
            "tipo_single":       r.get("TIPO DE SINGLE") or None,
            "tipo_musica":       r.get("TIPO DE MÚSICA") or None,
            "data_lancamento":   str(r["Data de lançamento"]) if r.get("Data de lançamento") else None,
            "ordem":             int(r["Ordem"]) if r.get("Ordem") else None,
        }))
    upsert(sb, "Musicas", registros)


def importar_albuns(sh, sb):
    print("\n▶ Albuns")
    SCHEMA = {
        "Nome do Album":     None,
        "Nome do Artista":   None,
        "Capa do Album":     None,
        "Link do audio":     None,
        "telegram_topic_id": None,
        "data_lancamento":   None,
    }
    rows = ler_aba(sh, "Albuns", "Álbuns")
    registros = []
    for r in rows:
        nome = r.get("Nome") or None
        if not nome:
            continue
        registros.append(normalizar(SCHEMA, {
            "Nome do Album":     nome,
            "Nome do Artista":   r.get("Nome do criador") or r.get("Artista") or None,
            "Capa do Album":     r.get("Capa") or None,
            "Link do audio":     r.get("Link do áudio") or None,
            "telegram_topic_id": int(r["ID do tópico"]) if r.get("ID do tópico") else None,
            "data_lancamento":   str(r["Data de lançamento"]) if r.get("Data de lançamento") else None,
        }))
    upsert(sb, "Albuns", registros)


def importar_videos(sh, sb):
    print("\n▶ Videos")
    SCHEMA = {
        "Titulo":            None,
        "Artista":           None,
        "Capa":              None,
        "telegram_file_id":  None,
        "telegram_topic_id": None,
    }
    rows = ler_aba(sh, "Videos", "Vídeos")
    registros = []
    for r in rows:
        # Aba Videos sem cabeçalhos confirmados — tenta variações comuns
        titulo = (r.get("titulo") or r.get("Titulo") or r.get("Nome")
                  or r.get("Título") or r.get("Nome do vídeo") or None)
        if not titulo:
            continue
        registros.append(normalizar(SCHEMA, {
            "Titulo":            titulo,
            "Artista":           r.get("artista") or r.get("Artista") or r.get("enviado_por") or None,
            "Capa":              r.get("thumbnail_url") or r.get("Capa") or r.get("Thumb") or None,
            "telegram_file_id":  r.get("ID do arquivo") or r.get("telegram_file_id") or None,
            "telegram_topic_id": int(r.get("ID do tópico") or r.get("telegram_topic_id") or 0) or None,
        }))
    upsert(sb, "Videos", registros)


def importar_music_videos(sh, sb):
    print("\n▶ Music Videos")
    SCHEMA = {
        "Titulo":            None,
        "Artista":           None,
        "Capa":              None,
        "telegram_file_id":  None,
        "telegram_topic_id": None,
        "tipo":              None,
        "data_lancamento":   None,
    }
    rows = ler_aba(sh, "Music Videos", "MusicVideos", "MVs")
    registros = []
    for r in rows:
        titulo = r.get("Nome") or r.get("Título") or r.get("Titulo") or None
        if not titulo:
            continue
        registros.append(normalizar(SCHEMA, {
            "Titulo":            titulo,
            "Artista":           r.get("Nome do criador") or r.get("Artista") or None,
            "Capa":              r.get("Thumb") or r.get("Capa") or None,
            "telegram_file_id":  r.get("ID do arquivo") or None,
            "telegram_topic_id": int(r["ID do tópico"]) if r.get("ID do tópico") else None,
            "tipo":              r.get("Tipo") or None,
            "data_lancamento":   str(r["Data de lançamento"]) if r.get("Data de lançamento") else None,
        }))
    upsert(sb, "Music Videos", registros)


def importar_top50_spotify(sh, sb):
    print("\n▶ Top_50_Spotify")
    SCHEMA = {
        "posicao":           None,
        "nome_musica":       None,
        "capa_musica":       None,
        "link_audio":        None,
        "telegram_topic_id": None,
    }
    rows = ler_aba(sh, "Top_50_Spotify", "Top 50 Spotify")
    registros = []
    for i, r in enumerate(rows):
        nome = r.get("Nome da música") or r.get("Nome") or None
        if not nome:
            continue
        registros.append(normalizar(SCHEMA, {
            "posicao":           int(r["Posição"]) if r.get("Posição") else i + 1,
            "nome_musica":       nome,
            "capa_musica":       r.get("Capa da música") or r.get("Capa") or None,
            "link_audio":        r.get("Link do áudio") or None,
            "telegram_topic_id": int(r["ID do tópico"]) if r.get("ID do tópico") else None,
        }))
    upsert(sb, "Top_50_Spotify", registros)


def importar_top_apple(sh, sb):
    print("\n▶ Top_Songs_Apple_Music")
    SCHEMA = {
        "posicao":           None,
        "nome_musica":       None,
        "capa_musica":       None,
        "link_audio":        None,
        "telegram_topic_id": None,
    }
    rows = ler_aba(sh, "Top_Songs_Apple_Music", "Top Songs Apple Music")
    registros = []
    for i, r in enumerate(rows):
        nome = r.get("Nome da música") or r.get("Nome") or None
        if not nome:
            continue
        registros.append(normalizar(SCHEMA, {
            "posicao":           int(r["Posição"]) if r.get("Posição") else i + 1,
            "nome_musica":       nome,
            "capa_musica":       r.get("Capa da música") or r.get("Capa") or None,
            "link_audio":        r.get("Link do áudio") or None,
            "telegram_topic_id": int(r["ID do tópico"]) if r.get("ID do tópico") else None,
        }))
    upsert(sb, "Top_Songs_Apple_Music", registros)


def importar_top_yt(sh, sb):
    print("\n▶ Top_Videos_YT")
    SCHEMA = {
        "posicao":           None,
        "nome_video":        None,
        "thumb":             None,
        "link_audio":        None,
        "telegram_topic_id": None,
    }
    rows = ler_aba(sh, "Top_Videos_YT", "Top Videos YT")
    registros = []
    for i, r in enumerate(rows):
        nome = r.get("Nome do vídeo") or r.get("Nome") or None
        if not nome:
            continue
        registros.append(normalizar(SCHEMA, {
            "posicao":           int(r["Posição"]) if r.get("Posição") else i + 1,
            "nome_video":        nome,
            "thumb":             r.get("Thumb") or r.get("Capa") or None,
            "link_audio":        r.get("Link do áudio") or None,
            "telegram_topic_id": int(r["ID do tópico"]) if r.get("ID do tópico") else None,
        }))
    upsert(sb, "Top_Videos_YT", registros)


def importar_comentarios_musicas(sh, sb):
    print("\n▶ Comentarios_Musicas")
    SCHEMA = {
        "telegram_topic_id": None,
        "id_jogador":        None,
        "nome_jogador":      None,
        "comentario":        None,
    }
    rows = ler_aba(sh, "Comentarios_Musicas", "Comentários Músicas")
    registros = []
    for r in rows:
        comentario = r.get("Comentário") or r.get("comentario") or None
        if not comentario:
            continue
        registros.append(normalizar(SCHEMA, {
            "telegram_topic_id": int(r["ID do tópico"]) if r.get("ID do tópico") else None,
            "id_jogador":        str(r["ID do jogador"]) if r.get("ID do jogador") else None,
            "nome_jogador":      r.get("Nome do jogador") or None,
            "comentario":        comentario,
        }))
    upsert(sb, "Comentarios_Musicas", registros)


def importar_comentarios_mv(sh, sb):
    print("\n▶ Comentarios_MV")
    SCHEMA = {
        "telegram_topic_id": None,
        "id_jogador":        None,
        "nome_jogador":      None,
        "comentario":        None,
        "data":              None,
    }
    rows = ler_aba(sh, "Comentarios_MV", "Comentários MV")
    registros = []
    for r in rows:
        comentario = r.get("Comentário") or r.get("comentario") or None
        if not comentario:
            continue
        registros.append(normalizar(SCHEMA, {
            "telegram_topic_id": int(r["ID do tópico"]) if r.get("ID do tópico") else None,
            "id_jogador":        str(r["ID do jogador"]) if r.get("ID do jogador") else None,
            "nome_jogador":      r.get("Nome do jogador") or None,
            "comentario":        comentario,
            "data":              str(r["Data"]) if r.get("Data") else None,
        }))
    upsert(sb, "Comentarios_MV", registros)


def importar_comentarios_videos(sh, sb):
    print("\n▶ Comentarios_Videos")
    SCHEMA = {
        "telegram_topic_id":   None,
        "telegram_message_id": None,
        "texto":               None,
        "autor":               None,
        "id_usuario":          None,
        "data":                None,
        "reacoes":             None,
    }
    rows = ler_aba(sh, "Comentarios_Videos", "Comentários Vídeos")
    registros = []
    for r in rows:
        texto = r.get("texto") or r.get("Comentário") or None
        if not texto:
            continue
        registros.append(normalizar(SCHEMA, {
            "telegram_topic_id":   int(r["telegram_topic_id"]) if r.get("telegram_topic_id") else None,
            "telegram_message_id": int(r["telegram_message_id"]) if r.get("telegram_message_id") else None,
            "texto":               texto,
            "autor":               r.get("autor") or None,
            "id_usuario":          str(r["id_usuario"]) if r.get("id_usuario") else None,
            "data":                str(r["data"]) if r.get("data") else None,
            "reacoes":             str(r["reacoes"]) if r.get("reacoes") else None,
        }))
    upsert(sb, "Comentarios_Videos", registros)


def importar_comentarios_albuns(sh, sb):
    print("\n▶ Comentarios_Albuns")
    SCHEMA = {
        "telegram_topic_id": None,
        "id_jogador":        None,
        "nome_jogador":      None,
        "comentario":        None,
        "data":              None,
    }
    rows = ler_aba(sh, "Comentarios_Albuns", "Comentários Álbuns")
    registros = []
    for r in rows:
        comentario = r.get("Comentário") or r.get("comentario") or None
        if not comentario:
            continue
        registros.append(normalizar(SCHEMA, {
            "telegram_topic_id": int(r["ID do tópico"]) if r.get("ID do tópico") else None,
            "id_jogador":        str(r["ID do jogador"]) if r.get("ID do jogador") else None,
            "nome_jogador":      r.get("Nome do jogador") or None,
            "comentario":        comentario,
            "data":              str(r["Data"]) if r.get("Data") else None,
        }))
    upsert(sb, "Comentarios_Albuns", registros)


# ─── MAIN ────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    if not SUPABASE_KEY:
        raise SystemExit("❌ SUPABASE_KEY não definida. Exporte a variável de ambiente ou edite o script.")

    print("🔌 Conectando...")
    sh, sb = conectar()
    print("✔ Conectado.\n")

    importar_musicas(sh, sb)
    importar_albuns(sh, sb)
    importar_videos(sh, sb)
    importar_music_videos(sh, sb)
    importar_top50_spotify(sh, sb)
    importar_top_apple(sh, sb)
    importar_top_yt(sh, sb)
    importar_comentarios_musicas(sh, sb)
    importar_comentarios_mv(sh, sb)
    importar_comentarios_videos(sh, sb)
    importar_comentarios_albuns(sh, sb)

    print("\n🎉 Importação concluída!")
