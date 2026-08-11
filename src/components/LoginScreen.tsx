import { useState } from "react";
import { Crown, Lock, User, Loader2, Eye, EyeOff } from "lucide-react";
import logoIcon from "@/assets/logo-icon.png";

export interface LoginResult {
  id: string;
  nome: string;
  usuario: string;
  tipoPerfil: string;
  fotoPerfil: string;
  prestigio: string;
}

const STORAGE_KEY = "empire_login_user";

export function getStoredLogin(): LoginResult | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as LoginResult) : null;
  } catch {
    return null;
  }
}

export function clearStoredLogin() {
  localStorage.removeItem(STORAGE_KEY);
}

export function setStoredLogin(user: LoginResult) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
}

export function LoginScreen({ onSuccess }: { onSuccess: (user: LoginResult) => void }) {
  const [usuario, setUsuario] = useState("");
  const [senha, setSenha] = useState("");
  const [showSenha, setShowSenha] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!usuario.trim() || !senha) {
      setErrorMsg("Preencha usuário e senha.");
      return;
    }
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ usuario: usuario.trim(), senha }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || "Não foi possível entrar.");
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(json.data));
      onSuccess(json.data as LoginResult);
    } catch (err: any) {
      setErrorMsg(err.message || "Erro de conexão ao entrar.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-5 py-10">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <div className="relative mb-4">
            <img src={logoIcon} alt="Empire" className="size-16 rounded-2xl object-contain relative z-10" />
            <span className="absolute inset-0 rounded-2xl bg-primary/40 blur-xl opacity-60" />
          </div>
          <h1 className="font-black italic uppercase tracking-tighter text-2xl">
            <span className="bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">
              Empire
            </span>{" "}
            <span className="text-primary">Hub</span>
          </h1>
          <p className="text-[11px] text-muted-foreground uppercase font-black tracking-[0.2em] mt-2 text-center opacity-70">
            Entre com seu usuário e senha
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-card border border-white/10 rounded-[2rem] p-6 sm:p-7 space-y-5 shadow-2xl"
        >
          <div>
            <label className="block text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <User className="size-3.5 text-primary" />
              Usuário
            </label>
            <input
              type="text"
              value={usuario}
              onChange={(e) => setUsuario(e.target.value)}
              placeholder="Ex: hugo_empire"
              autoCapitalize="none"
              autoCorrect="off"
              className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-2xl text-sm outline-none focus:border-primary/50 transition placeholder:text-muted-foreground/40"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Lock className="size-3.5 text-primary" />
              Senha
            </label>
            <div className="relative">
              <input
                type={showSenha ? "text" : "password"}
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                placeholder="••••••••"
                className="w-full px-4 py-3 pr-11 bg-white/5 border border-white/10 rounded-2xl text-sm outline-none focus:border-primary/50 transition placeholder:text-muted-foreground/40"
                required
              />
              <button
                type="button"
                onClick={() => setShowSenha((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition"
                tabIndex={-1}
              >
                {showSenha ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
            <p className="text-[10px] text-muted-foreground/60 mt-2 italic">
              Primeiro acesso? A senha que você digitar agora vira sua senha definitiva.
            </p>
          </div>

          {errorMsg && (
            <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-2xl text-red-400 text-xs font-medium">
              {errorMsg}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full h-14 rounded-[2rem] bg-primary text-primary-foreground font-black uppercase text-xs tracking-[0.2em] flex items-center justify-center gap-2 active:scale-95 transition-all disabled:opacity-50 shadow-[0_10px_30px_rgba(var(--primary-rgb),0.3)]"
          >
            {loading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <>
                <Crown className="size-4" />
                Entrar
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
