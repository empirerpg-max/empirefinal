import { useEffect, useState } from "react";
import { MessageCircle } from "lucide-react";

interface AtividadeItem {
  jogador: string;
  titulo: string;
  tipo: "musica" | "video" | "album";
}

const TIPO_VERBO: Record<AtividadeItem["tipo"], string> = {
  musica: "comentou em",
  video: "comentou em",
  album: "comentou no álbum",
};

// Texto corrido com os últimos comentários do Fórum — "fulano comentou em
// tal coisa". Lê de /api/forum/atividade-recente (últimas linhas das abas
// de comentário reais, não de REGISTRO — essa é zerada toda semana pro
// recálculo dos charts, não serviria de histórico).
export function ActivityTicker() {
  const [itens, setItens] = useState<AtividadeItem[]>([]);

  useEffect(() => {
    let alive = true;
    function load() {
      fetch("/api/forum/atividade-recente")
        .then((r) => r.json())
        .then((json) => {
          if (alive && json?.success) setItens(json.data || []);
        })
        .catch(() => {});
    }
    load();
    const interval = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(interval);
    };
  }, []);

  if (itens.length === 0) return null;

  const linha = (
    <div className="flex items-center gap-8 shrink-0 pr-8">
      {itens.map((item, i) => (
        <span key={i} className="flex items-center gap-2 text-xs text-muted-foreground whitespace-nowrap">
          <span className="font-bold text-foreground">{item.jogador}</span>
          <span>{TIPO_VERBO[item.tipo]}</span>
          <span className="font-bold text-primary">{item.titulo}</span>
          <span className="text-muted-foreground/30 ml-6">•</span>
        </span>
      ))}
    </div>
  );

  return (
    <div className="mt-3 mb-8 -mx-4 px-4 overflow-hidden">
      <div className="flex items-center gap-2 mb-2">
        <MessageCircle className="size-3 text-muted-foreground/50" aria-hidden="true" />
        <span className="text-[9px] font-black uppercase tracking-[0.2em] text-muted-foreground/50">
          Atividade recente
        </span>
      </div>
      <div
        className="flex w-max animate-marquee"
        // Duração proporcional à quantidade de itens — fixa em segundos
        // (ex: 30s pra sempre), a passagem ficava rápida demais quando
        // tinha poucos comentários e lenta demais quando tinha muitos,
        // porque a distância percorrida muda mas o tempo não. 6s por item
        // mantém a velocidade de leitura sempre parecida.
        style={{ animationDuration: `${Math.max(itens.length * 6, 20)}s` }}
      >
        {linha}
        {linha}
      </div>
    </div>
  );
}
