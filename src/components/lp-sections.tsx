import { Bot, Check, Download, Lock, Trash2, TriangleAlert, User, X } from "lucide-react";

/** Painel de exemplo montado em HTML: legível no celular e quase sem peso (no lugar de um print). */
export function DashboardPanel() {
  const bars = [
    { name: "Talhão 1 · soja", v: 82000, w: 100 },
    { name: "Talhão 2 · milho", v: 61500, w: 75 },
    { name: "Talhão 3 · trigo", v: 25300, w: 31 },
    { name: "Talhão 4 · soja", v: -4500, w: 6 },
  ];
  const brl = (n: number) => `${n < 0 ? "−" : ""}R$ ${Math.abs(n).toLocaleString("pt-BR")}`;
  return (
    <div className="w-full">
    <div className="w-full rounded-2xl border bg-card p-4 text-left [font-variant-numeric:tabular-nums] shadow-[var(--shadow-card)] sm:p-5">
      <div className="flex items-center justify-between text-xs">
        <span><span className="block font-semibold text-foreground">Fazenda Boa Vista</span><span className="whitespace-nowrap text-muted-foreground">Safra 25/26 · 120 ha</span></span>
        <span className="hidden rounded-full bg-muted px-2 py-0.5 text-muted-foreground sm:inline">Exemplo com dados fictícios</span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3">
        {[
          ["Custo total", "R$ 148.200"],
          ["Receita estimada", "R$ 312.500"],
          ["Lucro", "R$ 164.300"],
          ["Lucro por hectare", "R$ 1.370"],
        ].map(([l, v]) => (
          <div key={l} className="rounded-lg bg-secondary/60 p-3">
            <p className="text-[11px] text-muted-foreground sm:text-xs">{l}</p>
            <p className="mt-0.5 font-display text-base font-bold text-foreground sm:text-lg">{v}</p>
          </div>
        ))}
      </div>
      <p className="mt-5 text-xs font-semibold text-foreground">Lucro por talhão</p>
      <ul className="mt-2 space-y-2">
        {bars.map((b) => (
          <li key={b.name}>
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">{b.name}</span>
              <span className={b.v < 0 ? "font-semibold text-[#b91c1c]" : "font-medium text-foreground"}>{brl(b.v)}</span>
            </div>
            <div className="mt-1 h-2.5 rounded-full bg-muted">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${b.w}%`,
                  background: b.v < 0
                    ? "repeating-linear-gradient(45deg, #b91c1c 0 4px, #fca5a5 4px 8px)"
                    : "oklch(0.52 0.14 145)",
                }}
              />
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-300/60 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
        <span>Talhão 4 gastou 18% acima da média dos outros talhões.</span>
      </div>
    </div>
    <p className="mt-2 text-center text-xs text-muted-foreground sm:hidden">Exemplo com dados fictícios.</p>
    </div>
  );
}

/** "Hoje" x "Com o AgroIntel", lado a lado, em cinza e verde (sem vermelho, que lembra erro). */
export function BeforeAfter({ rows }: { rows: { before: string; after: string }[] }) {
  return (
    <div className="space-y-4">
      {rows.map((r) => (
        <div key={r.before} className="grid overflow-hidden rounded-xl border bg-card md:grid-cols-2">
          <div className="flex gap-3 bg-muted/60 p-5">
            <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-background text-muted-foreground"><X className="h-3.5 w-3.5" /></span>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Hoje</p>
              <p className="mt-1 font-medium">{r.before}</p>
            </div>
          </div>
          <div className="flex gap-3 bg-primary/5 p-5">
            <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground"><Check className="h-3.5 w-3.5" /></span>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-primary">Com o AgroIntel</p>
              <p className="mt-1 font-medium">{r.after}</p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Conversa de exemplo com o consultor de IA, em HTML (legível em qualquer tela). */
export function AiChat() {
  return (
    <div className="rounded-2xl border bg-card p-4 shadow-[var(--shadow-card)] sm:p-5">
      <div className="flex items-center justify-between text-xs">
        <span className="flex items-center gap-1.5 font-semibold"><Bot className="h-4 w-4 text-primary" /> Consultor de IA</span>
        <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground">Exemplo com dados fictícios</span>
      </div>
      <div className="mt-4 flex justify-end">
        <p className="flex max-w-[85%] items-start gap-2 rounded-2xl rounded-br-sm bg-primary px-4 py-2.5 text-sm text-primary-foreground">
          <User className="mt-0.5 h-4 w-4 shrink-0" /> Se a soja cair 10%, quanto eu perco?
        </p>
      </div>
      <div className="mt-3 max-w-[92%] rounded-2xl rounded-bl-sm bg-secondary/70 p-4 text-sm">
        <p>Com a soja 10% mais barata, a receita estimada cai <b>R$ 18.400</b> e o lucro da fazenda diminui. O Talhão 4 continua no prejuízo.</p>
        <table className="mt-3 w-full text-xs">
          <thead><tr className="text-left text-muted-foreground"><th className="pb-1 font-medium">Cenário</th><th className="pb-1 text-right font-medium">Lucro</th></tr></thead>
          <tbody>
            <tr className="border-t"><td className="py-1.5">Preço de hoje</td><td className="py-1.5 text-right font-medium">R$ 164.300</td></tr>
            <tr className="border-t"><td className="py-1.5">Soja −10%</td><td className="py-1.5 text-right font-medium">R$ 145.900</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function TrustCards() {
  const items = [
    { icon: Lock, t: "Só você vê", d: "Cada conta enxerga somente os próprios dados." },
    { icon: Download, t: "Exporta tudo", d: "Baixe todos os seus dados quando quiser, em Configurações." },
    { icon: Trash2, t: "Apaga quando quiser", d: "Exclua a conta e os dados da fazenda direto no app." },
  ];
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {items.map((i) => (
        <div key={i.t} className="rounded-xl border bg-card p-5">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-primary/10 text-primary"><i.icon className="h-5 w-5" /></span>
          <h3 className="mt-3 font-semibold">{i.t}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{i.d}</p>
        </div>
      ))}
    </div>
  );
}
