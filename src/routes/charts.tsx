import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/charts")({
  head: () => ({
    meta: [
      { title: "Empire Charts" },
      { name: "description", content: "Charts oficiais do Empire — Hot 100, Spotify, Apple, YouTube e mais." },
    ],
  }),
  component: ChartsPage,
});

function ChartsPage() {
  return (
    <div className="fixed inset-0 top-[calc(4rem+env(safe-area-inset-top))] bottom-[calc(4rem+env(safe-area-inset-bottom))] bg-black">
      <iframe
        src="/charts-app/index.html"
        title="Empire Charts"
        className="w-full h-full border-0 block"
        allow="autoplay"
        loading="lazy"
      />
    </div>
  );
}
