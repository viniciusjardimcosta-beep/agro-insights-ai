import { createFileRoute } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import { Sprout, BarChart3, Banknote, MapPinned, Bot, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "AgroIntel AI — O copiloto inteligente do produtor rural" },
      { name: "description", content: "Controle de talhões, custos, produção e lucro por hectare com um consultor de IA conectado aos dados da sua fazenda." },
      { property: "og:title", content: "AgroIntel AI" },
      { property: "og:description", content: "O copiloto inteligente do produtor rural." },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <div className="min-h-screen bg-background">
      <header className="container mx-auto flex items-center justify-between px-6 py-5">
        <Link to="/" className="flex items-center gap-2 font-display text-xl font-bold text-foreground">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-primary text-primary-foreground">
            <Sprout className="h-5 w-5" />
          </span>
          AgroIntel <span className="text-primary">AI</span>
        </Link>
        <Link to="/auth">
          <Button variant="ghost">Entrar</Button>
        </Link>
      </header>

      <section className="relative overflow-hidden">
        <div
          className="absolute inset-0 -z-10 opacity-[0.07]"
          style={{
            backgroundImage:
              "radial-gradient(circle at 20% 20%, oklch(0.52 0.14 145) 0, transparent 40%), radial-gradient(circle at 80% 60%, oklch(0.65 0.16 142) 0, transparent 40%)",
          }}
        />
        <div className="container mx-auto px-6 py-20 md:py-28">
          <div className="mx-auto max-w-3xl text-center">
            <span className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-xs font-medium text-primary">
              <Sprout className="h-3.5 w-3.5" /> Para produtores de soja, milho e trigo
            </span>
            <h1 className="mt-6 text-5xl font-bold tracking-tight text-foreground md:text-6xl">
              O copiloto inteligente <br className="hidden md:block" />
              do <span className="text-primary">produtor rural</span>
            </h1>
            <p className="mt-6 text-lg text-muted-foreground md:text-xl">
              Controle talhões, custos, produção e lucro por hectare — e converse com um
              consultor de IA que enxerga os dados da sua fazenda.
            </p>
            <div className="mt-10 flex items-center justify-center gap-3">
              <Link to="/auth">
                <Button size="lg" className="h-12 px-6 text-base">
                  Começar agora <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="container mx-auto px-6 pb-24">
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-4">
          {[
            { icon: Banknote, title: "Controle de custos", desc: "Sementes, defensivos, diesel, arrendamento — tudo lançado por talhão e categoria." },
            { icon: BarChart3, title: "Lucro por hectare", desc: "Veja receita estimada, custo e lucro/ha em tempo real, com alertas no dashboard." },
            { icon: MapPinned, title: "Gestão de talhões", desc: "Cadastre propriedades, talhões, cultura e safra com cálculos automáticos." },
            { icon: Bot, title: "Consultor IA da fazenda", desc: "“Estou tendo lucro?” “Qual talhão dá prejuízo?” A IA responde com seus dados." },
          ].map((f) => (
            <div key={f.title} className="rounded-xl border bg-card p-6 shadow-[var(--shadow-card)]">
              <div className="grid h-10 w-10 place-items-center rounded-lg bg-primary/10 text-primary">
                <f.icon className="h-5 w-5" />
              </div>
              <h3 className="mt-4 text-lg font-semibold">{f.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="border-t bg-secondary/40">
        <div className="container mx-auto px-6 py-16 text-center">
          <h2 className="text-3xl font-bold">Pronto para ver os números da sua safra?</h2>
          <p className="mt-3 text-muted-foreground">Crie sua conta gratuita e carregue dados de demonstração em 1 clique.</p>
          <Link to="/auth" className="mt-6 inline-block">
            <Button size="lg" className="h-12 px-6">Começar agora</Button>
          </Link>
        </div>
      </section>

      <footer className="border-t">
        <div className="container mx-auto flex flex-col items-center justify-between gap-2 px-6 py-6 text-sm text-muted-foreground md:flex-row">
          <span>© {new Date().getFullYear()} AgroIntel AI</span>
          <span>Feito para o campo brasileiro 🌱</span>
        </div>
      </footer>
    </div>
  );
}
