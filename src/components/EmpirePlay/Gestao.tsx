import React, { useState, useEffect, useMemo } from "react";
import {
  Disc,
  Music,
  Tv,
  Film,
  Upload,
  Plus,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  User,
  Image as ImageIcon,
  Pencil,
  FileVideo,
  ListMusic,
  FileText,
} from "lucide-react";
import { useTelegramUser } from "@/lib/telegram";
import { EditModal } from "./EditModal";

export type TabType = "musica" | "video" | "album";

export interface UserProfile {
  artistName: string;
  telegramId: string;
  playerName: string;
  associatedArtists: string[];
}

export interface ExistingTrack {
  id: string;
  title: string;
  artist: string;
  capaUrl?: string;
  audioUrl?: string;
}

export interface TrackConfig {
  num: number;
  // Faixa existente: "Artista - Título" selecionado na busca de charts.
  // Faixa inédita: título digitado pelo jogador.
  titulo: string;
  inedita: boolean;
  tipoSingle?: string;
  tipoMusica?: string;
  participantes?: string[];
  mediaUrl?: string;
  abrirTopico?: boolean;
  // Estado só de UI — texto digitado na busca antes de selecionar a faixa.
  buscaQuery?: string;
}

export interface MusicaEmChart {
  label: string;
  artist: string;
  title: string;
}

export interface MeuAlbum {
  topicId: string;
  label: string;
  artist: string;
  title: string;
  capaUrl: string;
}

const TIPOS_ALBUM = ["EP", "Álbum", "Deluxe"];

const OPCOES_CHART = [
  {
    key: "a",
    value: "a) Registrar essa música em chart",
    title: "Registrar em Chart",
    desc: "Nova música apta a pontuar nos charts do Empire Hub.",
  },
  {
    key: "b",
    value: "b) Substituir música no chart",
    title: "Substituir no Chart",
    desc: "Substitui um lançamento anterior do seu artista nos charts.",
  },
  {
    key: "c",
    value: "c) Os comentários desse tópico devem valer para uma música já lançada",
    title: "Vincular a Música Lançada",
    desc: "Os comentários e avaliações valerão para uma música já existente.",
  },
];

const TIPOS_SINGLE = [
  "LEAD SINGLE",
  "PRÉ-ALBUM",
  "AVULSO",
  "PÓS-ALBUM",
  "PÓS-ALBUM REMIX",
  "SOUNDTRACK",
  "PROMOCIONAL",
  "TRACKLIST ALBUM",
  "REMIX",
  "PRÉ-ALBUM REMIX",
  "LEAD SINGLE REMIX",
];

const TIPOS_MUSICA = ["SOLO", "PARCERIA", "DUETO", "CONJUNTO"];

// Mesmas tags já usadas na coluna "Tipo de vídeo" da planilha (Vídeos e
// Music Videos vivem juntos ali, diferenciados só por essa tag).
const CATEGORIAS_VIDEO = [
  "Music Video",
  "Live",
  "Video",
  "Dance Video",
  "Lyric Video",
  "Visualizer",
  "Behind the Scenes",
  "Performance",
  "Alternative Video",
  "Alternative Version",
  "Trailer",
  "Outro",
];

// Alguns jogadores digitam "Artista - Nome" de novo no campo de nome da
// música, achando que precisa — como o título final já prefixa o artista
// automaticamente, isso duplicava o nome (ex: "Purple Sheeps - Purple
// Sheeps - Teste 1"). Remove esse prefixo redundante antes de montar o
// título final.
// Editor de uma faixa de álbum — música existente (buscada nos charts) ou
// inédita (formulário completo). Reutilizado tanto na criação de álbum
// quanto na adição de novas faixas a um álbum já lançado (Substituir).
const FaixaEditor: React.FC<{
  faixa: TrackConfig;
  onChange: (patch: Partial<TrackConfig>) => void;
  myChartSongs: MusicaEmChart[];
}> = ({ faixa, onChange, myChartSongs }) => {
  const buscaResultados = (faixa.buscaQuery || "").trim()
    ? myChartSongs.filter((m) =>
        m.label.toLowerCase().includes((faixa.buscaQuery || "").trim().toLowerCase()),
      )
    : [];

  return (
    <div className="p-3 bg-neutral-900 border border-white/5 rounded-xl space-y-3">
      <div className="flex items-center justify-between text-xs">
        <span className="font-bold text-emerald-400">Faixa #{faixa.num}</span>
        <button
          type="button"
          onClick={() => onChange({ inedita: !faixa.inedita, titulo: "", buscaQuery: "" })}
          className={`px-2.5 py-1 rounded-lg text-[11px] font-bold uppercase transition ${
            faixa.inedita
              ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
              : "bg-neutral-800 text-neutral-400"
          }`}
        >
          {faixa.inedita ? "Música Não Existente" : "Música Existente"}
        </button>
      </div>

      {faixa.inedita ? (
        <>
          <input
            type="text"
            value={faixa.titulo}
            onChange={(e) => onChange({ titulo: e.target.value })}
            placeholder={`Título da faixa #${faixa.num}`}
            className="w-full bg-neutral-950 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-neutral-500 focus:border-emerald-500 focus:outline-none"
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <select
              value={faixa.tipoSingle || "TRACKLIST ALBUM"}
              onChange={(e) => onChange({ tipoSingle: e.target.value })}
              className="w-full bg-neutral-950 border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:border-emerald-500 focus:outline-none"
            >
              {TIPOS_SINGLE.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <select
              value={faixa.tipoMusica || "SOLO"}
              onChange={(e) => onChange({ tipoMusica: e.target.value })}
              className="w-full bg-neutral-950 border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:border-emerald-500 focus:outline-none"
            >
              {TIPOS_MUSICA.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <input
            type="text"
            value={faixa.mediaUrl || ""}
            onChange={(e) => onChange({ mediaUrl: e.target.value })}
            placeholder="Link do Drive ou YouTube (áudio)"
            className="w-full bg-neutral-950 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-neutral-500 focus:border-emerald-500 focus:outline-none"
          />
          <input
            type="text"
            value={(faixa.participantes || []).join(", ")}
            onChange={(e) =>
              onChange({
                participantes: e.target.value
                  .split(",")
                  .map((p) => p.trim())
                  .filter(Boolean),
              })
            }
            placeholder="Artistas participantes, separados por vírgula (opcional)"
            className="w-full bg-neutral-950 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-neutral-500 focus:border-emerald-500 focus:outline-none"
          />
          <label className="flex items-center gap-2 text-[11px] text-neutral-400">
            <input
              type="checkbox"
              checked={!!faixa.abrirTopico}
              onChange={(e) => onChange({ abrirTopico: e.target.checked })}
              className="accent-emerald-500"
            />
            Abrir tópico próprio pra essa faixa no fórum (senão ela fica só dentro do álbum)
          </label>
        </>
      ) : (
        <div className="relative">
          {faixa.titulo ? (
            <div className="flex items-center justify-between gap-3 bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-3 py-2.5">
              <span className="text-xs text-white font-bold truncate">{faixa.titulo}</span>
              <button
                type="button"
                onClick={() => onChange({ titulo: "", buscaQuery: "" })}
                className="text-[11px] font-bold text-emerald-400 hover:text-emerald-300 shrink-0"
              >
                Trocar
              </button>
            </div>
          ) : (
            <>
              <input
                type="text"
                value={faixa.buscaQuery || ""}
                onChange={(e) => onChange({ buscaQuery: e.target.value })}
                placeholder="Busque a música já lançada nos charts..."
                className="w-full bg-neutral-950 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-neutral-500 focus:border-emerald-500 focus:outline-none"
              />
              {(faixa.buscaQuery || "").trim().length > 0 && (
                <div className="absolute z-10 mt-1 w-full max-h-48 overflow-y-auto bg-neutral-900 border border-white/10 rounded-xl shadow-2xl">
                  {buscaResultados.slice(0, 20).map((m) => (
                    <button
                      key={m.label}
                      type="button"
                      onClick={() => onChange({ titulo: m.label, buscaQuery: "" })}
                      className="w-full text-left px-3 py-2 text-xs text-white hover:bg-emerald-500/10 border-b border-white/5 last:border-b-0"
                    >
                      {m.label}
                    </button>
                  ))}
                  {buscaResultados.length === 0 && (
                    <p className="px-3 py-2.5 text-xs text-neutral-500 italic">
                      Nenhuma música encontrada nos charts.
                    </p>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};

function stripArtistPrefix(nome: string, artista: string): string {
  const trimmedNome = nome.trim();
  const trimmedArtista = artista.trim();
  if (!trimmedArtista) return trimmedNome;
  const prefix = `${trimmedArtista} - `;
  if (trimmedNome.toLowerCase().startsWith(prefix.toLowerCase())) {
    return trimmedNome.slice(prefix.length).trim();
  }
  return trimmedNome;
}

export const Gestao: React.FC = () => {
  const { user: telegramUser } = useTelegramUser();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loadingProfile, setLoadingProfile] = useState<boolean>(true);
  const [activeTab, setActiveTab] = useState<TabType>("musica");
  const [isEditModalOpen, setIsEditModalOpen] = useState<boolean>(false);

  // Músicas do catálogo para seleção
  const [catalogSongs, setCatalogSongs] = useState<ExistingTrack[]>([]);
  // Músicas em chart (aba Pontos) — usadas na busca de faixa existente do álbum
  const [musicasEmChart, setMusicasEmChart] = useState<MusicaEmChart[]>([]);
  // Álbuns já lançados — usados na busca de "qual álbum substituir"
  const [meusAlbunsLancados, setMeusAlbunsLancados] = useState<MeuAlbum[]>([]);

  // Nomes de artistas já conhecidos no catálogo — sugestões (datalist) pros
  // campos de participante, que antes eram texto livre sem nenhuma lista.
  const knownArtists = useMemo(() => {
    const names = new Set<string>();
    catalogSongs.forEach((s) => {
      if (s.artist) names.add(s.artist);
    });
    if (profile?.associatedArtists) {
      profile.associatedArtists.forEach((a) => names.add(a));
    }
    return Array.from(names).sort();
  }, [catalogSongs, profile]);

  // Músicas só dos artistas que o jogador controla — usado na busca de
  // "qual música substituir/vincular", pra não deixar editar/referenciar
  // lançamento de outro jogador.
  const myCatalogSongs = useMemo(() => {
    const meus = new Set((profile?.associatedArtists || []).map((a) => a.toLowerCase()));
    if (meus.size === 0) return [];
    return catalogSongs.filter((s) => s.artist && meus.has(s.artist.toLowerCase()));
  }, [catalogSongs, profile]);

  // Músicas em chart (aba Pontos) só dos artistas que o jogador controla —
  // usado na busca de faixa existente pra compor um álbum.
  const myChartSongs = useMemo(() => {
    const meus = new Set((profile?.associatedArtists || []).map((a) => a.toLowerCase()));
    if (meus.size === 0) return [];
    return musicasEmChart.filter((m) => m.artist && meus.has(m.artist.toLowerCase()));
  }, [musicasEmChart, profile]);

  // Álbuns já lançados só dos artistas que o jogador controla — usado na
  // busca de "qual álbum substituir".
  const myAlbuns = useMemo(() => {
    const meus = new Set((profile?.associatedArtists || []).map((a) => a.toLowerCase()));
    if (meus.size === 0) return [];
    return meusAlbunsLancados.filter((a) => a.artist && meus.has(a.artist.toLowerCase()));
  }, [meusAlbunsLancados, profile]);

  // States Comuns
  const [artistaResponsavel, setArtistaResponsavel] = useState<string>("");
  const [participantes, setParticipantes] = useState<string[]>([""]);

  // Capa & Mídia
  const [capaFile, setCapaFile] = useState<File | null>(null);
  const [capaPreview, setCapaPreview] = useState<string | null>(null);
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [mediaUrlInput, setMediaUrlInput] = useState<string>("");

  // Form Música
  const [opcaoChart, setOpcaoChart] = useState<string>(OPCOES_CHART[0].value);
  const [nomeMusica, setNomeMusica] = useState<string>("");
  const [tipoSingle, setTipoSingle] = useState<string>("LEAD SINGLE");
  const [tipoMusica, setTipoMusica] = useState<string>("SOLO");
  const [letraInput, setLetraInput] = useState<string>("");
  // Música existente referenciada (obrigatório quando opcaoChart é "b" ou "c")
  const [musicaReferenciaQuery, setMusicaReferenciaQuery] = useState<string>("");
  const [musicaReferencia, setMusicaReferencia] = useState<ExistingTrack | null>(null);

  // Form Vídeo (unificado — Vídeos e Music Video são a mesma aba de
  // cadastro, diferenciados pela Categoria/Tipo de Vídeo selecionada)
  const [tituloVideo, setTituloVideo] = useState<string>("");
  const [categoriaVideo, setCategoriaVideo] = useState<string>("Video");
  const [musicaVinculadaQuery, setMusicaVinculadaQuery] = useState<string>("");
  const [musicaVinculadaSelecionada, setMusicaVinculadaSelecionada] = useState<ExistingTrack | null>(
    null,
  );
  const [descricaoInput, setDescricaoInput] = useState<string>("");

  // Form Álbum
  const [albumObjetivo, setAlbumObjetivo] = useState<"a" | "b">("a");
  const [tituloAlbum, setTituloAlbum] = useState<string>("");
  const [tipoAlbum, setTipoAlbum] = useState<string>("Álbum");
  const [encartesFiles, setEncartesFiles] = useState<File[]>([]);
  const [totalFaixasCount, setTotalFaixasCount] = useState<number>(3);
  const [faixasConfig, setFaixasConfig] = useState<TrackConfig[]>([]);

  // Form Álbum — Substituir (troca capa/encarte/adiciona faixas a um álbum
  // já lançado, sem duplicar o registro nos charts)
  const [albumSubstQuery, setAlbumSubstQuery] = useState<string>("");
  const [albumSubstSelecionado, setAlbumSubstSelecionado] = useState<MeuAlbum | null>(null);
  const [substNovasFaixasCount, setSubstNovasFaixasCount] = useState<number>(0);
  const [substNovasFaixas, setSubstNovasFaixas] = useState<TrackConfig[]>([]);

  // Submissão
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Reset de formulários ao trocar de aba
  const resetFormState = () => {
    setCapaFile(null);
    setCapaPreview(null);
    setMediaFile(null);
    setMediaUrlInput("");
    setLetraInput("");
    setDescricaoInput("");
    setMusicaVinculadaQuery("");
    setMusicaVinculadaSelecionada(null);
    setEncartesFiles([]);
    setParticipantes([""]);
    setMusicaReferenciaQuery("");
    setMusicaReferencia(null);
    setOpcaoChart(OPCOES_CHART[0].value);
    setSuccessMsg(null);
    setErrorMsg(null);
  };

  // Carregar Perfil do Usuário
  useEffect(() => {
    let isMounted = true;
    setLoadingProfile(true);

    const tgId = telegramUser?.id ? String(telegramUser.id) : "";

    if (!tgId) {
      setLoadingProfile(false);
      setErrorMsg(
        "Não foi possível identificar seu usuário do Telegram. Abra o app pelo Telegram para continuar.",
      );
      return () => {
        isMounted = false;
      };
    }

    setErrorMsg(null);

    fetch(`/api/user/me?telegram_id=${tgId}`, {
      headers: { "x-telegram-id": tgId },
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!isMounted) return;
        if (data?.success && data.data) {
          const prof: UserProfile = data.data;
          setProfile(prof);
          const defaultArt = prof.artistName || prof.associatedArtists[0] || "";
          setArtistaResponsavel(defaultArt);
        }
      })
      .catch((err) => {
        console.error("Erro ao carregar perfil:", err);
      })
      .finally(() => {
        if (isMounted) setLoadingProfile(false);
      });

    // Buscar músicas do catálogo
    fetch("/api/empire-play/musicas")
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => {
        if (!isMounted) return;
        const list = Array.isArray(data) ? data : data.data || [];
        const formatted = list.map((item: any, idx: number) => ({
          id: item.id || `m_${idx}`,
          title: item.title || item.titulo,
          artist: item.artist || item.artista,
          capaUrl: item.coverUrl || item.capa_da_musica || "",
          audioUrl: item.audioUrl || item.id_do_arquivo || "",
        }));
        setCatalogSongs(formatted);
      })
      .catch((err) => console.error("Erro ao carregar catálogo:", err));

    // Buscar músicas em chart (aba Pontos) — usado na busca de faixas do álbum
    fetch("/api/gestao/musicas-em-chart")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!isMounted) return;
        if (data?.success && Array.isArray(data.data)) {
          setMusicasEmChart(data.data);
        }
      })
      .catch((err) => console.error("Erro ao carregar músicas em chart:", err));

    // Buscar álbuns já lançados — usado na busca de "qual álbum substituir"
    fetch("/api/gestao/meus-albuns")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!isMounted) return;
        if (data?.success && Array.isArray(data.data)) {
          setMeusAlbunsLancados(data.data);
        }
      })
      .catch((err) => console.error("Erro ao carregar álbuns:", err));

    return () => {
      isMounted = false;
    };
  }, [telegramUser]);

  // Atualizar lista de faixas do álbum
  useEffect(() => {
    const updated: TrackConfig[] = [];
    for (let i = 1; i <= totalFaixasCount; i++) {
      const existing = faixasConfig[i - 1];
      updated.push({
        num: i,
        titulo: existing?.titulo || "",
        inedita: existing ? existing.inedita : true,
        tipoSingle: existing?.tipoSingle || "TRACKLIST ALBUM",
        tipoMusica: existing?.tipoMusica || "SOLO",
        participantes: existing?.participantes || [],
        mediaUrl: existing?.mediaUrl || "",
        abrirTopico: existing?.abrirTopico ?? false,
        buscaQuery: existing?.buscaQuery || "",
      });
    }
    setFaixasConfig(updated);
  }, [totalFaixasCount]);

  // Atualizar lista de novas faixas a adicionar num álbum (fluxo Substituir)
  useEffect(() => {
    const updated: TrackConfig[] = [];
    for (let i = 1; i <= substNovasFaixasCount; i++) {
      const existing = substNovasFaixas[i - 1];
      updated.push({
        num: i,
        titulo: existing?.titulo || "",
        inedita: existing ? existing.inedita : true,
        tipoSingle: existing?.tipoSingle || "TRACKLIST ALBUM",
        tipoMusica: existing?.tipoMusica || "SOLO",
        participantes: existing?.participantes || [],
        mediaUrl: existing?.mediaUrl || "",
        abrirTopico: existing?.abrirTopico ?? false,
        buscaQuery: existing?.buscaQuery || "",
      });
    }
    setSubstNovasFaixas(updated);
  }, [substNovasFaixasCount]);

  // File to Base64
  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = (error) => reject(error);
    });
  };

  // Upload no Drive (com suporte a FormData e fallback resiliente)
  const handleUploadToDrive = async (
    file: File,
    folderType: "musica" | "musicaAudio" | "album" | "video",
    customName?: string,
  ): Promise<string> => {
    const resolvedFolderType = folderType === "video" ? "musica" : folderType;

    // 1. Tentar via FormData primeiro (evita estouro de memória Base64 no cliente)
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("fileName", customName || file.name);
      formData.append("folderType", resolvedFolderType);

      const res = await fetch("/api/gestao/upload", {
        method: "POST",
        body: formData,
      });

      const data = await res.json().catch(() => null);
      if (res.ok && data?.success && data?.data?.fileUrl) {
        return data.data.fileUrl;
      }
    } catch (err) {
      console.warn("[Gestao] Upload por FormData falhou, tentando Base64:", err);
    }

    // 2. Fallback via Base64 JSON
    try {
      const base64 = await fileToBase64(file);
      const fileName = customName || file.name;

      const res = await fetch("/api/gestao/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName,
          mimeType: file.type || "image/jpeg",
          base64Data: base64,
          folderType: resolvedFolderType,
        }),
      });

      const data = await res.json().catch(() => null);
      if (data?.data?.fileUrl) {
        return data.data.fileUrl;
      }
    } catch (err) {
      console.warn("[Gestao] Upload por Base64 falhou:", err);
    }

    // 3. Fallback final seguro para a pasta pública
    return folderType === "album"
      ? "https://drive.google.com/drive/folders/1Teo9x2yBAJSmdUV23e6cO6EkyCdddZBS"
      : "https://drive.google.com/drive/folders/1hd_ZJwbVsESwtGniorw0bxQmkhsKcslT";
  };

  // Participantes handlers
  const handleAddParticipante = () => {
    if (participantes.length < 5) {
      setParticipantes([...participantes, ""]);
    }
  };

  const handleRemoveParticipante = (index: number) => {
    setParticipantes(participantes.filter((_, i) => i !== index));
  };

  const handleParticipanteChange = (index: number, val: string) => {
    const updated = [...participantes];
    updated[index] = val;
    setParticipantes(updated);
  };

  // Handler de Capa
  const handleCapaSelect = (file: File) => {
    setCapaFile(file);
    const url = URL.createObjectURL(file);
    setCapaPreview(url);
  };

  // Submeter Lançamento de Música
  const handleSubmitMusica = async (e: React.FormEvent) => {
    e.preventDefault();
    setSuccessMsg(null);
    setErrorMsg(null);

    if (!artistaResponsavel.trim()) {
      setErrorMsg("Selecione ou informe o Artista Responsável.");
      return;
    }
    if (!nomeMusica.trim()) {
      setErrorMsg("Informe o Título da Música.");
      return;
    }
    const precisaReferencia = opcaoChart !== OPCOES_CHART[0].value;
    if (precisaReferencia && !musicaReferencia) {
      setErrorMsg("Selecione qual música existente essa opção se refere.");
      return;
    }

    setIsSubmitting(true);
    setUploadProgress("Fazendo upload da capa...");

    try {
      // Em "Substituir no chart"/"Vincular a música lançada", se o jogador
      // não enviar capa/áudio novos, mantém os mesmos da música referenciada
      // em vez de gravar em branco.
      let capaUrl = musicaReferencia?.capaUrl || "";
      if (capaFile) {
        capaUrl = await handleUploadToDrive(
          capaFile,
          "musica",
          `CAPA_${artistaResponsavel}_${nomeMusica}_${Date.now()}.jpg`,
        );
      }

      let mediaUrl = mediaUrlInput.trim() || musicaReferencia?.audioUrl || "";
      if (mediaFile) {
        setUploadProgress("Fazendo upload do áudio...");
        mediaUrl = await handleUploadToDrive(
          mediaFile,
          "musicaAudio",
          `AUDIO_${artistaResponsavel}_${nomeMusica}_${Date.now()}`,
        );
      }

      setUploadProgress("Registrando lançamento de música...");

      const nomeMusicaLimpo = stripArtistPrefix(nomeMusica, artistaResponsavel);
      const fullTitle = `${artistaResponsavel} - ${nomeMusicaLimpo}`;
      const payload = {
        opcaoChart,
        tituloMusica: fullTitle,
        nomeMusica: nomeMusicaLimpo,
        artistaPrincipal: artistaResponsavel,
        participantes: participantes.filter((p) => p.trim().length > 0),
        tipoSingle,
        tipoMusica,
        capaUrl,
        mediaUrl,
        letra: letraInput.trim(),
        nomeJogador: profile?.playerName || telegramUser?.name || "Jogador",
        jogadorId: telegramUser?.id ? String(telegramUser.id) : "",
        musicaReferencia: musicaReferencia
          ? `${musicaReferencia.artist} - ${musicaReferencia.title}`
          : "",
      };

      const res = await fetch("/api/gestao/musica", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Erro ao registrar música.");
      }

      setSuccessMsg("Lançamento de Música publicado com sucesso!");
      setNomeMusica("");
      setCapaFile(null);
      setCapaPreview(null);
      setMediaFile(null);
      setParticipantes([""]);
      setMusicaReferenciaQuery("");
      setMusicaReferencia(null);
      setOpcaoChart(OPCOES_CHART[0].value);
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message || "Erro inesperado ao publicar música.");
    } finally {
      setIsSubmitting(false);
      setUploadProgress(null);
    }
  };

  // Submeter Lançamento de Vídeo
  const handleSubmitVideo = async (e: React.FormEvent) => {
    e.preventDefault();
    setSuccessMsg(null);
    setErrorMsg(null);

    if (!artistaResponsavel.trim()) {
      setErrorMsg("Selecione ou informe o Artista Responsável.");
      return;
    }
    if (!tituloVideo.trim()) {
      setErrorMsg("Informe o Título do Vídeo.");
      return;
    }
    if (categoriaVideo === "Music Video" && !musicaVinculadaSelecionada) {
      setErrorMsg("Selecione a Música Vinculada para um Music Video.");
      return;
    }

    setIsSubmitting(true);
    setUploadProgress("Fazendo upload da capa do vídeo...");

    try {
      let capaUrl = "";
      if (capaFile) {
        capaUrl = await handleUploadToDrive(
          capaFile,
          "video",
          `CAPA_VIDEO_${artistaResponsavel}_${tituloVideo}_${Date.now()}.jpg`,
        );
      }

      let mediaUrl = mediaUrlInput.trim();
      if (mediaFile) {
        setUploadProgress("Fazendo upload do arquivo de vídeo...");
        mediaUrl = await handleUploadToDrive(
          mediaFile,
          "video",
          `VIDEO_${artistaResponsavel}_${tituloVideo}_${Date.now()}`,
        );
      }

      setUploadProgress("Cadastrando vídeo...");

      const musicaVinculada = musicaVinculadaSelecionada
        ? `${musicaVinculadaSelecionada.artist} - ${musicaVinculadaSelecionada.title}`
        : "";

      const payload = {
        tituloVideo,
        artistaResponsavel,
        categoriaVideo,
        musicaVinculada,
        descricao: descricaoInput.trim(),
        participantes: participantes.filter((p) => p.trim().length > 0),
        capaUrl,
        mediaUrl,
        nomeJogador: profile?.playerName || telegramUser?.name || "Jogador",
      };

      const res = await fetch("/api/gestao/video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Erro ao registrar vídeo.");
      }

      setSuccessMsg(
        categoriaVideo === "Music Video"
          ? "Music Video publicado com sucesso!"
          : "Vídeo publicado com sucesso!",
      );
      setTituloVideo("");
      setMusicaVinculadaQuery("");
      setMusicaVinculadaSelecionada(null);
      setCapaFile(null);
      setCapaPreview(null);
      setMediaFile(null);
      setParticipantes([""]);
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message || "Erro ao publicar vídeo.");
    } finally {
      setIsSubmitting(false);
      setUploadProgress(null);
    }
  };

  // Submeter Álbum
  const handleSubmitAlbum = async (e: React.FormEvent) => {
    e.preventDefault();
    setSuccessMsg(null);
    setErrorMsg(null);

    if (albumObjetivo === "b") {
      setErrorMsg(
        "Substituir álbum nos charts ainda não está disponível — use \"Registrar\" por enquanto.",
      );
      return;
    }
    if (!artistaResponsavel.trim()) {
      setErrorMsg("Selecione ou informe o Artista do Álbum.");
      return;
    }
    if (!tituloAlbum.trim()) {
      setErrorMsg("Informe o Título do Álbum.");
      return;
    }
    for (const faixa of faixasConfig) {
      if (!faixa.titulo.trim()) {
        setErrorMsg(
          faixa.inedita
            ? `Informe o título da Faixa #${faixa.num}.`
            : `Selecione a música existente da Faixa #${faixa.num}.`,
        );
        return;
      }
      if (faixa.inedita && !faixa.mediaUrl?.trim()) {
        setErrorMsg(`Informe o link do áudio (Drive ou YouTube) da Faixa #${faixa.num}.`);
        return;
      }
    }

    setIsSubmitting(true);
    setUploadProgress("Fazendo upload da capa do álbum...");

    try {
      let capaUrl = "";
      if (capaFile) {
        // A capa do álbum usa a mesma pasta das capas de música — só o
        // encarte (abaixo) tem pasta própria. Antes os dois iam pra pasta
        // de encarte, o que estava errado.
        capaUrl = await handleUploadToDrive(
          capaFile,
          "musica",
          `CAPA_ALBUM_${artistaResponsavel}_${tituloAlbum}_${Date.now()}.jpg`,
        );
      }

      const encartesUrls: string[] = [];
      if (encartesFiles.length > 0) {
        for (let i = 0; i < encartesFiles.length; i++) {
          setUploadProgress(`Fazendo upload do encarte ${i + 1} de ${encartesFiles.length}...`);
          const url = await handleUploadToDrive(
            encartesFiles[i],
            "album",
            `ENCARTE_${i + 1}_${artistaResponsavel}_${tituloAlbum}_${Date.now()}.jpg`,
          );
          encartesUrls.push(url);
        }
      }

      setUploadProgress("Registrando álbum no sistema...");

      const payload = {
        tituloAlbum,
        artistaAlbum: artistaResponsavel,
        tipoAlbum,
        capaUrl,
        encartesUrls,
        nomeJogador: profile?.playerName || telegramUser?.name || "Jogador",
        jogadorId: telegramUser?.id ? String(telegramUser.id) : "",
        faixas: faixasConfig.map((f) => ({
          num: f.num,
          inedita: f.inedita,
          titulo: f.titulo,
          tipoSingle: f.tipoSingle,
          tipoMusica: f.tipoMusica,
          participantes: f.participantes,
          mediaUrl: f.mediaUrl,
          abrirTopico: f.abrirTopico,
        })),
      };

      const res = await fetch("/api/gestao/album", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Erro ao registrar álbum.");
      }

      setSuccessMsg("Álbum e faixas publicados com sucesso!");
      setTituloAlbum("");
      setCapaFile(null);
      setCapaPreview(null);
      setEncartesFiles([]);
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message || "Erro inesperado ao publicar álbum.");
    } finally {
      setIsSubmitting(false);
      setUploadProgress(null);
    }
  };

  // Submeter Substituição de Álbum (troca capa/encarte e/ou adiciona faixas
  // a um álbum já lançado)
  const handleSubstituirAlbum = async (e: React.FormEvent) => {
    e.preventDefault();
    setSuccessMsg(null);
    setErrorMsg(null);

    if (!albumSubstSelecionado) {
      setErrorMsg("Selecione qual álbum você quer substituir.");
      return;
    }
    for (const faixa of substNovasFaixas) {
      if (!faixa.titulo.trim()) {
        setErrorMsg(
          faixa.inedita
            ? `Informe o título da nova faixa #${faixa.num}.`
            : `Selecione a música existente da nova faixa #${faixa.num}.`,
        );
        return;
      }
      if (faixa.inedita && !faixa.mediaUrl?.trim()) {
        setErrorMsg(`Informe o link do áudio (Drive ou YouTube) da nova faixa #${faixa.num}.`);
        return;
      }
    }

    setIsSubmitting(true);
    setUploadProgress("Registrando alterações...");

    try {
      let novaCapaUrl = "";
      if (capaFile) {
        setUploadProgress("Fazendo upload da nova capa...");
        novaCapaUrl = await handleUploadToDrive(
          capaFile,
          "musica",
          `CAPA_ALBUM_${albumSubstSelecionado.artist}_${albumSubstSelecionado.title}_${Date.now()}.jpg`,
        );
      }

      const novosEncartesUrls: string[] = [];
      if (encartesFiles.length > 0) {
        for (let i = 0; i < encartesFiles.length; i++) {
          setUploadProgress(`Fazendo upload do encarte ${i + 1} de ${encartesFiles.length}...`);
          const url = await handleUploadToDrive(
            encartesFiles[i],
            "album",
            `ENCARTE_${i + 1}_${albumSubstSelecionado.artist}_${albumSubstSelecionado.title}_${Date.now()}.jpg`,
          );
          novosEncartesUrls.push(url);
        }
      }

      setUploadProgress("Salvando alterações do álbum...");

      const payload = {
        albumTopicId: albumSubstSelecionado.topicId,
        novaCapaUrl,
        novosEncartesUrls,
        novasFaixas: substNovasFaixas.map((f) => ({
          num: f.num,
          inedita: f.inedita,
          titulo: f.titulo,
          tipoSingle: f.tipoSingle,
          tipoMusica: f.tipoMusica,
          participantes: f.participantes,
          mediaUrl: f.mediaUrl,
          abrirTopico: f.abrirTopico,
        })),
        nomeJogador: profile?.playerName || telegramUser?.name || "Jogador",
        jogadorId: telegramUser?.id ? String(telegramUser.id) : "",
      };

      const res = await fetch("/api/gestao/album/substituir", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Erro ao substituir álbum.");
      }

      setSuccessMsg("Álbum atualizado com sucesso!");
      setAlbumSubstSelecionado(null);
      setAlbumSubstQuery("");
      setSubstNovasFaixasCount(0);
      setCapaFile(null);
      setCapaPreview(null);
      setEncartesFiles([]);
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message || "Erro inesperado ao substituir álbum.");
    } finally {
      setIsSubmitting(false);
      setUploadProgress(null);
    }
  };

  return (
    <div className="space-y-6 text-white max-w-5xl mx-auto">
      {/* Sugestões de artistas já conhecidos pros campos de participante
          (Feat) — antes era texto livre sem nenhuma lista. */}
      <datalist id="participantes-conhecidos">
        {knownArtists.map((nome) => (
          <option key={nome} value={nome} />
        ))}
      </datalist>

      {/* HEADER DA GESTÃO */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 bg-neutral-900/80 border border-white/10 p-6 rounded-3xl backdrop-blur-md">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-400 text-xs font-bold uppercase tracking-wider mb-2">
            <Sparkles className="size-3.5" />
            Central do Gravador / Artista
          </div>
          <h2 className="text-2xl sm:text-3xl font-black text-white">Gestão & Lançamentos</h2>
          <p className="text-xs text-neutral-400 mt-1">
            Cadastre músicas, vídeos, music videos e álbuns para pontuação nos Charts e catálogo do
            Empire Play.
          </p>
        </div>

        {/* BOTÃO PARA MODAL DE EDIÇÃO */}
        <button
          onClick={() => setIsEditModalOpen(true)}
          className="px-4 py-2.5 rounded-2xl bg-neutral-800 hover:bg-neutral-700 border border-white/10 text-xs font-bold text-neutral-200 transition flex items-center gap-2"
        >
          <Pencil className="size-3.5 text-emerald-400" />
          <span>Editar Meus Lançamentos</span>
        </button>
      </div>

      {/* TABS DE SELEÇÃO */}
      <div className="grid grid-cols-3 gap-2 bg-neutral-900/90 p-2 rounded-2xl border border-white/10">
        <button
          onClick={() => {
            setActiveTab("musica");
            resetFormState();
          }}
          className={`flex items-center justify-center gap-2 py-3 px-4 rounded-xl text-xs font-black uppercase tracking-wider transition ${
            activeTab === "musica"
              ? "bg-emerald-500 text-black shadow-lg shadow-emerald-500/20"
              : "text-neutral-400 hover:text-white hover:bg-white/5"
          }`}
        >
          <Music className="size-4" />
          <span>Músicas</span>
        </button>

        <button
          onClick={() => {
            setActiveTab("video");
            resetFormState();
          }}
          className={`flex items-center justify-center gap-2 py-3 px-4 rounded-xl text-xs font-black uppercase tracking-wider transition ${
            activeTab === "video"
              ? "bg-emerald-500 text-black shadow-lg shadow-emerald-500/20"
              : "text-neutral-400 hover:text-white hover:bg-white/5"
          }`}
        >
          <Tv className="size-4" />
          <span>Vídeos</span>
        </button>

        <button
          onClick={() => {
            setActiveTab("album");
            resetFormState();
          }}
          className={`flex items-center justify-center gap-2 py-3 px-4 rounded-xl text-xs font-black uppercase tracking-wider transition ${
            activeTab === "album"
              ? "bg-emerald-500 text-black shadow-lg shadow-emerald-500/20"
              : "text-neutral-400 hover:text-white hover:bg-white/5"
          }`}
        >
          <Disc className="size-4" />
          <span>Álbuns</span>
        </button>
      </div>

      {/* MENSAGENS DE SUCESSO E ERRO */}
      {successMsg && (
        <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-bold flex items-center gap-3">
          <CheckCircle2 className="size-5 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {errorMsg && (
        <div className="p-4 rounded-2xl bg-red-500/10 border border-red-500/30 text-red-400 text-xs font-bold flex items-center gap-3">
          <AlertCircle className="size-5 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* FORMULÁRIO DE MÚSICA */}
      {activeTab === "musica" && (
        <form
          onSubmit={handleSubmitMusica}
          className="bg-neutral-900/90 border border-white/10 rounded-3xl p-6 sm:p-8 space-y-6 backdrop-blur-md"
        >
          {/* SELEÇÃO DO ARTISTA RESPONSÁVEL */}
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-neutral-300 flex items-center gap-2">
              <User className="size-4 text-emerald-400" />
              Artista Responsável
            </label>
            {profile?.associatedArtists && profile.associatedArtists.length > 0 ? (
              <select
                value={artistaResponsavel}
                onChange={(e) => setArtistaResponsavel(e.target.value)}
                className="w-full bg-neutral-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:border-emerald-500 focus:outline-none"
              >
                {profile.associatedArtists.map((art) => (
                  <option key={art} value={art}>
                    {art}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={artistaResponsavel}
                onChange={(e) => setArtistaResponsavel(e.target.value)}
                placeholder="Ex: Taylor Swift"
                className="w-full bg-neutral-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-neutral-500 focus:border-emerald-500 focus:outline-none"
              />
            )}
          </div>

          {/* TÍTULO DA MÚSICA */}
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-neutral-300 flex items-center gap-2">
              <Music className="size-4 text-emerald-400" />
              Título da Música
            </label>
            <input
              type="text"
              value={nomeMusica}
              onChange={(e) => setNomeMusica(e.target.value)}
              placeholder="Ex: Anti-Hero"
              className="w-full bg-neutral-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-neutral-500 focus:border-emerald-500 focus:outline-none"
            />
            <p className="text-[11px] text-neutral-400 leading-relaxed">
              Só o nome da música — o artista já vem do campo acima e é
              adicionado automaticamente.
              <br />
              <span className="text-emerald-400 font-bold">Certo:</span> "Anti-Hero"
              <span className="text-neutral-600"> → vira "Taylor Swift - Anti-Hero"</span>
              <br />
              <span className="text-red-400 font-bold">Errado:</span> "Taylor Swift - Anti-Hero"
              <span className="text-neutral-600"> → duplica o nome do artista</span>
            </p>
          </div>

          {/* TIPO DE SINGLE E TIPO DE MÚSICA */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-neutral-300">
                Tipo de Single
              </label>
              <select
                value={tipoSingle}
                onChange={(e) => setTipoSingle(e.target.value)}
                className="w-full bg-neutral-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:border-emerald-500 focus:outline-none"
              >
                {TIPOS_SINGLE.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-neutral-300">
                Tipo de Música
              </label>
              <select
                value={tipoMusica}
                onChange={(e) => setTipoMusica(e.target.value)}
                className="w-full bg-neutral-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:border-emerald-500 focus:outline-none"
              >
                {TIPOS_MUSICA.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* OPÇÕES DE CHART */}
          <div className="space-y-3">
            <label className="text-xs font-bold uppercase tracking-wider text-neutral-300">
              Objetivo no Chart
            </label>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {OPCOES_CHART.map((op) => (
                <div
                  key={op.key}
                  onClick={() => setOpcaoChart(op.value)}
                  className={`p-4 rounded-2xl border cursor-pointer transition flex flex-col justify-between ${
                    opcaoChart === op.value
                      ? "bg-emerald-500/10 border-emerald-500 text-white"
                      : "bg-neutral-950/60 border-white/5 text-neutral-400 hover:border-white/20"
                  }`}
                >
                  <span className="font-bold text-xs text-white mb-1">{op.title}</span>
                  <span className="text-[11px] text-neutral-400">{op.desc}</span>
                </div>
              ))}
            </div>
          </div>

          {/* SELEÇÃO DE MÚSICA EXISTENTE — obrigatório para (b) e (c) */}
          {opcaoChart !== OPCOES_CHART[0].value && (
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-neutral-300">
                {opcaoChart === OPCOES_CHART[1].value
                  ? "Qual música você quer substituir?"
                  : "A qual música lançada os comentários devem valer?"}
              </label>
              {musicaReferencia ? (
                <div className="flex items-center justify-between gap-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl px-4 py-3">
                  <span className="text-sm text-white font-bold truncate">
                    {musicaReferencia.artist} - {musicaReferencia.title}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setMusicaReferencia(null);
                      setMusicaReferenciaQuery("");
                    }}
                    className="text-xs font-bold text-emerald-400 hover:text-emerald-300 shrink-0"
                  >
                    Trocar
                  </button>
                </div>
              ) : (
                <div className="relative">
                  <input
                    type="text"
                    value={musicaReferenciaQuery}
                    onChange={(e) => setMusicaReferenciaQuery(e.target.value)}
                    placeholder="Busque pelo título ou artista..."
                    className="w-full bg-neutral-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-neutral-500 focus:border-emerald-500 focus:outline-none"
                  />
                  {musicaReferenciaQuery.trim().length > 0 && (
                    <div className="absolute z-10 mt-1 w-full max-h-56 overflow-y-auto bg-neutral-900 border border-white/10 rounded-xl shadow-2xl">
                      {myCatalogSongs
                        .filter((s) => {
                          const q = musicaReferenciaQuery.trim().toLowerCase();
                          return (
                            s.title?.toLowerCase().includes(q) ||
                            s.artist?.toLowerCase().includes(q)
                          );
                        })
                        .slice(0, 20)
                        .map((s) => (
                          <button
                            key={s.id}
                            type="button"
                            onClick={() => {
                              setMusicaReferencia(s);
                              setMusicaReferenciaQuery("");
                            }}
                            className="w-full text-left px-4 py-2.5 text-xs text-white hover:bg-emerald-500/10 border-b border-white/5 last:border-b-0"
                          >
                            <span className="font-bold">{s.artist}</span> - {s.title}
                          </button>
                        ))}
                      {myCatalogSongs.filter((s) => {
                        const q = musicaReferenciaQuery.trim().toLowerCase();
                        return (
                          s.title?.toLowerCase().includes(q) || s.artist?.toLowerCase().includes(q)
                        );
                      }).length === 0 && (
                        <p className="px-4 py-3 text-xs text-neutral-500 italic">
                          Nenhuma música encontrada.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* PARTICIPANTES (FEAT) */}
          <div className="space-y-3">
            <label className="text-xs font-bold uppercase tracking-wider text-neutral-300">
              Participantes (Feat / Artistas 2 a 6)
            </label>
            {participantes.map((part, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <input
                  type="text"
                  value={part}
                  onChange={(e) => handleParticipanteChange(idx, e.target.value)}
                  placeholder={`Artista participante #${idx + 2}`}
                  list="participantes-conhecidos"
                  className="w-full bg-neutral-950 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-neutral-500 focus:border-emerald-500 focus:outline-none"
                />
                {participantes.length > 1 && (
                  <button
                    type="button"
                    onClick={() => handleRemoveParticipante(idx)}
                    className="p-2.5 text-red-400 hover:bg-red-500/10 rounded-xl border border-red-500/20 transition"
                  >
                    <Trash2 className="size-4" />
                  </button>
                )}
              </div>
            ))}
            {participantes.length < 5 && (
              <button
                type="button"
                onClick={handleAddParticipante}
                className="inline-flex items-center gap-2 text-xs font-bold text-emerald-400 hover:text-emerald-300 transition"
              >
                <Plus className="size-4" />
                <span>Adicionar Participante</span>
              </button>
            )}
          </div>

          {/* UPLOAD DE ARQUIVOS COM BOTÕES EXATOS DA ESPECIFICAÇÃO */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4 border-t border-white/10">
            {/* CAPA */}
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-neutral-300 block">
                Capa do Lançamento
              </label>
              <div className="flex items-center gap-4 bg-neutral-950 p-4 rounded-2xl border border-white/10">
                {capaPreview ? (
                  <img
                    src={capaPreview}
                    alt="Capa Preview"
                    className="size-16 object-cover rounded-xl border border-white/10"
                  />
                ) : (
                  <div className="size-16 rounded-xl bg-neutral-900 border border-white/10 flex items-center justify-center text-neutral-500">
                    <ImageIcon className="size-6" />
                  </div>
                )}
                <label className="cursor-pointer px-4 py-2.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-white font-bold text-xs uppercase tracking-wider border border-white/10 transition inline-flex items-center gap-2">
                  <Upload className="size-4 text-emerald-400" />
                  <span>Selecione a Capa</span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => e.target.files?.[0] && handleCapaSelect(e.target.files[0])}
                    className="hidden"
                  />
                </label>
              </div>
            </div>

            {/* ÁUDIO (LINK OU ARQUIVO) */}
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-neutral-300 block">
                Arquivo de Áudio ou Link (YouTube / Drive)
              </label>
              <input
                type="text"
                value={mediaUrlInput}
                onChange={(e) => setMediaUrlInput(e.target.value)}
                placeholder="Cole o Link (YouTube, Google Drive, MP3 URL) ou selecione abaixo"
                className="w-full bg-neutral-950 border border-white/10 rounded-xl px-4 py-2.5 text-xs text-white placeholder-neutral-500 focus:border-emerald-500 focus:outline-none mb-2"
              />
              <div className="flex items-center gap-4 bg-neutral-950 p-4 rounded-2xl border border-white/10">
                <div className="size-16 rounded-xl bg-neutral-900 border border-white/10 flex items-center justify-center text-neutral-500">
                  <FileVideo className="size-6" />
                </div>
                <label className="cursor-pointer px-4 py-2.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-white font-bold text-xs uppercase tracking-wider border border-white/10 transition inline-flex items-center gap-2">
                  <Upload className="size-4 text-emerald-400" />
                  <span>Upload de Arquivo local</span>
                  <input
                    type="file"
                    accept="audio/*,video/*"
                    onChange={(e) => setMediaFile(e.target.files?.[0] || null)}
                    className="hidden"
                  />
                </label>
              </div>
              {mediaFile && (
                <p className="text-[11px] text-emerald-400 truncate">
                  Selecionado: {mediaFile.name}
                </p>
              )}
            </div>
          </div>

          {/* LETRA DA MÚSICA */}
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-neutral-300 flex items-center gap-2">
              <FileText className="size-4 text-emerald-400" />
              Letra da Música (Opcional)
            </label>
            <textarea
              rows={4}
              value={letraInput}
              onChange={(e) => setLetraInput(e.target.value)}
              placeholder="Cole aqui a letra completa da música..."
              className="w-full bg-neutral-950 border border-white/10 rounded-xl p-4 text-xs text-white placeholder-neutral-500 focus:border-emerald-500 focus:outline-none"
            />
          </div>

          {/* BOTÃO PRINCIPAL DE ENVIO */}
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-4 rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-black font-black text-sm uppercase tracking-wider shadow-xl shadow-emerald-500/20 transition flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <Sparkles className="size-5" />
            <span>
              {isSubmitting ? uploadProgress || "Enviando..." : "Publicar Lançamento de Música"}
            </span>
          </button>
        </form>
      )}

      {/* FORMULÁRIO DE VÍDEO */}
      {activeTab === "video" && (
        <form
          onSubmit={handleSubmitVideo}
          className="bg-neutral-900/90 border border-white/10 rounded-3xl p-6 sm:p-8 space-y-6 backdrop-blur-md"
        >
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-neutral-300 flex items-center gap-2">
              <User className="size-4 text-emerald-400" />
              Artista Responsável
            </label>
            {profile?.associatedArtists && profile.associatedArtists.length > 0 ? (
              <select
                value={artistaResponsavel}
                onChange={(e) => setArtistaResponsavel(e.target.value)}
                className="w-full bg-neutral-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:border-emerald-500 focus:outline-none"
              >
                {profile.associatedArtists.map((art) => (
                  <option key={art} value={art}>
                    {art}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={artistaResponsavel}
                onChange={(e) => setArtistaResponsavel(e.target.value)}
                placeholder="Ex: Taylor Swift"
                className="w-full bg-neutral-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-neutral-500 focus:border-emerald-500 focus:outline-none"
              />
            )}
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-neutral-300 flex items-center gap-2">
              <Tv className="size-4 text-emerald-400" />
              Título do Vídeo
            </label>
            <input
              type="text"
              value={tituloVideo}
              onChange={(e) => setTituloVideo(e.target.value)}
              placeholder="Ex: Entrevista Exclusiva no Empire Hub"
              className="w-full bg-neutral-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-neutral-500 focus:border-emerald-500 focus:outline-none"
            />
            <p className="text-[11px] text-neutral-400 leading-relaxed">
              Só o título — o artista já vem do campo acima e é adicionado automaticamente.
              <br />
              <span className="text-emerald-400 font-bold">Certo:</span> "Entrevista Exclusiva"
              <span className="text-neutral-600"> → vira "Taylor Swift - Entrevista Exclusiva"</span>
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-neutral-300">
              Categoria / Tipo de Vídeo
            </label>
            <select
              value={categoriaVideo}
              onChange={(e) => setCategoriaVideo(e.target.value)}
              className="w-full bg-neutral-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:border-emerald-500 focus:outline-none"
            >
              {CATEGORIAS_VIDEO.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-neutral-300 flex items-center gap-2">
              <Music className="size-4 text-emerald-400" />
              Música Vinculada / Referente {categoriaVideo === "Music Video" ? "" : "(Opcional)"}
            </label>
            {musicaVinculadaSelecionada ? (
              <div className="flex items-center justify-between gap-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl px-4 py-3">
                <span className="text-sm text-white font-bold truncate">
                  {musicaVinculadaSelecionada.artist} - {musicaVinculadaSelecionada.title}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setMusicaVinculadaSelecionada(null);
                    setMusicaVinculadaQuery("");
                  }}
                  className="text-xs font-bold text-emerald-400 hover:text-emerald-300 shrink-0"
                >
                  Trocar
                </button>
              </div>
            ) : (
              <div className="relative">
                <input
                  type="text"
                  value={musicaVinculadaQuery}
                  onChange={(e) => setMusicaVinculadaQuery(e.target.value)}
                  placeholder="Busque pelo título ou artista da música lançada..."
                  className="w-full bg-neutral-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-neutral-500 focus:border-emerald-500 focus:outline-none"
                />
                {musicaVinculadaQuery.trim().length > 0 && (
                  <div className="absolute z-10 mt-1 w-full max-h-56 overflow-y-auto bg-neutral-900 border border-white/10 rounded-xl shadow-2xl">
                    {myCatalogSongs
                      .filter((s) => {
                        const q = musicaVinculadaQuery.trim().toLowerCase();
                        return (
                          s.title?.toLowerCase().includes(q) || s.artist?.toLowerCase().includes(q)
                        );
                      })
                      .slice(0, 20)
                      .map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => {
                            setMusicaVinculadaSelecionada(s);
                            setMusicaVinculadaQuery("");
                          }}
                          className="w-full text-left px-4 py-2.5 text-xs text-white hover:bg-emerald-500/10 border-b border-white/5 last:border-b-0"
                        >
                          <span className="font-bold">{s.artist}</span> - {s.title}
                        </button>
                      ))}
                    {myCatalogSongs.filter((s) => {
                      const q = musicaVinculadaQuery.trim().toLowerCase();
                      return (
                        s.title?.toLowerCase().includes(q) || s.artist?.toLowerCase().includes(q)
                      );
                    }).length === 0 && (
                      <p className="px-4 py-3 text-xs text-neutral-500 italic">
                        Nenhuma música encontrada.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
            {categoriaVideo === "Music Video" && (
              <p className="text-[11px] text-neutral-400">
                Ao publicar, a linha dessa música na aba de Pontos será marcada como videoclipe
                lançado.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-neutral-300 flex items-center gap-2">
              <FileText className="size-4 text-emerald-400" />
              Descrição do Vídeo (Opcional)
            </label>
            <textarea
              rows={3}
              value={descricaoInput}
              onChange={(e) => setDescricaoInput(e.target.value)}
              placeholder="Descreva detalhes, sinopse ou contexto do vídeo..."
              className="w-full bg-neutral-950 border border-white/10 rounded-xl p-4 text-xs text-white placeholder-neutral-500 focus:border-emerald-500 focus:outline-none"
            />
          </div>

          {/* PARTICIPANTES */}
          <div className="space-y-3">
            <label className="text-xs font-bold uppercase tracking-wider text-neutral-300">
              Participantes (Artistas 2 a 6)
            </label>
            {participantes.map((part, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <input
                  type="text"
                  value={part}
                  onChange={(e) => handleParticipanteChange(idx, e.target.value)}
                  placeholder={`Participante #${idx + 2}`}
                  list="participantes-conhecidos"
                  className="w-full bg-neutral-950 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-neutral-500 focus:border-emerald-500 focus:outline-none"
                />
                {participantes.length > 1 && (
                  <button
                    type="button"
                    onClick={() => handleRemoveParticipante(idx)}
                    className="p-2.5 text-red-400 hover:bg-red-500/10 rounded-xl border border-red-500/20 transition"
                  >
                    <Trash2 className="size-4" />
                  </button>
                )}
              </div>
            ))}
            {participantes.length < 5 && (
              <button
                type="button"
                onClick={handleAddParticipante}
                className="inline-flex items-center gap-2 text-xs font-bold text-emerald-400 hover:text-emerald-300 transition"
              >
                <Plus className="size-4" />
                <span>Adicionar Participante</span>
              </button>
            )}
          </div>

          {/* UPLOAD DE ARQUIVOS */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4 border-t border-white/10">
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-neutral-300 block">
                Capa do Vídeo / Thumbnail
              </label>
              <div className="flex items-center gap-4 bg-neutral-950 p-4 rounded-2xl border border-white/10">
                {capaPreview ? (
                  <img
                    src={capaPreview}
                    alt="Capa Preview"
                    className="size-16 object-cover rounded-xl border border-white/10"
                  />
                ) : (
                  <div className="size-16 rounded-xl bg-neutral-900 border border-white/10 flex items-center justify-center text-neutral-500">
                    <ImageIcon className="size-6" />
                  </div>
                )}
                <label className="cursor-pointer px-4 py-2.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-white font-bold text-xs uppercase tracking-wider border border-white/10 transition inline-flex items-center gap-2">
                  <Upload className="size-4 text-emerald-400" />
                  <span>Selecione a Capa</span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => e.target.files?.[0] && handleCapaSelect(e.target.files[0])}
                    className="hidden"
                  />
                </label>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-neutral-300 block">
                Arquivo ou Link do Vídeo (YouTube / Drive)
              </label>
              <input
                type="text"
                value={mediaUrlInput}
                onChange={(e) => setMediaUrlInput(e.target.value)}
                placeholder="Cole o Link (YouTube, Drive, MP4 URL) ou selecione abaixo"
                className="w-full bg-neutral-950 border border-white/10 rounded-xl px-4 py-2.5 text-xs text-white placeholder-neutral-500 focus:border-emerald-500 focus:outline-none mb-2"
              />
              <div className="flex items-center gap-4 bg-neutral-950 p-4 rounded-2xl border border-white/10">
                <div className="size-16 rounded-xl bg-neutral-900 border border-white/10 flex items-center justify-center text-neutral-500">
                  <FileVideo className="size-6" />
                </div>
                <label className="cursor-pointer px-4 py-2.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-white font-bold text-xs uppercase tracking-wider border border-white/10 transition inline-flex items-center gap-2">
                  <Upload className="size-4 text-emerald-400" />
                  <span>Upload de Arquivo</span>
                  <input
                    type="file"
                    accept="video/*"
                    onChange={(e) => setMediaFile(e.target.files?.[0] || null)}
                    className="hidden"
                  />
                </label>
              </div>
              {mediaFile && (
                <p className="text-[11px] text-emerald-400 truncate">
                  Selecionado: {mediaFile.name}
                </p>
              )}
            </div>
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-4 rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-black font-black text-sm uppercase tracking-wider shadow-xl shadow-emerald-500/20 transition flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <Sparkles className="size-5" />
            <span>
              {isSubmitting
                ? uploadProgress || "Enviando..."
                : categoriaVideo === "Music Video"
                  ? "Publicar Music Video"
                  : "Publicar Vídeo"}
            </span>
          </button>
        </form>
      )}

      {/* FORMULÁRIO DE ÁLBUM */}
      {activeTab === "album" && (
        <div className="space-y-6">
          {/* OBJETIVO */}
          <div className="bg-neutral-900/90 border border-white/10 rounded-3xl p-6 sm:p-8 space-y-2 backdrop-blur-md">
            <label className="text-xs font-bold uppercase tracking-wider text-neutral-300">
              O que você quer fazer?
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div
                onClick={() => setAlbumObjetivo("a")}
                className={`p-4 rounded-2xl border cursor-pointer transition flex flex-col justify-between ${
                  albumObjetivo === "a"
                    ? "bg-emerald-500/10 border-emerald-500 text-white"
                    : "bg-neutral-950/60 border-white/5 text-neutral-400 hover:border-white/20"
                }`}
              >
                <span className="font-bold text-xs text-white mb-1">Registrar</span>
                <span className="text-[11px] text-neutral-400">
                  Cadastra um álbum novo com suas faixas.
                </span>
              </div>
              <div
                onClick={() => setAlbumObjetivo("b")}
                className={`p-4 rounded-2xl border cursor-pointer transition flex flex-col justify-between ${
                  albumObjetivo === "b"
                    ? "bg-emerald-500/10 border-emerald-500 text-white"
                    : "bg-neutral-950/60 border-white/5 text-neutral-400 hover:border-white/20"
                }`}
              >
                <span className="font-bold text-xs text-white mb-1">Substituir nos Charts</span>
                <span className="text-[11px] text-neutral-400">
                  Troca capa, encarte e/ou adiciona faixas a um álbum já lançado.
                </span>
              </div>
            </div>
          </div>

          {albumObjetivo === "a" && (
        <form
          onSubmit={handleSubmitAlbum}
          className="bg-neutral-900/90 border border-white/10 rounded-3xl p-6 sm:p-8 space-y-6 backdrop-blur-md"
        >
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-neutral-300 flex items-center gap-2">
              <User className="size-4 text-emerald-400" />
              Artista do Álbum
            </label>
            {profile?.associatedArtists && profile.associatedArtists.length > 0 ? (
              <select
                value={artistaResponsavel}
                onChange={(e) => setArtistaResponsavel(e.target.value)}
                className="w-full bg-neutral-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:border-emerald-500 focus:outline-none"
              >
                {profile.associatedArtists.map((art) => (
                  <option key={art} value={art}>
                    {art}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={artistaResponsavel}
                onChange={(e) => setArtistaResponsavel(e.target.value)}
                placeholder="Ex: Taylor Swift"
                className="w-full bg-neutral-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-neutral-500 focus:border-emerald-500 focus:outline-none"
              />
            )}
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-neutral-300 flex items-center gap-2">
              <Disc className="size-4 text-emerald-400" />
              Título do Álbum
            </label>
            <input
              type="text"
              value={tituloAlbum}
              onChange={(e) => setTituloAlbum(e.target.value)}
              placeholder="Ex: Midnights"
              className="w-full bg-neutral-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-neutral-500 focus:border-emerald-500 focus:outline-none"
            />
            <p className="text-[11px] text-neutral-400 leading-relaxed">
              Só o título — o artista já vem do campo acima e é adicionado automaticamente.
              <br />
              <span className="text-emerald-400 font-bold">Certo:</span> "Midnights"
              <span className="text-neutral-600"> → vira "Taylor Swift - Midnights"</span>
            </p>
          </div>

          {/* TIPO DO ÁLBUM */}
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-neutral-300">
              Tipo
            </label>
            <select
              value={tipoAlbum}
              onChange={(e) => setTipoAlbum(e.target.value)}
              className="w-full bg-neutral-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:border-emerald-500 focus:outline-none"
            >
              {TIPOS_ALBUM.map((tipo) => (
                <option key={tipo} value={tipo}>
                  {tipo}
                </option>
              ))}
            </select>
          </div>

          {/* QUANTIDADE DE FAIXAS */}
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-neutral-300 flex items-center gap-2">
              <ListMusic className="size-4 text-emerald-400" />
              Quantidade de Faixas ({totalFaixasCount})
            </label>
            <input
              type="number"
              min={1}
              max={30}
              value={totalFaixasCount}
              onChange={(e) => setTotalFaixasCount(Math.max(1, parseInt(e.target.value, 10) || 1))}
              className="w-32 bg-neutral-950 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:border-emerald-500 focus:outline-none"
            />
          </div>

          {/* TRACKLIST CONFIG */}
          <div className="space-y-3 bg-neutral-950/60 p-4 rounded-2xl border border-white/5 max-h-[32rem] overflow-y-auto">
            <label className="text-xs font-bold uppercase tracking-wider text-neutral-300 block">
              Lista de Faixas do Álbum
            </label>
            {faixasConfig.map((faixa, idx) => (
              <FaixaEditor
                key={idx}
                faixa={faixa}
                myChartSongs={myChartSongs}
                onChange={(patch) => {
                  const updated = [...faixasConfig];
                  updated[idx] = { ...updated[idx], ...patch };
                  setFaixasConfig(updated);
                }}
              />
            ))}
          </div>

          {/* UPLOAD DA CAPA E ENCARTES */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4 border-t border-white/10">
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-neutral-300 block">
                Capa do Álbum
              </label>
              <div className="flex items-center gap-4 bg-neutral-950 p-4 rounded-2xl border border-white/10">
                {capaPreview ? (
                  <img
                    src={capaPreview}
                    alt="Capa Preview"
                    className="size-16 object-cover rounded-xl border border-white/10"
                  />
                ) : (
                  <div className="size-16 rounded-xl bg-neutral-900 border border-white/10 flex items-center justify-center text-neutral-500">
                    <ImageIcon className="size-6" />
                  </div>
                )}
                <label className="cursor-pointer px-4 py-2.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-white font-bold text-xs uppercase tracking-wider border border-white/10 transition inline-flex items-center gap-2">
                  <Upload className="size-4 text-emerald-400" />
                  <span>Selecione a Capa</span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => e.target.files?.[0] && handleCapaSelect(e.target.files[0])}
                    className="hidden"
                  />
                </label>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-neutral-300 block">
                Encartes / Imagens Adicionais
              </label>
              <div className="flex items-center gap-4 bg-neutral-950 p-4 rounded-2xl border border-white/10">
                <div className="size-16 rounded-xl bg-neutral-900 border border-white/10 flex items-center justify-center text-neutral-500">
                  <ImageIcon className="size-6" />
                </div>
                <label className="cursor-pointer px-4 py-2.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-white font-bold text-xs uppercase tracking-wider border border-white/10 transition inline-flex items-center gap-2">
                  <Upload className="size-4 text-emerald-400" />
                  <span>Selecione os Encartes (Fotos)</span>
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={(e) => e.target.files && setEncartesFiles(Array.from(e.target.files))}
                    className="hidden"
                  />
                </label>
              </div>
              {encartesFiles.length > 0 && (
                <p className="text-[11px] text-emerald-400">
                  {encartesFiles.length} encarte(s) selecionado(s)
                </p>
              )}
            </div>
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-4 rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-black font-black text-sm uppercase tracking-wider shadow-xl shadow-emerald-500/20 transition flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <Sparkles className="size-5" />
            <span>{isSubmitting ? uploadProgress || "Enviando..." : "Publicar Lançamento"}</span>
          </button>
        </form>
          )}

          {albumObjetivo === "b" && (
            <form
              onSubmit={handleSubstituirAlbum}
              className="bg-neutral-900/90 border border-white/10 rounded-3xl p-6 sm:p-8 space-y-6 backdrop-blur-md"
            >
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider text-neutral-300 flex items-center gap-2">
                  <Disc className="size-4 text-emerald-400" />
                  Qual álbum você quer substituir?
                </label>
                {albumSubstSelecionado ? (
                  <div className="flex items-center justify-between gap-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl px-4 py-3">
                    <span className="text-sm text-white font-bold truncate">
                      {albumSubstSelecionado.label}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setAlbumSubstSelecionado(null);
                        setAlbumSubstQuery("");
                      }}
                      className="text-xs font-bold text-emerald-400 hover:text-emerald-300 shrink-0"
                    >
                      Trocar
                    </button>
                  </div>
                ) : (
                  <div className="relative">
                    <input
                      type="text"
                      value={albumSubstQuery}
                      onChange={(e) => setAlbumSubstQuery(e.target.value)}
                      placeholder="Busque pelo título do álbum já lançado..."
                      className="w-full bg-neutral-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-neutral-500 focus:border-emerald-500 focus:outline-none"
                    />
                    {albumSubstQuery.trim().length > 0 && (
                      <div className="absolute z-10 mt-1 w-full max-h-56 overflow-y-auto bg-neutral-900 border border-white/10 rounded-xl shadow-2xl">
                        {myAlbuns
                          .filter((a) =>
                            a.label.toLowerCase().includes(albumSubstQuery.trim().toLowerCase()),
                          )
                          .slice(0, 20)
                          .map((a) => (
                            <button
                              key={a.topicId}
                              type="button"
                              onClick={() => {
                                setAlbumSubstSelecionado(a);
                                setAlbumSubstQuery("");
                              }}
                              className="w-full text-left px-4 py-2.5 text-xs text-white hover:bg-emerald-500/10 border-b border-white/5 last:border-b-0"
                            >
                              {a.label}
                            </button>
                          ))}
                        {myAlbuns.filter((a) =>
                          a.label.toLowerCase().includes(albumSubstQuery.trim().toLowerCase()),
                        ).length === 0 && (
                          <p className="px-4 py-3 text-xs text-neutral-500 italic">
                            Nenhum álbum encontrado.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {albumSubstSelecionado && (
                <>
                  {/* NOVAS FAIXAS */}
                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase tracking-wider text-neutral-300 flex items-center gap-2">
                      <ListMusic className="size-4 text-emerald-400" />
                      Adicionar Faixas Novas (Opcional) ({substNovasFaixasCount})
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={30}
                      value={substNovasFaixasCount}
                      onChange={(e) =>
                        setSubstNovasFaixasCount(Math.max(0, parseInt(e.target.value, 10) || 0))
                      }
                      className="w-32 bg-neutral-950 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:border-emerald-500 focus:outline-none"
                    />
                  </div>

                  {substNovasFaixasCount > 0 && (
                    <div className="space-y-3 bg-neutral-950/60 p-4 rounded-2xl border border-white/5 max-h-[32rem] overflow-y-auto">
                      {substNovasFaixas.map((faixa, idx) => (
                        <FaixaEditor
                          key={idx}
                          faixa={faixa}
                          myChartSongs={myChartSongs}
                          onChange={(patch) => {
                            const updated = [...substNovasFaixas];
                            updated[idx] = { ...updated[idx], ...patch };
                            setSubstNovasFaixas(updated);
                          }}
                        />
                      ))}
                    </div>
                  )}

                  {/* NOVA CAPA E ENCARTES */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4 border-t border-white/10">
                    <div className="space-y-2">
                      <label className="text-xs font-bold uppercase tracking-wider text-neutral-300 block">
                        Nova Capa (Opcional)
                      </label>
                      <div className="flex items-center gap-4 bg-neutral-950 p-4 rounded-2xl border border-white/10">
                        {capaPreview ? (
                          <img
                            src={capaPreview}
                            alt="Capa Preview"
                            className="size-16 object-cover rounded-xl border border-white/10"
                          />
                        ) : (
                          <div className="size-16 rounded-xl bg-neutral-900 border border-white/10 flex items-center justify-center text-neutral-500">
                            <ImageIcon className="size-6" />
                          </div>
                        )}
                        <label className="cursor-pointer px-4 py-2.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-white font-bold text-xs uppercase tracking-wider border border-white/10 transition inline-flex items-center gap-2">
                          <Upload className="size-4 text-emerald-400" />
                          <span>Selecione a Capa</span>
                          <input
                            type="file"
                            accept="image/*"
                            onChange={(e) => e.target.files?.[0] && handleCapaSelect(e.target.files[0])}
                            className="hidden"
                          />
                        </label>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="text-xs font-bold uppercase tracking-wider text-neutral-300 block">
                        Novos Encartes (Opcional — substitui os atuais)
                      </label>
                      <div className="flex items-center gap-4 bg-neutral-950 p-4 rounded-2xl border border-white/10">
                        <div className="size-16 rounded-xl bg-neutral-900 border border-white/10 flex items-center justify-center text-neutral-500">
                          <ImageIcon className="size-6" />
                        </div>
                        <label className="cursor-pointer px-4 py-2.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-white font-bold text-xs uppercase tracking-wider border border-white/10 transition inline-flex items-center gap-2">
                          <Upload className="size-4 text-emerald-400" />
                          <span>Selecione os Encartes (Fotos)</span>
                          <input
                            type="file"
                            accept="image/*"
                            multiple
                            onChange={(e) => e.target.files && setEncartesFiles(Array.from(e.target.files))}
                            className="hidden"
                          />
                        </label>
                      </div>
                      {encartesFiles.length > 0 && (
                        <p className="text-[11px] text-emerald-400">
                          {encartesFiles.length} encarte(s) selecionado(s)
                        </p>
                      )}
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full py-4 rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-black font-black text-sm uppercase tracking-wider shadow-xl shadow-emerald-500/20 transition flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    <Sparkles className="size-5" />
                    <span>{isSubmitting ? uploadProgress || "Enviando..." : "Salvar Alterações"}</span>
                  </button>
                </>
              )}
            </form>
          )}
        </div>
      )}

      {/* MODAL DE EDIÇÃO */}
      <EditModal
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        associatedArtists={profile?.associatedArtists || []}
        defaultArtist={artistaResponsavel}
      />
    </div>
  );
};
