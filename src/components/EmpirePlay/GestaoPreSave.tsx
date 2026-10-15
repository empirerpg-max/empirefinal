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
  Maximize2,
  Pencil,
} from "lucide-react";
import { useTelegramUser, haptic } from "@/lib/telegram";
import { api, driveImg, normalizeNome, formatarDataBR } from "@/lib/api";
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
import { EncarteViewer } from "./EncarteViewer";
import { SocialPostComposer } from "@/components/Social/SocialPostComposer";

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

// Mesmo formato de TrackConfig (Gestao.tsx) persistido pela campanha, já
// resolvido pelo backend (ver preSaveController.ts) — 2 campos extras de
// pre-save (mostrarNomeReal/revelada) por cima do cadastro normal de faixa.
interface Faixa {
  num: number;
  inedita: boolean;
  titulo: string;
  mostrarNomeReal: boolean;
  revelada: boolean;
  instrumental?: boolean;
  letra?: string;
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
  valoresPorDia: { dia: number; valor: number }[];
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
                  Lançamento em {formatarDataBR(c.dataLancamento)} ·{" "}
                  {c.modo === "missao" ? "Com missões" : "Só contagem"}
                </div>
              </div>
              <StatusPill status={c.status} />
            </button>
          ))}
        </div>
      )}

      {!mostrarForm && !selecionada && <LeaderboardPreSave />}
    </div>
  );
}

interface LeaderboardEntry {
  posicao: number;
  artista: string;
  totalPreSaves: number;
  campanhas: number;
}

// Leaderboard histórico "mais pre-saves da história" (top 10/20/30
// artistas) — item explicitamente pedido no desenho da feature; faltava
// ter ALGUM lugar pra exibir o que /api/presave/leaderboard já calculava.
function LeaderboardPreSave() {
  const [ranking, setRanking] = useState<LeaderboardEntry[]>([]);
  const [limite, setLimite] = useState(10);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/presave/leaderboard?limit=${limite}`)
      .then((r) => r.json())
      .then((res) => setRanking(Array.isArray(res?.data) ? res.data : []))
      .catch(() => setRanking([]))
      .finally(() => setLoading(false));
  }, [limite]);

  return (
    <div className="mt-8 rounded-2xl bg-neutral-800/40 border border-white/10 p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <h2 className="text-sm font-black uppercase tracking-wider text-fuchsia-300">
          Top artistas em pre-save (histórico)
        </h2>
        <div className="flex gap-1.5">
          {[10, 20, 30].map((n) => (
            <button
              key={n}
              onClick={() => setLimite(n)}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-bold shrink-0 ${
                limite === n ? "bg-fuchsia-500 text-black" : "bg-white/5 text-neutral-300"
              }`}
            >
              Top {n}
            </button>
          ))}
        </div>
      </div>
      {loading && <p className="text-xs text-neutral-500">Carregando...</p>}
      {!loading && ranking.length === 0 && (
        <p className="text-xs text-neutral-500">Nenhuma campanha de pre-save registrada ainda.</p>
      )}
      <div className="space-y-1.5">
        {ranking.map((r) => (
          <div key={r.artista} className="flex items-center gap-3 px-2 py-1.5 rounded-xl min-w-0">
            <span className="text-xs font-black text-neutral-500 w-6 shrink-0">#{r.posicao}</span>
            <span className="text-sm text-white font-bold truncate flex-1 min-w-0">
              {r.artista}
            </span>
            <span className="text-xs font-bold text-fuchsia-300 shrink-0">
              {r.totalPreSaves.toLocaleString("pt-BR")}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Botão de diagnóstico/reparo — só aparece quando o contador está em 0.
// Investiga um bug real reportado em produção: o teto é calculado uma vez
// na criação da campanha e NUNCA recalculado depois; se nessa hora o
// cálculo do valTotal do artista deu 0 (bug real do cap fixo em
// "SPOTIFY", já corrigido em getMelhorValTotalArtista), o teto ficou
// gravado em 0 PRA SEMPRE, e qualquer missão completada depois nunca
// soma nada (0 × peso = 0). Esse botão chama o diagnóstico e, se for
// exatamente esse o caso, corrige recalculando com o bug já corrigido —
// sem nunca sobrescrever um teto que já era > 0 de verdade.
function RecalcularTetoButton({
  campanhaId,
  onCorrigido,
}: {
  campanhaId: string;
  onCorrigido: () => void;
}) {
  const [estado, setEstado] = useState<"idle" | "verificando" | "ok" | "corrigido" | "erro">(
    "idle",
  );
  const [mensagem, setMensagem] = useState("");

  // O backend (recalcularTetoPreSaveController) já decide se o teto
  // armazenado "parece quebrado" (zero OU um número implausivelmente
  // pequeno — bug real de corrupção de locale, ver preSaveController.ts)
  // e só reescreve nesse caso — não precisa de um diagnóstico separado
  // antes, a própria chamada já responde com o motivo quando não é o
  // caso.
  const verificarECorrigir = async () => {
    setEstado("verificando");
    setMensagem("");
    try {
      const res = await fetch("/api/presave/recalcular-teto", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campanhaId }),
      }).then((r) => r.json());
      if (!res.success) {
        setEstado("ok");
        setMensagem(res.error || "Não encontrei esse bug nessa campanha.");
        return;
      }
      setEstado("corrigido");
      setMensagem(
        `Teto estava quebrado (${res.data.tetoAnterior}) — recalculado pra ${res.data.tetoNovo} agora. Contador atualizado.`,
      );
      onCorrigido();
    } catch (err: any) {
      setEstado("erro");
      setMensagem(err.message || "Falha ao verificar/corrigir.");
    }
  };

  return (
    <div className="mt-2.5 pt-2.5 border-t border-fuchsia-400/20">
      <button
        onClick={verificarECorrigir}
        disabled={estado === "verificando"}
        className="text-[11px] font-bold text-fuchsia-300 hover:text-fuchsia-200 disabled:opacity-50"
      >
        {estado === "verificando" ? "Verificando..." : "Contador em 0? Verificar/corrigir"}
      </button>
      {mensagem && <p className="text-[11px] text-neutral-400 mt-1">{mensagem}</p>}
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
    const meus = new Set((profile?.associatedArtists || []).map((a) => normalizeNome(a)));
    if (meus.size === 0) return [];
    return musicasEmChart.filter((m) => m.artist && meus.has(normalizeNome(m.artist)));
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
      // Diferente do álbum normal (Gestao.tsx), aqui o áudio NÃO é
      // obrigatório na criação da campanha — o álbum só é publicado de
      // verdade no dia D, então o jogador pode cadastrar a faixa (nome
      // oculto "Track N") sem ainda ter o áudio final pronto. A ausência
      // de áudio numa faixa inédita é validada/bloqueada no lançamento
      // (ver processarLancamentosPreSaveScheduled, preSaveController.ts),
      // não aqui.
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
      {/* Mesma lista de sugestões de "Feat" que Gestao.tsx usa — o
          FaixaEditor reaproveitado aqui referencia esse mesmo id de
          datalist; sem ele, o campo de participante continua funcionando
          normalmente, só sem autocomplete. */}
      <datalist id="participantes-conhecidos">
        {(profile?.associatedArtists || []).map((nome) => (
          <option key={nome} value={nome} />
        ))}
      </datalist>
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
        {faixasConfig.map((faixa, idx) => {
          // Aviso real (pedido do usuário, achado o motivo com o bug da
          // "Follia" na campanha do Max Gorghan): faixa marcada como
          // inédita, com um link placeholder ("-" ou vazio), cujo título
          // já bate com uma música REAL já registrada nos charts — sinal
          // de que o jogador só preencheu "inédita" pra conseguir avançar
          // no formulário (provavelmente porque a busca de "Música
          // Existente" não achava essa música na hora, bug do cap fixo do
          // SPOTIFY, já corrigido). Em vez de deixar passar calado,
          // sugere trocar pra "Música Existente" de verdade.
          const linkPlaceholder = !faixa.mediaUrl?.trim() || faixa.mediaUrl.trim() === "-";
          const sugestaoExistente =
            faixa.inedita && linkPlaceholder && faixa.titulo.trim()
              ? musicasEmChart.find(
                  (m) =>
                    normalizeNome(m.artist) === normalizeNome(artista) &&
                    (normalizeNome(m.title) === normalizeNome(faixa.titulo) ||
                      normalizeNome(m.label) === normalizeNome(`${artista} - ${faixa.titulo}`)),
                )
              : undefined;
          return (
            <div key={idx} className="space-y-1.5">
              {sugestaoExistente && (
                <div className="flex items-center justify-between gap-2 bg-amber-500/10 border border-amber-400/30 rounded-xl px-3 py-2">
                  <span className="text-[11px] text-amber-200 min-w-0">
                    "{sugestaoExistente.label}" já existe nos charts — vincular como Música
                    Existente em vez de criar uma faixa inédita vazia?
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      const updated = [...faixasConfig];
                      updated[idx] = {
                        ...updated[idx],
                        inedita: false,
                        titulo: sugestaoExistente.label,
                        mediaUrl: undefined,
                        buscaQuery: "",
                      };
                      setFaixasConfig(updated);
                    }}
                    className="text-[11px] font-black text-amber-300 hover:text-amber-200 shrink-0 whitespace-nowrap"
                  >
                    Vincular
                  </button>
                </div>
              )}
              <FaixaEditor
                faixa={faixa}
                myChartSongs={myChartSongs}
                onChange={(patch) => {
                  const updated = [...faixasConfig];
                  updated[idx] = { ...updated[idx], ...patch };
                  setFaixasConfig(updated);
                }}
              />
            </div>
          );
        })}
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
  const [capaExpandida, setCapaExpandida] = useState(false);
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
          <button
            type="button"
            onClick={() => setCapaExpandida(true)}
            title="Ver capa em tela cheia"
            className="relative size-16 rounded-xl overflow-hidden shrink-0 group"
          >
            <img
              src={campanha.capaUrl}
              alt=""
              className="w-full h-full object-cover group-hover:scale-105 transition"
            />
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition flex items-center justify-center">
              <Maximize2 className="size-3.5 text-white opacity-0 group-hover:opacity-100 transition" />
            </div>
          </button>
        )}
        <div className="flex-1 min-w-0">
          <h2 className="font-black text-white text-lg truncate">{campanha.albumTituloFull}</h2>
          <p className="text-xs text-neutral-400 truncate">
            Lançamento em {formatarDataBR(campanha.dataLancamento)} · faltam {diasFaltando} dia
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
        {campanha.acumuladoAtual === 0 && campanha.status === "ativa" && (
          <RecalcularTetoButton campanhaId={campanha.id} onCorrigido={recarregar} />
        )}
      </div>

      {campanha.modo === "missao" ? (
        <div>
          <h3 className="text-xs font-black uppercase tracking-wider text-neutral-400 mb-2">
            Calendário de missões ({campanha.duracaoDias} dias)
          </h3>
          <div className="grid grid-cols-3 sm:grid-cols-7 gap-2">
            {campanha.missoes.map((m) => {
              const valorDoDia = campanha.valoresPorDia.find((v) => v.dia === m.dia)?.valor;
              return (
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
                  {/* Quanto esse dia já contribuiu pro contador — pedido
                      explícito: cada dia tem que mostrar seu número, não só
                      um total solto no final. Só dias já passados têm valor
                      aqui (valoresPorDia nunca inclui o dia corrente). */}
                  {valorDoDia !== undefined && (
                    <span
                      className={`text-[10px] font-black ${valorDoDia > 0 ? "text-fuchsia-300" : "text-neutral-600"}`}
                    >
                      {valorDoDia > 0 ? `+${Math.round(valorDoDia).toLocaleString("pt-BR")}` : "0"}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <div>
          <div className="flex items-center gap-2 text-sm text-neutral-400 mb-2">
            <Calendar className="size-4 shrink-0" />
            Modo só contagem — o contador sobe automaticamente todo dia, sem depender de missão.
          </div>
          {campanha.valoresPorDia.length > 0 && (
            <div className="grid grid-cols-3 sm:grid-cols-7 gap-2">
              {campanha.valoresPorDia.map((d) => (
                <div
                  key={d.dia}
                  className="flex flex-col items-center gap-1 px-1.5 py-2.5 rounded-xl border border-white/10 bg-white/5 text-center min-w-0"
                >
                  <span className="text-[10px] font-black text-neutral-400">Dia {d.dia}</span>
                  <span className="text-[11px] font-black text-fuchsia-300">
                    +{Math.round(d.valor).toLocaleString("pt-BR")}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <TracklistEditor
        campanhaId={campanha.id}
        telegramId={telegramId}
        faixas={campanha.faixas}
        onAtualizada={(c) => onAtualizada(c)}
      />

      {campanha.status === "ativa" && (
        <button onClick={cancelar} className="text-xs font-bold text-red-400 hover:text-red-300">
          Cancelar campanha
        </button>
      )}

      {diaAberto && (
        <MissaoModal
          campanhaId={campanha.id}
          telegramId={telegramId}
          artista={campanha.artista}
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

      {capaExpandida && campanha.capaUrl && (
        <EncarteViewer
          paginas={[campanha.capaUrl]}
          indiceInicial={0}
          onClose={() => setCapaExpandida(false)}
        />
      )}
    </div>
  );
}

// -------------------- EDITAR TRACKLIST --------------------

// Só edita faixa INÉDITA (f.inedita) — faixa já existente no catálogo tem
// seu título/letra editados por lá (Fórum > Músicas), não aqui (ver
// editarFaixaPreSavecontroller, backend). Editar aqui nunca muda o status
// de "revelada" — só corrige nome/letra/instrumental.
function TracklistEditor({
  campanhaId,
  telegramId,
  faixas,
  onAtualizada,
}: {
  campanhaId: string;
  telegramId: string;
  faixas: Faixa[];
  onAtualizada: (c: Campanha) => void;
}) {
  const [editando, setEditando] = useState<Faixa | null>(null);
  const editaveis = faixas.filter((f) => f.inedita);
  if (editaveis.length === 0) return null;

  return (
    <div>
      <h3 className="text-xs font-black uppercase tracking-wider text-neutral-400 mb-2">
        Tracklist
      </h3>
      <div className="space-y-1.5">
        {editaveis.map((f) => (
          <button
            key={f.num}
            onClick={() => {
              haptic.selection?.();
              setEditando(f);
            }}
            className="w-full flex items-center gap-2.5 p-2.5 rounded-xl bg-neutral-800/40 border border-white/10 hover:border-fuchsia-400/40 transition-colors text-left min-w-0"
          >
            <span className="size-6 rounded-lg bg-white/5 flex items-center justify-center text-[10px] font-black text-neutral-400 shrink-0">
              {f.num}
            </span>
            <span className="flex-1 min-w-0 truncate text-sm font-bold text-white">
              {f.revelada ? f.titulo : `Track ${f.num}`}
            </span>
            {f.instrumental && (
              <span className="shrink-0 text-[9px] font-black uppercase tracking-wider text-neutral-400 bg-white/5 px-1.5 py-0.5 rounded-full">
                Instrumental
              </span>
            )}
            <Pencil className="size-3.5 text-neutral-500 shrink-0" />
          </button>
        ))}
      </div>

      {editando && (
        <EditarFaixaModal
          campanhaId={campanhaId}
          telegramId={telegramId}
          faixa={editando}
          onFechar={() => setEditando(null)}
          onSalva={(c) => {
            setEditando(null);
            onAtualizada(c);
          }}
        />
      )}
    </div>
  );
}

function EditarFaixaModal({
  campanhaId,
  telegramId,
  faixa,
  onFechar,
  onSalva,
}: {
  campanhaId: string;
  telegramId: string;
  faixa: Faixa;
  onFechar: () => void;
  onSalva: (c: Campanha) => void;
}) {
  const [titulo, setTitulo] = useState(faixa.titulo);
  const [letra, setLetra] = useState(faixa.letra || "");
  const [instrumental, setInstrumental] = useState(!!faixa.instrumental);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  const salvar = async () => {
    if (!titulo.trim()) return setErro("O título não pode ficar vazio.");
    setErro("");
    setSalvando(true);
    try {
      const res = await fetch("/api/presave/editar-faixa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campanhaId,
          jogadorId: telegramId,
          faixaNum: faixa.num,
          titulo: titulo.trim(),
          letra,
          instrumental,
        }),
      }).then((r) => r.json());
      if (!res.success) throw new Error(res.error || "Falha ao salvar a faixa.");
      haptic.success?.();
      onSalva(res.data);
    } catch (err: any) {
      setErro(err.message || "Falha ao salvar a faixa.");
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[110] flex items-end sm:items-center justify-center bg-black/70 p-0 sm:p-4">
      <div className="w-full sm:max-w-md bg-neutral-900 border border-white/10 rounded-t-2xl sm:rounded-2xl p-5 space-y-4 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h3 className="font-black text-white text-sm">Editar faixa {faixa.num}</h3>
          <button onClick={onFechar} className="text-neutral-400 hover:text-white">
            <X className="size-5" />
          </button>
        </div>

        <div>
          <label className="text-[10px] font-black uppercase tracking-wider text-neutral-400 block mb-1.5">
            Nome da faixa
          </label>
          <input
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            className="w-full bg-neutral-800 border border-white/10 rounded-xl px-3 py-2 text-sm text-white"
            placeholder="Nome da faixa"
          />
          {!faixa.revelada && (
            <p className="text-[11px] text-neutral-500 mt-1">
              Essa faixa ainda está oculta pro público — vai continuar aparecendo como "Track{" "}
              {faixa.num}" até a missão de revelação.
            </p>
          )}
        </div>

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={instrumental}
            onChange={(e) => setInstrumental(e.target.checked)}
            className="size-4 accent-fuchsia-500"
          />
          <span className="text-sm text-white font-bold">Faixa instrumental (sem letra)</span>
        </label>

        {!instrumental && (
          <div>
            <label className="text-[10px] font-black uppercase tracking-wider text-neutral-400 block mb-1.5">
              Letra
            </label>
            <textarea
              value={letra}
              onChange={(e) => setLetra(e.target.value)}
              rows={8}
              className="w-full bg-neutral-800 border border-white/10 rounded-xl px-3 py-2 text-sm text-white resize-none"
              placeholder="Cole a letra da faixa aqui..."
            />
          </div>
        )}

        {erro && <p className="text-xs text-red-400">{erro}</p>}

        <button
          onClick={salvar}
          disabled={salvando}
          className="w-full px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider bg-fuchsia-500 hover:bg-fuchsia-400 text-black disabled:opacity-50"
        >
          {salvando ? "Salvando..." : "Salvar faixa"}
        </button>
      </div>
    </div>
  );
}

// -------------------- MODAL DE COMPLETAR MISSÃO --------------------

interface PerguntaResposta {
  pergunta: string;
  resposta: string;
}

function MissaoModal({
  campanhaId,
  telegramId,
  artista,
  missao,
  faixas,
  perfisMidia,
  onFechar,
  onCompletada,
}: {
  campanhaId: string;
  telegramId: string;
  artista: string;
  missao: MissaoDia;
  faixas: Faixa[];
  perfisMidia: PerfilMidia[];
  onFechar: () => void;
  onCompletada: () => void;
}) {
  const tipo = missao.tipo as MissaoTipo;
  const info = MISSOES.find((m) => m.tipo === tipo)!;
  // Missões que terminam em post social agora usam o MESMO composer real do
  // Social (<SocialPostComposer>, src/components/Social/SocialPostComposer.tsx)
  // em vez de um mini-form próprio — o post sai pelo caminho de verdade
  // (salvarPostSocial), e só depois de criado é que a missão é confirmada
  // (ver confirmarMissaoComPost abaixo). No final das contas o post cai no
  // mesmo Social de sempre.
  const [composerOpen, setComposerOpen] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [perfilArtista, setPerfilArtista] = useState("");
  const [faixaOrdemRevelada, setFaixaOrdemRevelada] = useState<number | "">("");

  // Entrevista — EXATAMENTE a mesma forma do cadastro de Entrevistas do
  // Acervo (acervo.tsx, CreateModal): múltiplas perguntas/respostas, capa
  // opcional, músicas vinculadas do chart do artista.
  const [entrevistaTitulo, setEntrevistaTitulo] = useState("");
  const [entrevistaCapaFile, setEntrevistaCapaFile] = useState<File | null>(null);
  const [entrevistaCapaPreview, setEntrevistaCapaPreview] = useState<string | null>(null);
  const [enviandoCapaEntrevista, setEnviandoCapaEntrevista] = useState(false);
  const [perguntas, setPerguntas] = useState<PerguntaResposta[]>([{ pergunta: "", resposta: "" }]);
  const [musicasChart, setMusicasChart] = useState<{ label: string; artist: string }[]>([]);
  const [musicasSelecionadas, setMusicasSelecionadas] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (tipo !== "entrevista") return;
    fetch("/api/gestao/musicas-em-chart")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.success && Array.isArray(data.data)) setMusicasChart(data.data);
      })
      .catch(() => {});
  }, [tipo]);
  const musicasDoArtista = musicasChart.filter(
    (m) => normalizeNome(m.artist) === normalizeNome(artista),
  );

  const [videoRealId, setVideoRealId] = useState("");
  const [caminhoMakingOf, setCaminhoMakingOf] = useState<"tiktok" | "video_real">("tiktok");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");
  // Confirmação explícita pro jogador depois de revelar — sem isso, a
  // faixa só "some" da lista de ocultas sem nenhum feedback de qual nome
  // virou público.
  const [faixaRevelConfirmada, setFaixaRevelConfirmada] = useState<string | null>(null);
  // BUG REAL corrigido aqui (reportado em produção, 2026-10): antes,
  // sucesso chamava onCompletada() na mesma passada de render que setava
  // faixaRevelConfirmada — onCompletada fecha esse modal inteiro
  // (setDiaAberto(null) no componente pai), desmontando MissaoModal ANTES
  // de qualquer confirmação aparecer na tela. Pro jogador, a experiência
  // era: publica no Instagram, a tela simplesmente volta pra Gestão sem
  // nenhum feedback — parecia que "não deixava publicar", mesmo quando a
  // missão tinha sido confirmada de verdade no backend. Agora o sucesso
  // mostra uma tela de confirmação própria, e só fecha quando o jogador
  // confirma ter visto (onCompletada só dispara aí).
  const [missaoConcluida, setMissaoConcluida] = useState(false);

  const faixasOcultas = faixas.filter((f) => !f.revelada);

  const completar = async () => {
    setErro("");
    const payload: Record<string, unknown> = { campanhaId, dia: missao.dia, jogadorId: telegramId };

    if (tipo === "entrevista") {
      const perguntasValidas = perguntas.filter((p) => p.pergunta.trim() && p.resposta.trim());
      if (!entrevistaTitulo.trim() || perguntasValidas.length === 0) {
        return setErro("Preencha o título e ao menos 1 pergunta/resposta da entrevista.");
      }
      if (musicasSelecionadas.size === 0) {
        return setErro("Selecione ao menos 1 música do chart pra essa entrevista.");
      }
      let capaEntrevistaUrl = "";
      if (entrevistaCapaFile) {
        setEnviandoCapaEntrevista(true);
        try {
          capaEntrevistaUrl = await uploadToDrive(
            entrevistaCapaFile,
            "musica",
            `CAPA_ENTREVISTA_${Date.now()}.jpg`,
          );
        } catch (err: any) {
          setEnviandoCapaEntrevista(false);
          return setErro(err.message || "Falha ao enviar a capa da entrevista.");
        }
        setEnviandoCapaEntrevista(false);
      }
      payload.entrevista = {
        titulo: entrevistaTitulo,
        capa: capaEntrevistaUrl,
        perguntas: perguntasValidas,
        musicas: Array.from(musicasSelecionadas),
      };
    } else if (tipo === "making_of_video" && caminhoMakingOf === "video_real") {
      if (!videoRealId.trim())
        return setErro("Informe o ID do vídeo já cadastrado em Fórum > Vídeos.");
      payload.videoRealId = videoRealId.trim();
    } else {
      // Os demais tipos (post_anuncio, bastidores, capa_alternativa,
      // trecho_letra, making_of_video "TikTok", enquete_fas,
      // countdown_marco, desafio_som, tracklist_reveal) publicam pelo
      // <SocialPostComposer> — ver confirmarMissaoComPost, chamado pelo
      // onPosted do composer depois que o post já existe de verdade.
      return;
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
      setMissaoConcluida(true);
    } catch (err: any) {
      setErro(err.message || "Falha ao completar missão.");
    } finally {
      setEnviando(false);
    }
  };

  // Chamado pelo <SocialPostComposer> (onPosted) depois que o post já foi
  // criado de verdade no Social (mesmo backend, createSocialPostController/
  // salvarPostSocial) — aqui só confirma a missão do dia, sem recriar o
  // post (completar-missao recebe postJaPublicado:true e não publica de
  // novo, ver preSaveController.ts).
  const confirmarMissaoComPost = async (result: { id: string; payload: Record<string, unknown> }) => {
    setErro("");
    // BUG REAL corrigido aqui (reportado em produção, 2026-10): esses 2
    // retornos antecipados não fechavam o composer — ele cobre a tela
    // inteira (z-[110]), então o jogador via o post sair de verdade no
    // Social e, em seguida, nada visível acontecia (a mensagem de erro
    // ficava escondida atrás do composer ainda aberto). Mesma causa raiz
    // do fix anterior (sucesso fechando o modal sem feedback), só que
    // nesse caminho de erro específico.
    if (tipo === "bastidores" && !perfilArtista) {
      setComposerOpen(false);
      return setErro('Escolha um perfil de "Tá na Mídia" para publicar.');
    }
    if (tipo === "tracklist_reveal" && !faixaOrdemRevelada) {
      setComposerOpen(false);
      return setErro("Escolha qual faixa oculta revelar.");
    }
    const tipoRede = String(result.payload.tipo || "").toLowerCase();
    const subtipo = String(result.payload.subtipo || "");
    const rede = subtipo === "Story" ? "stories" : tipoRede;
    const payload: Record<string, unknown> = {
      campanhaId,
      dia: missao.dia,
      jogadorId: telegramId,
      postJaPublicado: true,
      rede,
    };
    if (tipo === "bastidores") payload.perfilArtista = perfilArtista;
    if (tipo === "tracklist_reveal") payload.faixaOrdemRevelada = faixaOrdemRevelada;

    setConfirmando(true);
    try {
      const res = await fetch("/api/presave/completar-missao", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }).then((r) => r.json());
      if (!res.success)
        throw new Error(
          res.error ||
            "O post já foi publicado no Social, mas não deu pra confirmar a missão — tenta de novo.",
        );
      haptic.success?.();
      setComposerOpen(false);
      if (tipo === "tracklist_reveal") {
        // Nome real só existe no retorno DEPOIS de confirmado — o dropdown
        // mostrava só "Track N" (ver option abaixo), então esse é o
        // primeiro momento em que o jogador vê de fato o que foi revelado.
        const faixaRevelada = (res.data?.faixas as { num: number; titulo: string }[] | undefined)?.find(
          (f) => f.num === faixaOrdemRevelada,
        );
        setFaixaRevelConfirmada(faixaRevelada?.titulo || null);
      }
      setMissaoConcluida(true);
    } catch (err: any) {
      // Fecha o composer no erro também — ele cobre a tela inteira
      // (z-[110]), então enquanto ficasse aberto o jogador nunca via essa
      // mensagem de erro (ela some atrás do composer).
      setComposerOpen(false);
      setErro(err.message || "Falha ao confirmar a missão.");
    } finally {
      setConfirmando(false);
    }
  };

  // Rede(s) permitida(s) no 1º passo do composer: desafio_som e o caminho
  // TikTok de making_of_video são exclusivos de TikTok; os demais tipos de
  // post aceitam qualquer rede (igual o mini-form antigo, que oferecia
  // twitter/instagram/tiktok/stories — "stories" vira o próprio modo Story
  // dentro do Instagram no composer).
  const composerAllowedTypes: ("Instagram" | "Twitter" | "TikTok")[] | undefined =
    tipo === "desafio_som" || tipo === "making_of_video" ? ["TikTok"] : undefined;

  // Bastidores publica através de um perfil de "Tá na Mídia" escolhido
  // (não do artista da campanha) — os demais tipos publicam como o próprio
  // artista da campanha.
  const composerFixedArtist =
    tipo === "bastidores"
      ? perfilArtista
        ? { nome: perfilArtista, foto: perfisMidia.find((p) => p.nome === perfilArtista)?.foto }
        : null
      : { nome: artista };

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

        {missaoConcluida ? (
          <div className="py-6 flex flex-col items-center text-center gap-3">
            <div className="size-14 rounded-full bg-emerald-500/15 flex items-center justify-center">
              <Check className="size-7 text-emerald-400" />
            </div>
            <div>
              <p className="font-black text-white">Missão concluída!</p>
              {faixaRevelConfirmada ? (
                <p className="text-sm text-fuchsia-300 font-bold mt-1">
                  🎉 Faixa revelada: {faixaRevelConfirmada}
                </p>
              ) : (
                <p className="text-xs text-neutral-400 mt-1">
                  O post já está no Social e o contador de pre-save foi atualizado.
                </p>
              )}
            </div>
            <button
              onClick={onCompletada}
              className="w-full px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider bg-fuchsia-500 hover:bg-fuchsia-400 text-black"
            >
              Fechar
            </button>
          </div>
        ) : (
          <>
            <p className="text-xs text-neutral-400">{info.descricao}</p>

            {tipo === "entrevista" ? (
          <div className="space-y-3">
            <input
              value={entrevistaTitulo}
              onChange={(e) => setEntrevistaTitulo(e.target.value)}
              placeholder="Título da entrevista"
              className="w-full bg-neutral-800 border border-white/10 rounded-xl px-3 py-2 text-sm text-white"
            />

            <div>
              <label className="text-[11px] font-bold text-neutral-400">Capa (opcional)</label>
              <div className="flex items-center gap-3 mt-1">
                {entrevistaCapaPreview && (
                  <img
                    src={entrevistaCapaPreview}
                    alt=""
                    className="size-12 rounded-xl object-cover shrink-0"
                  />
                )}
                <label className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-xs font-bold cursor-pointer shrink-0">
                  <UploadIcon className="size-3.5 shrink-0" />
                  <span className="truncate">
                    {enviandoCapaEntrevista
                      ? "Enviando..."
                      : entrevistaCapaPreview
                        ? "Trocar capa"
                        : "Selecionar capa"}
                  </span>
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      setEntrevistaCapaFile(file);
                      setEntrevistaCapaPreview(URL.createObjectURL(file));
                    }}
                  />
                </label>
              </div>
            </div>

            <div>
              <label className="text-[11px] font-bold text-neutral-400">Músicas vinculadas</label>
              {musicasDoArtista.length === 0 ? (
                <p className="text-[11px] text-neutral-500 mt-1">
                  Nenhuma música do artista encontrada no chart.
                </p>
              ) : (
                <div className="flex flex-wrap gap-1.5 mt-1.5 max-h-28 overflow-y-auto">
                  {musicasDoArtista.map((m) => (
                    <button
                      key={m.label}
                      type="button"
                      onClick={() =>
                        setMusicasSelecionadas((prev) => {
                          const next = new Set(prev);
                          if (next.has(m.label)) next.delete(m.label);
                          else next.add(m.label);
                          return next;
                        })
                      }
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-bold truncate max-w-full ${
                        musicasSelecionadas.has(m.label)
                          ? "bg-fuchsia-500 text-black"
                          : "bg-white/5 text-neutral-300"
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-bold text-neutral-400">
                  Perguntas e respostas
                </label>
                <button
                  type="button"
                  onClick={() => setPerguntas((prev) => [...prev, { pergunta: "", resposta: "" }])}
                  className="text-[11px] font-bold text-fuchsia-300 hover:text-fuchsia-200"
                >
                  + adicionar pergunta
                </button>
              </div>
              {perguntas.map((p, i) => (
                <div
                  key={i}
                  className="space-y-1.5 p-2.5 rounded-xl bg-neutral-800 border border-white/10"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-black text-neutral-500">#{i + 1}</span>
                    {perguntas.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setPerguntas((prev) => prev.filter((_, idx) => idx !== i))}
                        className="p-1 rounded-lg hover:bg-white/10"
                      >
                        <Trash2 className="size-3.5 text-neutral-500" />
                      </button>
                    )}
                  </div>
                  <input
                    value={p.pergunta}
                    onChange={(e) =>
                      setPerguntas((prev) =>
                        prev.map((x, idx) => (idx === i ? { ...x, pergunta: e.target.value } : x)),
                      )
                    }
                    placeholder="Pergunta"
                    className="w-full bg-neutral-900 border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
                  />
                  <textarea
                    value={p.resposta}
                    onChange={(e) =>
                      setPerguntas((prev) =>
                        prev.map((x, idx) => (idx === i ? { ...x, resposta: e.target.value } : x)),
                      )
                    }
                    placeholder="Resposta"
                    className="w-full bg-neutral-900 border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
                  />
                </div>
              ))}
            </div>
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
              <button
                type="button"
                onClick={() => {
                  haptic.selection?.();
                  setComposerOpen(true);
                }}
                className="w-full px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider bg-fuchsia-500 hover:bg-fuchsia-400 text-black"
              >
                Abrir compositor do Social (TikTok)
              </button>
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
          <div className="space-y-3">
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
              <>
                <select
                  value={faixaOrdemRevelada}
                  onChange={(e) => setFaixaOrdemRevelada(Number(e.target.value))}
                  className="w-full bg-neutral-800 border border-white/10 rounded-xl px-3 py-2 text-sm text-white"
                >
                  {/* Nome real só aparece DEPOIS da missão confirmada (ver
                      faixaRevelConfirmada) — mostrar f.titulo aqui vazaria o
                      nome antes da "revelação" de verdade acontecer. */}
                  <option value="">Escolha a faixa a revelar...</option>
                  {faixasOcultas.map((f) => (
                    <option key={f.num} value={f.num}>
                      Track {f.num}
                    </option>
                  ))}
                </select>
                {faixaRevelConfirmada && (
                  <p className="text-xs font-bold text-fuchsia-300">
                    🎉 Faixa revelada: {faixaRevelConfirmada}
                  </p>
                )}
              </>
            )}
            <button
              type="button"
              disabled={
                (tipo === "bastidores" && !perfilArtista) ||
                (tipo === "tracklist_reveal" && !faixaOrdemRevelada)
              }
              onClick={() => {
                haptic.selection?.();
                setComposerOpen(true);
              }}
              className="w-full px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider bg-fuchsia-500 hover:bg-fuchsia-400 text-black disabled:opacity-50"
            >
              Abrir compositor do Social
            </button>
          </div>
        )}

        {erro && <p className="text-xs text-red-400">{erro}</p>}

        {(tipo === "entrevista" || (tipo === "making_of_video" && caminhoMakingOf === "video_real")) && (
          <button
            onClick={completar}
            disabled={enviando}
            className="w-full px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider bg-fuchsia-500 hover:bg-fuchsia-400 text-black disabled:opacity-50"
          >
            {enviando ? "Enviando..." : "Completar missão"}
          </button>
        )}
          </>
        )}
      </div>

      {composerOpen && composerFixedArtist && (
        <SocialPostComposer
          telegramId={telegramId}
          fixedArtist={composerFixedArtist}
          allowedTypes={composerAllowedTypes}
          initialType={composerAllowedTypes?.length === 1 ? composerAllowedTypes[0] : null}
          profiles={[]}
          onClose={() => setComposerOpen(false)}
          onPosted={confirmarMissaoComPost}
        />
      )}
      {confirmando && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70">
          <p className="text-xs font-bold text-white">Confirmando a missão...</p>
        </div>
      )}
    </div>
  );
}
