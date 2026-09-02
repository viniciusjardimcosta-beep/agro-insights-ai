import { useEffect, useRef, useState } from "react";
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
import { logClientAuditEvent } from "@/lib/audit.functions";
import { captureError } from "@/lib/monitoring";
import { ERROR_CODES, toUserMessage } from "@/lib/errors";

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
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function run() {
    if (busy) return;
    setBusy(true);
    const correlationId = crypto.randomUUID();
    const startedAt = Date.now();
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

      // Producer identity comes from the profile name only — never the e-mail.
      let producerName: string | null = null;
      const uid = userData?.user?.id;
      if (uid) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("name")
          .eq("id", uid)
          .maybeSingle();
        producerName = (profile?.name ?? "").trim() || null;
      }

      generateExecutiveReport({
        properties: snap.properties ?? [],
        fields: snap.fields ?? [],
        costs: snap.costs ?? [],
        prices: snap.prices ?? [],
        latestDiagnostic: (latest as never) ?? null,
        scenarios: (scenarios as SimulatedScenarioRow[]) ?? [],
        producerName,
      });
      void logClientAuditEvent({
        data: {
          eventType: "executive_report_generated",
          source: "relatorio",
          correlationId,
          metadata: { duration_ms: Date.now() - startedAt },
        },
      }).catch(() => {});
      toast.success("Relatório gerado!");
    } catch (e) {
      captureError(e, {
        errorCode: ERROR_CODES.REPORT_FAILED,
        route: "/relatorios",
        correlationId,
        source: "relatorio",
      });
      void logClientAuditEvent({
        data: {
          eventType: "executive_report_failed",
          status: "failure",
          source: "relatorio",
          correlationId,
          metadata: { error_code: ERROR_CODES.REPORT_FAILED, duration_ms: Date.now() - startedAt },
        },
      }).catch(() => {});
      toast.error("Erro ao gerar relatório", { description: toUserMessage(e) });
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <Button onClick={run} disabled={busy} size={size} variant={variant} className={className}>
      {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileDown className="mr-2 h-4 w-4" />}
      {busy ? "Gerando..." : "Gerar Relatório Executivo"}
    </Button>
  );
}