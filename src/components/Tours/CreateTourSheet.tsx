import { useEffect, useMemo, useState } from "react";
import { X, Loader2, ImagePlus, Sparkles, Check, Wand2, ListChecks, Music2, Building2, Landmark } from "lucide-react";
import { fmtMoney, driveImg } from "@/lib/api";
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

const CATEGORIA_STYLE: Record<string, { icon: React.ReactNode; classes: string }> = {
  Club: { icon: <Music2 className="size-4" />, classes: "bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/30" },
  Arena: { icon: <Building2 className="size-4" />, classes: "bg-sky-500/15 text-sky-300 border-sky-500/30" },
  Estádio: { icon: <Landmark className="size-4" />, classes: "bg-amber-500/15 text-amber-300 border-amber-500/30" },
};

function categoriaStyle(categoria: string) {
  return (
    CATEGORIA_STYLE[categoria] || {
      icon: <Building2 className="size-4" />,
      classes: "bg-white/10 text-neutral-300 border-white/20",
    }
  );
}

// Gera automaticamente `qtd` locais tentando aproximar a soma do lucro
// máximo de cada um ao "valorAlvo" total informado — greedy por show, sempre
// pegando o local ainda não escolhido mais próximo da média alvo restante.
function gerarLocaisAutomaticos(todos: LocalTurne[], qtd: number, valorAlvo: number): string[] {
  if (qtd <= 0 || todos.length === 0) return [];
  const disponiveis = [...todos];
  const escolhidos: LocalTurne[] = [];
  let restanteAlvo = valorAlvo;
  for (let i = 0; i < qtd && disponiveis.length > 0; i++) {
    const showsRestantes = qtd - i;
    const mediaAlvo = restanteAlvo / showsRestantes;
    disponiveis.sort((a, b) => Math.abs(a.lucroMaximo - mediaAlvo) - Math.abs(b.lucroMaximo - mediaAlvo));
    const pick = disponiveis.shift()!;
    escolhidos.push(pick);
    restanteAlvo -= pick.lucroMaximo;
  }
  return escolhidos.map((l) => l.local);
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
  // Duas formas de espaçar os shows: por intervalo fixo entre eles (como já
  // era) ou escolhendo direto a data de término, com os shows distribuídos
  // em espaçamento igual dentro desse período.
  const [modoData, setModoData] = useState<"intervalo" | "periodo">("intervalo");
  const [dataTermino, setDataTermino] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 15);
    return d.toISOString().slice(0, 10);
  });
  const [capaUrl, setCapaUrl] = useState("");
  const [uploadingCapa, setUploadingCapa] = useState(false);
  const [sim, setSim] = useState<{ lucroMinimo: number; lucroMaximo: number } | null>(null);
  const [metaLucro, setMetaLucro] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [erro, setErro] = useState("");

  const [modo, setModo] = useState<"manual" | "auto">("manual");
  const [continenteAtivo, setContinenteAtivo] = useState<string | null>(null);
  const [autoQtd, setAutoQtd] = useState(6);
  const [autoValorAlvo, setAutoValorAlvo] = useState(5000000);

  useEffect(() => {
    fetch("/api/turnes/locais")
      .then((r) => r.json())
      .then((res) => {
        if (res?.success) {
          setLocais(res.data || []);
          const primeiroContinente = res.data?.[0]?.continente;
          if (primeiroContinente) setContinenteAtivo(primeiroContinente);
        }
      })
      .finally(() => setLoadingLocais(false));
  }, []);

  const continentes = useMemo(() => {
    const set = new Set<string>();
    for (const l of locais) set.add(l.continente || "Outros");
    return Array.from(set);
  }, [locais]);

  const locaisDoContinente = useMemo(
    () => locais.filter((l) => (l.continente || "Outros") === continenteAtivo),
    [locais, continenteAtivo],
  );

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

  function handleGerarAutomatico() {
    if (locais.length === 0) return;
    haptic.selection();
    const nomes = gerarLocaisAutomaticos(locais, autoQtd, autoValorAlvo);
    setSelecionados(new Set(nomes));
    setModo("manual");
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
      const [anoF, mesF, diaF] = dataTermino.split("-");
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
          ...(modoData === "periodo"
            ? { dataTermino: `${diaF}/${mesF}/${anoF}` }
            : { intervaloDias }),
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

      <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6 pb-4">
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
                <img src={driveImg(capaUrl, 200)} alt="Capa" className="size-full object-cover" />
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

        <section>
          <div className="flex items-center gap-2 p-1 rounded-2xl bg-neutral-900 border border-white/10 mb-3">
            <button
              onClick={() => setModoData("intervalo")}
              className={`flex-1 py-2 rounded-xl text-[11px] font-black uppercase transition ${
                modoData === "intervalo" ? "bg-primary text-primary-foreground" : "text-neutral-400"
              }`}
            >
              Por espaçamento
            </button>
            <button
              onClick={() => setModoData("periodo")}
              className={`flex-1 py-2 rounded-xl text-[11px] font-black uppercase transition ${
                modoData === "periodo" ? "bg-primary text-primary-foreground" : "text-neutral-400"
              }`}
            >
              Por data de término
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3">
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
            {modoData === "intervalo" ? (
              <div>
                <label className="text-[11px] font-black uppercase text-neutral-400 mb-2 block">
                  Espaçamento (dias)
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
            ) : (
              <div>
                <label className="text-[11px] font-black uppercase text-neutral-400 mb-2 block">
                  Data de término
                </label>
                <input
                  type="date"
                  min={dataInicio}
                  value={dataTermino}
                  onChange={(e) => setDataTermino(e.target.value)}
                  className="w-full bg-neutral-900 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white"
                />
              </div>
            )}
          </div>
          <p className="text-[10px] text-neutral-500 mt-1.5 leading-snug">
            {modoData === "intervalo"
              ? "Quantos dias de descanso entre um show e o próximo. Com 3, a agenda fica: dia 1, dia 4, dia 7..."
              : "Os shows são distribuídos em espaçamento igual entre a data de início e a de término escolhidas."}
          </p>
        </section>

        <section>
          <div className="flex items-center gap-2 p-1 rounded-2xl bg-neutral-900 border border-white/10 mb-4">
            <button
              onClick={() => setModo("manual")}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-[11px] font-black uppercase transition ${
                modo === "manual" ? "bg-primary text-primary-foreground" : "text-neutral-400"
              }`}
            >
              <ListChecks className="size-3.5" />
              Escolher locais
            </button>
            <button
              onClick={() => setModo("auto")}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-[11px] font-black uppercase transition ${
                modo === "auto" ? "bg-primary text-primary-foreground" : "text-neutral-400"
              }`}
            >
              <Wand2 className="size-3.5" />
              Gerar automático
            </button>
          </div>

          {modo === "auto" ? (
            <div className="rounded-2xl bg-white/5 border border-white/10 p-4 space-y-4">
              <p className="text-[11px] text-neutral-400 leading-snug">
                Diga quantos shows quer e um lucro máximo aproximado — o app escolhe os locais que mais
                se aproximam disso pra você. Dá pra ajustar manualmente depois.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-black uppercase text-neutral-400 mb-2 block">
                    Quantidade de shows
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={locais.length || 40}
                    value={autoQtd}
                    onChange={(e) => setAutoQtd(Math.max(1, Number(e.target.value) || 1))}
                    className="w-full bg-neutral-900 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-black uppercase text-neutral-400 mb-2 block">
                    Lucro máximo desejado
                  </label>
                  <input
                    type="number"
                    min={0}
                    step={100000}
                    value={autoValorAlvo}
                    onChange={(e) => setAutoValorAlvo(Math.max(0, Number(e.target.value) || 0))}
                    className="w-full bg-neutral-900 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white"
                  />
                </div>
              </div>
              <button
                onClick={handleGerarAutomatico}
                disabled={loadingLocais}
                className="w-full py-3 rounded-xl bg-primary text-primary-foreground font-black text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition disabled:opacity-50"
              >
                <Wand2 className="size-4" />
                Gerar {autoQtd} shows
              </button>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between mb-3">
                <span className="text-[11px] font-black uppercase text-neutral-400">
                  {selecionados.size} selecionados
                </span>
              </div>
              {loadingLocais ? (
                <div className="flex justify-center py-10 opacity-50">
                  <Loader2 className="size-6 animate-spin" />
                </div>
              ) : (
                <>
                  <div className="flex gap-2 overflow-x-auto pb-1 mb-3 -mx-1 px-1">
                    {continentes.map((c) => (
                      <button
                        key={c}
                        onClick={() => setContinenteAtivo(c)}
                        className={`shrink-0 px-3.5 py-2 rounded-full text-[11px] font-black uppercase whitespace-nowrap transition border ${
                          continenteAtivo === c
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-white/5 text-neutral-400 border-white/10"
                        }`}
                      >
                        {c}
                      </button>
                    ))}
                  </div>

                  <div className="grid grid-cols-2 gap-2.5">
                    {locaisDoContinente.map((l) => {
                      const checked = selecionados.has(l.local);
                      const style = categoriaStyle(l.categoria);
                      return (
                        <button
                          key={l.local}
                          type="button"
                          onClick={() => toggleLocal(l.local)}
                          className={`relative text-left rounded-2xl border p-3.5 transition overflow-hidden ${
                            checked
                              ? "bg-primary/10 border-primary shadow-[0_0_0_1px_rgba(var(--primary),0.4)]"
                              : "bg-neutral-900/60 border-white/5 hover:border-white/20"
                          }`}
                        >
                          {checked && (
                            <div className="absolute top-2.5 right-2.5 size-5 rounded-full bg-primary grid place-items-center">
                              <Check className="size-3.5 text-black" />
                            </div>
                          )}
                          <div
                            className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-[10px] font-black uppercase mb-2 ${style.classes}`}
                          >
                            {style.icon}
                            {l.categoria}
                          </div>
                          <p className="text-xs font-bold text-white leading-tight mb-0.5 pr-6">{l.local}</p>
                          <p className="text-[10px] text-neutral-500 mb-2">{l.cidade}</p>
                          <div className="flex items-center justify-between text-[10px]">
                            <span className="text-neutral-400">
                              {l.capacidade.toLocaleString("pt-BR")} lugares
                            </span>
                            <span className="font-black text-emerald-400">
                              {fmtMoney(l.capacidade * l.repasseIngresso)}
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </>
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

      <div className="p-4 sm:p-6 border-t border-white/10 bg-neutral-900/95 shrink-0 space-y-2">
        {sim && (
          <div className="flex items-center justify-between text-[11px] font-black uppercase text-neutral-400 px-1">
            <span>
              {selecionados.size} shows selecionados
            </span>
            <span className="text-emerald-400">até {fmtMoney(sim.lucroMaximo)}</span>
          </div>
        )}
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
