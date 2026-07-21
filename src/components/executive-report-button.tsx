import { useState } from "react";
import { FileDown, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { getFarmSnapshot } from "@/lib/data.functions";
import { latestDiagnostic } from "@/lib/diagnostics.functions";
import { listScenarios, type SimulatedScenarioRow } from "@/lib/scenarios.functions";
import { generateExecutiveReport } from "@/lib/report";
import type { CostRow, FieldRow, PriceRow } from "@/lib/calc";

type Props = {
  size?: "sm" | "default" | "lg";
  variant?: "default" | "outline" | "secondary";
  className?: string;
};

export function ExecutiveReportButton({ size = "default", variant = "outline", className }: Props) {
  const qc = useQueryClient();
  const getSnapshot = useServerFn(getFarmSnapshot);
  const getLatest = useServerFn(latestDiagnostic);
  const getScenarios = useServerFn(listScenarios);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      // Prefer cached data — avoid duplicate queries.
      const [snapshot, latest, scenarios, { data: userData }] = await Promise.all([
        qc.ensureQueryData({ queryKey: ["farm-snapshot"], queryFn: () => getSnapshot() }),
        qc.ensureQueryData({ queryKey: ["latest-diagnostic"], queryFn: () => getLatest() }),
        qc.ensureQueryData({ queryKey: ["scenarios"], queryFn: () => getScenarios() }),
        supabase.auth.getUser(),
      ]);

      const snap = snapshot as {
        properties: { name?: string; city?: string; state?: string; total_area?: number }[];
        fields: FieldRow[];
        costs: CostRow[];
        prices: PriceRow[];
      };

      if (!snap.fields || snap.fields.length === 0) {
        toast.error("Cadastre talhões, custos e preços antes de gerar o relatório.");
        return;
      }

      generateExecutiveReport({
        properties: snap.properties ?? [],
        fields: snap.fields ?? [],
        costs: snap.costs ?? [],
        prices: snap.prices ?? [],
        latestDiagnostic: (latest as never) ?? null,
        scenarios: (scenarios as SimulatedScenarioRow[]) ?? [],
        producerName:
          (userData?.user?.user_metadata?.full_name as string | undefined) ||
          userData?.user?.email ||
          null,
      });
      toast.success("Relatório gerado!");
    } catch (e) {
      toast.error("Erro ao gerar relatório", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button onClick={run} disabled={busy} size={size} variant={variant} className={className}>
      {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileDown className="mr-2 h-4 w-4" />}
      {busy ? "Gerando..." : "Gerar Relatório Executivo"}
    </Button>
  );
}