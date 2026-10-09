import { useEffect, useState } from "react";
import { Rocket } from "lucide-react";

interface ContadorPublico {
  id: string;
  artista: string;
  albumTituloFull: string;
  modo: "missao" | "contagem";
  dataLancamento: string;
  status: "ativa" | "lancada" | "cancelada";
  acumuladoAtual: number;
}

// Contador público de pre-save, usado na página do álbum (tópico do fórum)
// — nunca mostra o teto/valor final calculado (regra do usuário: só o
// valor acumulado até o momento). Se o álbum não tiver campanha de
// pre-save associada, o componente simplesmente não renderiza nada.
export function PreSaveCounterBadge({ albumTopicId }: { albumTopicId: string }) {
  const [dado, setDado] = useState<ContadorPublico | null>(null);

  useEffect(() => {
    if (!albumTopicId) return;
    let ativo = true;
    fetch(`/api/presave/contador-publico?albumTopicId=${encodeURIComponent(albumTopicId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((res) => {
        if (ativo && res?.success) setDado(res.data);
      })
      .catch(() => {});
    return () => {
      ativo = false;
    };
  }, [albumTopicId]);

  if (!dado) return null;

  const diasFaltando = Math.max(
    0,
    Math.ceil((new Date(`${dado.dataLancamento}T00:00:00`).getTime() - Date.now()) / 86400000),
  );

  return (
    <div className="inline-flex items-center gap-2 pl-2.5 pr-3 py-1.5 rounded-full border backdrop-blur-md max-w-full bg-fuchsia-500/10 border-fuchsia-400/30 text-fuchsia-200 min-w-0">
      <Rocket className="size-3.5 shrink-0" />
      <span className="text-[11px] font-bold truncate">
        {dado.status === "ativa"
          ? `Pre-save: ${dado.acumuladoAtual.toLocaleString("pt-BR")} · faltam ${diasFaltando} dia${diasFaltando === 1 ? "" : "s"}`
          : `Pre-save encerrado: ${dado.acumuladoAtual.toLocaleString("pt-BR")} fãs engajados`}
      </span>
    </div>
  );
}
