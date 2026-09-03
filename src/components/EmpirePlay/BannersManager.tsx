import { useEffect, useState } from "react";
import { Image as ImageIcon, Link2, Trash2, Loader2, GripVertical } from "lucide-react";
import { driveImg } from "@/lib/api";

interface BannerRow {
  id: string;
  imagem_url: string;
  link_destino?: string;
  legenda?: string;
  ordem: number;
}

async function uploadBannerImage(file: File): Promise<string> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("fileName", `BANNER_${Date.now()}_${file.name}`);
  formData.append("folderType", "socialPosts");

  const res = await fetch("/api/gestao/upload", { method: "POST", body: formData });
  const data = await res.json().catch(() => null);
  if (res.ok && data?.success && data?.data?.fileUrl) return data.data.fileUrl;
  throw new Error("Falha ao enviar a imagem do banner.");
}

// Cadastro dos banners promocionais que rodam no carrossel do topo do
// Catálogo (ver BannerCarousel.tsx). Sem imagem não existe banner — por
// isso o upload é obrigatório antes de conseguir salvar.
export function BannersManager({ tgId }: { tgId: string }) {
  const [banners, setBanners] = useState<BannerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [link, setLink] = useState("");
  const [legenda, setLegenda] = useState("");
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const carregar = () => {
    setLoading(true);
    fetch("/api/social/banners")
      .then((res) => res.json())
      .then((data) => setBanners(Array.isArray(data) ? data : []))
      .catch(() => setBanners([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    carregar();
  }, []);

  const handleSalvar = async () => {
    if (!imageFile) {
      setErrorMsg("Escolha uma imagem para o banner.");
      return;
    }
    setSaving(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const imagem_url = await uploadBannerImage(imageFile);
      const res = await fetch("/api/social/banners", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imagem_url,
          link_destino: link.trim() || undefined,
          legenda: legenda.trim() || undefined,
          ordem: banners.length,
          tgId,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Erro ao salvar banner.");

      setSuccessMsg("Banner publicado!");
      setImageFile(null);
      setImagePreview(null);
      setLink("");
      setLegenda("");
      carregar();
    } catch (err: any) {
      setErrorMsg(err.message || "Erro inesperado ao salvar o banner.");
    } finally {
      setSaving(false);
    }
  };

  const handleApagar = async (id: string) => {
    await fetch("/api/social/banners/deletar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    setBanners((prev) => prev.filter((b) => b.id !== id));
  };

  return (
    <div className="space-y-6 text-white max-w-5xl mx-auto">
      {successMsg && (
        <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-bold">
          {successMsg}
        </div>
      )}
      {errorMsg && (
        <div className="p-4 rounded-2xl bg-red-500/10 border border-red-500/30 text-red-400 text-xs font-bold">
          {errorMsg}
        </div>
      )}

      <div className="bg-white/[0.04] border border-white/10 rounded-3xl p-6 sm:p-8 space-y-6 backdrop-blur-2xl shadow-2xl shadow-black/40">
        <div className="space-y-2">
          <label className="text-xs font-bold uppercase tracking-wider text-neutral-300 flex items-center gap-2">
            <ImageIcon className="size-4 text-emerald-400" />
            Imagem do banner
          </label>
          <label className="block border-2 border-dashed border-white/15 rounded-2xl p-5 text-center cursor-pointer hover:border-white/25 transition">
            {imagePreview ? (
              <img src={imagePreview} alt="" className="w-full aspect-[16/6] object-cover rounded-xl" />
            ) : (
              <>
                <p className="text-sm font-bold text-neutral-300">Toque para enviar a imagem</p>
                <p className="text-[11px] text-neutral-500 mt-1">Recomendado 1200×450px (proporção 16:6)</p>
              </>
            )}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                setImageFile(file);
                setImagePreview(URL.createObjectURL(file));
              }}
            />
          </label>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-bold uppercase tracking-wider text-neutral-300 flex items-center gap-2">
            <Link2 className="size-4 text-emerald-400" />
            Link de destino (opcional)
          </label>
          <input
            type="text"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="/empire-play/musicas/... ou https://..."
            className="w-full bg-black/25 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-neutral-500 focus:border-emerald-500 focus:outline-none backdrop-blur-sm"
          />
        </div>

        <div className="space-y-2">
          <label className="text-xs font-bold uppercase tracking-wider text-neutral-300">
            Legenda curta (opcional)
          </label>
          <input
            type="text"
            value={legenda}
            onChange={(e) => setLegenda(e.target.value.slice(0, 60))}
            placeholder='Ex: Single "Luz Baixa" já disponível'
            className="w-full bg-black/25 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-neutral-500 focus:border-emerald-500 focus:outline-none backdrop-blur-sm"
          />
          <p className="text-[11px] text-neutral-500">Aparece como um pill discreto abaixo da imagem, não por cima.</p>
        </div>

        <button
          onClick={handleSalvar}
          disabled={saving}
          className="w-full py-3.5 rounded-2xl bg-emerald-500 text-black font-black text-xs uppercase tracking-wider disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {saving && <Loader2 className="size-4 animate-spin" />}
          Publicar Banner
        </button>
      </div>

      <div className="space-y-3">
        <p className="text-xs font-bold uppercase tracking-wider text-neutral-400">
          Banners ativos ({loading ? "…" : banners.length})
        </p>
        {banners.map((b) => (
          <div
            key={b.id}
            className="flex items-center gap-3 bg-white/[0.03] border border-white/10 rounded-2xl p-3 backdrop-blur-xl"
          >
            <GripVertical className="size-4 text-neutral-600 shrink-0" />
            <img src={driveImg(b.imagem_url, 200)} alt="" className="w-20 aspect-[16/6] object-cover rounded-lg shrink-0" />
            <div className="min-w-0 flex-1">
              {b.legenda && <p className="text-xs font-bold text-white truncate">{b.legenda}</p>}
              {b.link_destino && <p className="text-[10px] text-neutral-500 truncate">{b.link_destino}</p>}
            </div>
            <button
              onClick={() => handleApagar(b.id)}
              className="size-8 rounded-full bg-red-500/10 border border-red-500/20 text-red-400 grid place-items-center shrink-0"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        ))}
        {!loading && banners.length === 0 && (
          <p className="text-xs text-neutral-500">Nenhum banner ativo ainda.</p>
        )}
      </div>
    </div>
  );
}
