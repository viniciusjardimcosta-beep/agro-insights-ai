import { createFileRoute, Link } from "@tanstack/react-router";
import { LEGAL_DISCLAIMER, PRIVACY_CONTACT, TERMS_VERSION } from "@/lib/privacy";

export const Route = createFileRoute("/termos")({
  head: () => ({
    meta: [
      { title: "Termos de Uso — AgroIntel AI" },
      {
        name: "description",
        content: "Regras de uso do AgroIntel AI: conta, responsabilidades, limites do serviço e encerramento.",
      },
      { property: "og:title", content: "Termos de Uso — AgroIntel AI" },
      { property: "og:description", content: "Condições de uso da plataforma AgroIntel AI." },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TermsPage,
});

function TermsPage() {
  return (
    <main className="mx-auto max-w-3xl space-y-6 px-6 py-16">
      <p className="text-sm text-muted-foreground">
        <Link to="/" className="underline">
          Voltar ao início
        </Link>
      </p>
      <h1 className="text-3xl font-bold">Termos de Uso</h1>
      <p className="text-sm text-muted-foreground">
        Versão {TERMS_VERSION} — documento base, em linguagem clara, sujeito a revisão jurídica.
      </p>

      <section className="space-y-2">
        <h2 className="text-xl font-semibold">O serviço</h2>
        <p className="text-muted-foreground">
          O AgroIntel AI é uma ferramenta de gestão e análise financeira rural. Os cálculos partem exclusivamente dos
          dados que você cadastra: informações incompletas ou incorretas produzem resultados incorretos.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-xl font-semibold">Sua conta</h2>
        <ul className="list-disc space-y-1 pl-6 text-muted-foreground">
          <li>Você é responsável pela veracidade dos dados cadastrados e pelo sigilo da sua senha.</li>
          <li>Cada conta acessa apenas os próprios dados.</li>
          <li>Você pode exportar seus dados ou excluir a conta a qualquer momento, em Configurações.</li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-xl font-semibold">Uso aceitável</h2>
        <p className="text-muted-foreground">
          É vedado tentar acessar dados de terceiros, contornar limites de uso, automatizar chamadas em volume abusivo
          ou usar a plataforma para fins ilícitos. Existem limites de uso do Consultor IA e do Diagnóstico para
          proteger o serviço.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-xl font-semibold">Limitação de responsabilidade</h2>
        <p className="text-muted-foreground">
          O serviço é fornecido no estado em que se encontra. Não garantimos resultados financeiros nem a exatidão de
          análises geradas por inteligência artificial.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-xl font-semibold">Alterações e contato</h2>
        <p className="text-muted-foreground">
          Estes termos podem ser atualizados; versões novas podem exigir novo aceite. Contato: {PRIVACY_CONTACT}
        </p>
      </section>

      <p className="rounded-lg border bg-muted/40 p-4 text-sm text-muted-foreground">{LEGAL_DISCLAIMER}</p>
    </main>
  );
}
