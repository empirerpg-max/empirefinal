import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, Trophy, Loader2, Check } from "lucide-react";
import { useTelegramUser, haptic } from "@/lib/telegram";
import { api, type Artist } from "@/lib/api";
import { toast } from "sonner";

export const Route = createFileRoute("/premiacoes")({
  component: PremiacoesPage,
});

type Categoria = { ano: string; segmento: string; categoria: string; preenchido: boolean };

function PremiacoesPage() {
  const navigate = useNavigate();
  const { user } = useTelegramUser();

  const [awards, setAwards] = useState<string[]>([]);
  const [meusArtistas, setMeusArtistas] = useState<Artist[]>([]);
  const [award, setAward] = useState<string>("");
  const [categorias, setCategorias] = useState<Categoria[] | null>(null);
  const [ano, setAno] = useState<string>("");
  const [categoria, setCategoria] = useState<string>("");
  const [artista, setArtista] = useState<string>("");
  const [titulo, setTitulo] = useState<string>("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.listarPremiacoesAwards().then(setAwards);
  }, []);

  useEffect(() => {
    if (!user || user.id === "guest") return;
    api.meusArtistas(user.id).then(setMeusArtistas).catch(() => {});
  }, [user]);

  useEffect(() => {
    if (!award) {
      setCategorias(null);
      return;
    }
    setCategorias(null);
    setAno("");
    setCategoria("");
    api.listarPremiacoesCategorias(award).then(setCategorias);
  }, [award]);

  const anos = useMemo(() => {
    if (!categorias) return [];
    return Array.from(new Set(categorias.map((c) => c.ano))).sort((a, b) => b.localeCompare(a));
  }, [categorias]);

  const categoriasDoAno = useMemo(() => {
    if (!categorias || !ano) return [];
    return categorias.filter((c) => c.ano === ano);
  }, [categorias, ano]);

  const handleSubmit = async () => {
    if (!award || !ano || !categoria || !artista.trim() || !titulo.trim() || saving) return;
    const cat = categoriasDoAno.find((c) => c.categoria === categoria);
    if (!cat) return;
    setSaving(true);
    try {
      const res = await api.preencherPremiacao({
        award,
        ano,
        segmento: cat.segmento,
        categoria,
        artista: artista.trim(),
        titulo: titulo.trim(),
      });
      if (res.success) {
        haptic.success();
        toast.success("Enviado! Obrigado por contribuir.");
        setTitulo("");
        setArtista("");
        setCategoria("");
        // Recarrega pra refletir o novo status "preenchido" da categoria.
        api.listarPremiacoesCategorias(award).then(setCategorias);
      } else {
        toast.error(res.error || "Não foi possível enviar.");
      }
    } catch {
      toast.error("Erro de conexão ao enviar.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="pb-24 px-4 pt-6 max-w-md mx-auto min-h-screen">
      <header className="flex items-center gap-3 mb-6">
        <button
          onClick={() => navigate({ to: "/perfil" })}
          className="size-9 rounded-full bg-white/5 border border-white/10 grid place-items-center"
        >
          <ChevronLeft className="size-5" />
        </button>
        <div>
          <h1 className="text-lg font-black uppercase tracking-tight flex items-center gap-2">
            <Trophy className="size-5 text-primary" /> Premiações
          </h1>
          <p className="text-[11px] text-muted-foreground">
            Preencha as categorias que seu artista ganhou.
          </p>
        </div>
      </header>

      {meusArtistas.length === 0 && (
        <div className="mb-4 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-300">
          Você precisa ter um artista vinculado ao perfil pra preencher premiações.
        </div>
      )}

      <div className="space-y-4">
        <div>
          <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-1.5 block">
            Award
          </label>
          <select
            value={award}
            onChange={(e) => setAward(e.target.value)}
            className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-2xl text-sm outline-none focus:border-primary/50 transition"
          >
            <option value="">Selecione...</option>
            {awards.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>

        {award && (
          <div>
            <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-1.5 block">
              Ano
            </label>
            {categorias === null ? (
              <div className="h-12 rounded-2xl bg-white/5 animate-pulse" />
            ) : (
              <select
                value={ano}
                onChange={(e) => {
                  setAno(e.target.value);
                  setCategoria("");
                }}
                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-2xl text-sm outline-none focus:border-primary/50 transition"
              >
                <option value="">Selecione...</option>
                {anos.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}

        {ano && (
          <div>
            <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-1.5 block">
              Categoria
            </label>
            <select
              value={categoria}
              onChange={(e) => setCategoria(e.target.value)}
              className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-2xl text-sm outline-none focus:border-primary/50 transition"
            >
              <option value="">Selecione...</option>
              {categoriasDoAno.map((c) => (
                <option key={`${c.segmento}-${c.categoria}`} value={c.categoria}>
                  {c.categoria}
                </option>
              ))}
            </select>
          </div>
        )}

        {categoria && (
          <>
            <div>
              <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-1.5 block">
                Seu artista
              </label>
              <select
                value={artista}
                onChange={(e) => setArtista(e.target.value)}
                disabled={meusArtistas.length === 0}
                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-2xl text-sm outline-none focus:border-primary/50 transition disabled:opacity-40"
              >
                <option value="">Selecione...</option>
                {meusArtistas.map((a) => (
                  <option key={a.nome} value={a.nome}>
                    {a.nome}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-1.5 block">
                Título da música/álbum
              </label>
              <input
                type="text"
                value={titulo}
                onChange={(e) => setTitulo(e.target.value)}
                placeholder="Ex: Nome da faixa"
                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-2xl text-sm outline-none focus:border-primary/50 transition"
              />
            </div>

            <button
              onClick={handleSubmit}
              disabled={!artista || !titulo.trim() || saving}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl bg-primary text-primary-foreground text-xs font-black uppercase tracking-widest disabled:opacity-40 transition"
            >
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
              Enviar
            </button>
          </>
        )}
      </div>
    </div>
  );
}
