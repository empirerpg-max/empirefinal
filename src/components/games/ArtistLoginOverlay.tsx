import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { User, CheckCircle2, ChevronRight } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { api, driveImg } from "../../lib/api";
import { useTelegramUser } from "../../lib/telegram";

interface Artist {
  nome: string;
  foto?: string;
  saldo: number;
}

interface ArtistLoginOverlayProps {
  onSelect: (artist: Artist) => void;
  gameName: string;
}

export function ArtistLoginOverlay({ onSelect, gameName }: ArtistLoginOverlayProps) {
  const { user } = useTelegramUser();
  const [artists, setArtists] = useState<Artist[]>([]);
  const [loading, setLoading] = useState(true);
  const [isOpen, setIsOpen] = useState(true);

  useEffect(() => {
    async function loadArtists() {
      const tgId = user?.id || "";
      if (!tgId || tgId === "guest") {
        setLoading(false);
        return;
      }
      try {
        // Aproveitamos a rota de artistas do jogador para listar os disponíveis
        const res = await api.meusArtistas(tgId);
        if (Array.isArray(res)) {
          setArtists(res);
        }
      } catch (e) {
        console.error("Erro ao carregar artistas:", e);
      } finally {
        setLoading(false);
      }
    }
    loadArtists();
  }, [user?.id]);

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[200] bg-black flex flex-col items-center justify-center p-6 text-center"
      >
        <div className="max-w-md w-full">
          <div className="mb-10">
            <h1 className="text-3xl font-cabinet font-black italic uppercase text-white mb-2 tracking-tighter">
              Acesso ao {gameName}
            </h1>
            <p className="text-white/40 text-xs font-black uppercase tracking-widest">
              Escolha um de seus artistas para entrar
            </p>
          </div>

          {loading ? (
            <div className="flex flex-col items-center py-10">
              <div className="size-10 border-4 border-primary border-t-transparent rounded-full animate-spin mb-4" />
              <p className="text-primary text-[10px] font-black uppercase tracking-[0.2em]">Buscando artistas...</p>
            </div>
          ) : artists.length > 0 ? (
            <div className="space-y-4 max-h-[50vh] overflow-y-auto pr-2 scrollbar-thin">
              {artists.map((art) => (
                <button
                  key={art.nome}
                  onClick={() => {
                    onSelect(art);
                    setIsOpen(false);
                  }}
                  className="w-full flex items-center gap-4 bg-white/5 border border-white/10 p-5 rounded-[28px] hover:bg-white/10 hover:border-primary transition-all group"
                >
                  <div className="size-16 rounded-2xl overflow-hidden border border-white/10 bg-white/5 flex-shrink-0">
                    <img src={driveImg(art.foto)} className="w-full h-full object-cover" alt="" referrerPolicy="no-referrer"  loading="lazy" decoding="async"/>
                  </div>
                  <div className="flex-1 text-left">
                    <h3 className="text-white font-cabinet font-black italic uppercase text-lg leading-tight group-hover:text-primary transition-colors">
                      {art.nome}
                    </h3>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-gold font-black italic text-sm">{Math.floor(art.saldo).toLocaleString()} EC</span>
                    </div>
                  </div>
                  <ChevronRight className="size-5 text-white/20 group-hover:text-primary" />
                </button>
              ))}
            </div>
          ) : (
            <div className="py-10">
              <User className="size-16 text-white/10 mx-auto mb-6" />
              <h3 className="text-white font-cabinet font-black italic uppercase text-xl mb-4">Nenhum Artista</h3>
              <p className="text-white/40 text-sm mb-10">
                Você ainda não possui artistas vinculados ao seu Telegram. Vá ao Studio para criar um.
              </p>
            </div>
          )}

          <div className="mt-12 flex flex-col gap-4">
             <a
              href="/studio"
              className="text-white/20 hover:text-white text-[10px] font-black uppercase tracking-widest transition-colors"
             >
                Ir para o Studio
             </a>
             <Link 
              to="/games" 
              className="text-white/20 hover:text-white text-[10px] font-black uppercase tracking-widest transition-colors"
             >
                Voltar aos Jogos
             </Link>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
