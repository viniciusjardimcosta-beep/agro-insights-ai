import { createContext, useContext } from "react";
import { ALL_FARMS, FARM_ACTIVITY_LABEL, isFarmActivity, type Flags } from "@/lib/farms";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Store } from "lucide-react";

export type Farm = { id: string; name: string; activity?: string | null };

export type FarmCtx = {
  farms: Farm[];
  /** "todas" ou o id da fazenda escolhida. */
  selectedId: string;
  /** Fazenda escolhida (null = todas). */
  selected: Farm | null;
  setSelectedId: (id: string) => void;
  /** O que aparece no app agora: da fazenda escolhida, ou da conta quando são todas. */
  flags: Flags;
};

const Ctx = createContext<FarmCtx>({
  farms: [],
  selectedId: ALL_FARMS,
  selected: null,
  setSelectedId: () => {},
  flags: { lavoura: true, pecuaria: false },
});

export const FarmContext = Ctx;
export function useFarm(): FarmCtx {
  return useContext(Ctx);
}

/** Seletor "Fazenda: ..." — só aparece quando a pessoa tem 2 ou mais fazendas. */
export function FarmSelector({ className = "" }: { className?: string }) {
  const { farms, selectedId, setSelectedId } = useFarm();
  if (farms.length < 2) return null;
  return (
    <div className={className}>
      <Select value={selectedId} onValueChange={setSelectedId}>
        <SelectTrigger aria-label="Fazenda" className="h-9 w-full gap-2">
          <Store className="h-4 w-4 shrink-0 text-muted-foreground" />
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL_FARMS}>Todas as fazendas</SelectItem>
          {farms.map((f) => (
            <SelectItem key={f.id} value={f.id}>
              {f.name}
              {isFarmActivity(f.activity) ? ` · ${FARM_ACTIVITY_LABEL[f.activity].replace(" (ILP)", "")}` : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
