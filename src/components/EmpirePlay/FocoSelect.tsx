import { useEffect, useState } from "react";
import { listarPaisesFoco } from "@/lib/focoMusica";

interface FocoSelectProps {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  /** Obrigatório: mostra a opção vazia "Escolha o foco…" (o fluxo bloqueia enquanto vazio). */
  obrigatorio?: boolean;
  /** Classes do <select> — cada tela usa o visual dos selects vizinhos. */
  className?: string;
  /** Esconde o texto de ajuda (ex.: linha compacta de faixa pendente). */
  semAjuda?: boolean;
}

const CLASSE_PADRAO =
  "w-full min-w-0 bg-black/25 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:border-emerald-500 focus:outline-none disabled:opacity-50";

// Select do foco (país-alvo) do lançamento — opções vêm de /api/musica-foco/paises.
export function FocoSelect({
  value,
  onChange,
  disabled,
  obrigatorio,
  className,
  semAjuda,
}: FocoSelectProps) {
  const [paises, setPaises] = useState<string[]>([]);
  const [erro, setErro] = useState(false);

  useEffect(() => {
    let ativo = true;
    listarPaisesFoco()
      .then((lista) => {
        if (ativo) setPaises(lista);
      })
      .catch(() => {
        if (ativo) setErro(true);
      });
    return () => {
      ativo = false;
    };
  }, []);

  // Valor salvo que não está na lista (ex.: país removido) continua visível.
  const opcoes =
    value && value !== "GLOBAL" && !paises.includes(value) ? [value, ...paises] : paises;

  return (
    <div className="space-y-1.5 min-w-0">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        aria-label="Foco do lançamento"
        className={className || CLASSE_PADRAO}
      >
        {(obrigatorio || !value) && <option value="">Escolha o foco…</option>}
        <option value="GLOBAL">Global / sem foco</option>
        {opcoes.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </select>
      {erro && (
        <p className="text-[11px] text-red-400">
          Não foi possível carregar a lista de países. Só "Global / sem foco" está disponível agora.
        </p>
      )}
      {!semAjuda && (
        <p className="text-[11px] text-neutral-500">
          País onde você quer focar este lançamento. Depois de salvo, só a administração pode
          alterar.
        </p>
      )}
    </div>
  );
}
