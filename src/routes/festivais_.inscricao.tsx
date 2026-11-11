import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ChevronLeft, Ticket, Loader2, Check, ChevronDown } from "lucide-react";
import { useTelegramUser, haptic } from "@/lib/telegram";
import { api } from "@/lib/api";
import { toast } from "sonner";

export const Route = createFileRoute("/festivais_/inscricao")({
  component: FestivalInscricaoPage,
});

type Dados = Awaited<ReturnType<typeof api.getFestivalInscricao>>;

function FestivalInscricaoPage() {
  const { user } = useTelegramUser();
  const telegramId = user?.id ? String(user.id) : (typeof window !== "undefined" ? localStorage.getItem("empire_tg_id") : null) || "";

  const [dados, setDados] = useState<Dados>(null);
  const [carregando, setCarregando] = useState(true);
  const [artistaSelecionado, setArtistaSelecionado] = useState("");
  const [generoSelecionado, setGeneroSelecionado] = useState("");
  const [dropdownArtistaAberto, setDropdownArtistaAberto] = useState(false);
  const [dropdownGeneroAberto, setDropdownGeneroAberto] = useState(false);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    if (!telegramId) return;
    api.getFestivalInscricao(telegramId).then((d) => {
      setDados(d);
      setCarregando(false);
    });
  }, [telegramId]);

  const inscricaoDoArtista = (artista: string) =>
    dados?.inscricoes.find((i) => i.artista.toLowerCase() === artista.toLowerCase());

  const selecionarArtista = (artista: string) => {
    haptic.selection();
    setArtistaSelecionado(artista);
    setDropdownArtistaAberto(false);
    const existente = inscricaoDoArtista(artista);
    setGeneroSelecionado(existente?.genero || "");
  };

  const enviar = async () => {
    if (!telegramId || !artistaSelecionado || !generoSelecionado || enviando) return;
    setEnviando(true);
    const res = await api.enviarFestivalInscricao({
      telegramId,
      artista: artistaSelecionado,
      genero: generoSelecionado,
    });
    setEnviando(false);
    if (res.success) {
      haptic.success();
      toast.success(res.data?.editado ? "Inscrição atualizada!" : "Inscrito com sucesso!");
      const atualizados = await api.getFestivalInscricao(telegramId);
      setDados(atualizados);
    } else {
      haptic.error();
      toast.error(res.error || "Erro ao enviar inscrição.");
    }
  };

  if (carregando) {
    return (
      <div className="pb-24 px-4 pt-6 max-w-md mx-auto min-h-screen grid place-items-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const encerrado = dados?.status === "encerrado";
  const agendado = dados?.status === "agendado";
  const jaInscrito = artistaSelecionado ? !!inscricaoDoArtista(artistaSelecionado) : false;

  return (
    <div className="pb-24 px-4 pt-6 max-w-md mx-auto min-h-screen">
      <header className="flex items-center gap-3 mb-4">
        <Link
          to="/perfil"
          onClick={() => haptic.selection()}
          className="size-9 rounded-full bg-white/5 border border-white/10 grid place-items-center"
        >
          <ChevronLeft className="size-5" />
        </Link>
        <div className="min-w-0">
          <h1 className="text-base font-black uppercase tracking-tight truncate">Inscrição — Festivais</h1>
          <p className="text-[11px] text-muted-foreground">
            {encerrado
              ? "Inscrições encerradas."
              : agendado
                ? "Inscrições ainda não abriram."
                : `Prazo: até ${dados?.deadlineLabel}`}
          </p>
        </div>
      </header>

      {!encerrado && !agendado && dados && dados.artistas.length === 0 && (
        <div className="p-5 rounded-2xl bg-white/[0.02] border border-white/5 text-center">
          <Ticket className="size-6 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">
            Você ainda não gerencia nenhum artista — crie ou assuma um artista antes de se inscrever.
          </p>
        </div>
      )}

      {!encerrado && !agendado && dados && dados.artistas.length > 0 && (
        <div className="space-y-4">
          {/* Seletor de artista */}
          <div className="relative">
            <label className="block text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-1.5">
              Artista
            </label>
            <button
              type="button"
              onClick={() => {
                haptic.selection();
                setDropdownArtistaAberto((v) => !v);
                setDropdownGeneroAberto(false);
              }}
              className="w-full flex items-center gap-2 px-4 py-3 rounded-2xl bg-white/[0.04] border border-white/10 text-left"
            >
              <span className={`flex-1 text-sm font-bold truncate ${artistaSelecionado ? "" : "text-muted-foreground"}`}>
                {artistaSelecionado || "Selecione um artista"}
              </span>
              <ChevronDown className={`size-4 text-muted-foreground transition-transform ${dropdownArtistaAberto ? "rotate-180" : ""}`} />
            </button>
            {dropdownArtistaAberto && (
              <div className="absolute z-20 mt-1.5 w-full max-h-64 overflow-y-auto rounded-2xl bg-neutral-900 border border-white/10 shadow-2xl">
                {dados.artistas.map((artista) => {
                  const inscrito = !!inscricaoDoArtista(artista);
                  return (
                    <button
                      key={artista}
                      type="button"
                      onClick={() => selecionarArtista(artista)}
                      className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-white/5 transition-colors"
                    >
                      <span className="flex-1 text-sm font-bold truncate">{artista}</span>
                      {inscrito && <Check className="size-3.5 text-emerald-400 shrink-0" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Seletor de gênero */}
          <div className="relative">
            <label className="block text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-1.5">
              Gênero musical
            </label>
            <button
              type="button"
              disabled={!artistaSelecionado}
              onClick={() => {
                haptic.selection();
                setDropdownGeneroAberto((v) => !v);
                setDropdownArtistaAberto(false);
              }}
              className="w-full flex items-center gap-2 px-4 py-3 rounded-2xl bg-white/[0.04] border border-white/10 text-left disabled:opacity-40"
            >
              <span className={`flex-1 text-sm font-bold truncate ${generoSelecionado ? "" : "text-muted-foreground"}`}>
                {generoSelecionado || "Selecione um gênero"}
              </span>
              <ChevronDown className={`size-4 text-muted-foreground transition-transform ${dropdownGeneroAberto ? "rotate-180" : ""}`} />
            </button>
            {dropdownGeneroAberto && (
              <div className="absolute z-20 mt-1.5 w-full max-h-64 overflow-y-auto rounded-2xl bg-neutral-900 border border-white/10 shadow-2xl">
                {dados.generos.map((genero) => (
                  <button
                    key={genero}
                    type="button"
                    onClick={() => {
                      haptic.selection();
                      setGeneroSelecionado(genero);
                      setDropdownGeneroAberto(false);
                    }}
                    className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-white/5 transition-colors"
                  >
                    <span className="flex-1 text-sm font-bold truncate">{genero}</span>
                    {generoSelecionado === genero && <Check className="size-3.5 text-primary shrink-0" />}
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={enviar}
            disabled={!artistaSelecionado || !generoSelecionado || enviando}
            className="w-full py-3.5 rounded-2xl bg-primary text-primary-foreground text-sm font-black uppercase tracking-wide active:scale-95 transition-transform disabled:opacity-40 flex items-center justify-center gap-2"
          >
            {enviando ? (
              <Loader2 className="size-4 animate-spin" />
            ) : jaInscrito ? (
              "Salvar alterações"
            ) : (
              "Enviar inscrição"
            )}
          </button>

          {dados.inscricoes.length > 0 && (
            <div className="space-y-1.5 pt-2">
              <p className="text-[10px] font-black uppercase tracking-widest text-emerald-400">Já inscritos</p>
              {dados.inscricoes.map((i) => (
                <div
                  key={i.artista}
                  className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30"
                >
                  <Check className="size-4 text-emerald-400 shrink-0" />
                  <span className="flex-1 text-xs font-bold truncate">
                    {i.artista} — {i.genero}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
