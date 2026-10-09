import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { driveImgWide } from "@/lib/api";
import { Rocket } from "lucide-react";

interface CampanhaPublica {
  id: string;
  artista: string;
  albumTituloFull: string;
  capaUrl: string;
  modo: "missao" | "contagem";
  dataLancamento: string;
  status: "ativa" | "lancada" | "cancelada";
  albumTopicId: string;
  acumuladoAtual: number;
}

const ROTATE_MS = 6000;

// Banner promocional de campanhas de pre-save ativas, no mesmo slot do
// Home onde o Market já usa o "spotlight banner" (ver
// SpotlightBannerCarousel.tsx, reaproveitado aqui só como referência de
// padrão visual — componente próprio, dados próprios). Nunca mostra o
// teto/valor final, só o acumulado até agora e a contagem regressiva.
export function PreSaveBannerCarousel() {
  const navigate = useNavigate();
  const [campanhas, setCampanhas] = useState<CampanhaPublica[]>([]);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    fetch("/api/presave/banners-ativos")
      .then((r) => (r.ok ? r.json() : null))
      .then((res) => setCampanhas(Array.isArray(res?.data) ? res.data : []))
      .catch(() => setCampanhas([]));
  }, []);

  useEffect(() => {
    if (campanhas.length < 2) return;
    const timer = setInterval(() => setIndex((i) => (i + 1) % campanhas.length), ROTATE_MS);
    return () => clearInterval(timer);
  }, [campanhas.length]);

  if (campanhas.length === 0) return null;
  const atual = campanhas[index];
  const diasFaltando = Math.max(
    0,
    Math.ceil((new Date(`${atual.dataLancamento}T00:00:00`).getTime() - Date.now()) / 86400000),
  );

  return (
    <div className="mb-8">
      <button
        onClick={() =>
          navigate({ to: "/empire-play/forum", search: { tab: "albuns", id: atual.albumTopicId } })
        }
        className="relative w-full rounded-2xl overflow-hidden text-left"
        style={{ height: 112, boxShadow: "0 8px 22px rgba(0,0,0,0.35)" }}
      >
        <img
          src={driveImgWide(atual.capaUrl, 800)}
          alt=""
          className="absolute inset-0 w-full h-full object-cover"
        />
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(90deg, rgba(0,0,0,0.75) 0%, rgba(0,0,0,0.35) 55%, rgba(0,0,0,0.05) 100%)",
          }}
        />
        <div className="absolute top-2 left-3 inline-flex items-center gap-1 text-[8px] font-black tracking-[0.08em] text-fuchsia-200 bg-black/40 px-2 py-1 rounded-full">
          <Rocket className="size-2.5" />
          PRE-SAVE
        </div>
        <div className="absolute left-3 bottom-2.5 right-16 min-w-0">
          <div className="text-[15px] font-black text-white leading-tight truncate">
            {atual.albumTituloFull}
          </div>
          <div className="text-[11px] text-neutral-200 mt-0.5 truncate">
            Faltam {diasFaltando} dia{diasFaltando === 1 ? "" : "s"} ·{" "}
            {atual.acumuladoAtual.toLocaleString("pt-BR")} fãs já aderiram
          </div>
        </div>
      </button>
      {campanhas.length > 1 && (
        <div className="flex gap-1.5 justify-center mt-2">
          {campanhas.map((c, i) => (
            <div
              key={c.id}
              className="rounded-full transition-all"
              style={{
                width: i === index ? 16 : 5,
                height: 5,
                background: i === index ? "#e879f9" : "#3a4058",
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
