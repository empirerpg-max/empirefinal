import { createFileRoute, Outlet } from "@tanstack/react-router";
import { BannerCarousel } from "@/components/EmpirePlay/BannerCarousel";
import { EmpirePlayTabNav } from "@/components/EmpirePlay/TabNav";

export const Route = createFileRoute("/empire-play")({
  head: () => ({
    meta: [
      { title: "Catálogo — Empire Hub" },
      { name: "description", content: "Músicas, vídeos, álbuns e o fórum do Catálogo." },
    ],
  }),
  component: EmpirePlayLayout,
});

// O player (áudio/vídeo) agora mora na raiz do app (__root.tsx), não mais
// aqui — assim ele continua tocando mesmo saindo do Catálogo pra outro menu.
function EmpirePlayLayout() {
  return (
    <div className="w-full max-w-5xl mx-auto px-3 sm:px-4 py-4 sm:py-6 pb-28 min-w-0 max-w-full overflow-x-hidden">
      <BannerCarousel />
      <EmpirePlayTabNav />
      <Outlet />
    </div>
  );
}
