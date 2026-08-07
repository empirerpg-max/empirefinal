import { createFileRoute, Link } from "@tanstack/react-router";
import { BackButton } from "@/components/BackButton";
import {
  ChevronLeft,
  Info,
  HelpCircle,
  BookOpen,
  Music,
  ShoppingBag,
  TrendingUp,
  Trophy,
} from "lucide-react";

export const Route = createFileRoute("/tutorial")({
  component: TutorialPage,
});

function TutorialPage() {
  return (
    <main className="flex-1 mx-auto w-full max-w-2xl px-4 pt-6 pb-20">
      <BackButton />

      <header className="mb-8">
        <div className="size-12 rounded-xl bg-primary/15 text-primary grid place-items-center mb-4">
          <HelpCircle className="size-6" />
        </div>
        <h1 className="text-3xl font-black">Tutorial</h1>
        <p className="text-muted-foreground mt-2">
          Aprenda a dominar o mundo artístico no Empire Hub.
        </p>
      </header>

      <div className="space-y-8">
        <TutorialSection
          icon={<Music className="size-5" />}
          title="1. Lançando seu primeiro Álbum"
          description="Acesse o perfil do seu artista e clique em 'Lançar projeto'. No formulário, você pode adicionar título, capa (via link do Google Drive), gênero e data. Lembre-se: use links públicos do Drive para que todos possam ouvir."
        />

        <TutorialSection
          icon={<TrendingUp className="size-5" />}
          title="2. Ganhando Prestígio"
          description="Seu prestígio sobe conforme seus lançamentos atingem o Top 10 dos Charts semanais. Você também ganha prestígio fazendo filantropia e lançando projetos de cinema ou tours mundiais."
        />

        <TutorialSection
          icon={<ShoppingBag className="size-5" />}
          title="3. O Mercado de Ações"
          description="No Empire Market, você pode comprar e vender ações de outros artistas ou gravadoras. Se um artista lança um hit, as ações valorizam. Compre na baixa, venda na alta!"
        />

        <TutorialSection
          icon={<Trophy className="size-5" />}
          title="4. Rankings e Hall da Fama"
          description="Acompanhe o Ranking para ver quem é o magnata do jogo. Artistas com carreiras lendárias são imortalizados no Hall da Fama."
        />

        <div className="p-6 rounded-2xl bg-card border border-border">
          <h3 className="font-bold flex items-center gap-2 mb-2 text-primary">
            <Info className="size-4" /> Dica de Ouro
          </h3>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Fique atento à <strong>Fadiga</strong> do seu artista. Tours intensas aumentam a fadiga,
            o que pode prejudicar o desempenho. Use os itens de 'Férias' no mercado para descansar.
          </p>
        </div>
      </div>

      <div className="mt-12 p-8 rounded-3xl bg-secondary text-center">
        <BookOpen className="size-8 mx-auto mb-4 text-primary opacity-50" />
        <h3 className="font-extrabold text-lg mb-2">Pronto para começar?</h3>
        <p className="text-sm text-muted-foreground mb-6">
          Explore os menus e comece sua jornada ao topo!
        </p>
        <Link
          to="/"
          className="inline-flex py-3 px-8 rounded-full bg-primary text-primary-foreground font-bold shadow-lg shadow-primary/20"
        >
          Vamos lá!
        </Link>
      </div>
    </main>
  );
}

function TutorialSection({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="flex gap-4">
      <div className="size-10 rounded-lg bg-card border border-border grid place-items-center shrink-0">
        {icon}
      </div>
      <div>
        <h3 className="font-bold text-lg mb-1">{title}</h3>
        <p className="text-sm text-muted-foreground leading-relaxed">{description}</p>
      </div>
    </div>
  );
}
