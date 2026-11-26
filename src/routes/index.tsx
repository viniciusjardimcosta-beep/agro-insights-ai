import { createFileRoute } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { Sprout, BarChart3, Banknote, MapPinned, Bot, ArrowRight, Mic, Beef, Check, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HeroField } from "@/components/hero-field";
import { Reveal } from "@/components/reveal";
import { PRIVACY_CONTACT } from "@/lib/privacy";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "AgroIntel AI — quanto cada talhão e cada lote dá de lucro" },
      { name: "description", content: "Lavoura e pecuária num só lugar: custos, produção, lucro por hectare e resultado por lote, com um consultor de IA conectado aos dados da sua fazenda." },
      { property: "og:title", content: "AgroIntel AI — quanto cada talhão e cada lote dá de lucro" },
      { property: "og:description", content: "Lavoura e pecuária num só lugar: custos, lucro por hectare, resultado por lote e consultor de IA." },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <div className="min-h-screen bg-background">
      <header className="container mx-auto flex items-center justify-between gap-2 px-4 py-4 sm:px-6 sm:py-5">
        <Link to="/" className="flex min-w-0 items-center gap-2 font-display text-lg font-bold text-foreground sm:text-xl">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-primary text-primary-foreground">
            <Sprout className="h-5 w-5" />
          </span>
          AgroIntel <span className="text-primary">AI</span>
        </Link>
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm"><Link to="/auth">Entrar</Link></Button>
          <Button asChild size="sm"><Link to="/auth"><span className="sm:hidden">Começar</span><span className="hidden sm:inline">Começar grátis</span></Link></Button>
        </div>
      </header>

      <section className="relative overflow-hidden">
        <div
          className="absolute inset-0 -z-10 opacity-[0.07]"
          style={{
            backgroundImage:
              "radial-gradient(circle at 20% 20%, oklch(0.52 0.14 145) 0, transparent 40%), radial-gradient(circle at 80% 60%, oklch(0.65 0.16 142) 0, transparent 40%)",
          }}
        />
        <div className="container mx-auto px-6 pb-10 pt-20 md:pb-14 md:pt-28">
          <div className="mx-auto max-w-3xl text-center">
            <span className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-xs font-medium text-primary">
              <Sprout className="h-3.5 w-3.5" /> Para quem planta e para quem cria gado
            </span>
            <h1 className="mt-6 text-5xl font-bold tracking-tight text-foreground md:text-6xl">
              Saiba quanto cada talhão <br className="hidden md:block" />
              e cada lote <span className="text-primary">dá de lucro</span>
            </h1>
            <p className="mt-6 text-lg text-muted-foreground md:text-xl">
              O copiloto do produtor rural: organize custos, produção e resultado de lavoura e gado num só
              lugar — e converse com um consultor de IA que enxerga os dados da sua fazenda.
            </p>
            <div className="mt-10 flex items-center justify-center gap-3">
              <Button asChild size="lg" className="h-12 px-6 text-base">
                <Link to="/auth">Começar agora <ArrowRight className="ml-2 h-4 w-4" /></Link>
              </Button>
            </div>
            <p className="mt-3 text-sm text-muted-foreground">Teste grátis de 7 dias ao criar a conta.</p>
            {/* No celular, o produto aparece logo no topo (a cena animada fica parada e embaixo). */}
            <div className="mx-auto mt-8 max-w-md overflow-hidden rounded-xl border bg-card shadow-[var(--shadow-card)] md:hidden">
              <img src="/lp/dash-480.webp" alt="Dashboard do AgroIntel com custo, receita e lucro por hectare" width={480} height={220} className="w-full" />
            </div>
          </div>
        </div>
        <HeroField />
      </section>

      <section className="container mx-auto px-6 py-16 md:py-24">
        <Reveal className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold md:text-4xl">Desorganização custa dinheiro</h2>
          <p className="mt-3 text-muted-foreground">
            Quem não enxerga o custo de cada talhão e de cada lote deixa lucro no campo. É isso que o AgroIntel resolve, sem dar trabalho extra.
          </p>
        </Reveal>
        <div className="mt-10 grid gap-5 md:grid-cols-3">
          {[
            { before: "Custo anotado no caderno, que ninguém soma.", after: "Fale ou fotografe o caderno: o app lança e organiza por você.", icon: Mic },
            { before: "Gado vendido sem saber se deu lucro.", after: "Resultado por lote, custo por cabeça e preço mínimo da arroba.", icon: BarChart3 },
            { before: "Duas fazendas, números misturados.", after: "Escolha a fazenda no topo: cada uma separada, ou todas somadas.", icon: MapPinned },
          ].map((c, i) => (
            <Reveal key={c.before} delay={i * 120}>
              <div className="h-full overflow-hidden rounded-xl border bg-card shadow-[var(--shadow-card)]">
                <div className="bg-destructive/5 p-5">
                  <p className="text-xs font-semibold uppercase tracking-wide text-destructive">Hoje</p>
                  <p className="mt-1 font-medium">{c.before}</p>
                </div>
                <div className="p-5">
                  <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-primary"><c.icon className="h-3.5 w-3.5" /> Com o AgroIntel</p>
                  <p className="mt-1 font-medium">{c.after}</p>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      <Modules />

      <section className="border-y bg-secondary/40">
        <div className="container mx-auto px-6 py-16 md:py-24">
          <Reveal className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold md:text-4xl">Lançar leva segundos</h2>
            <p className="mt-3 text-muted-foreground">O app foi feito para o produtor no celular, no meio do trabalho.</p>
          </Reveal>
          <div className="mt-10 grid gap-8 md:grid-cols-3">
            {[
              { img: "voz", h: 610, n: "1", t: "Fale", d: "“Diesel 450 reais ontem.” O app entende o valor, a data e a categoria.", alt: "Tela de lançar custo por voz" },
              { img: "foto", h: 700, n: "2", t: "Fotografe", d: "Tire foto do caderno ou da nota. Você confere e salva.", alt: "Tela de foto do caderno" },
              { img: "custos", h: 562, n: "3", t: "Veja o resultado", d: "Custos por talhão ou por lote, lucro por hectare, alertas.", alt: "Tela de custos" },
            ].map((st, i) => (
              <Reveal key={st.n} delay={i * 120} className="text-center">
                <PhoneFrame src={`/lp/${st.img}-400.webp`} alt={st.alt} w={400} h={st.h} />
                <h3 className="mt-5 text-lg font-semibold"><span className="mr-2 inline-grid h-7 w-7 place-items-center rounded-full bg-primary text-sm text-primary-foreground">{st.n}</span>{st.t}</h3>
                <p className="mx-auto mt-2 max-w-xs text-sm text-muted-foreground">{st.d}</p>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section className="container mx-auto px-6 py-16 md:py-24">
        <div className="grid items-center gap-8 md:grid-cols-2">
          <Reveal>
            <span className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-xs font-medium text-primary"><Bot className="h-3.5 w-3.5" /> Consultor de IA</span>
            <h2 className="mt-4 text-3xl font-bold md:text-4xl">Pergunte, em vez de procurar</h2>
            <p className="mt-3 text-muted-foreground">
              “Se a soja cair 10%, quanto eu perco?” “Qual talhão dá prejuízo?” A IA responde com os números da sua fazenda, não com respostas genéricas.
            </p>
          </Reveal>
          <Reveal delay={150}>
            <div className="overflow-hidden rounded-xl border bg-card shadow-[var(--shadow-card)]">
              <img src="/lp/consultor.webp" alt="Consultor de IA respondendo com os dados da fazenda" width={1000} height={466} loading="lazy" className="w-full" />
            </div>
          </Reveal>
        </div>
      </section>

      <section className="container mx-auto px-6 pb-16 md:pb-24">
        <div className="grid gap-10 md:grid-cols-2">
          <Reveal>
            <h2 className="flex items-center gap-2 text-2xl font-bold"><ShieldCheck className="h-6 w-6 text-primary" /> Seus dados são seus</h2>
            <p className="mt-3 text-muted-foreground">
              Cada conta enxerga somente os próprios dados. Você pode exportar tudo e excluir a conta quando quiser, direto em Configurações.
              Veja como tratamos cada dado na <Link to="/privacidade" className="text-primary underline">política de privacidade</Link>.
            </p>
          </Reveal>
          <Reveal delay={120}>
            <h2 className="text-2xl font-bold">Perguntas frequentes</h2>
            <div className="mt-3 divide-y rounded-xl border bg-card">
              {[
                ["Serve para quem só cria gado?", "Sim. Você escolhe o que faz: plantio, pecuária ou os dois (ILP), e o app mostra só o que importa para você."],
                ["Quais culturas posso lançar?", "Soja, milho, trigo e outras culturas. O cadastro é por talhão, com cultura e safra."],
                ["Tenho mais de uma fazenda. E agora?", "Cadastre todas e escolha qual ver no topo da tela, ou veja todas somadas."],
                ["Posso testar antes de assinar?", "Sim, o teste grátis dura 7 dias a partir da criação da conta."],
                ["Dá para apagar meus dados?", "Dá. Em Configurações você exporta tudo e exclui a conta."],
              ].map(([q, a]) => (
                <details key={q} className="group p-4">
                  <summary className="cursor-pointer list-none font-medium marker:hidden">{q}</summary>
                  <p className="mt-2 text-sm text-muted-foreground">{a}</p>
                </details>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      <section className="border-t bg-secondary/40">
        <div className="container mx-auto px-6 py-16 text-center">
          <Reveal>
            <h2 className="text-3xl font-bold">Pronto para ver os números da sua fazenda?</h2>
            <p className="mt-3 text-muted-foreground">Crie sua conta e comece pelo que você faz: plantio, pecuária ou os dois.</p>
            <Button asChild size="lg" className="mt-6 h-12 px-6"><Link to="/auth">Começar agora</Link></Button>
            <p className="mt-3 text-sm text-muted-foreground">Teste grátis de 7 dias ao criar a conta.</p>
          </Reveal>
        </div>
      </section>

      <footer className="border-t">
        <div className="container mx-auto flex flex-col items-center justify-between gap-2 px-6 py-6 text-sm text-muted-foreground md:flex-row">
          <span>© {new Date().getFullYear()} AgroIntel AI</span>
          <nav className="flex gap-4">
            <Link to="/privacidade" className="hover:text-foreground">Privacidade</Link>
            <Link to="/termos" className="hover:text-foreground">Termos de uso</Link>
            <a href={`mailto:${PRIVACY_CONTACT}`} className="hover:text-foreground">Contato</a>
          </nav>
          <span>Feito para o campo brasileiro 🌱</span>
        </div>
      </footer>
    </div>
  );
}

function PhoneFrame({ src, alt, w, h }: { src: string; alt: string; w: number; h: number }) {
  return (
    <div className="mx-auto h-[360px] w-[200px] overflow-hidden rounded-[1.6rem] border-4 border-foreground/80 bg-card shadow-[var(--shadow-card)]">
      <img src={src} alt={alt} width={w} height={h} loading="lazy" className="w-full object-cover object-top" />
    </div>
  );
}

const MODULES = {
  lavoura: {
    label: "Lavoura", icon: Sprout,
    title: "Quanto cada talhão dá de lucro?",
    items: ["Custos lançados por talhão e categoria (ou divididos pela área)", "Receita estimada e lucro por hectare em tempo real", "Alertas quando um talhão gasta acima da média", "Simulador: e se o preço da soja cair?"],
    img: { src: "/lp/dash.webp", alt: "Dashboard com custo total, receita e lucro por hectare", w: 1100, h: 504, phone: false },
  },
  pecuaria: {
    label: "Pecuária", icon: Beef,
    title: "Esse lote deu lucro? Qual o preço mínimo da arroba?",
    items: ["Resultado por lote: custo por cabeça, vendido e margem", "Estoque por idade e sexo, nascimentos e cuidado na cobertura", "Fotos da compra do lote, para lembrar como o gado chegou", "Plantio e gado na mesma fazenda (ILP), com seletor de fazenda"],
    img: { src: "/lp/lote.webp", alt: "Lote de gado com investido, custo por cabeça e resultado", w: 640, h: 739, phone: true },
  },
} as const;

function Modules() {
  const [tab, setTab] = useState<keyof typeof MODULES>("lavoura");
  const m = MODULES[tab];
  return (
    <section className="container mx-auto px-6 pb-16 md:pb-24">
      <Reveal className="mx-auto max-w-2xl text-center">
        <h2 className="text-3xl font-bold md:text-4xl">Lavoura e pecuária, do mesmo jeito</h2>
        <p className="mt-3 text-muted-foreground">Plante, crie gado ou faça os dois. O app se ajusta ao que você faz.</p>
        <div role="tablist" className="mt-6 inline-flex rounded-full border bg-card p-1">
          {(Object.keys(MODULES) as (keyof typeof MODULES)[]).map((k) => {
            const Icon = MODULES[k].icon;
            return (
              <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
                className={`flex items-center gap-1.5 rounded-full px-5 py-2 text-sm font-medium transition-colors ${tab === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                <Icon className="h-4 w-4" /> {MODULES[k].label}
              </button>
            );
          })}
        </div>
      </Reveal>
      <div key={tab} className="mt-10 grid animate-in fade-in items-center gap-8 duration-500 md:grid-cols-2">
        <div>
          <h3 className="text-2xl font-semibold">{m.title}</h3>
          <ul className="mt-5 space-y-3">
            {m.items.map((it) => (
              <li key={it} className="flex gap-3 text-sm md:text-base">
                <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-primary/10 text-primary"><Check className="h-3.5 w-3.5" /></span>
                {it}
              </li>
            ))}
          </ul>
        </div>
        <div className="flex justify-center">
          {m.img.phone ? (
            <div className="w-[260px] overflow-hidden rounded-[1.6rem] border-4 border-foreground/80 bg-card shadow-[var(--shadow-card)]">
              <img src={m.img.src} alt={m.img.alt} width={m.img.w} height={m.img.h} className="w-full" />
            </div>
          ) : (
            <div className="w-full overflow-hidden rounded-xl border bg-card shadow-[var(--shadow-card)]">
              <img src={m.img.src} alt={m.img.alt} width={m.img.w} height={m.img.h} className="w-full" />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
