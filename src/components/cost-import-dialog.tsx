import { useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileSpreadsheet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { importCosts } from "@/lib/data.functions";
import { BRL } from "@/lib/calc";
import { formatDateBR } from "@/lib/format-pt";
import {
  COST_CATEGORY_NAMES,
  buildDrafts,
  decodeCsvBytes,
  detectRoles,
  hasHeaderRow,
  parseCsv,
  type ColumnRole,
  type Draft,
  type ExistingCost,
} from "@/lib/cost-import";
import { readXlsx } from "@/lib/xlsx-reader";

const MAX_FILE_BYTES = 5 * 1024 * 1024;

const ROLE_LABEL: Record<ColumnRole, string> = {
  ignore: "Ignorar",
  date: "Data",
  amount: "Valor (R$)",
  category: "Categoria",
  description: "Descrição",
  field: "Talhão",
};

type FieldLite = { id: string; name: string };
type CostLite = { field_id: string; date: string; category: string; amount: number | string };

export function CostImportDialog({
  open,
  onOpenChange,
  fields,
  costs,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  fields: FieldLite[];
  costs: CostLite[];
}) {
  const qc = useQueryClient();
  const send = useServerFn(importCosts);
  const fileRef = useRef<HTMLInputElement>(null);

  const [fileName, setFileName] = useState("");
  const [sheets, setSheets] = useState<{ name: string; rows: string[][] }[]>([]);
  const [sheetIdx, setSheetIdx] = useState(0);
  const [roles, setRoles] = useState<ColumnRole[]>([]);
  const [skipFirst, setSkipFirst] = useState(true);
  const [defaultTarget, setDefaultTarget] = useState<string>("all");
  const [edits, setEdits] = useState<Record<number, Partial<Draft>>>({});
  const [picked, setPicked] = useState<Record<number, boolean>>({});
  const [busy, setBusy] = useState(false);

  const rows = sheets[sheetIdx]?.rows ?? [];

  function reset() {
    setFileName(""); setSheets([]); setSheetIdx(0); setRoles([]); setEdits({}); setPicked({});
    if (fileRef.current) fileRef.current.value = "";
  }

  function loadSheet(data: { name: string; rows: string[][] }[], idx: number) {
    const r = data[idx]?.rows ?? [];
    const header = hasHeaderRow(r);
    setSheetIdx(idx);
    setSkipFirst(header);
    setRoles(detectRoles(header ? (r[0] ?? []) : [], header ? r.slice(1) : r));
    setEdits({}); setPicked({});
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) { toast.error("Arquivo grande demais (máximo 5 MB)."); return; }
    try {
      const buf = await file.arrayBuffer();
      const lower = file.name.toLowerCase();
      let data: { name: string; rows: string[][] }[];
      if (lower.endsWith(".xlsx")) data = await readXlsx(buf);
      else if (lower.endsWith(".xls")) { toast.error("Arquivo .xls antigo: abra no Excel e salve como .xlsx ou CSV."); return; }
      else data = [{ name: "Planilha", rows: parseCsv(decodeCsvBytes(new Uint8Array(buf))) }];
      data = data.filter((s) => s.rows.some((r) => r.some((c) => c.trim() !== "")));
      if (data.length === 0) { toast.error("Não encontrei dados nesse arquivo."); return; }
      setFileName(file.name);
      setSheets(data);
      loadSheet(data, 0);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não consegui ler o arquivo.");
    }
  }

  const existing: ExistingCost[] = useMemo(
    () => costs.map((c) => ({ field_id: c.field_id, date: c.date, category: c.category, amount: Number(c.amount) })),
    [costs],
  );

  const built = useMemo(
    () => (rows.length === 0 ? null : buildDrafts(rows, { roles, fields, defaultTarget, existing, skipFirst })),
    [rows, roles, fields, defaultTarget, existing, skipFirst],
  );

  // Aplica as correções feitas na tela e recalcula a situação da linha.
  const drafts: Draft[] = useMemo(() => {
    if (!built) return [];
    return built.drafts.map((d) => {
      const e = edits[d.row];
      if (!e) return d;
      const m: Draft = { ...d, ...e };
      let issues = d.issues;
      if (e.category !== undefined) issues = issues.filter((i) => i !== "Categoria não reconhecida");
      if (e.target !== undefined) issues = issues.filter((i) => i !== "Talhão não definido" && !i.startsWith("Talhão \""));
      const hard = issues.some((i) => /^(Sem coluna|Data|Valor)/.test(i) || i === "Talhão não definido");
      const status: Draft["status"] = hard ? "error" : issues.length > 0 ? "review" : "ok";
      return { ...m, issues, status };
    });
  }, [built, edits]);

  // Marcados por padrão: tudo que não tem erro e não parece duplicado. O usuário pode mudar.
  const isChecked = (d: Draft) => d.status !== "error" && (picked[d.row] ?? !d.duplicate);
  const finalRows = drafts.filter(isChecked);
  const finalTotal = finalRows.reduce((s, d) => s + (d.amount ?? 0), 0);
  const counts = {
    ok: drafts.filter((d) => d.status === "ok").length,
    review: drafts.filter((d) => d.status === "review").length,
    error: drafts.filter((d) => d.status === "error").length,
  };

  function patch(row: number, p: Partial<Draft>) { setEdits((e) => ({ ...e, [row]: { ...e[row], ...p } })); }
  function onCheck(d: Draft, on: boolean) { setPicked((x) => ({ ...x, [d.row]: on })); }

  async function confirm() {
    if (finalRows.length === 0) return;
    setBusy(true);
    try {
      const res = await send({
        data: {
          rows: finalRows.map((d) => ({
            target: d.target as string,
            category: d.category,
            description: d.description || null,
            amount: d.amount as number,
            date: d.date as string,
          })),
        },
      });
      await Promise.all([qc.invalidateQueries({ queryKey: ["costs"] }), qc.invalidateQueries({ queryKey: ["alerts"] })]);
      toast.success(`${res.lines} lançamento(s) importado(s).`);
      reset();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível importar.");
    } finally {
      setBusy(false);
    }
  }

  const colCount = Math.max(0, ...rows.slice(0, 20).map((r) => r.length));
  const headerRow = rows[0] ?? [];

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Importar custos de planilha</DialogTitle>
          <DialogDescription>
            Excel (.xlsx) ou CSV. Nada é salvo até você conferir e confirmar. O arquivo é lido no seu aparelho e não é enviado.
          </DialogDescription>
        </DialogHeader>

        {sheets.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center">
            <FileSpreadsheet className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
            <p className="mb-3 text-sm text-muted-foreground">
              Uma linha por lançamento, com data e valor. Categoria, descrição e talhão são opcionais.
            </p>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.csv,.txt,text/csv"
              className="block w-full text-sm"
              onChange={(e) => onFile(e.target.files?.[0])}
            />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className="font-medium">{fileName}</span>
              {sheets.length > 1 && (
                <Select value={String(sheetIdx)} onValueChange={(v) => loadSheet(sheets, Number(v))}>
                  <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {sheets.map((s, i) => <SelectItem key={i} value={String(i)}>Aba: {s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
              <Button variant="ghost" size="sm" onClick={reset}>Trocar arquivo</Button>
            </div>

            <div className="rounded-lg border p-3">
              <p className="mb-2 text-sm font-medium">1. O que é cada coluna?</p>
              <div className="flex flex-wrap gap-3">
                {Array.from({ length: colCount }, (_, i) => (
                  <div key={i} className="w-40">
                    <p className="mb-1 truncate text-xs text-muted-foreground" title={headerRow[i]}>
                      {headerRow[i] || `Coluna ${i + 1}`}
                    </p>
                    <Select value={roles[i] ?? "ignore"} onValueChange={(v) => setRoles((r) => { const n = [...r]; for (let k = 0; k < colCount; k++) if (v !== "ignore" && n[k] === v) n[k] = "ignore"; n[i] = v as ColumnRole; return n; })}>
                      <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {(Object.keys(ROLE_LABEL) as ColumnRole[]).map((r) => <SelectItem key={r} value={r}>{ROLE_LABEL[r]}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
              <label className="mt-3 flex items-center gap-2 text-sm">
                <Checkbox checked={skipFirst} onCheckedChange={(v) => setSkipFirst(v === true)} />
                A primeira linha é título (não importar)
              </label>
              <div className="mt-3 flex items-center gap-2 text-sm">
                <span>Talhão quando a planilha não disser:</span>
                <Select value={defaultTarget} onValueChange={setDefaultTarget}>
                  <SelectTrigger className="h-8 w-56"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos (dividir pela área)</SelectItem>
                    {fields.map((f) => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <p className="mb-2 text-sm font-medium">2. Confira os lançamentos</p>
              <p className="mb-2 text-xs text-muted-foreground">
                {counts.ok} prontos · {counts.review} para revisar · {counts.error} com erro (não serão importados)
                {built?.truncated ? " · só as primeiras 1.000 linhas foram lidas" : ""}
              </p>
              <div className="max-h-[40vh] overflow-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-8"></TableHead>
                      <TableHead>Data</TableHead>
                      <TableHead>Categoria</TableHead>
                      <TableHead>Talhão</TableHead>
                      <TableHead className="hidden md:table-cell">Descrição</TableHead>
                      <TableHead className="text-right">Valor</TableHead>
                      <TableHead>Situação</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {drafts.map((d) => (
                      <TableRow key={d.row} className={d.status === "error" ? "bg-destructive/5" : d.status === "review" ? "bg-amber-500/5" : ""}>
                        <TableCell>
                          <Checkbox disabled={d.status === "error"} checked={isChecked(d)} onCheckedChange={(v) => onCheck(d, v === true)} />
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-xs">{d.date ? formatDateBR(d.date) : "-"}</TableCell>
                        <TableCell>
                          <Select value={d.category} onValueChange={(v) => patch(d.row, { category: v })}>
                            <SelectTrigger className="h-8 w-36"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {COST_CATEGORY_NAMES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <Select value={d.target ?? ""} onValueChange={(v) => patch(d.row, { target: v })}>
                            <SelectTrigger className="h-8 w-36"><SelectValue placeholder="Escolher" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">Todos (pela área)</SelectItem>
                              {fields.map((f) => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell className="hidden max-w-[10rem] truncate text-xs text-muted-foreground md:table-cell" title={d.description}>{d.description}</TableCell>
                        <TableCell className="whitespace-nowrap text-right font-medium">{d.amount !== null ? BRL.format(d.amount) : "-"}</TableCell>
                        <TableCell className="text-xs">
                          {d.issues.length === 0 ? <span className="text-emerald-600">Pronto</span> : <span className={d.status === "error" ? "text-destructive" : "text-amber-600"}>{d.issues.join("; ")}</span>}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          </div>
        )}

        <DialogFooter className="items-center gap-2">
          {sheets.length > 0 && (
            <span className="mr-auto text-sm text-muted-foreground">
              {finalRows.length} lançamento(s) · {BRL.format(finalTotal)}
            </span>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button disabled={busy || finalRows.length === 0} onClick={confirm}>
            {busy ? "Importando..." : `Importar ${finalRows.length}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
