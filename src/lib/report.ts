// Client-only Executive Report generator (jsPDF vector output).
// Reads only from data already loaded by React Query — no extra fetches,
// no recalculations of scores or metrics. All numbers come from
// aggregateFarm / DiagnosticReport / SimulatedScenarioRow already computed
// upstream.
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { BRL, NUM, aggregateFarm, type CostRow, type FieldRow, type PriceRow } from "@/lib/calc";
import type { DiagnosticReport } from "@/lib/diagnostics.functions";
import type { SimulatedScenarioRow } from "@/lib/scenarios.functions";

export const REPORT_VERSION = "1.0";

type PropertyRow = {
  name?: string | null;
  city?: string | null;
  state?: string | null;
  total_area?: number | null;
};

type DiagnosticRow = {
  id: string;
  created_at: string;
  health_score: number;
  report: DiagnosticReport | unknown;
};

export type ExecutiveReportInput = {
  properties: PropertyRow[];
  fields: FieldRow[];
  costs: CostRow[];
  prices: PriceRow[];
  latestDiagnostic?: DiagnosticRow | null;
  scenarios?: SimulatedScenarioRow[];
  producerName?: string | null;
};

// -------------------- helpers --------------------
const PRIMARY: [number, number, number] = [22, 101, 52];       // deep green
const ACCENT: [number, number, number] = [132, 204, 22];       // lime
const MUTED: [number, number, number] = [107, 114, 128];
const DARK: [number, number, number] = [17, 24, 39];
const WARN: [number, number, number] = [217, 119, 6];
const DANGER: [number, number, number] = [185, 28, 28];
const LIGHT: [number, number, number] = [243, 244, 246];

function classify(score: number): { label: string; color: [number, number, number] } {
  if (score >= 85) return { label: "EXCELENTE", color: PRIMARY };
  if (score >= 70) return { label: "BOA", color: ACCENT };
  if (score >= 50) return { label: "ATENÇÃO", color: WARN };
  return { label: "CRÍTICA", color: DANGER };
}

function slug(s: string) {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    || "propriedade";
}

// -------------------- main --------------------
export function generateExecutiveReport(input: ExecutiveReportInput): void {
  const doc = new jsPDF({ unit: "pt", format: "a4", compress: true });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 40;

  const property = input.properties[0] ?? {};
  const propertyName = property.name || "Propriedade sem nome";
  const propertyLoc =
    [property.city, property.state].filter(Boolean).join(" / ") || "-";
  const producer = (input.producerName ?? "").trim() || "Produtor não informado";
  const now = new Date();
  const dateLabel = now.toLocaleDateString("pt-BR");
  const dateTimeLabel = now.toLocaleString("pt-BR");

  const farm = aggregateFarm(input.fields, input.costs, input.prices);
  const margin_pct =
    farm.totalRevenue > 0 ? (farm.totalProfit / farm.totalRevenue) * 100 : 0;

  const diag = input.latestDiagnostic ?? null;
  const report = (diag?.report as DiagnosticReport | undefined) ?? null;
  const score = diag?.health_score ?? 0;
  const cls = classify(score);

  // Best scenario: highest simulated_score → tie-break by profit → by net margin.
  const scenarios = input.scenarios ?? [];
  const snapNum = (s: SimulatedScenarioRow, k: string) => {
    const m = (s.metrics_snapshot as unknown as Record<string, unknown>) || {};
    const v = Number(m[k]);
    return Number.isFinite(v) ? v : 0;
  };
  const bestScenario =
    scenarios.length > 0
      ? [...scenarios].sort(
          (a, b) =>
            b.simulated_score - a.simulated_score ||
            snapNum(b, "profit") - snapNum(a, "profit") ||
            snapNum(b, "margin") - snapNum(a, "margin"),
        )[0]
      : null;

  // -------- COVER --------
  drawCover({
    doc,
    pageW,
    pageH,
    propertyName,
    propertyLoc,
    producer,
    dateLabel,
    score: diag ? score : null,
    cls: diag ? cls : null,
  });

  // -------- Header/footer applied to remaining pages --------
  const addPage = () => {
    doc.addPage();
  };
  // Starts a fresh content page with header chrome and returns the initial y.
  const newContentPage = () => {
    addPage();
    drawPageChrome(doc, pageW, pageH, margin, propertyName, dateLabel);
    return 90;
  };
  const BOTTOM = pageH - 60;
  // Ensures `needed` vertical points are available, breaking the page if not.
  const ensure = (y: number, needed: number) => (y + needed > BOTTOM ? newContentPage() : y);

  // Page 2 — Resumo Executivo
  addPage();
  drawPageChrome(doc, pageW, pageH, margin, propertyName, dateLabel);
  let y = 90;
  y = drawH1(doc, "Resumo Executivo", margin, y);

  const topCrop = report?.metrics?.topCrop || report?.indicators?.mostProfitableCrop || "-";
  const topRisk = report?.risks?.[0] || "-";
  const topOpp = report?.opportunities?.[0] || "-";

  const summary: [string, string][] = [
    ["Receita total", BRL.format(farm.totalRevenue)],
    ["Custos totais", BRL.format(farm.totalCost)],
    ["Lucro", BRL.format(farm.totalProfit)],
    ["Margem líquida", `${margin_pct.toFixed(1)}%`],
    ["Lucro por hectare", BRL.format(farm.profitPerHa)],
    ["Área cultivada", `${NUM.format(farm.totalArea)} ha`],
    ["Número de talhões", String(input.fields.length)],
    ["Maior cultura (receita)", topCrop],
  ];
  y = drawKpiGrid(doc, summary, margin, y, pageW - margin * 2);

  y += 12;
  y = drawLabelBlock(doc, "Maior risco identificado", topRisk, margin, y, pageW - margin * 2, DANGER);
  y = drawLabelBlock(doc, "Maior oportunidade", topOpp, margin, y, pageW - margin * 2, PRIMARY);

  // Page 3 — Diagnóstico Financeiro
  addPage();
  drawPageChrome(doc, pageW, pageH, margin, propertyName, dateLabel);
  y = 90;
  y = drawH1(doc, "Diagnóstico Financeiro", margin, y);

  if (!report) {
    doc.setTextColor(...MUTED);
    doc.setFontSize(11);
    doc.text(
      "Nenhum diagnóstico gerado ainda. Gere um diagnóstico na tela Diagnóstico para incluí-lo aqui.",
      margin,
      y + 10,
      { maxWidth: pageW - margin * 2 },
    );
  } else {
    // Score panel
    doc.setFillColor(...LIGHT);
    doc.roundedRect(margin, y, pageW - margin * 2, 70, 6, 6, "F");
    doc.setTextColor(...cls.color);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(36);
    doc.text(String(score), margin + 20, y + 48);
    doc.setFontSize(10);
    doc.setTextColor(...MUTED);
    doc.setFont("helvetica", "normal");
    doc.text("de 100", margin + 90, y + 30);
    doc.setTextColor(...cls.color);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text(cls.label, margin + 90, y + 48);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(...DARK);
    doc.text(report.scoreReason || "", margin + 200, y + 30, {
      maxWidth: pageW - margin * 2 - 220,
    });
    y += 90;

    // Composição da nota
    const bd = Array.isArray(report.scoreBreakdown) ? report.scoreBreakdown : [];
    const penalties = bd.filter((b) => b.points < 0);
    const bonuses = bd.filter((b) => b.points > 0);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(...DARK);
    doc.text("Composição da Nota", margin, y);
    y += 6;

    autoTable(doc, {
      startY: y + 4,
      head: [["Fator", "Pontos"]],
      body: bd.map((b) => [b.label, (b.points > 0 ? "+" : "") + String(b.points)]),
      styles: { fontSize: 9, cellPadding: 4, textColor: DARK, lineColor: [229, 231, 235] },
      headStyles: { fillColor: PRIMARY, textColor: [255, 255, 255], fontStyle: "bold" },
      columnStyles: { 1: { halign: "right", cellWidth: 60 } },
      margin: { left: margin, right: margin },
      didParseCell: (data) => {
        if (data.section === "body" && data.column.index === 1) {
          const raw = String(data.cell.raw ?? "");
          const n = Number(raw);
          if (n > 0) data.cell.styles.textColor = PRIMARY;
          else if (n < 0) data.cell.styles.textColor = DANGER;
        }
      },
    });
    y = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 18;

    const fullW = pageW - margin * 2;
    const half = (fullW - 16) / 2;
    const penaltyItems = penalties.map((p) => `${p.label} (${p.points})`);
    const bonusItems = bonuses.map((p) => `${p.label} (+${p.points})`);

    // Side-by-side only when both columns are short enough to fit together.
    const penH = measureList(doc, penaltyItems, half);
    const bonH = measureList(doc, bonusItems, half);
    const sideBySide =
      Math.max(penH, bonH) <= 180 && y + Math.max(penH, bonH) <= BOTTOM;

    if (sideBySide) {
      y = ensure(y, Math.max(penH, bonH));
      drawList(doc, "Penalidades", penaltyItems, margin, y, half, DANGER);
      drawList(doc, "Bônus", bonusItems, margin + half + 16, y, half, PRIMARY);
      y += Math.max(penH, bonH) + 18;
    } else {
      const sections: [string, string[], [number, number, number]][] = [
        ["Penalidades", penaltyItems, DANGER],
        ["Bônus", bonusItems, PRIMARY],
      ];
      for (const [title, items, color] of sections) {
        const h = measureList(doc, items, fullW);
        y = ensure(y, Math.min(h, BOTTOM - 90));
        y = drawList(doc, title, items, margin, y, fullW, color) + 18;
      }
    }

    const blocks: [string, string[], [number, number, number]][] = [
      ["Riscos", report.risks ?? [], DANGER],
      ["Oportunidades", report.opportunities ?? [], PRIMARY],
      ["Plano de ação", report.actionPlan ?? [], DARK],
    ];
    for (const [title, items, color] of blocks) {
      const h = measureList(doc, items, fullW);
      y = ensure(y, Math.min(h, BOTTOM - 90));
      y = drawList(doc, title, items, margin, y, fullW, color) + 18;
    }
  }

  // Page 4 — Indicadores Visuais (charts as vector bars)
  addPage();
  drawPageChrome(doc, pageW, pageH, margin, propertyName, dateLabel);
  y = 90;
  y = drawH1(doc, "Indicadores Visuais", margin, y);

  // Cost by category
  const costByCat: Record<string, number> = {};
  for (const c of input.costs) {
    costByCat[c.category] = (costByCat[c.category] ?? 0) + Number(c.amount || 0);
  }
  const costCatEntries = Object.entries(costByCat).sort((a, b) => b[1] - a[1]);

  y = drawBarChart(doc, "Custo por categoria (R$)", costCatEntries.map(([k, v]) => ({ label: k, value: v })), margin, y, pageW - margin * 2, 160, PRIMARY, (v) => BRL.format(v));

  // Lucro por talhão
  const profitPerField = farm.perField.map((f) => ({ label: f.field.name, value: f.profit }));
  y = drawBarChart(doc, "Lucro por talhão (R$)", profitPerField, margin, y, pageW - margin * 2, 160, PRIMARY, (v) => BRL.format(v), true);

  if (y > pageH - 180) {
    addPage();
    drawPageChrome(doc, pageW, pageH, margin, propertyName, dateLabel);
    y = 90;
  }

  // Margem por talhão (%)
  const marginPerField = farm.perField.map((f) => ({
    label: f.field.name,
    value: f.revenue > 0 ? (f.profit / f.revenue) * 100 : 0,
  }));
  y = drawBarChart(doc, "Margem por talhão (%)", marginPerField, margin, y, pageW - margin * 2, 160, ACCENT, (v) => `${v.toFixed(1)}%`, true);

  // Rentabilidade (lucro/ha)
  const rentPerField = farm.perField.map((f) => ({ label: f.field.name, value: f.profitPerHa }));
  y = drawBarChart(doc, "Rentabilidade — Lucro por hectare (R$/ha)", rentPerField, margin, y, pageW - margin * 2, 160, PRIMARY, (v) => BRL.format(v), true);

  // Page 5 — Comparação de Cenários
  addPage();
  drawPageChrome(doc, pageW, pageH, margin, propertyName, dateLabel);
  y = 90;
  y = drawH1(doc, "Comparação de Cenários", margin, y);

  if (!bestScenario) {
    doc.setTextColor(...MUTED);
    doc.setFontSize(11);
    doc.text("Nenhum cenário salvo para comparação.", margin, y + 10);
  } else {
    const bm = (bestScenario.metrics_snapshot as unknown as {
      revenue?: number; costs?: number; profit?: number; margin?: number;
    }) || {};
    const bestRev = Number(bm.revenue ?? 0);
    const bestCost = Number(bm.costs ?? 0);
    const bestProfit = Number(bm.profit ?? 0);
    const bestMargin = Number(bm.margin ?? 0);
    const bestScore = bestScenario.simulated_score;

    const rows: [string, string, string, string][] = [
      ["Receita", BRL.format(farm.totalRevenue), BRL.format(bestRev), fmtDeltaMoney(bestRev - farm.totalRevenue)],
      ["Custos", BRL.format(farm.totalCost), BRL.format(bestCost), fmtDeltaMoney(bestCost - farm.totalCost)],
      ["Lucro", BRL.format(farm.totalProfit), BRL.format(bestProfit), fmtDeltaMoney(bestProfit - farm.totalProfit)],
      ["Margem líquida", `${margin_pct.toFixed(1)}%`, `${bestMargin.toFixed(1)}%`, `${(bestMargin - margin_pct >= 0 ? "+" : "")}${(bestMargin - margin_pct).toFixed(1)} p.p.`],
      ["Nota financeira", diag ? String(score) : "-", String(bestScore), diag ? fmtDeltaPoints(bestScore - score) : "-"],
    ];

    doc.setFontSize(10);
    doc.setTextColor(...MUTED);
    doc.text(`Melhor cenário salvo: ${bestScenario.name}`, margin, y);
    y += 12;

    autoTable(doc, {
      startY: y,
      head: [["Indicador", "Atual", "Melhor cenário", "Diferença"]],
      body: rows,
      styles: { fontSize: 10, cellPadding: 6, textColor: DARK, lineColor: [229, 231, 235] },
      headStyles: { fillColor: PRIMARY, textColor: [255, 255, 255], fontStyle: "bold" },
      columnStyles: {
        1: { halign: "right" },
        2: { halign: "right" },
        3: { halign: "right", fontStyle: "bold" },
      },
      margin: { left: margin, right: margin },
    });
  }

  // Page 6 — Plano Estratégico
  addPage();
  drawPageChrome(doc, pageW, pageH, margin, propertyName, dateLabel);
  y = 90;
  y = drawH1(doc, "Plano Estratégico", margin, y);

  const priorities = derivePriorities(report, farm);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(...DARK);
  doc.text("Prioridades", margin, y);
  y += 18;

  priorities.forEach((p, i) => {
    const h = measurePriority(doc, p, pageW - margin * 2);
    y = ensure(y, h + 10);
    y = drawPriority(doc, i + 1, p, margin, y, pageW - margin * 2);
  });

  y = ensure(y + 12, 130);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(...DARK);
  doc.text("Checklist", margin, y);
  y += 4;

  const checklist = [
    "Reduzir custos",
    "Melhorar margem",
    "Revisar rentabilidade",
    "Monitorar cultura mais arriscada",
  ];
  checklist.forEach((item) => {
    y += 20;
    doc.setDrawColor(...DARK);
    doc.setLineWidth(1);
    doc.rect(margin, y - 10, 12, 12);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.setTextColor(...DARK);
    doc.text(item, margin + 20, y);
  });

  // -------- footer/page numbers on every page except cover --------
  const total = doc.getNumberOfPages();
  for (let p = 2; p <= total; p++) {
    doc.setPage(p);
    drawFooter(doc, pageW, pageH, margin, p, total, dateTimeLabel);
  }

  doc.save(`relatorio-executivo-${slug(propertyName)}.pdf`);
}

// -------------------- drawing helpers --------------------
function drawCover(args: {
  doc: jsPDF;
  pageW: number;
  pageH: number;
  propertyName: string;
  propertyLoc: string;
  producer: string;
  dateLabel: string;
  score: number | null;
  cls: { label: string; color: [number, number, number] } | null;
}) {
  const { doc, pageW, pageH, propertyName, propertyLoc, producer, dateLabel, score, cls } = args;
  // green gradient band top
  doc.setFillColor(...PRIMARY);
  doc.rect(0, 0, pageW, 220, "F");
  doc.setFillColor(...ACCENT);
  doc.rect(0, 220, pageW, 6, "F");

  // Logo mark — simple leaf circle
  doc.setFillColor(255, 255, 255);
  doc.circle(60, 70, 22, "F");
  doc.setFillColor(...ACCENT);
  doc.circle(60, 70, 12, "F");

  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text("AgroIntel AI", 100, 66);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text("Inteligência financeira rural", 100, 82);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(255, 255, 255);
  doc.text("RELATÓRIO EXECUTIVO DA PROPRIEDADE", 40, 170);

  // Info block
  doc.setTextColor(...DARK);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(28);
  doc.text(propertyName, 40, 290, { maxWidth: pageW - 80 });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(12);
  doc.setTextColor(...MUTED);
  doc.text(propertyLoc, 40, 315);

  doc.setFontSize(11);
  doc.setTextColor(...DARK);
  doc.text(`Produtor: ${producer}`, 40, 350);
  doc.text(`Data de emissão: ${dateLabel}`, 40, 370);

  // Score seal
  if (score !== null && cls) {
    const cx = pageW - 130;
    const cy = 470;
    doc.setFillColor(...cls.color);
    doc.circle(cx, cy, 70, "F");
    doc.setFillColor(255, 255, 255);
    doc.circle(cx, cy, 58, "F");
    doc.setTextColor(...cls.color);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(42);
    doc.text(String(score), cx, cy + 6, { align: "center" });
    doc.setFontSize(10);
    doc.text("/ 100", cx, cy + 24, { align: "center" });

    // ribbon
    doc.setFillColor(...cls.color);
    doc.roundedRect(cx - 70, cy + 80, 140, 26, 4, 4, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(12);
    doc.text(cls.label, cx, cy + 98, { align: "center" });

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(...MUTED);
    doc.text("Nota Financeira", cx, cy - 92, { align: "center" });
  } else {
    doc.setTextColor(...MUTED);
    doc.setFontSize(11);
    doc.text("Nota financeira: diagnóstico ainda não gerado", 40, 470);
  }

  // footer strip
  doc.setFillColor(...LIGHT);
  doc.rect(0, pageH - 40, pageW, 40, "F");
  doc.setTextColor(...MUTED);
  doc.setFontSize(9);
  doc.text("Relatório gerado automaticamente pelo AgroIntel AI", 40, pageH - 16);
  doc.text(`v${REPORT_VERSION}`, pageW - 40, pageH - 16, { align: "right" });
}

function drawPageChrome(doc: jsPDF, pageW: number, _pageH: number, margin: number, propertyName: string, dateLabel: string) {
  doc.setFillColor(...PRIMARY);
  doc.rect(0, 0, pageW, 40, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("AgroIntel AI · Relatório Executivo", margin, 26);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(`${propertyName}  ·  ${dateLabel}`, pageW - margin, 26, { align: "right" });
}

function drawFooter(doc: jsPDF, pageW: number, pageH: number, margin: number, page: number, total: number, dateTimeLabel: string) {
  doc.setDrawColor(229, 231, 235);
  doc.setLineWidth(0.5);
  doc.line(margin, pageH - 32, pageW - margin, pageH - 32);
  doc.setTextColor(...MUTED);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text(`Relatório gerado pelo AgroIntel AI · ${dateTimeLabel} · v${REPORT_VERSION}`, margin, pageH - 18);
  doc.text(`Página ${page - 1} de ${total - 1}`, pageW - margin, pageH - 18, { align: "right" });
}

function drawH1(doc: jsPDF, text: string, x: number, y: number) {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.setTextColor(...DARK);
  doc.text(text, x, y);
  doc.setDrawColor(...ACCENT);
  doc.setLineWidth(2);
  doc.line(x, y + 6, x + 60, y + 6);
  return y + 26;
}

function drawKpiGrid(doc: jsPDF, items: [string, string][], x: number, y: number, w: number) {
  const cols = 4;
  const gap = 10;
  const cardW = (w - gap * (cols - 1)) / cols;
  const cardH = 60;
  items.forEach((it, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const cx = x + col * (cardW + gap);
    const cy = y + row * (cardH + gap);
    doc.setFillColor(...LIGHT);
    doc.roundedRect(cx, cy, cardW, cardH, 4, 4, "F");
    doc.setTextColor(...MUTED);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text(it[0], cx + 10, cy + 18, { maxWidth: cardW - 20 });
    doc.setTextColor(...DARK);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.text(it[1], cx + 10, cy + 44, { maxWidth: cardW - 20 });
  });
  const rows = Math.ceil(items.length / cols);
  return y + rows * (cardH + gap);
}

function drawLabelBlock(doc: jsPDF, label: string, value: string, x: number, y: number, w: number, color: [number, number, number]) {
  doc.setFillColor(...LIGHT);
  doc.roundedRect(x, y, w, 46, 4, 4, "F");
  doc.setFillColor(...color);
  doc.rect(x, y, 4, 46, "F");
  doc.setTextColor(...MUTED);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(label.toUpperCase(), x + 14, y + 16);
  doc.setTextColor(...DARK);
  doc.setFontSize(11);
  doc.text(value, x + 14, y + 34, { maxWidth: w - 24 });
  return y + 56;
}

const LIST_LINE = 12;
const LIST_ITEM_GAP = 8;
const LIST_TITLE_H = 18;

function listLines(doc: jsPDF, items: string[], w: number): string[][] {
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  return items.map((it) => doc.splitTextToSize(it, w - 20) as string[]);
}

/** Real height of a list block (title + wrapped items), in points. */
function measureList(doc: jsPDF, items: string[], w: number): number {
  if (items.length === 0) return LIST_TITLE_H + LIST_LINE;
  const lines = listLines(doc, items, w);
  return (
    LIST_TITLE_H +
    lines.reduce((s, l) => s + l.length * LIST_LINE + LIST_ITEM_GAP, 0)
  );
}

/** Draws a bullet list and returns the y just below it. */
function drawList(
  doc: jsPDF,
  title: string,
  items: string[],
  x: number,
  y: number,
  w: number,
  color: [number, number, number],
): number {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...color);
  doc.text(title, x, y);
  let cursor = y + LIST_TITLE_H;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  if (items.length === 0) {
    doc.setTextColor(...MUTED);
    doc.text("—", x, cursor);
    return cursor + LIST_LINE;
  }

  const lines = listLines(doc, items, w);
  lines.forEach((l) => {
    doc.setFillColor(...color);
    doc.circle(x + 3, cursor - 3, 2, "F");
    doc.setTextColor(...DARK);
    l.forEach((line, li) => doc.text(line, x + 14, cursor + li * LIST_LINE));
    cursor += l.length * LIST_LINE + LIST_ITEM_GAP;
  });
  return cursor;
}

function drawBarChart(
  doc: jsPDF,
  title: string,
  data: { label: string; value: number }[],
  x: number,
  y: number,
  w: number,
  h: number,
  color: [number, number, number],
  fmt: (v: number) => string,
  allowNegative = false,
) {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...DARK);
  doc.text(title, x, y);
  y += 8;
  const chartY = y;
  const chartH = h - 20;

  if (data.length === 0) {
    doc.setTextColor(...MUTED);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text("Sem dados.", x, y + 20);
    return y + 30;
  }

  const values = data.map((d) => d.value);
  const maxVal = Math.max(...values, 0);
  const minVal = allowNegative ? Math.min(...values, 0) : 0;
  const range = maxVal - minVal || 1;
  const barCount = data.length;
  const gap = 8;
  const barW = Math.max(6, (w - gap * (barCount - 1)) / barCount);
  const zeroY = chartY + chartH - ((0 - minVal) / range) * chartH;

  // baseline
  doc.setDrawColor(...MUTED);
  doc.setLineWidth(0.5);
  doc.line(x, zeroY, x + w, zeroY);

  data.forEach((d, i) => {
    const bx = x + i * (barW + gap);
    const val = d.value;
    const barH = Math.abs(val - 0) / range * chartH;
    const by = val >= 0 ? zeroY - barH : zeroY;
    if (val < 0) {
      doc.setFillColor(...DANGER);
    } else {
      doc.setFillColor(...color);
    }
    doc.roundedRect(bx, by, barW, Math.max(1, barH), 2, 2, "F");

    doc.setTextColor(...DARK);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.text(fmt(val), bx + barW / 2, by - 3, { align: "center" });

    doc.setTextColor(...MUTED);
    doc.setFontSize(7);
    const lbl = d.label.length > 14 ? d.label.slice(0, 13) + "…" : d.label;
    doc.text(lbl, bx + barW / 2, chartY + chartH + 12, { align: "center" });
  });

  return y + h + 8;
}

function fmtDeltaMoney(v: number) {
  const sign = v > 0 ? "+" : v < 0 ? "-" : "";
  return `${sign}${BRL.format(Math.abs(v))}`;
}
function fmtDeltaPoints(v: number) {
  const sign = v > 0 ? "+" : "";
  return `${sign}${v} pts`;
}

// Derive 3 priorities from the persisted diagnostic — no AI, no recompute.
function derivePriorities(
  report: DiagnosticReport | null,
  farm: ReturnType<typeof aggregateFarm>,
): { title: string; detail: string }[] {
  const out: { title: string; detail: string }[] = [];
  const seen = new Set<string>();

  function push(title: string, detail: string) {
    if (seen.has(title)) return;
    seen.add(title);
    out.push({ title, detail });
  }

  const m = report?.metrics;
  const margin = m?.margin ?? (farm.totalRevenue > 0 ? (farm.totalProfit / farm.totalRevenue) * 100 : 0);
  const negativeFields = m?.negativeFieldsCount ?? farm.perField.filter((f) => f.profit < 0).length;
  const depPct = m?.depPct ?? 0;

  if (negativeFields > 0) {
    push(
      "Recuperar talhões com prejuízo",
      `${negativeFields} talhão(ões) apresentam lucro negativo. Revise custos e produtividade nestes locais antes de qualquer outra ação.`,
    );
  }
  if (margin < 20) {
    push(
      "Reduzir custos e melhorar margem",
      `Margem líquida em ${margin.toFixed(1)}%. Concentre esforços na renegociação de insumos e revisão dos maiores centros de custo.`,
    );
  }
  if (depPct >= 60) {
    push(
      "Reduzir dependência de uma única cultura",
      `Dependência atual de ${depPct.toFixed(1)}% da receita. Planeje diversificação gradual sem alterar estratégia produtiva sem dados agronômicos/climáticos.`,
    );
  }

  // Fill from actionPlan of diagnostic when needed
  const plan = report?.actionPlan ?? [];
  for (const p of plan) {
    if (out.length >= 3) break;
    push(p.slice(0, 60), p);
  }

  // Final fallbacks
  const fallbacks = [
    { title: "Revisar comercialização", detail: "Defina gatilhos de venda por cultura e trave preços em janelas favoráveis." },
    { title: "Fortalecer controles financeiros", detail: "Fluxo de caixa mensal, conciliação e indicadores por talhão." },
    { title: "Monitorar rentabilidade por talhão", detail: "Compare lucro/ha e ponto de equilíbrio em cada safra." },
  ];
  for (const f of fallbacks) {
    if (out.length >= 3) break;
    push(f.title, f.detail);
  }
  return out.slice(0, 3);
}

function drawPriority(doc: jsPDF, n: number, p: { title: string; detail: string }, x: number, y: number, w: number) {
  const h = 54;
  doc.setFillColor(...LIGHT);
  doc.roundedRect(x, y, w, h, 4, 4, "F");
  doc.setFillColor(...PRIMARY);
  doc.circle(x + 22, y + 27, 14, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text(String(n), x + 22, y + 32, { align: "center" });

  doc.setTextColor(...DARK);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text(p.title, x + 46, y + 20, { maxWidth: w - 60 });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  doc.text(p.detail, x + 46, y + 36, { maxWidth: w - 60 });
  return y + h + 8;
}