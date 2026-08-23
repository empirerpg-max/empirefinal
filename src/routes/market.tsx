import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft, ShoppingBag } from "lucide-react";

export const Route = createFileRoute("/market")({
  head: () => ({
    meta: [{ title: "Market — Empire Hub" }],
  }),
  component: MarketPage,
});

function MarketPage() {
  return (
    <main className="flex-1 mx-auto w-full max-w-2xl px-4 pt-6 pb-20">
      <div className="flex items-center gap-3 mb-8">
        <Link
          to="/"
          className="size-9 rounded-full bg-white/5 border border-white/10 grid place-items-center"
        >
          <ChevronLeft className="size-5" />
        </Link>
        <h1 className="text-lg font-black uppercase tracking-tight">Market</h1>
      </div>

      <div className="flex flex-col items-center justify-center text-center py-24">
        <ShoppingBag className="size-14 text-primary/30 mb-4" />
        <p className="text-sm font-black uppercase tracking-widest text-muted-foreground">
          Em construção
        </p>
      </div>
    </main>
  );
}
