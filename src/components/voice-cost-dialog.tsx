import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Mic, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createCostSplit, upsertCost } from "@/lib/data.functions";
import { COST_CATEGORY_NAMES } from "@/lib/cost-import";
import { parseSpokenCost } from "@/lib/voice-parse";
import { BRL } from "@/lib/calc";

type FieldLite = { id: string; name: string };

// Reconhecimento de voz do próprio navegador (Chrome/Edge/Safari). O áudio é tratado pelo navegador; o app só recebe o texto.
type Recognition = {
  lang: string; interimResults: boolean; continuous: boolean;
  start: () => void; stop: () => void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
};
function getRecognition(): (new () => Recognition) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export function VoiceCostDialog({
  open,
  onOpenChange,
  fields,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  fields: FieldLite[];
}) {
  const qc = useQueryClient();
  const save = useServerFn(upsertCost);
  const saveSplit = useServerFn(createCostSplit);
  const recRef = useRef<Recognition | null>(null);
  // Só decide no navegador (depois da hidratação), para o servidor e o cliente renderizarem o mesmo na primeira vez.
  const [supported, setSupported] = useState(false);
  useEffect(() => { setSupported(getRecognition() !== null); }, []);

  const [listening, setListening] = useState(false);
  const [text, setText] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayIso());
  const [category, setCategory] = useState<string>("Outros");
  const [target, setTarget] = useState<string>("");
  const [issues, setIssues] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  function apply(spoken: string) {
    setText(spoken);
    if (spoken.trim() === "") { setAmount(""); setIssues([]); return; }
    const p = parseSpokenCost(spoken, fields);
    setAmount(p.amount !== null ? String(p.amount) : "");
    setDate(p.date);
    setCategory(p.category);
    setTarget(p.target ?? "");
    setIssues(p.issues);
  }

  function reset() {
    try { recRef.current?.stop(); } catch { /* já parado */ }
    setListening(false); setText(""); setAmount(""); setDate(todayIso()); setCategory("Outros"); setTarget(""); setIssues([]);
  }

  useEffect(() => () => { try { recRef.current?.stop(); } catch { /* sem efeito */ } }, []);

  function toggleListen() {
    if (listening) { try { recRef.current?.stop(); } catch { /* sem efeito */ } return; }
    const SR = getRecognition();
    if (!SR) return;
    const rec = new SR();
    rec.lang = "pt-BR";
    rec.interimResults = true;
    rec.continuous = false;
    rec.onresult = (e) => {
      let out = "";
      for (let i = 0; i < e.results.length; i++) out += e.results[i][0].transcript + " ";
      apply(out.trim());
    };
    rec.onerror = (e) => {
      setListening(false);
      if (e.error === "not-allowed" || e.error === "service-not-allowed") toast.error("Permita o uso do microfone no navegador para falar o custo.");
      else if (e.error === "no-speech") toast.message("Não ouvi nada. Toque no microfone e fale de novo.");
      else toast.error("Não consegui ouvir. Você pode digitar a frase.");
    };
    rec.onend = () => setListening(false);
    recRef.current = rec;
    setListening(true);
    try { rec.start(); } catch { setListening(false); }
  }

  const n = Number(amount.replace(",", "."));
  const valid = n > 0 && /^\d{4}-\d{2}-\d{2}$/.test(date) && target !== "";
  const unknownIssues = issues.filter((i) => i !== "Categoria não reconhecida");

  async function confirm(again: boolean) {
    if (!valid) return;
    setBusy(true);
    try {
      const common = { category, description: text.trim().slice(0, 300) || null, amount: n, date, notes: "Lançado por voz." };
      if (target === "all") {
        const r = await saveSplit({ data: { ...common, field_ids: fields.map((f) => f.id) } });
        toast.success(`Custo dividido entre ${r.count} talhões`);
      } else {
        await save({ data: { ...common, field_id: target } });
        toast.success("Custo lançado");
      }
      await qc.invalidateQueries();
      if (again) reset(); else { reset(); onOpenChange(false); }
    } catch (e) {
      toast.error("Erro", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Lançar custo falando</DialogTitle>
          <DialogDescription>
            Diga, por exemplo: “diesel 450 reais talhão 1 ontem”. Você confere antes de salvar.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {supported ? (
            <Button
              type="button"
              size="lg"
              variant={listening ? "destructive" : "default"}
              className="h-16 w-full text-lg font-semibold"
              onClick={toggleListen}
            >
              {listening ? <><Square className="mr-2 h-6 w-6" />Ouvindo... toque para parar</> : <><Mic className="mr-2 h-6 w-6" />Toque e fale o custo</>}
            </Button>
          ) : (
            <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
              Este navegador não tem reconhecimento de voz. Use o Chrome, Edge ou Safari, ou digite a frase abaixo.
            </p>
          )}

          <div>
            <Label htmlFor="voice-text">O que entendi (pode corrigir ou digitar)</Label>
            <Textarea id="voice-text" rows={2} value={text} onChange={(e) => apply(e.target.value)} placeholder="Ex.: adubo 1.500 reais todos os talhões dia 5" />
          </div>

          {text.trim() !== "" && (
            <div className="space-y-3 rounded-lg border p-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Valor (R$)</Label>
                  <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
                </div>
                <div>
                  <Label>Data</Label>
                  <Input type="date" value={date} max={todayIso()} onChange={(e) => setDate(e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Categoria</Label>
                  <Select value={category} onValueChange={setCategory}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{COST_CATEGORY_NAMES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Talhão</Label>
                  <Select value={target} onValueChange={setTarget}>
                    <SelectTrigger><SelectValue placeholder="Escolher" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos (dividir pela área)</SelectItem>
                      {fields.map((f) => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {(unknownIssues.length > 0 || target === "") && (
                <p className="text-sm font-medium text-amber-700">
                  {[...unknownIssues, ...(target === "" && !unknownIssues.some((i) => i.startsWith("Não achei o talhão")) ? ["Escolha o talhão"] : [])].join(" · ")}
                </p>
              )}
              {valid && <p className="text-sm text-muted-foreground">Vai lançar <b>{BRL.format(n)}</b> em <b>{category}</b>.</p>}
            </div>
          )}

          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" disabled={!valid || busy} onClick={() => confirm(true)}>Salvar e falar outro</Button>
            <Button size="lg" className="font-semibold" disabled={!valid || busy} onClick={() => confirm(false)}>
              {busy ? "Salvando..." : "Salvar custo"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
