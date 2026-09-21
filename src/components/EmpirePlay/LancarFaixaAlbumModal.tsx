import { useEffect, useMemo, useState } from "react";
import { X, Search, Loader2, Rocket, Disc, Upload, Image as ImageIcon, Plus, Minus, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { haptic } from "@/lib/telegram";
import { driveImg } from "@/lib/api";
import {
  ExtraMaterialEditor,
  emptyExtraMaterialEditorValue,
  fetchExtraMaterial,
  saveExtraMaterial,
  type ExtraMaterialEditorValue,
} from "./ExtraMaterial";

const TIPOS_SINGLE_FAIXA = [
  "TRACKLIST ALBUM",
  "LEAD SINGLE",
  "PRÉ-ALBUM",
  "AVULSO",
  "PÓS-ALBUM",
  "PÓS-ALBUM REMIX",
  "SOUNDTRACK",
  "PROMOCIONAL",
  "REMIX",
  "PRÉ-ALBUM REMIX",
  "LEAD SINGLE REMIX",
  "INTERLUDE",
];
const TIPOS_MUSICA_FAIXA = ["SOLO", "PARCERIA", "DUETO", "CONJUNTO"];

interface FaixaPendente {
  musicaRowIndex: number;
  titulo: string;
  album: string;
  tipoSingleAtual: string;
  tipoMusicaAtual: string;
  audioUrl: string;
  capaUrl: string;
  letra: string;
  participantes: string[];
  codigoUnico: string;
}

interface LancarFaixaAlbumModalProps {
  associatedArtists: string[];
  defaultArtist: string;
  nomeJogador: string;
  jogadorId: string;
  onClose: () => void;
  /** Reaproveita o mesmo upload já usado no resto da Gestão (Drive, com fallback FormData/Base64). */
  uploadToDrive: (file: File, folderType: "musica" | "musicaAudio", customName?: string) => Promise<string>;
}

// Botão próprio em Gestão pra centralizar o caminho de "lançar uma faixa de
// álbum que ficou pendente" — antes só dava pra fazer isso abrindo Editar >
// Álbuns > achando o álbum certo > rolando até a faixa. Junta os passos
// (escolher a faixa pendente, entre TODOS os álbuns do artista de uma vez;
// virar tópico; ajustar as MESMAS opções que um lançamento normal de
// música permite — tipo de single, tipo de música, participantes, capa,
// áudio, letra) numa tela só, reaproveitando o mesmo
// publicarFaixaPendenteController que já existia (agora também aceitando
// esses campos extras).
export function LancarFaixaAlbumModal({
  associatedArtists,
  defaultArtist,
  nomeJogador,
  jogadorId,
  onClose,
  uploadToDrive,
}: LancarFaixaAlbumModalProps) {
  const [artista, setArtista] = useState(defaultArtist || associatedArtists[0] || "");
  const [faixas, setFaixas] = useState<FaixaPendente[] | null>(null);
  const [busca, setBusca] = useState("");
  const [selecionada, setSelecionada] = useState<FaixaPendente | null>(null);

  const [tipoSingle, setTipoSingle] = useState("LEAD SINGLE");
  const [tipoMusica, setTipoMusica] = useState("SOLO");
  const [participantes, setParticipantes] = useState<string[]>([""]);
  const [letra, setLetra] = useState("");
  const [capaFile, setCapaFile] = useState<File | null>(null);
  const [capaPreview, setCapaPreview] = useState<string | null>(null);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioUrlInput, setAudioUrlInput] = useState("");
  const [extraEdit, setExtraEdit] = useState<ExtraMaterialEditorValue>(emptyExtraMaterialEditorValue());

  const [publicando, setPublicando] = useState(false);

  useEffect(() => {
    if (!artista) return;
    setFaixas(null);
    setSelecionada(null);
    fetch(`/api/gestao/faixas-pendentes?artista=${encodeURIComponent(artista)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setFaixas(data?.success ? data.data : []))
      .catch(() => setFaixas([]));
  }, [artista]);

  const faixasFiltradas = useMemo(() => {
    if (!faixas) return [];
    const q = busca.trim().toLowerCase();
    if (!q) return faixas;
    return faixas.filter(
      (f) => f.titulo.toLowerCase().includes(q) || f.album.toLowerCase().includes(q),
    );
  }, [faixas, busca]);

  function selecionar(f: FaixaPendente) {
    haptic.selection();
    setSelecionada(f);
    setTipoSingle(f.tipoSingleAtual || "LEAD SINGLE");
    setTipoMusica(f.tipoMusicaAtual || "SOLO");
    setParticipantes(f.participantes.length > 0 ? f.participantes : [""]);
    setLetra(f.letra || "");
    setCapaFile(null);
    setCapaPreview(f.capaUrl || null);
    setAudioFile(null);
    setAudioUrlInput(f.audioUrl || "");
    // Botões do tópico (Shop/Info/Visual) — mesma opção que "Nova Música"
    // já tem, faltava aqui. Se a faixa já tem Código único (comum: faixa
    // inédita de álbum já ganha um na criação), carrega o que já existe
    // pra edição; senão começa vazio, igual uma música nova.
    if (f.codigoUnico) {
      fetchExtraMaterial(f.codigoUnico, "musica").then((data) =>
        setExtraEdit({
          shopAtivo: data.shop.length > 0,
          shop: data.shop,
          infoAtivo: !!data.info.trim(),
          info: data.info,
          visualAtivo: data.arte.length > 0,
          arte: data.arte,
        }),
      );
    } else {
      setExtraEdit(emptyExtraMaterialEditorValue());
    }
  }

  function handleCapaSelect(file: File) {
    setCapaFile(file);
    const reader = new FileReader();
    reader.onload = () => setCapaPreview(reader.result as string);
    reader.readAsDataURL(file);
  }

  async function handlePublicar() {
    if (!selecionada) return;
    setPublicando(true);
    try {
      let capaUrl: string | undefined = undefined;
      if (capaFile) {
        capaUrl = await uploadToDrive(capaFile, "musica", `CAPA_${artista}_${selecionada.titulo}_${Date.now()}.jpg`);
      }
      let audioUrl: string | undefined = undefined;
      if (audioFile) {
        audioUrl = await uploadToDrive(audioFile, "musicaAudio", `AUDIO_${artista}_${selecionada.titulo}_${Date.now()}`);
      } else if (audioUrlInput.trim() && audioUrlInput.trim() !== selecionada.audioUrl) {
        audioUrl = audioUrlInput.trim();
      }

      const res = await fetch("/api/gestao/faixa/publicar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          musicaRowIndex: selecionada.musicaRowIndex,
          nomeJogador,
          jogadorId,
          tipoSingle,
          tipoMusica,
          participantes: tipoMusica !== "SOLO" ? participantes.filter((p) => p.trim()) : [],
          letra,
          ...(capaUrl ? { capaUrl } : {}),
          ...(audioUrl ? { audioUrl } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "Erro ao lançar a faixa.");

      const codigoUnico = data.data?.codigoUnico || "";
      if (codigoUnico && (extraEdit.shopAtivo || extraEdit.infoAtivo || extraEdit.visualAtivo)) {
        await saveExtraMaterial(codigoUnico, "musica", {
          shop: extraEdit.shopAtivo ? extraEdit.shop : [],
          info: extraEdit.infoAtivo ? extraEdit.info : "",
          arte: extraEdit.visualAtivo ? extraEdit.arte : [],
        }).catch(() => {});
      }

      haptic.success();
      toast.success("Faixa lançada!", {
        description: `"${selecionada.titulo}" agora tem tópico próprio nos charts.`,
      });
      onClose();
    } catch (err: any) {
      toast.error(err.message || "Não foi possível lançar essa faixa.");
    } finally {
      setPublicando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[200] bg-neutral-950 flex flex-col overflow-hidden text-white">
      <div className="flex items-center justify-between px-4 pt-[calc(env(safe-area-inset-top)+16px)] pb-3 border-b border-white/10">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.14em] text-emerald-400">Gestão</p>
          <h2 className="text-lg font-black italic uppercase tracking-tight">Lançar Faixa de Álbum</h2>
        </div>
        <button
          onClick={onClose}
          className="size-9 shrink-0 rounded-full bg-white/10 grid place-items-center hover:bg-white/20"
          aria-label="Fechar"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {associatedArtists.length > 1 && (
          <div className="space-y-1.5">
            <label className="text-xs font-bold uppercase tracking-wider text-neutral-400">Artista</label>
            <select
              value={artista}
              onChange={(e) => setArtista(e.target.value)}
              className="w-full px-4 py-3 bg-neutral-900 border border-white/10 rounded-2xl text-sm text-white focus:outline-none focus:border-emerald-500"
            >
              {associatedArtists.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </div>
        )}

        {!selecionada ? (
          <>
            <div className="relative">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-neutral-500" />
              <input
                type="text"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar faixa ou álbum..."
                className="w-full pl-10 pr-4 py-3 bg-neutral-900 border border-white/10 rounded-2xl text-sm text-white placeholder-neutral-500 focus:outline-none focus:border-emerald-500"
              />
            </div>

            {faixas === null ? (
              <div className="flex justify-center py-16 opacity-50">
                <Loader2 className="size-6 animate-spin" />
              </div>
            ) : faixasFiltradas.length === 0 ? (
              <div className="rounded-3xl bg-white/[0.03] border border-dashed border-white/10 p-10 text-center">
                <Disc className="size-8 mx-auto mb-3 text-neutral-600" />
                <p className="text-sm text-neutral-400">
                  {faixas.length === 0
                    ? "Nenhuma faixa de álbum pendente pra esse artista."
                    : "Nada encontrado com esse termo."}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {faixasFiltradas.map((f) => (
                  <button
                    key={f.musicaRowIndex}
                    onClick={() => selecionar(f)}
                    className="w-full text-left flex items-center justify-between gap-3 p-3.5 rounded-2xl bg-neutral-900 border border-white/10 hover:border-emerald-500/40 transition"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-bold truncate">{f.titulo}</p>
                      <p className="text-[11px] text-neutral-500 truncate">{f.album}</p>
                    </div>
                    <span className="shrink-0 px-2 py-1 rounded-full bg-yellow-500/15 text-yellow-400 text-[9.5px] font-black uppercase tracking-wide">
                      Pendente
                    </span>
                  </button>
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="space-y-5">
            <button
              onClick={() => setSelecionada(null)}
              className="text-xs font-bold text-neutral-400 hover:text-white"
            >
              ← Escolher outra faixa
            </button>

            <div className="rounded-2xl bg-neutral-900 border border-white/10 p-4">
              <p className="text-[10px] font-black uppercase tracking-wide text-emerald-400 mb-1">
                Faixa selecionada
              </p>
              <p className="text-base font-bold">{selecionada.titulo}</p>
              <p className="text-xs text-neutral-500">{selecionada.album}</p>
            </div>

            {/* Mesmas opções que "Nova Música" permite — pedido explícito pra
                paridade entre os dois fluxos de lançamento. */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-neutral-400">
                  Tipo de Single
                </label>
                <select
                  value={tipoSingle}
                  onChange={(e) => setTipoSingle(e.target.value)}
                  className="w-full px-3 py-2.5 bg-neutral-900 border border-white/10 rounded-xl text-xs text-white focus:outline-none focus:border-emerald-500"
                >
                  {TIPOS_SINGLE_FAIXA.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-neutral-400">
                  Tipo de Música
                </label>
                <select
                  value={tipoMusica}
                  onChange={(e) => setTipoMusica(e.target.value)}
                  className="w-full px-3 py-2.5 bg-neutral-900 border border-white/10 rounded-xl text-xs text-white focus:outline-none focus:border-emerald-500"
                >
                  {TIPOS_MUSICA_FAIXA.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {tipoMusica !== "SOLO" && (
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-neutral-400">
                  Participantes (feat)
                </label>
                {participantes.map((part, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={part}
                      onChange={(e) => {
                        const next = [...participantes];
                        next[idx] = e.target.value;
                        setParticipantes(next);
                      }}
                      placeholder="Nome do artista"
                      className="flex-1 px-3 py-2.5 bg-neutral-900 border border-white/10 rounded-xl text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-emerald-500"
                    />
                    {participantes.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setParticipantes(participantes.filter((_, i) => i !== idx))}
                        className="size-8 shrink-0 rounded-lg bg-neutral-900 border border-white/10 text-neutral-400 hover:text-red-400 grid place-items-center"
                      >
                        <Minus className="size-3.5" />
                      </button>
                    )}
                  </div>
                ))}
                {participantes.length < 5 && (
                  <button
                    type="button"
                    onClick={() => setParticipantes([...participantes, ""])}
                    className="inline-flex items-center gap-1.5 text-[11px] font-bold text-emerald-400 hover:text-emerald-300"
                  >
                    <Plus className="size-3.5" /> Adicionar participante
                  </button>
                )}
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wider text-neutral-400">Capa</label>
              <div className="flex items-center gap-3 bg-neutral-900 p-3 rounded-2xl border border-white/10">
                {capaPreview ? (
                  <img
                    src={capaFile ? capaPreview : driveImg(capaPreview, 100)}
                    alt="Capa"
                    className="size-14 object-cover rounded-lg border border-white/10"
                  />
                ) : (
                  <div className="size-14 rounded-lg bg-neutral-800 border border-white/10 grid place-items-center text-neutral-500">
                    <ImageIcon className="size-5" />
                  </div>
                )}
                <label className="cursor-pointer px-3.5 py-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-white font-bold text-[11px] uppercase tracking-wide border border-white/10 transition inline-flex items-center gap-1.5">
                  <Upload className="size-3.5 text-emerald-400" />
                  <span>{capaPreview ? "Trocar" : "Selecionar"}</span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => e.target.files?.[0] && handleCapaSelect(e.target.files[0])}
                    className="hidden"
                  />
                </label>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wider text-neutral-400">Áudio</label>
              <input
                type="text"
                value={audioUrlInput}
                onChange={(e) => setAudioUrlInput(e.target.value)}
                placeholder="Link do Drive ou YouTube"
                className="w-full px-4 py-2.5 bg-neutral-900 border border-white/10 rounded-xl text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-emerald-500"
              />
              <label className="cursor-pointer inline-flex items-center gap-1.5 text-[11px] font-bold text-neutral-400 hover:text-white">
                <Upload className="size-3.5 text-emerald-400" />
                <span>{audioFile ? audioFile.name : "ou envie um arquivo"}</span>
                <input
                  type="file"
                  accept="audio/*"
                  onChange={(e) => e.target.files?.[0] && setAudioFile(e.target.files[0])}
                  className="hidden"
                />
              </label>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wider text-neutral-400">Letra</label>
              <textarea
                value={letra}
                onChange={(e) => setLetra(e.target.value)}
                rows={6}
                placeholder="Cole ou digite a letra completa..."
                className="w-full px-4 py-3 bg-neutral-900 border border-white/10 rounded-2xl text-sm text-white placeholder-neutral-500 focus:outline-none focus:border-emerald-500 resize-y"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wider text-neutral-400 flex items-center gap-1.5">
                <Sparkles className="size-3.5 text-emerald-400" />
                Botões do Tópico (Opcional)
              </label>
              <ExtraMaterialEditor value={extraEdit} onChange={setExtraEdit} folderType="materiaisMusica" />
            </div>

            <button
              onClick={handlePublicar}
              disabled={publicando}
              className="w-full h-12 rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-black font-black uppercase text-sm tracking-wide disabled:opacity-50 flex items-center justify-center gap-2 transition"
            >
              {publicando ? <Loader2 className="size-4 animate-spin" /> : <Rocket className="size-4" />}
              Lançar faixa
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
