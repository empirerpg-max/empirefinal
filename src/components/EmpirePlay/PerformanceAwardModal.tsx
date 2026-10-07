import { useEffect, useState } from "react";
import { X, Loader2, Mic2, Upload, Send, Check } from "lucide-react";
import { toast } from "sonner";
import { haptic } from "@/lib/telegram";
import { api } from "@/lib/api";

interface Pendencia {
  awardId: string;
  premiacao: string;
  linha: number;
  artista: string;
}

interface PerformanceAwardModalProps {
  telegramId: string;
  onClose: () => void;
  onSubmitted: () => void;
}

// "Performance Award" (Gestão > Catálogo) — só aparece pros jogadores que
// têm pelo menos uma inscrição pendente (artista marcou "Sim" em Perfil >
// Premiações > Votação, mas ainda não entregou o link/arquivo). Entrega o
// link direto na coluna C da linha certa em Performances (ver
// performanceController.ts) — texto colado ou upload, nunca os dois.
export function PerformanceAwardModal({ telegramId, onClose, onSubmitted }: PerformanceAwardModalProps) {
  const [pendencias, setPendencias] = useState<Pendencia[] | null>(null);
  const [selecionada, setSelecionada] = useState<Pendencia | null>(null);
  const [linkTexto, setLinkTexto] = useState("");
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    api.listarPendenciasPerformance(telegramId).then((data) => {
      setPendencias(data);
      if (data.length === 1) setSelecionada(data[0]);
    });
  }, [telegramId]);

  const enviar = async () => {
    if (!selecionada || enviando) return;
    if (!linkTexto.trim() && !arquivo) {
      toast.error("Cole um link ou envie um arquivo.");
      return;
    }
    setEnviando(true);
    try {
      let link = linkTexto.trim();
      if (arquivo) {
        const formData = new FormData();
        formData.append("file", arquivo);
        formData.append("fileName", `PERFORMANCE_${selecionada.artista}_${Date.now()}_${arquivo.name}`);
        formData.append("folderType", "performanceAward");
        const uploadRes = await fetch("/api/gestao/upload", { method: "POST", body: formData }).then((r) => r.json());
        if (!uploadRes?.success || !uploadRes?.data?.fileUrl) throw new Error("Falha ao enviar o arquivo.");
        link = uploadRes.data.fileUrl;
      }

      const res = await api.enviarPerformance({ awardId: selecionada.awardId, artista: selecionada.artista, telegramId, link });
      if (res.success) {
        haptic.success();
        toast.success("Performance enviada!");
        onSubmitted();
        onClose();
      } else {
        toast.error(res.error || "Não foi possível enviar.");
      }
    } catch (err: any) {
      toast.error(err?.message || "Erro de conexão.");
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md bg-neutral-900 rounded-t-3xl sm:rounded-3xl p-6 border border-white/10 max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <div className="size-10 rounded-xl bg-emerald-500/15 text-emerald-400 grid place-items-center">
              <Mic2 className="size-5" />
            </div>
            <h3 className="text-base font-black uppercase tracking-tight text-white">Performance Award</h3>
          </div>
          <button onClick={onClose} className="size-8 rounded-full bg-white/5 border border-white/10 grid place-items-center text-neutral-400">
            <X className="size-4" />
          </button>
        </div>

        {pendencias === null ? (
          <div className="flex justify-center py-10">
            <Loader2 className="size-6 animate-spin text-emerald-400" />
          </div>
        ) : pendencias.length === 0 ? (
          <p className="text-sm text-neutral-400 text-center py-6">Nenhuma performance pendente de envio no momento.</p>
        ) : !selecionada ? (
          <div className="space-y-2">
            <p className="text-xs text-neutral-400 mb-2">Qual artista?</p>
            {pendencias.map((p) => (
              <button
                key={`${p.awardId}-${p.linha}`}
                onClick={() => {
                  haptic.selection();
                  setSelecionada(p);
                }}
                className="w-full flex items-center justify-between gap-2 p-3.5 rounded-2xl bg-white/[0.03] border border-white/10 hover:bg-white/[0.06] transition text-left"
              >
                <span className="text-sm font-bold text-white">{p.artista}</span>
                <span className="text-[10px] text-neutral-500 font-bold">{p.premiacao}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-2 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/25">
              <Check className="size-4 text-emerald-400 shrink-0" />
              <span className="text-sm font-bold text-white">{selecionada.artista}</span>
              <span className="text-[10px] text-neutral-500 font-bold ml-auto">{selecionada.premiacao}</span>
            </div>

            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-neutral-500 mb-1.5">
                Link da performance
              </label>
              <input
                type="text"
                value={linkTexto}
                onChange={(e) => {
                  setLinkTexto(e.target.value);
                  if (e.target.value) setArquivo(null);
                }}
                placeholder="https://..."
                disabled={!!arquivo}
                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-2xl text-sm text-white outline-none focus:border-emerald-500/50 transition disabled:opacity-40"
              />
            </div>

            <div className="flex items-center gap-2">
              <div className="flex-1 h-px bg-white/10" />
              <span className="text-[10px] font-bold text-neutral-500 uppercase">ou</span>
              <div className="flex-1 h-px bg-white/10" />
            </div>

            <label className="flex items-center justify-center gap-2 py-3 rounded-2xl bg-white/5 border border-dashed border-white/15 text-xs font-bold text-neutral-300 cursor-pointer hover:border-white/25 transition">
              <Upload className="size-4" />
              {arquivo ? arquivo.name : "Fazer upload do arquivo"}
              <input
                type="file"
                accept="video/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0] || null;
                  setArquivo(file);
                  if (file) setLinkTexto("");
                }}
              />
            </label>

            <button
              onClick={enviar}
              disabled={enviando || (!linkTexto.trim() && !arquivo)}
              className="w-full py-3.5 rounded-full bg-emerald-500 text-black font-black text-xs uppercase tracking-wider disabled:opacity-40 flex items-center justify-center gap-1.5"
            >
              {enviando ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              Enviar
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
