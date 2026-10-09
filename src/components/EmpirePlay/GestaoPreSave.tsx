import { useEffect, useMemo, useState } from "react";
import {
  Rocket,
  Plus,
  Minus,
  Calendar,
  X,
  Check,
  Clock,
  Ban,
  Upload as UploadIcon,
  Trash2,
  UserCircle,
  Image as ImageIcon,
  Sparkles,
} from "lucide-react";
import { useTelegramUser, haptic } from "@/lib/telegram";
import { api, driveImg } from "@/lib/api";
import { getStoredLogin } from "@/components/LoginScreen";
import {
  FaixaEditor,
  TIPOS_ALBUM,
  stripArtistPrefix,
  type TrackConfig,
  type MusicaEmChart,
  type UserProfile,
} from "./Gestao";
import {
  ExtraMaterialEditor,
  emptyExtraMaterialEditorValue,
  type ExtraMaterialEditorValue,
} from "./ExtraMaterial";

// Gestão Pre save — menu próprio do Catálogo (separado de "Gestão"), pra
// criar/gerenciar campanhas de pre-save de álbum. Ver preSaveController.ts
// no backend pro resumo completo das regras (teto nunca exposto, sem
// fallback em missão perdida, dia travado igual Tour etc.).

type Modo = "missao" | "contagem";

type MissaoTipo =
  | "post_anuncio"
  | "bastidores"
  | "entrevista"
  | "tracklist_reveal"
  | "capa_alternativa"
  | "trecho_letra"
  | "making_of_video"
  | "enquete_fas"
  | "countdown_marco"
  | "desafio_som";

// Catálogo de missões (espelha MISSOES_CATALOGO do backend — só pra
// exibir label/descrição aqui; o peso real/validação vivem no servidor).
const MISSOES: { tipo: MissaoTipo; label: string; descricao: string }[] = [
  { tipo: "post_anuncio", label: "Post de anúncio", descricao: "Post social, qualquer rede." },
  {
    tipo: "bastidores",
    label: "Bastidores",
    descricao: 'Post via um perfil de "Tá na Mídia" disponível.',
  },
  {
    tipo: "entrevista",
    label: "Entrevista",
    descricao: "Cadastro direto em Acervo > Entrevistas.",
  },
  {
    tipo: "tracklist_reveal",
    label: "Revelar faixa",
    descricao: "Post social + revela o nome real de uma faixa oculta.",
  },
  { tipo: "capa_alternativa", label: "Capa alternativa", descricao: "Post social, qualquer rede." },
  { tipo: "trecho_letra", label: "Trecho de letra", descricao: "Post social, qualquer rede." },
  {
    tipo: "making_of_video",
    label: "Making of",
    descricao: "TikTok exclusivo OU vídeo real em Fórum > Vídeos.",
  },
  { tipo: "enquete_fas", label: "Enquete pros fãs", descricao: "Post social, qualquer rede." },
  { tipo: "countdown_marco", label: "Marco da contagem", descricao: "Post social, qualquer rede." },
  { tipo: "desafio_som", label: "Desafio de som", descricao: "Post social EXCLUSIVO de TikTok." },
];

const REDES = ["twitter", "instagram", "tiktok", "stories"];

// Mesmo formato de TrackConfig (Gestao.tsx) persistido pela campanha, já
// resolvido pelo backend (ver preSaveController.ts) — 2 campos extras de
// pre-save (mostrarNomeReal/revelada) por cima do cadastro normal de faixa.
interface Faixa {
  num: number;
  inedita: boolean;
  titulo: string;
  mostrarNomeReal: boolean;
  revelada: boolean;
}

interface MissaoDia {
  dia: number;
  tipo: MissaoTipo | null;
  status: "pendente" | "completa" | "perdida";
  completadoEm?: string;
}

interface Campanha {
  id: string;
  artista: string;
  albumTituloFull: string;
  capaUrl: string;
  modo: Modo;
  tipoAlbum: string;
  duracaoDias: number;
  dataLancamento: string;
  status: "ativa" | "lancada" | "cancelada";
  acumuladoAtual: number;
  faixas: Faixa[];
  missoes: MissaoDia[];
}

interface PerfilMidia {
  nome: string;
  foto: string;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = (error) => reject(error);
  });
}

// Mesmo upload de Gestao.tsx (handleUploadToDrive): FormData primeiro,
// fallback em Base64 JSON, e um link de pasta pública como último recurso
// — nunca deixa o upload travar o formulário sem solução nenhuma.
async function uploadToDrive(
  file: File,
  folderType: "musica" | "musicaAudio" | "album",
  customName?: string,
): Promise<string> {
  const TIMEOUT_MS = 45_000;
  const fetchComTimeout = (input: string, init: RequestInit) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    return fetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
  };

  try {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("fileName", customName || file.name);
    formData.append("folderType", folderType);
    const res = await fetchComTimeout("/api/gestao/upload", { method: "POST", body: formData });
    const data = await res.json().catch(() => null);
    if (res.ok && data?.success && data?.data?.fileUrl) return data.data.fileUrl;
  } catch (err) {
    console.warn("[GestaoPreSave] Upload por FormData falhou, tentando Base64:", err);
  }

  try {
    const base64 = await fileToBase64(file);
    const fileName = customName || file.name;
    const res = await fetchComTimeout("/api/gestao/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fileName,
        mimeType: file.type || "image/jpeg",
        base64Data: base64,
        folderType,
      }),
    });
    const data = await res.json().catch(() => null);
    if (data?.data?.fileUrl) return data.data.fileUrl;
  } catch (err) {
    console.warn("[GestaoPreSave] Upload por Base64 falhou:", err);
  }

  throw new Error("Falha ao enviar o arquivo — tenta de novo.");
}

export function GestaoPreSave() {
  const { user } = useTelegramUser();
  // Mesma lógica de Gestao.tsx: fora do Telegram (ex: testando no navegador
  // comum), user?.id vem "guest" ou vazio — sem o fallback pro login
  // armazenado, telegramId ficava "" e nenhuma música do artista carregava
  // (useEffect de /api/user/me e /api/gestao/musicas-em-chart nunca disparava).
  const storedLogin = getStoredLogin();
  const telegramId =
    storedLogin?.id || (user?.id && user.id !== "guest" ? String(user.id) : "");
  const [campanhas, setCampanhas] = useState<Campanha[]>([]);
  const [loading, setLoading] = useState(true);
  const [mostrarForm, setMostrarForm] = useState(false);
  const [selecionada, setSelecionada] = useState<Campanha | null>(null);
  const [perfisMidia, setPerfisMidia] = useState<PerfilMidia[]>([]);

  const carregar = () => {
    if (!telegramId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    fetch(`/api/presave/minhas-campanhas?jogadorId=${encodeURIComponent(telegramId)}`)
      .then((r) => r.json())
      .then((res) => setCampanhas(Array.isArray(res?.data) ? res.data : []))
      .catch(() => setCampanhas([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [telegramId]);

  // Mesma lista/UI que social.tsx usa pra viewMode === "Midia"
  // (perfisPublicos): perfis de SOCIAL_PERFIS com telegram_id = "Todos",
  // mais os próprios artistas do jogador (que também podem ser escolhidos
  // como "perfil" de bastidores) — dedupe por nome.
  useEffect(() => {
    (api as any)
      .listarPerfisSocial()
      .then((profs: any[]) => {
        const vistos = new Set<string>();
        const out: PerfilMidia[] = [];
        for (const p of profs || []) {
          const telegramIdPerfil = String(p.telegramId || "")
            .trim()
            .toLowerCase();
          const ehCompartilhado = telegramIdPerfil === "todos";
          const ehDoJogador = telegramId && telegramIdPerfil === telegramId.toLowerCase();
          if (!ehCompartilhado && !ehDoJogador) continue;
          const chave = String(p.artista || "")
            .trim()
            .toLowerCase();
          if (!chave || vistos.has(chave)) continue;
          vistos.add(chave);
          out.push({ nome: p.artista, foto: p.avatar_url || p.avatar || p.foto || "" });
        }
        setPerfisMidia(out);
      })
      .catch(() => setPerfisMidia([]));
  }, [telegramId]);

  return (
    <div className="space-y-6 min-w-0">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl sm:text-2xl font-black text-white flex items-center gap-2">
            <Rocket className="size-5 text-fuchsia-400 shrink-0" />
            Gestão Pre save
          </h1>
          <p className="text-sm text-neutral-400 mt-1">
            Crie uma campanha de pre-save pro seu próximo álbum: contagem regressiva, com ou sem
            missões diárias.
          </p>
        </div>
        <button
          onClick={() => {
            haptic.selection();
            setMostrarForm(true);
            setSelecionada(null);
          }}
          className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider bg-fuchsia-500 hover:bg-fuchsia-400 text-black transition-colors shrink-0"
        >
          <Plus className="size-4 shrink-0" />
          <span className="truncate">Nova campanha</span>
        </button>
      </div>

      {mostrarForm && (
        <NovaCampanhaForm
          telegramId={telegramId}
          jogadorNome={user?.name || "Jogador"}
          onCancelar={() => setMostrarForm(false)}
          onCriada={() => {
            setMostrarForm(false);
            carregar();
          }}
        />
      )}

      {!mostrarForm && selecionada && (
        <CalendarioCampanha
          campanha={selecionada}
          telegramId={telegramId}
          perfisMidia={perfisMidia}
          onVoltar={() => setSelecionada(null)}
          onAtualizada={(c) => {
            setSelecionada(c);
            setCampanhas((prev) => prev.map((x) => (x.id === c.id ? c : x)));
          }}
        />
      )}

      {!mostrarForm && !selecionada && (
        <div className="space-y-3">
          {loading && <p className="text-sm text-neutral-500">Carregando campanhas...</p>}
          {!loading && campanhas.length === 0 && (
            <div className="text-center py-12 text-neutral-500 text-sm">
              Nenhuma campanha de pre-save ainda. Clique em "Nova campanha" pra começar.
            </div>
          )}
          {campanhas.map((c) => (
            <button
              key={c.id}
              onClick={() => setSelecionada(c)}
              className="w-full flex items-center gap-3 p-3 sm:p-4 rounded-2xl bg-neutral-800/40 border border-white/10 hover:border-fuchsia-400/40 transition-colors text-left min-w-0"
            >
              {c.capaUrl ? (
                <img src={c.capaUrl} alt="" className="size-14 rounded-xl object-cover shrink-0" />
              ) : (
                <div className="size-14 rounded-xl bg-neutral-700 shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <div className="font-bold text-white truncate">{c.albumTituloFull}</div>
                <div className="text-xs text-neutral-400 truncate">
                  Lançamento em {c.dataLancamento} ·{" "}
                  {c.modo === "missao" ? "Com missões" : "Só contagem"}
                </div>
              </div>
              <StatusPill status={c.status} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: Campanha["status"] }) {
  const map = {
    ativa: { label: "Ativa", cls: "bg-emerald-500/15 text-emerald-300 border-emerald-400/30" },
    lancada: { label: "Lançado", cls: "bg-sky-500/15 text-sky-300 border-sky-400/30" },
    cancelada: {
      label: "Cancelada",
      cls: "bg-neutral-500/15 text-neutral-400 border-neutral-500/30",
    },
  } as const;
  const cfg = map[status];
  return (
    <span
      className={`shrink-0 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider border ${cfg.cls}`}
    >
      {cfg.label}
    </span>
  );
}

// -------------------- FORMULÁRIO DE NOVA CAMPANHA --------------------

// Rico de propósito: é EXATAMENTE o mesmo cadastro de álbum de verdade de
// Catálogo > Gestão (Gestao.tsx, seção albumObjetivo === "a") — reaproveita
// FaixaEditor/TrackConfig/TIPOS_ALBUM/ExtraMaterialEditor de lá em vez de
// reinventar um editor de faixa simplificado — só com os campos extras de
// pre-save (modo de campanha, data de lançamento, calendário de missões)
// por cima. A diferença pro cadastro normal é só NO ENVIO: aqui nada é
// publicado na hora — tudo (inclusive capa/encartes/áudio já enviados pro
// Drive) fica salvo no estado da campanha (aba PreSave_Album) até o dia D,
// quando processarLancamentosPreSaveScheduled (preSaveController.ts)
// finalmente chama publicarAlbum de verdade.
function NovaCampanhaForm({
  telegramId,
  jogadorNome,
  onCancelar,
  onCriada,
}: {
  telegramId: string;
  jogadorNome: string;
  onCancelar: () => void;
  onCriada: () => void;
}) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [musicasEmChart, setMusicasEmChart] = useState<MusicaEmChart[]>([]);

  const [artista, setArtista] = useState("");
  const [tituloAlbum, setTituloAlbum] = useState("");
  const [tipoAlbum, setTipoAlbum] = useState("Álbum");
  const [capaFile, setCapaFile] = useState<File | null>(null);
  const [capaPreview, setCapaPreview] = useState<string | null>(null);
  const [encartesFiles, setEncartesFiles] = useState<File[]>([]);
  const [totalFaixasCount, setTotalFaixasCount] = useState(3);
  const [faixasConfig, setFaixasConfig] = useState<TrackConfig[]>([
    { num: 1, titulo: "", inedita: true },
    { num: 2, titulo: "", inedita: true },
    { num: 3, titulo: "", inedita: true },
  ]);
  const [extraAlbum, setExtraAlbum] = useState<ExtraMaterialEditorValue>(
    emptyExtraMaterialEditorValue(),
  );

  const [modo, setModo] = useState<Modo>("contagem");
  const [dataLancamento, setDataLancamento] = useState("");
  const [missoesPorDia, setMissoesPorDia] = useState<Record<number, MissaoTipo | "">>({});
  const [duracaoDias] = useState(14);

  const [salvando, setSalvando] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const [erro, setErro] = useState("");

  const dias = useMemo(() => Array.from({ length: duracaoDias }, (_, i) => i + 1), [duracaoDias]);

  useEffect(() => {
    if (!telegramId) return;
    fetch(`/api/user/me?telegram_id=${telegramId}`, { headers: { "x-telegram-id": telegramId } })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.success && data.data) {
          const prof: UserProfile = data.data;
          setProfile(prof);
          setArtista(prof.artistName || prof.associatedArtists[0] || "");
        }
      })
      .catch((err) => console.error("[GestaoPreSave] Erro ao carregar perfil:", err));

    fetch("/api/gestao/musicas-em-chart")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.success && Array.isArray(data.data)) setMusicasEmChart(data.data);
      })
      .catch((err) => console.error("[GestaoPreSave] Erro ao carregar músicas em chart:", err));
  }, [telegramId]);

  // Músicas em chart só dos artistas do jogador — mesma lógica de
  // myChartSongs em Gestao.tsx, usada pelo FaixaEditor na busca de faixa
  // "Música Existente".
  const myChartSongs = useMemo(() => {
    const meus = new Set((profile?.associatedArtists || []).map((a) => a.toLowerCase()));
    if (meus.size === 0) return [];
    return musicasEmChart.filter((m) => m.artist && meus.has(m.artist.toLowerCase()));
  }, [musicasEmChart, profile]);

  // Ajustar lista de faixas ao mudar "Quantidade de Faixas" — mesma lógica
  // de Gestao.tsx: só adiciona/remove do fim, nunca descarta o que já foi
  // preenchido.
  useEffect(() => {
    const updated: TrackConfig[] = [];
    for (let i = 1; i <= totalFaixasCount; i++) {
      const existing = faixasConfig[i - 1];
      updated.push(existing ? { ...existing, num: i } : { num: i, titulo: "", inedita: true });
    }
    setFaixasConfig(updated);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalFaixasCount]);

  const handleCapaSelect = (file: File) => {
    setCapaFile(file);
    setCapaPreview(URL.createObjectURL(file));
  };

  const salvar = async () => {
    setErro("");
    if (!artista.trim()) return setErro("Selecione ou informe o Artista do Álbum.");
    if (!tituloAlbum.trim()) return setErro("Informe o Título do Álbum.");
    if (!capaFile) return setErro("A capa é obrigatória pra iniciar a campanha.");
    if (!dataLancamento) return setErro("Escolha a data de lançamento.");
    if (new Date(`${dataLancamento}T00:00:00`).getTime() <= Date.now()) {
      return setErro("A data de lançamento precisa ser no futuro.");
    }
    for (const faixa of faixasConfig) {
      if (!faixa.titulo.trim()) {
        return setErro(
          faixa.inedita
            ? `Informe o título da Faixa #${faixa.num}.`
            : `Selecione a música existente da Faixa #${faixa.num}.`,
        );
      }
      if (faixa.inedita && !faixa.mediaUrl?.trim() && !faixa.mediaFile) {
        return setErro(
          `Informe o link do áudio (Drive ou YouTube) ou envie um arquivo pra Faixa #${faixa.num}.`,
        );
      }
    }

    setSalvando(true);
    setUploadProgress("Fazendo upload da capa...");
    try {
      const capaUrl = await uploadToDrive(
        capaFile,
        "musica",
        `CAPA_PRESAVE_${artista}_${tituloAlbum}_${Date.now()}.jpg`,
      );

      const encartesUrls: string[] = [];
      for (let i = 0; i < encartesFiles.length; i++) {
        setUploadProgress(`Fazendo upload do encarte ${i + 1} de ${encartesFiles.length}...`);
        encartesUrls.push(
          await uploadToDrive(
            encartesFiles[i],
            "album",
            `ENCARTE_${i + 1}_${artista}_${tituloAlbum}_${Date.now()}.jpg`,
          ),
        );
      }

      const faixasComAudio: TrackConfig[] = [];
      for (const f of faixasConfig) {
        if (f.inedita && f.mediaFile) {
          setUploadProgress(`Fazendo upload do áudio da Faixa #${f.num}...`);
          const url = await uploadToDrive(
            f.mediaFile,
            "musicaAudio",
            `AUDIO_${artista}_${f.titulo}_${Date.now()}`,
          );
          faixasComAudio.push({ ...f, mediaUrl: url });
        } else {
          faixasComAudio.push(f);
        }
      }

      setUploadProgress("Criando campanha de pre-save...");
      const res = await fetch("/api/presave/criar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jogadorId: telegramId,
          jogadorNome,
          artista,
          tituloAlbum: stripArtistPrefix(tituloAlbum.trim(), artista),
          tipoAlbum,
          capaUrl,
          encartesUrls,
          modo,
          dataLancamento,
          faixas: faixasComAudio.map((f) => ({
            num: f.num,
            inedita: f.inedita,
            titulo: f.titulo,
            tipoSingle: f.tipoSingle,
            tipoMusica: f.tipoMusica,
            participantes: (f.participantes || []).filter((p) => p.trim()),
            mediaUrl: f.mediaUrl,
            letra: f.letra,
            abrirTopico: f.abrirTopico,
            mostrarNomeReal: !f.inedita, // faixa inédita nasce oculta ("Track N") por padrão
          })),
          missoesPorDia:
            modo === "missao"
              ? Object.fromEntries(Object.entries(missoesPorDia).filter(([, v]) => v))
              : undefined,
          extraMaterial:
            extraAlbum.shopAtivo || extraAlbum.infoAtivo || extraAlbum.visualAtivo
              ? extraAlbum
              : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "Falha ao criar campanha.");
      haptic.success?.();
      onCriada();
    } catch (err: any) {
      setErro(err.message || "Falha ao criar campanha.");
    } finally {
      setSalvando(false);
      setUploadProgress(null);
    }
  };

  return (
    <div className="rounded-2xl bg-neutral-800/40 border border-white/10 p-4 sm:p-5 space-y-5 min-w-0">
      <div className="flex items-center justify-between">
        <h2 className="font-black text-white">Nova campanha de pre-save</h2>
        <button onClick={onCancelar} className="p-1.5 rounded-lg hover:bg-white/10 shrink-0">
          <X className="size-4" />
        </button>
      </div>

      <div>
        <label className="text-xs font-bold text-neutral-400">Artista do Álbum</label>
        {profile?.associatedArtists && profile.associatedArtists.length > 0 ? (
          <select
            value={artista}
            onChange={(e) => setArtista(e.target.value)}
            className="w-full mt-1 bg-neutral-900 border border-white/10 rounded-xl px-3 py-2 text-sm text-white"
          >
            {profile.associatedArtists.map((art) => (
              <option key={art} value={art}>
                {art}
              </option>
            ))}
          </select>
        ) : (
          <input
            value={artista}
            onChange={(e) => setArtista(e.target.value)}
            placeholder="Ex: Taylor Swift"
            className="w-full mt-1 bg-neutral-900 border border-white/10 rounded-xl px-3 py-2 text-sm text-white"
          />
        )}
      </div>

      <div>
        <label className="text-xs font-bold text-neutral-400">Título do Álbum</label>
        <input
          value={tituloAlbum}
          onChange={(e) => setTituloAlbum(e.target.value)}
          placeholder="Ex: Midnights"
          className="w-full mt-1 bg-neutral-900 border border-white/10 rounded-xl px-3 py-2 text-sm text-white"
        />
      </div>

      <div>
        <label className="text-xs font-bold text-neutral-400">Tipo</label>
        <select
          value={tipoAlbum}
          onChange={(e) => setTipoAlbum(e.target.value)}
          className="w-full mt-1 bg-neutral-900 border border-white/10 rounded-xl px-3 py-2 text-sm text-white"
        >
          {TIPOS_ALBUM.map((tipo) => (
            <option key={tipo} value={tipo}>
              {tipo}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="text-xs font-bold text-neutral-400">
          Quantidade de Faixas ({totalFaixasCount})
        </label>
        <div className="flex items-center gap-2 mt-1">
          <button
            type="button"
            onClick={() => setTotalFaixasCount((n) => Math.max(1, n - 1))}
            disabled={totalFaixasCount <= 1}
            className="size-10 shrink-0 rounded-xl bg-neutral-900 border border-white/10 text-white flex items-center justify-center disabled:opacity-30"
          >
            <Minus className="size-4" />
          </button>
          <input
            type="number"
            min={1}
            max={30}
            value={totalFaixasCount}
            onChange={(e) => setTotalFaixasCount(Math.max(1, parseInt(e.target.value, 10) || 1))}
            className="w-16 text-center bg-neutral-900 border border-white/10 rounded-xl px-2 py-2 text-sm text-white"
          />
          <button
            type="button"
            onClick={() => setTotalFaixasCount((n) => Math.min(30, n + 1))}
            disabled={totalFaixasCount >= 30}
            className="size-10 shrink-0 rounded-xl bg-neutral-900 border border-white/10 text-white flex items-center justify-center disabled:opacity-30"
          >
            <Plus className="size-4" />
          </button>
        </div>
      </div>

      <div className="space-y-3 bg-neutral-950/60 p-4 rounded-2xl border border-white/5 max-h-[28rem] overflow-y-auto">
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

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4 border-t border-white/10">
        <div className="space-y-2">
          <label className="text-xs font-bold uppercase tracking-wider text-neutral-300 block">
            Capa do Álbum (obrigatória)
          </label>
          <div className="flex items-center gap-3 bg-neutral-950 p-3 rounded-2xl border border-white/10">
            {capaPreview ? (
              <img src={capaPreview} alt="" className="size-14 rounded-xl object-cover shrink-0" />
            ) : (
              <div className="size-14 rounded-xl bg-neutral-900 border border-white/10 flex items-center justify-center text-neutral-500 shrink-0">
                <ImageIcon className="size-5" />
              </div>
            )}
            <label className="cursor-pointer px-3 py-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-white font-bold text-[11px] uppercase tracking-wider border border-white/10 inline-flex items-center gap-1.5 min-w-0">
              <UploadIcon className="size-3.5 text-fuchsia-400 shrink-0" />
              <span className="truncate">Selecione a Capa</span>
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && handleCapaSelect(e.target.files[0])}
              />
            </label>
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-bold uppercase tracking-wider text-neutral-300 block">
            Encartes / Imagens Adicionais
          </label>
          <div className="flex items-center gap-3 bg-neutral-950 p-3 rounded-2xl border border-white/10">
            <div className="size-14 rounded-xl bg-neutral-900 border border-white/10 flex items-center justify-center text-neutral-500 shrink-0">
              <ImageIcon className="size-5" />
            </div>
            <label className="cursor-pointer px-3 py-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-white font-bold text-[11px] uppercase tracking-wider border border-white/10 inline-flex items-center gap-1.5 min-w-0">
              <UploadIcon className="size-3.5 text-fuchsia-400 shrink-0" />
              <span className="truncate">Selecione os Encartes</span>
              <input
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => e.target.files && setEncartesFiles(Array.from(e.target.files))}
              />
            </label>
          </div>
          {encartesFiles.length > 0 && (
            <p className="text-[11px] text-fuchsia-300">
              {encartesFiles.length} encarte(s) selecionado(s)
            </p>
          )}
        </div>
      </div>

      <div>
        <label className="text-xs font-black uppercase tracking-wider text-fuchsia-400 mb-3 flex items-center gap-2">
          <Sparkles className="size-4 text-fuchsia-400" />
          Botões do Tópico (Opcional)
        </label>
        <ExtraMaterialEditor
          value={extraAlbum}
          onChange={setExtraAlbum}
          folderType="materiaisAlbum"
        />
      </div>

      <div className="grid sm:grid-cols-2 gap-4 pt-4 border-t border-white/10">
        <div>
          <label className="text-xs font-bold text-neutral-400">Data de lançamento</label>
          <input
            type="date"
            value={dataLancamento}
            onChange={(e) => setDataLancamento(e.target.value)}
            className="w-full mt-1 bg-neutral-900 border border-white/10 rounded-xl px-3 py-2 text-sm text-white"
          />
        </div>
        <div>
          <label className="text-xs font-bold text-neutral-400">Modo da campanha</label>
          <div className="flex gap-2 mt-1">
            <button
              onClick={() => setModo("contagem")}
              className={`flex-1 px-3 py-2 rounded-xl text-xs font-bold truncate ${
                modo === "contagem" ? "bg-fuchsia-500 text-black" : "bg-white/5 text-neutral-300"
              }`}
            >
              Só contagem
            </button>
            <button
              onClick={() => setModo("missao")}
              className={`flex-1 px-3 py-2 rounded-xl text-xs font-bold truncate ${
                modo === "missao" ? "bg-fuchsia-500 text-black" : "bg-white/5 text-neutral-300"
              }`}
            >
              Contagem + missões
            </button>
          </div>
        </div>
      </div>

      {modo === "missao" && (
        <div>
          <label className="text-xs font-bold text-neutral-400">
            Calendário de missões ({duracaoDias} dias) — escolha qual missão vai em qual dia (fixo
            depois de salvo)
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-1.5">
            {dias.map((dia) => (
              <div
                key={dia}
                className="flex items-center gap-2 bg-neutral-900 border border-white/10 rounded-xl px-2.5 py-2 min-w-0"
              >
                <span className="text-[11px] font-black text-neutral-500 shrink-0">D{dia}</span>
                <select
                  value={missoesPorDia[dia] || ""}
                  onChange={(e) =>
                    setMissoesPorDia((prev) => ({
                      ...prev,
                      [dia]: e.target.value as MissaoTipo | "",
                    }))
                  }
                  className="flex-1 min-w-0 bg-transparent text-[11px] text-white truncate"
                >
                  <option value="">Sem missão</option>
                  {MISSOES.map((m) => (
                    <option key={m.tipo} value={m.tipo}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </div>
      )}

      {uploadProgress && <p className="text-xs text-fuchsia-300">{uploadProgress}</p>}
      {erro && <p className="text-xs text-red-400">{erro}</p>}

      <div className="flex justify-end gap-2">
        <button
          onClick={onCancelar}
          className="px-4 py-2.5 rounded-xl text-xs font-bold text-neutral-400 hover:bg-white/5"
        >
          Cancelar
        </button>
        <button
          onClick={salvar}
          disabled={salvando}
          className="px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider bg-fuchsia-500 hover:bg-fuchsia-400 text-black disabled:opacity-50"
        >
          {salvando ? "Criando..." : "Criar campanha"}
        </button>
      </div>
    </div>
  );
}

// -------------------- CALENDÁRIO DA CAMPANHA --------------------

function CalendarioCampanha({
  campanha,
  telegramId,
  perfisMidia,
  onVoltar,
  onAtualizada,
}: {
  campanha: Campanha;
  telegramId: string;
  perfisMidia: PerfilMidia[];
  onVoltar: () => void;
  onAtualizada: (c: Campanha) => void;
}) {
  const [diaAberto, setDiaAberto] = useState<MissaoDia | null>(null);
  const diasFaltando = Math.max(
    0,
    Math.ceil((new Date(`${campanha.dataLancamento}T00:00:00`).getTime() - Date.now()) / 86400000),
  );

  const recarregar = async () => {
    const res = await fetch(`/api/presave/campanha?id=${encodeURIComponent(campanha.id)}`).then(
      (r) => r.json(),
    );
    if (res?.success) onAtualizada(res.data);
  };

  const cancelar = async () => {
    if (!confirm("Cancelar essa campanha de pre-save? Essa ação não pode ser desfeita.")) return;
    const res = await fetch("/api/presave/cancelar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ campanhaId: campanha.id, jogadorId: telegramId }),
    }).then((r) => r.json());
    if (res?.success) recarregar();
  };

  return (
    <div className="space-y-5 min-w-0">
      <button onClick={onVoltar} className="text-xs font-bold text-neutral-400 hover:text-white">
        ← Voltar
      </button>

      <div className="flex items-center gap-3">
        {campanha.capaUrl && (
          <img src={campanha.capaUrl} alt="" className="size-16 rounded-xl object-cover shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <h2 className="font-black text-white text-lg truncate">{campanha.albumTituloFull}</h2>
          <p className="text-xs text-neutral-400 truncate">
            Lançamento em {campanha.dataLancamento} · faltam {diasFaltando} dia
            {diasFaltando === 1 ? "" : "s"}
          </p>
        </div>
        <StatusPill status={campanha.status} />
      </div>

      <div className="rounded-2xl bg-fuchsia-500/10 border border-fuchsia-400/30 px-4 py-3">
        <div className="text-[10px] font-black uppercase tracking-wider text-fuchsia-300">
          Contador de pre-save
        </div>
        <div className="text-2xl font-black text-white mt-0.5">
          {campanha.acumuladoAtual.toLocaleString("pt-BR")}
        </div>
        <p className="text-[11px] text-neutral-400 mt-1">
          Valor acumulado até agora — visível a todos no banner e na página do álbum.
        </p>
      </div>

      {campanha.modo === "missao" ? (
        <div>
          <h3 className="text-xs font-black uppercase tracking-wider text-neutral-400 mb-2">
            Calendário de missões ({campanha.duracaoDias} dias)
          </h3>
          <div className="grid grid-cols-3 sm:grid-cols-7 gap-2">
            {campanha.missoes.map((m) => (
              <button
                key={m.dia}
                onClick={() => m.tipo && m.status === "pendente" && setDiaAberto(m)}
                disabled={!m.tipo || m.status !== "pendente"}
                className={`flex flex-col items-center gap-1 px-1.5 py-2.5 rounded-xl border text-center min-w-0 ${
                  m.status === "completa"
                    ? "bg-emerald-500/15 border-emerald-400/30"
                    : m.status === "perdida"
                      ? "bg-red-500/10 border-red-400/20"
                      : m.tipo
                        ? "bg-white/5 border-white/10 hover:border-fuchsia-400/40"
                        : "bg-neutral-900/40 border-white/5"
                }`}
              >
                <span className="text-[10px] font-black text-neutral-400">Dia {m.dia}</span>
                {m.status === "completa" && (
                  <Check className="size-3.5 text-emerald-400 shrink-0" />
                )}
                {m.status === "perdida" && <Ban className="size-3.5 text-red-400 shrink-0" />}
                {m.status === "pendente" && m.tipo && (
                  <Clock className="size-3.5 text-neutral-400 shrink-0" />
                )}
                <span className="text-[9px] text-neutral-400 truncate w-full">
                  {m.tipo ? MISSOES.find((x) => x.tipo === m.tipo)?.label : "Sem missão"}
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 text-sm text-neutral-400">
          <Calendar className="size-4 shrink-0" />
          Modo só contagem — o contador sobe automaticamente até o dia do lançamento, sem missões.
        </div>
      )}

      {campanha.status === "ativa" && (
        <button onClick={cancelar} className="text-xs font-bold text-red-400 hover:text-red-300">
          Cancelar campanha
        </button>
      )}

      {diaAberto && (
        <MissaoModal
          campanhaId={campanha.id}
          telegramId={telegramId}
          missao={diaAberto}
          faixas={campanha.faixas}
          perfisMidia={perfisMidia}
          onFechar={() => setDiaAberto(null)}
          onCompletada={() => {
            setDiaAberto(null);
            recarregar();
          }}
        />
      )}
    </div>
  );
}

// -------------------- MODAL DE COMPLETAR MISSÃO --------------------

function MissaoModal({
  campanhaId,
  telegramId,
  missao,
  faixas,
  perfisMidia,
  onFechar,
  onCompletada,
}: {
  campanhaId: string;
  telegramId: string;
  missao: MissaoDia;
  faixas: Faixa[];
  perfisMidia: PerfilMidia[];
  onFechar: () => void;
  onCompletada: () => void;
}) {
  const tipo = missao.tipo as MissaoTipo;
  const info = MISSOES.find((m) => m.tipo === tipo)!;
  const [rede, setRede] = useState(
    tipo === "desafio_som" || tipo === "making_of_video" ? "tiktok" : REDES[0],
  );
  const [texto, setTexto] = useState("");
  const [perfilArtista, setPerfilArtista] = useState("");
  const [faixaOrdemRevelada, setFaixaOrdemRevelada] = useState<number | "">("");
  const [entrevistaTitulo, setEntrevistaTitulo] = useState("");
  const [entrevistaPergunta, setEntrevistaPergunta] = useState("");
  const [entrevistaResposta, setEntrevistaResposta] = useState("");
  const [videoRealId, setVideoRealId] = useState("");
  const [caminhoMakingOf, setCaminhoMakingOf] = useState<"tiktok" | "video_real">("tiktok");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");

  const faixasOcultas = faixas.filter((f) => !f.revelada);

  const completar = async () => {
    setErro("");
    const payload: Record<string, unknown> = { campanhaId, dia: missao.dia, jogadorId: telegramId };

    if (tipo === "entrevista") {
      if (!entrevistaTitulo.trim() || !entrevistaPergunta.trim() || !entrevistaResposta.trim()) {
        return setErro("Preencha título, pergunta e resposta da entrevista.");
      }
      payload.entrevista = {
        titulo: entrevistaTitulo,
        perguntas: [{ pergunta: entrevistaPergunta, resposta: entrevistaResposta }],
        musicas: [],
      };
    } else if (tipo === "making_of_video" && caminhoMakingOf === "video_real") {
      if (!videoRealId.trim())
        return setErro("Informe o ID do vídeo já cadastrado em Fórum > Vídeos.");
      payload.videoRealId = videoRealId.trim();
    } else {
      if (!texto.trim()) return setErro("Escreva o texto do post.");
      payload.texto = texto;
      payload.rede =
        tipo === "desafio_som" ? "tiktok" : tipo === "making_of_video" ? "tiktok" : rede;
      if (tipo === "bastidores") {
        if (!perfilArtista) return setErro('Escolha um perfil de "Tá na Mídia" para publicar.');
        payload.perfilArtista = perfilArtista;
      }
      if (tipo === "tracklist_reveal") {
        if (!faixaOrdemRevelada) return setErro("Escolha qual faixa oculta revelar.");
        payload.faixaOrdemRevelada = faixaOrdemRevelada;
      }
    }

    setEnviando(true);
    try {
      const res = await fetch("/api/presave/completar-missao", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }).then((r) => r.json());
      if (!res.success) throw new Error(res.error || "Falha ao completar missão.");
      haptic.success?.();
      onCompletada();
    } catch (err: any) {
      setErro(err.message || "Falha ao completar missão.");
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3"
      onClick={onFechar}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md bg-neutral-900 border border-white/10 rounded-2xl p-5 space-y-4 max-h-[85vh] overflow-y-auto min-w-0"
      >
        <div className="flex items-center justify-between">
          <h3 className="font-black text-white truncate pr-2">
            Dia {missao.dia} · {info.label}
          </h3>
          <button onClick={onFechar} className="p-1.5 rounded-lg hover:bg-white/10 shrink-0">
            <X className="size-4" />
          </button>
        </div>
        <p className="text-xs text-neutral-400">{info.descricao}</p>

        {tipo === "entrevista" ? (
          <div className="space-y-2">
            <input
              value={entrevistaTitulo}
              onChange={(e) => setEntrevistaTitulo(e.target.value)}
              placeholder="Título da entrevista"
              className="w-full bg-neutral-800 border border-white/10 rounded-xl px-3 py-2 text-sm text-white"
            />
            <input
              value={entrevistaPergunta}
              onChange={(e) => setEntrevistaPergunta(e.target.value)}
              placeholder="Pergunta"
              className="w-full bg-neutral-800 border border-white/10 rounded-xl px-3 py-2 text-sm text-white"
            />
            <textarea
              value={entrevistaResposta}
              onChange={(e) => setEntrevistaResposta(e.target.value)}
              placeholder="Resposta"
              className="w-full bg-neutral-800 border border-white/10 rounded-xl px-3 py-2 text-sm text-white"
            />
          </div>
        ) : tipo === "making_of_video" ? (
          <div className="space-y-3">
            <div className="flex gap-2">
              <button
                onClick={() => setCaminhoMakingOf("tiktok")}
                className={`flex-1 px-3 py-2 rounded-xl text-xs font-bold truncate ${
                  caminhoMakingOf === "tiktok"
                    ? "bg-fuchsia-500 text-black"
                    : "bg-white/5 text-neutral-300"
                }`}
              >
                Post TikTok
              </button>
              <button
                onClick={() => setCaminhoMakingOf("video_real")}
                className={`flex-1 px-3 py-2 rounded-xl text-xs font-bold truncate ${
                  caminhoMakingOf === "video_real"
                    ? "bg-fuchsia-500 text-black"
                    : "bg-white/5 text-neutral-300"
                }`}
              >
                Vídeo real (Fórum)
              </button>
            </div>
            {caminhoMakingOf === "tiktok" ? (
              <textarea
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                placeholder="Legenda do post de TikTok"
                className="w-full bg-neutral-800 border border-white/10 rounded-xl px-3 py-2 text-sm text-white"
              />
            ) : (
              <input
                value={videoRealId}
                onChange={(e) => setVideoRealId(e.target.value)}
                placeholder="ID do vídeo já cadastrado em Fórum > Vídeos"
                className="w-full bg-neutral-800 border border-white/10 rounded-xl px-3 py-2 text-sm text-white"
              />
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {tipo !== "desafio_som" && (
              <select
                value={rede}
                onChange={(e) => setRede(e.target.value)}
                className="w-full bg-neutral-800 border border-white/10 rounded-xl px-3 py-2 text-sm text-white"
              >
                {REDES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            )}
            {tipo === "desafio_som" && (
              <div className="text-[11px] text-fuchsia-300 font-bold">
                Rede travada em TikTok (exclusivo).
              </div>
            )}
            {tipo === "bastidores" && (
              <div>
                <label className="text-[11px] font-bold text-neutral-400">
                  Publicar através de qual perfil de &quot;Tá na Mídia&quot;?
                </label>
                {perfisMidia.length === 0 ? (
                  <p className="text-[11px] text-neutral-500 mt-1">
                    Nenhum perfil de &quot;Tá na Mídia&quot; disponível no momento.
                  </p>
                ) : (
                  <div className="grid grid-cols-3 gap-2 mt-1.5 max-h-40 overflow-y-auto pr-1">
                    {perfisMidia.map((perfil) => (
                      <button
                        key={perfil.nome}
                        type="button"
                        onClick={() => setPerfilArtista(perfil.nome)}
                        className={`flex flex-col items-center gap-1 p-2 rounded-xl border min-w-0 ${
                          perfilArtista === perfil.nome
                            ? "bg-fuchsia-500/20 border-fuchsia-400/50"
                            : "bg-white/5 border-white/10 hover:border-fuchsia-400/30"
                        }`}
                      >
                        <div className="size-9 rounded-full overflow-hidden bg-neutral-700 flex items-center justify-center shrink-0">
                          {perfil.foto ? (
                            <img
                              src={
                                perfil.foto.includes("drive.google.com") ||
                                perfil.foto.includes("googleusercontent.com")
                                  ? driveImg(perfil.foto)
                                  : perfil.foto
                              }
                              alt=""
                              className="w-full h-full object-cover"
                              referrerPolicy="no-referrer"
                              onError={(e) => {
                                const target = e.target as HTMLImageElement;
                                target.onerror = null;
                                target.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(perfil.nome)}&background=111&color=fff&size=64&bold=true`;
                              }}
                            />
                          ) : (
                            <UserCircle className="size-5 text-neutral-500" />
                          )}
                        </div>
                        <span className="text-[9px] font-bold text-neutral-300 truncate w-full text-center">
                          {perfil.nome}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {tipo === "tracklist_reveal" && (
              <select
                value={faixaOrdemRevelada}
                onChange={(e) => setFaixaOrdemRevelada(Number(e.target.value))}
                className="w-full bg-neutral-800 border border-white/10 rounded-xl px-3 py-2 text-sm text-white"
              >
                <option value="">Escolha a faixa a revelar...</option>
                {faixasOcultas.map((f) => (
                  <option key={f.num} value={f.num}>
                    {f.titulo}
                  </option>
                ))}
              </select>
            )}
            <textarea
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder="Texto do post"
              className="w-full bg-neutral-800 border border-white/10 rounded-xl px-3 py-2 text-sm text-white"
            />
          </div>
        )}

        {erro && <p className="text-xs text-red-400">{erro}</p>}

        <button
          onClick={completar}
          disabled={enviando}
          className="w-full px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider bg-fuchsia-500 hover:bg-fuchsia-400 text-black disabled:opacity-50"
        >
          {enviando ? "Enviando..." : "Completar missão"}
        </button>
      </div>
    </div>
  );
}
