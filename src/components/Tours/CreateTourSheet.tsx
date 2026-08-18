import { useEffect, useMemo, useState } from "react";
import { X, Loader2, ImagePlus, Sparkles, Check } from "lucide-react";
import { fmtMoney } from "@/lib/api";
import { haptic } from "@/lib/telegram";

interface LocalTurne {
  continente: string;
  cidade: string;
  local: string;
  categoria: string;
  capacidade: number;
  precoIngresso: number;
  repasseIngresso: number;
  lucroMaximo: number;
}

export function CreateTourSheet({
  telegramId,
  artistas,
  onClose,
  onCreated,
}: {
  telegramId: string;
  artistas: string[];
  onClose: () => void;
  onCreated: (idUnico: string) => void;
}) {
  const [artista, setArtista] = useState(artistas[0] || "");
  const [nomeTurne, setNomeTurne] = useState("");
  const [locais, setLocais] = useState<LocalTurne[]>([]);
  const [loadingLocais, setLoadingLocais] = useState(true);
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [intervaloDias, setIntervaloDias] = useState(3);
  const [dataInicio, setDataInicio] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  });
  const [capaUrl, setCapaUrl] = useState("");
  const [uploadingCapa, setUploadingCapa] = useState(false);
  const [sim, setSim] = useState<{ lucroMinimo: number; lucroMaximo: number } | null>(null);
  const [metaLucro, setMetaLucro] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [erro, setErro] = useState("");

  useEffect(() => {
    fetch("/api/turnes/locais")
      .then((r) => r.json())
      .then((res) => {
        if (res?.success) setLocais(res.data || []);
      })
      .finally(() => setLoadingLocais(false));
  }, []);

  const porContinente = useMemo(() => {
    const map = new Map<string, LocalTurne[]>();
    for (const l of locais) {
      const key = l.continente || "Outros";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(l);
    }
    return map;
  }, [locais]);

  useEffect(() => {
    const nomes = Array.from(selecionados);
    if (nomes.length === 0) {
      setSim(null);
      return;
    }
    const t = setTimeout(() => {
      fetch("/api/turnes/simular", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locais: nomes }),
      })
        .then((r) => r.json())
        .then((res) => {
          if (res?.success) {
            setSim(res.data);
            setMetaLucro((prev) => {
              const clamped = Math.min(Math.max(prev, res.data.lucroMinimo), res.data.lucroMaximo);
              return clamped || res.data.lucroMinimo;
            });
          }
        });
    }, 300);
    return () => clearTimeout(t);
  }, [selecionados]);

  function toggleLocal(nome: string) {
    haptic.selection();
    setSelecionados((prev) => {
      const next = new Set(prev);
      if (next.has(nome)) next.delete(nome);
      else next.add(nome);
      return next;
    });
  }

  async function handleUploadCapa(file: File) {
    setUploadingCapa(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("fileName", file.name);
      formData.append("folderType", "turnes");
      const res = await fetch("/api/gestao/upload", { method: "POST", body: formData });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.success && data?.data?.fileUrl) setCapaUrl(data.data.fileUrl);
      else setErro("Não deu pra enviar a capa. Tente de novo.");
    } catch {
      setErro("Não deu pra enviar a capa. Tente de novo.");
    } finally {
      setUploadingCapa(false);
    }
  }

  async function handleSubmit() {
    if (!artista) return setErro("Escolha o artista.");
    if (!nomeTurne.trim()) return setErro("Dê um nome pra turnê.");
    if (selecionados.size === 0) return setErro("Escolha pelo menos um local.");
    setErro("");
    setSubmitting(true);
    try {
      const [ano, mes, dia] = dataInicio.split("-");
      const res = await fetch("/api/turnes/criar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          telegramId,
          artista,
          nomeTurne: nomeTurne.trim(),
          capaUrl,
          metaLucro,
          dataInicio: `${dia}/${mes}/${ano}`,
          intervaloDias,
          locais: Array.from(selecionados),
        }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.success) {
        haptic.selection();
        onCreated(data.data.idUnico);
      } else {
        setErro(data?.error || "Não deu pra criar a turnê.");
      }
    } catch {
      setErro("Não deu pra criar a turnê.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[150] bg-neutral-950/98 backdrop-blur-3xl flex flex-col animate-in slide-in-from-bottom overflow-hidden">
      <div className="p-4 sm:p-6 border-b border-white/10 flex items-center justify-between bg-neutral-900/90 shrink-0">
        <div>
          <span className="text-[10px] font-mono font-black uppercase text-primary/80 block">
            Nova Turnê
          </span>
          <h2 className="text-lg sm:text-xl font-black text-white">Planeje sua turnê</h2>
        </div>
        <button
          onClick={onClose}
          className="p-2.5 rounded-full bg-neutral-800 hover:bg-neutral-700 text-neutral-400 hover:text-white transition"
        >
          <X className="size-5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6 pb-32">
        {artistas.length > 1 && (
          <section>
            <label className="text-[11px] font-black uppercase text-neutral-400 mb-2 block">Artista</label>
            <select
              value={artista}
              onChange={(e) => setArtista(e.target.value)}
              className="w-full bg-neutral-900 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white"
            >
              {artistas.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </section>
        )}

        <section>
          <label className="text-[11px] font-black uppercase text-neutral-400 mb-2 block">
            Nome da turnê
          </label>
          <input
            type="text"
            value={nomeTurne}
            onChange={(e) => setNomeTurne(e.target.value)}
            placeholder="Ex: World Domination Tour"
            className="w-full bg-neutral-900 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-neutral-600"
          />
        </section>

        <section>
          <label className="text-[11px] font-black uppercase text-neutral-400 mb-2 block">
            Capa da turnê
          </label>
          <div className="flex items-center gap-3">
            <div className="size-16 rounded-xl bg-neutral-900 border border-white/10 overflow-hidden shrink-0 grid place-items-center">
              {capaUrl ? (
                <img src={capaUrl} alt="Capa" className="size-full object-cover" />
              ) : (
                <ImagePlus className="size-6 text-neutral-600" />
              )}
            </div>
            <label className="px-4 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-white text-xs font-black uppercase cursor-pointer transition">
              {uploadingCapa ? "Enviando..." : "Escolher imagem"}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                disabled={uploadingCapa}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleUploadCapa(f);
                }}
              />
            </label>
          </div>
        </section>

        <section className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[11px] font-black uppercase text-neutral-400 mb-2 block">
              Data de início
            </label>
            <input
              type="date"
              value={dataInicio}
              onChange={(e) => setDataInicio(e.target.value)}
              className="w-full bg-neutral-900 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white"
            />
          </div>
          <div>
            <label className="text-[11px] font-black uppercase text-neutral-400 mb-2 block">
              Dias entre shows
            </label>
            <input
              type="number"
              min={1}
              max={14}
              value={intervaloDias}
              onChange={(e) => setIntervaloDias(Math.max(1, Number(e.target.value) || 1))}
              className="w-full bg-neutral-900 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white"
            />
          </div>
        </section>

        <section>
          <label className="text-[11px] font-black uppercase text-neutral-400 mb-2 block">
            Locais ({selecionados.size} selecionados)
          </label>
          {loadingLocais ? (
            <div className="flex justify-center py-10 opacity-50">
              <Loader2 className="size-6 animate-spin" />
            </div>
          ) : (
            <div className="space-y-4">
              {Array.from(porContinente.entries()).map(([continente, lista]) => (
                <div key={continente}>
                  <p className="text-[10px] font-black uppercase text-neutral-500 mb-1.5">{continente}</p>
                  <div className="space-y-1.5">
                    {lista.map((l) => {
                      const checked = selecionados.has(l.local);
                      return (
                        <button
                          key={l.local}
                          type="button"
                          onClick={() => toggleLocal(l.local)}
                          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border text-left transition ${
                            checked
                              ? "bg-primary/10 border-primary/40"
                              : "bg-neutral-900/60 border-white/5 hover:border-white/15"
                          }`}
                        >
                          <div
                            className={`size-5 rounded-md border shrink-0 grid place-items-center ${
                              checked ? "bg-primary border-primary" : "border-white/20"
                            }`}
                          >
                            {checked && <Check className="size-3.5 text-black" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-bold text-white truncate">{l.local}</p>
                            <p className="text-[10px] text-neutral-400">
                              {l.cidade} · {l.categoria} · {l.capacidade.toLocaleString("pt-BR")} lugares
                            </p>
                          </div>
                          <p className="text-[11px] font-black text-emerald-400 shrink-0">
                            até {fmtMoney(l.capacidade * l.repasseIngresso)}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {sim && (
          <section className="rounded-2xl bg-white/5 border border-white/10 p-4">
            <div className="flex items-center gap-2 mb-3">
              <Sparkles className="size-4 text-primary" />
              <p className="text-[11px] font-black uppercase text-neutral-300">Simulação de lucro</p>
            </div>
            <div className="flex justify-between text-xs text-neutral-400 mb-1">
              <span>Mínimo (sem ações)</span>
              <span>Máximo (sold out total)</span>
            </div>
            <div className="flex justify-between font-black text-white mb-3">
              <span>{fmtMoney(sim.lucroMinimo)}</span>
              <span>{fmtMoney(sim.lucroMaximo)}</span>
            </div>
            <label className="text-[11px] font-black uppercase text-neutral-400 mb-2 block">
              Sua meta de lucro: <span className="text-primary">{fmtMoney(metaLucro)}</span>
            </label>
            <input
              type="range"
              min={sim.lucroMinimo}
              max={sim.lucroMaximo}
              value={metaLucro}
              onChange={(e) => setMetaLucro(Number(e.target.value))}
              className="w-full accent-primary"
            />
          </section>
        )}

        {erro && <p className="text-xs text-red-400 font-bold">{erro}</p>}
      </div>

      <div className="p-4 sm:p-6 border-t border-white/10 bg-neutral-900/90 shrink-0">
        <button
          onClick={handleSubmit}
          disabled={submitting}
          className="w-full py-3.5 rounded-2xl bg-primary hover:bg-primary/90 text-primary-foreground font-black text-sm uppercase tracking-wider transition disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
          Criar turnê
        </button>
      </div>
    </div>
  );
}
