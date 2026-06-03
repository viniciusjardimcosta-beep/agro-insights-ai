import { useChat } from "@ai-sdk/react";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { DefaultChatTransport, type UIMessage } from "ai";
import { ArrowLeft, Bot, Loader2, Send, Sprout, User } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { getThreadMessages } from "@/lib/threads.functions";

const SUGGESTIONS = [
  "Estou tendo lucro?",
  "Qual talhão está dando prejuízo?",
  "Quanto preciso colher para empatar?",
  "Se a soja cair 10%, quanto eu perco?",
  "Qual custo está mais pesado?",
];

export const Route = createFileRoute("/_authenticated/consultor/$threadId")({
  head: () => ({ meta: [{ title: "Consultor IA — AgroIntel AI" }] }),
  component: ThreadPage,
  errorComponent: ({ error }) => <p className="text-destructive">{error.message}</p>,
});

function ThreadPage() {
  const { threadId } = Route.useParams();
  const initial = useQuery(
    queryOptions({
      queryKey: ["thread-messages", threadId],
      queryFn: () => getThreadMessages({ data: { threadId } }),
    }),
  );

  if (initial.isLoading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Carregando conversa...
      </div>
    );
  }

  if (initial.error) {
    return <p className="text-sm text-destructive">{initial.error.message}</p>;
  }

  // Map DB rows to UIMessage shape
  const initialMessages: UIMessage[] = (initial.data?.messages ?? []).map((m) => ({
    id: m.id,
    role: m.role as UIMessage["role"],
    parts: [{ type: "text", text: m.content }],
  }));

  return <Chat key={threadId} threadId={threadId} initialMessages={initialMessages} />;
}

function Chat({ threadId, initialMessages }: { threadId: string; initialMessages: UIMessage[] }) {
  const [token, setToken] = useState<string | null>(null);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setToken(data.session?.access_token ?? null));
  }, []);

  const transport = new DefaultChatTransport({
    api: "/api/chat",
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: { threadId },
  });

  const { messages, sendMessage, status, error } = useChat({
    id: threadId,
    messages: initialMessages,
    transport,
  });

  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { taRef.current?.focus(); }, [threadId]);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, status]);

  const busy = status === "submitted" || status === "streaming";

  async function send(text: string) {
    if (!text.trim() || busy) return;
    setInput("");
    await sendMessage({ text });
    setTimeout(() => taRef.current?.focus(), 0);
  }

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col md:h-[calc(100vh-5rem)]">
      <div className="mb-3 flex items-center gap-3">
        <Link to="/consultor" className="text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /></Link>
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-foreground"><Sprout className="h-4 w-4" /></span>
          <div>
            <h1 className="text-lg font-semibold leading-tight">Consultor IA</h1>
            <p className="text-xs text-muted-foreground">Conectado aos dados da sua fazenda</p>
          </div>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 space-y-6 overflow-y-auto rounded-lg border bg-card p-4">
        {messages.length === 0 && (
          <div className="mx-auto max-w-md space-y-4 py-8 text-center">
            <Bot className="mx-auto h-10 w-10 text-primary" />
            <p className="text-sm text-muted-foreground">Pergunte algo sobre sua safra — ou comece com uma sugestão:</p>
            <div className="flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => send(s)} className="rounded-full border bg-background px-3 py-1.5 text-xs hover:bg-accent">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m) => {
          const text = m.parts.map((p) => (p.type === "text" ? p.text : "")).join("");
          if (m.role === "user") {
            return (
              <div key={m.id} className="flex justify-end gap-2">
                <div className="max-w-[80%] rounded-2xl rounded-tr-sm bg-primary px-4 py-2.5 text-sm text-primary-foreground">
                  {text}
                </div>
                <span className="mt-1 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-secondary text-secondary-foreground">
                  <User className="h-3.5 w-3.5" />
                </span>
              </div>
            );
          }
          return (
            <div key={m.id} className="flex gap-3">
              <span className="mt-1 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                <Sprout className="h-3.5 w-3.5" />
              </span>
              <div className="prose prose-sm max-w-none flex-1 text-foreground prose-p:my-2 prose-ul:my-2 prose-strong:text-foreground">
                <ReactMarkdown>{text || "..."}</ReactMarkdown>
              </div>
            </div>
          );
        })}

        {status === "submitted" && (
          <div className="flex gap-3">
            <span className="mt-1 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
              <Sprout className="h-3.5 w-3.5" />
            </span>
            <p className="animate-pulse text-sm text-muted-foreground">Pensando...</p>
          </div>
        )}

        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            Erro: {error.message}
          </div>
        )}
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); send(input); }}
        className="mt-3 flex gap-2"
      >
        <Textarea
          ref={taRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }}
          placeholder="Pergunte ao Consultor IA..."
          rows={1}
          className="min-h-[44px] resize-none"
        />
        <Button type="submit" size="icon" disabled={busy || !input.trim()} className="h-11 w-11 shrink-0">
          <Send className="h-4 w-4" />
        </Button>
      </form>
    </div>
  );
}