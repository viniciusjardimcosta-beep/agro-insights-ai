import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Bot, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { createThread, deleteThread, listThreads } from "@/lib/threads.functions";

const q = queryOptions({ queryKey: ["threads"], queryFn: () => listThreads() });

export const Route = createFileRoute("/_authenticated/consultor")({
  head: () => ({ meta: [{ title: "Consultor IA — AgroIntel AI" }] }),
  component: Page,
  errorComponent: ({ error }) => <p className="text-destructive">{error.message}</p>,
});

function Page() {
  const { data = [], isLoading, error } = useQuery(q);
  const create = useServerFn(createThread);
  const del = useServerFn(deleteThread);
  const qc = useQueryClient();
  const navigate = useNavigate();

  if (isLoading) return <p className="text-sm text-muted-foreground">Carregando conversas...</p>;
  if (error) return <p className="text-sm text-destructive">{error.message}</p>;

  async function newThread() {
    try {
      const t = await create();
      await qc.invalidateQueries({ queryKey: ["threads"] });
      navigate({ to: "/consultor/$threadId", params: { threadId: t.id } });
    } catch (e) { toast.error("Erro", { description: (e as Error).message }); }
  }

  async function onDelete(id: string, e: React.MouseEvent) {
    e.preventDefault(); e.stopPropagation();
    if (!confirm("Excluir esta conversa?")) return;
    await del({ data: { id } });
    await qc.invalidateQueries({ queryKey: ["threads"] });
    toast.success("Excluída");
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Consultor IA</h1>
          <p className="text-sm text-muted-foreground">Converse sobre lucro, custos e simulações com base nos dados da sua fazenda.</p>
        </div>
        <Button onClick={newThread}><Plus className="mr-2 h-4 w-4" />Nova conversa</Button>
      </div>

      {data.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-16 text-center">
            <Bot className="mx-auto h-10 w-10 text-muted-foreground" />
            <h3 className="mt-3 text-lg font-semibold">Comece uma conversa</h3>
            <p className="mt-1 text-sm text-muted-foreground">Pergunte “Estou tendo lucro?”, “Qual talhão dá prejuízo?”, “Se a soja cair 10%, quanto eu perco?”.</p>
            <Button className="mt-4" onClick={newThread}><Plus className="mr-2 h-4 w-4" />Nova conversa</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-2">
          {data.map((t) => (
            <Link
              key={t.id}
              to="/consultor/$threadId"
              params={{ threadId: t.id }}
              className="flex items-center justify-between rounded-lg border bg-card p-4 transition-colors hover:bg-accent"
            >
              <div className="flex items-center gap-3 min-w-0">
                <Bot className="h-4 w-4 shrink-0 text-primary" />
                <div className="min-w-0">
                  <p className="truncate font-medium">{t.title}</p>
                  <p className="text-xs text-muted-foreground">{new Date(t.updated_at).toLocaleString("pt-BR")}</p>
                </div>
              </div>
              <button
                onClick={(e) => onDelete(t.id, e)}
                className="rounded-md p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                aria-label="Excluir"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}