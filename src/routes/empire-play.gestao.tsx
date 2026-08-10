import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Upload, Loader2, Send } from "lucide-react";
import { Gestao } from "@/components/EmpirePlay/Gestao";
import { useTelegramUser } from "@/lib/telegram";

export const Route = createFileRoute("/empire-play/gestao")({
  component: EmpirePlayGestao,
});

function EmpirePlayGestao() {
  const { user } = useTelegramUser();

  // Estado do formulário de Upload de Vídeo
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadTitulo, setUploadTitulo] = useState("");
  const [uploadArtista, setUploadArtista] = useState("");
  const [uploadTipo, setUploadTipo] = useState("Music Video");
  const [uploadDescricao, setUploadDescricao] = useState("");
  const [uploadReferente, setUploadReferente] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<{ type: "success" | "error"; text: string } | null>(
    null,
  );

  // Handler do Upload de Vídeo: envia o arquivo para o Google Drive
  // (/api/gestao/upload) e registra o link retornado no catálogo
  // (/api/gestao/video ou /api/gestao/music-video).
  const handleVideoUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadFile) {
      setUploadMsg({ type: "error", text: "Selecione um arquivo de vídeo." });
      return;
    }
    if (!uploadTitulo.trim() || !uploadArtista.trim()) {
      setUploadMsg({ type: "error", text: "Título e Artista são obrigatórios." });
      return;
    }

    setUploading(true);
    setUploadMsg(null);

    try {
      const isMusicVideo = uploadTipo === "Music Video";

      const driveFormData = new FormData();
      driveFormData.append("file", uploadFile);
      driveFormData.append("fileName", uploadFile.name);
      driveFormData.append("folderType", isMusicVideo ? "musicVideo" : "video");

      const uploadRes = await fetch("/api/gestao/upload", {
        method: "POST",
        body: driveFormData,
      });
      const uploadJson = await uploadRes.json();

      if (!uploadRes.ok || !uploadJson.success || !uploadJson.data?.fileUrl) {
        setUploadMsg({
          type: "error",
          text: uploadJson.error || "Erro ao enviar o arquivo para o Google Drive.",
        });
        return;
      }

      const mediaUrl = uploadJson.data.fileUrl as string;

      const registerRes = await fetch(
        isMusicVideo ? "/api/gestao/music-video" : "/api/gestao/video",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            isMusicVideo
              ? {
                  tituloMusicVideo: uploadTitulo.trim(),
                  artistaResponsavel: uploadArtista.trim(),
                  musicaVinculada: uploadReferente.trim(),
                  mediaUrl,
                  capaUrl: "",
                  nomeJogador: user?.name || user?.username || "Jogador",
                }
              : {
                  tituloVideo: uploadTitulo.trim(),
                  artistaResponsavel: uploadArtista.trim(),
                  categoriaVideo: uploadTipo,
                  mediaUrl,
                  capaUrl: "",
                  nomeJogador: user?.name || user?.username || "Jogador",
                },
          ),
        },
      );
      const registerJson = await registerRes.json();

      if (registerRes.ok && registerJson.success) {
        setUploadMsg({
          type: "success",
          text: "Vídeo enviado para o Google Drive e registrado no catálogo!",
        });
        setUploadFile(null);
        setUploadTitulo("");
        setUploadArtista("");
        setUploadDescricao("");
        setUploadReferente("");
      } else {
        setUploadMsg({
          type: "error",
          text: registerJson.error || "Erro ao registrar o vídeo no catálogo.",
        });
      }
    } catch (err: any) {
      setUploadMsg({
        type: "error",
        text: "Erro de conexão ao servidor: " + err.message,
      });
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-8">
      <Gestao />

      {/* Upload Direto de Vídeos via Telegram Storage */}
      <div className="bg-neutral-900 border border-white/10 rounded-3xl p-6 shadow-2xl">
        <div className="flex items-center gap-3 border-b border-white/10 pb-4 mb-6">
          <div className="size-10 rounded-2xl bg-emerald-500/20 text-emerald-400 grid place-items-center">
            <Upload className="size-5" />
          </div>
          <div>
            <h3 className="text-base font-black text-white uppercase tracking-tight">
              Upload de Mídia de Vídeo (Google Drive)
            </h3>
            <p className="text-xs text-neutral-400">
              Envie clipes e vídeos diretamente para o Google Drive da comunidade.
            </p>
          </div>
        </div>

        {uploadMsg && (
          <div
            className={`p-4 rounded-2xl text-xs font-bold mb-6 border ${
              uploadMsg.type === "success"
                ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                : "bg-red-500/10 border-red-500/30 text-red-400"
            }`}
          >
            {uploadMsg.text}
          </div>
        )}

        <form onSubmit={handleVideoUpload} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] font-black uppercase text-neutral-400 mb-1 block">
                Título do Vídeo *
              </label>
              <input
                value={uploadTitulo}
                onChange={(e) => setUploadTitulo(e.target.value)}
                placeholder="Ex: Anti-Hero (Official Video)"
                className="w-full bg-neutral-950 border border-white/10 rounded-xl px-4 py-3 text-xs text-white outline-none focus:border-emerald-500/50"
              />
            </div>

            <div>
              <label className="text-[10px] font-black uppercase text-neutral-400 mb-1 block">
                Artista *
              </label>
              <input
                value={uploadArtista}
                onChange={(e) => setUploadArtista(e.target.value)}
                placeholder="Ex: Taylor Swift"
                className="w-full bg-neutral-950 border border-white/10 rounded-xl px-4 py-3 text-xs text-white outline-none focus:border-emerald-500/50"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] font-black uppercase text-neutral-400 mb-1 block">
                Tipo de Vídeo
              </label>
              <select
                value={uploadTipo}
                onChange={(e) => setUploadTipo(e.target.value)}
                className="w-full bg-neutral-950 border border-white/10 rounded-xl px-4 py-3 text-xs text-white outline-none focus:border-emerald-500/50"
              >
                <option value="Music Video">Music Video</option>
                <option value="Live">Live</option>
                <option value="Video">Video</option>
                <option value="Dance Video">Dance Video</option>
                <option value="Lyric Video">Lyric Video</option>
                <option value="Visualizer">Visualizer</option>
                <option value="Behind the Scenes">Behind the Scenes</option>
                <option value="Performance">Performance</option>
                <option value="Alternative Video">Alternative Video</option>
                <option value="Alternative Version">Alternative Version</option>
                <option value="Trailer">Trailer</option>
                <option value="Outro">Outro</option>
              </select>
            </div>

            <div>
              <label className="text-[10px] font-black uppercase text-neutral-400 mb-1 block">
                Referente à Música (Opcional)
              </label>
              <input
                value={uploadReferente}
                onChange={(e) => setUploadReferente(e.target.value)}
                placeholder="Ex: ID ou Nome da música"
                className="w-full bg-neutral-950 border border-white/10 rounded-xl px-4 py-3 text-xs text-white outline-none focus:border-emerald-500/50"
              />
            </div>
          </div>

          <div>
            <label className="text-[10px] font-black uppercase text-neutral-400 mb-1 block">
              Descrição
            </label>
            <textarea
              value={uploadDescricao}
              onChange={(e) => setUploadDescricao(e.target.value)}
              placeholder="Detalhes sobre o clipe..."
              rows={3}
              className="w-full bg-neutral-950 border border-white/10 rounded-xl p-4 text-xs text-white outline-none focus:border-emerald-500/50"
            />
          </div>

          <div>
            <label className="text-[10px] font-black uppercase text-neutral-400 mb-1 block">
              Arquivo de Vídeo *
            </label>
            <input
              type="file"
              accept="video/*"
              onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
              className="w-full bg-neutral-950 border border-white/10 rounded-xl p-3 text-xs text-neutral-300 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-black file:bg-emerald-500 file:text-black cursor-pointer"
            />
          </div>

          <button
            type="submit"
            disabled={uploading}
            className="w-full py-4 rounded-2xl bg-emerald-500 text-black font-black text-xs uppercase tracking-widest flex items-center justify-center gap-2 active:scale-95 transition-all shadow-lg shadow-emerald-500/20 disabled:opacity-50"
          >
            {uploading ? (
              <>
                <Loader2 className="size-4 animate-spin" /> Enviando Mídia para o Drive...
              </>
            ) : (
              <>
                <Send className="size-4" /> Publicar Mídia
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
