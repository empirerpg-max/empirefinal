import { createFileRoute } from "@tanstack/react-router";
import { GestaoPreSave } from "@/components/EmpirePlay/GestaoPreSave";

export const Route = createFileRoute("/empire-play/gestao-presave")({
  head: () => ({
    meta: [
      { title: "Gestão Pre save — Empire Hub" },
      {
        name: "description",
        content: "Campanhas de pre-save de álbum: contagem regressiva e missões diárias.",
      },
    ],
  }),
  component: GestaoPreSave,
});
