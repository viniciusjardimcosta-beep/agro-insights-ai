import { createFileRoute, Link } from "@tanstack/react-router";
import { LEGAL_DISCLAIMER, PRIVACY_CONTACT, PRIVACY_VERSION } from "@/lib/privacy";

export const Route = createFileRoute("/privacidade")({
  head: () => ({
    meta: [
      { title: "Política de Privacidade — AgroIntel AI" },
      {
        name: "description",
        content:
          "Como o AgroIntel AI coleta, usa, retém, exporta e exclui os dados da sua propriedade rural.",
      },
      { property: "og:title", content: "Política de Privacidade — AgroIntel AI" },
      { property: "og:description", content: "Coleta, uso de IA, retenção, exportação e exclusão de dados." },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl space-y-6 px-6 py-16">
      <p className="text-sm text-muted-foreground">
        <Link to="/" className="underline">
          Voltar ao início
        </Link>
      </p>
      <h1 className="text-3xl font-bold">Política de Privacidade</h1>
      <p className="text-sm text-muted-foreground">
        Versão {PRIVACY_VERSION} — documento base, em linguagem clara, sujeito a revisão jurídica.
      </p>

      <section className="space-y-2">
        <h2 className="text-xl font-semibold">Quais dados coletamos</h2>
        <ul className="list-disc space-y-1 pl-6 text-muted-foreground">
          <li>Cadastro: nome e e-mail.</li>
          <li>Dados da fazenda: propriedades, talhões, culturas, áreas, custos, preços e produtividade.</li>
          <li>Resultados gerados: diagnósticos, cenários simulados e alertas.</li>
          <li>Conversas com o Consultor IA.</li>
          <li>Registros técnicos de uso e auditoria (sem conteúdo financeiro ou mensagens).</li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-xl font-semibold">Por que utilizamos</h2>
        <p className="text-muted-foreground">
          Para calcular lucro por hectare, gerar diagnósticos e alertas, permitir simulações, emitir relatórios e
          manter a segurança e a estabilidade do serviço (prevenção de abuso e investigação de incidentes).
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-xl font-semibold">Uso de inteligência artificial externa</h2>
        <p className="text-muted-foreground">
          O Consultor IA e o Diagnóstico enviam um resumo dos dados da sua fazenda a um provedor de modelos de
          linguagem para gerar a resposta. Não enviamos senhas, tokens nem dados de outros usuários. As respostas são
          geradas automaticamente e podem conter imprecisões.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-xl font-semibold">Retenção</h2>
        <p className="text-muted-foreground">
          Os dados da conta são mantidos enquanto a conta estiver ativa. Registros de uso têm retenção curta e
          operacional; registros de auditoria têm retenção sugerida de 90 dias. Detalhes em nossa política interna de
          retenção de dados.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-xl font-semibold">Exportação e exclusão</h2>
        <p className="text-muted-foreground">
          Em Configurações você pode exportar todos os seus dados em JSON e excluir sua conta. A exclusão remove
          permanentemente seus dados pessoais e da fazenda; registros técnicos de auditoria permanecem anonimizados,
          sem vínculo com você.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-xl font-semibold">Contato</h2>
        <p className="text-muted-foreground">Dúvidas sobre privacidade: {PRIVACY_CONTACT}</p>
      </section>

      <p className="rounded-lg border bg-muted/40 p-4 text-sm text-muted-foreground">{LEGAL_DISCLAIMER}</p>
    </main>
  );
}
