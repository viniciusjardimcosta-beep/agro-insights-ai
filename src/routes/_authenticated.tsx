import { createFileRoute, Link, Outlet, redirect, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { LayoutDashboard, MapPinned, Sprout, Banknote, TrendingUp, FileBarChart, Bot, LogOut, Activity, FlaskConical } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    return { user: data.user };
  },
  component: AuthLayout,
});

const NAV = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/propriedades", label: "Propriedades", icon: MapPinned },
  { to: "/talhoes", label: "Talhões", icon: Sprout },
  { to: "/custos", label: "Custos", icon: Banknote },
  { to: "/precos", label: "Preços", icon: TrendingUp },
  { to: "/relatorios", label: "Relatórios", icon: FileBarChart },
  { to: "/diagnostico", label: "Diagnóstico", icon: Activity },
  { to: "/simulador", label: "Simulador", icon: FlaskConical },
  { to: "/consultor", label: "Consultor IA", icon: Bot },
] as const;

function AuthLayout() {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const queryClient = useQueryClient();

  async function logout() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    toast.success("Você saiu da conta.");
    navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col bg-sidebar text-sidebar-foreground md:flex">
        <div className="flex h-16 items-center gap-2 px-6 text-lg font-bold">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
            <Sprout className="h-4 w-4" />
          </span>
          AgroIntel <span className="text-sidebar-primary">AI</span>
        </div>
        <nav className="flex-1 space-y-1 px-3 py-4">
          {NAV.map((item) => {
            const active = pathname.startsWith(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
                }`}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-sidebar-border p-3">
          <Button
            variant="ghost"
            onClick={logout}
            className="w-full justify-start text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          >
            <LogOut className="mr-2 h-4 w-4" /> Sair
          </Button>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b bg-background px-4 md:hidden">
        <Link to="/dashboard" className="flex items-center gap-2 font-bold">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-primary text-primary-foreground">
            <Sprout className="h-4 w-4" />
          </span>
          AgroIntel AI
        </Link>
        <Button variant="ghost" size="sm" onClick={logout}>
          <LogOut className="h-4 w-4" />
        </Button>
      </header>

      <main className="md:ml-64">
        <div className="container mx-auto max-w-7xl px-4 py-6 pb-24 md:px-8 md:pb-10">
          <Outlet />
        </div>
      </main>

      {/* Mobile bottom nav */}
      <nav className="fixed inset-x-0 bottom-0 z-30 flex justify-around border-t bg-background py-2 md:hidden">
        {NAV.slice(0, 5).map((item) => {
          const active = pathname.startsWith(item.to);
          return (
            <Link
              key={item.to}
              to={item.to}
              className={`flex flex-col items-center gap-0.5 px-2 py-1 text-[10px] font-medium ${
                active ? "text-primary" : "text-muted-foreground"
              }`}
            >
              <item.icon className="h-5 w-5" />
              {item.label}
            </Link>
          );
        })}
        <Link
          to="/consultor"
          className={`flex flex-col items-center gap-0.5 px-2 py-1 text-[10px] font-medium ${
            pathname.startsWith("/consultor") ? "text-primary" : "text-muted-foreground"
          }`}
        >
          <Bot className="h-5 w-5" />
          IA
        </Link>
      </nav>
    </div>
  );
}