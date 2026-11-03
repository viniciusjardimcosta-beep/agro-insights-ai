import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Sprout } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { logClientAuditEvent } from "@/lib/audit.functions";
import { captureMessage, setMonitoringUser } from "@/lib/monitoring";
import { Checkbox } from "@/components/ui/checkbox";
import { acceptLegalTerms } from "@/lib/account.functions";
import { PRIVACY_VERSION, TERMS_VERSION } from "@/lib/privacy";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Entrar — AgroIntel AI" },
      { name: "description", content: "Acesse sua conta no AgroIntel AI." },
    ],
  }),
  ssr: false,
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  // Checkbox NUNCA pré-marcado: o aceite é ação explícita do usuário.
  const [accepted, setAccepted] = useState(false);
  // Recuperação de senha: o link do e-mail volta para /auth com "type=recovery".
  // Nesse caso NÃO redirecionamos para o painel; mostramos o formulário de nova senha.
  const recoveryRef = useRef(
    typeof window !== "undefined" && /type=recovery/.test(window.location.hash),
  );
  const [recovering, setRecovering] = useState(recoveryRef.current);
  const [forgot, setForgot] = useState(false);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getUser().then(({ data }) => {
      if (mounted && data.user && !recoveryRef.current) {
        navigate({ to: "/dashboard", replace: true });
      }
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") {
        recoveryRef.current = true;
        setRecovering(true);
        return;
      }
      if (session?.user && !recoveryRef.current) navigate({ to: "/dashboard", replace: true });
    });
    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [navigate]);

  async function handleSignIn(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: String(fd.get("email")),
      password: String(fd.get("password")),
    });
    setLoading(false);
    if (error) {
      // login_failure: apenas o código do erro. Nunca e-mail, senha ou token.
      captureMessage("login_failure", { errorCode: "AUTH_SIGN_IN_FAILED", route: "/auth" });
      toast.error("Não foi possível entrar", { description: error.message });
      return;
    }
    const { data: sessionData } = await supabase.auth.getUser();
    if (sessionData.user) setMonitoringUser({ id: sessionData.user.id });
    void logClientAuditEvent({ data: { eventType: "login_success", source: "auth" } }).catch(() => {});
    if (window.localStorage.getItem("agrointel.pending_terms_accept")) {
      window.localStorage.removeItem("agrointel.pending_terms_accept");
      void acceptLegalTerms({
        data: { termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION },
      }).catch(() => {});
    }
    toast.success("Bem-vindo de volta!");
  }

  async function handleForgot(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(String(fd.get("email")), {
      redirectTo: `${window.location.origin}/auth`,
    });
    setLoading(false);
    if (error) {
      toast.error("Não foi possível enviar o e-mail", { description: error.message });
      return;
    }
    // Mensagem neutra: não revela se o e-mail existe.
    toast.success("Verifique seu e-mail", {
      description: "Se o e-mail estiver cadastrado, você receberá um link para criar uma nova senha.",
    });
    setForgot(false);
  }

  async function handleNewPassword(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const password = String(fd.get("password"));
    if (password !== String(fd.get("confirm"))) {
      toast.error("As senhas não conferem");
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) {
      toast.error("Não foi possível alterar a senha", { description: error.message });
      return;
    }
    toast.success("Senha alterada!");
    recoveryRef.current = false;
    setRecovering(false);
    window.history.replaceState(null, "", window.location.pathname);
    navigate({ to: "/dashboard", replace: true });
  }

  async function handleSignUp(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    if (!accepted) {
      toast.error("Aceite necessário", {
        description: "É preciso concordar com os Termos de Uso e a Política de Privacidade.",
      });
      return;
    }
    setLoading(true);
    const { data: signUpData, error } = await supabase.auth.signUp({
      email: String(fd.get("email")),
      password: String(fd.get("password")),
      options: {
        emailRedirectTo: window.location.origin,
        data: { name: String(fd.get("name") || "") },
      },
    });
    setLoading(false);
    if (error) {
      toast.error("Não foi possível criar a conta", { description: error.message });
      return;
    }
    // Quando a sessão já vem no cadastro, o aceite é gravado imediatamente.
    if (signUpData.session) {
      await acceptLegalTerms({
        data: { termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION },
      }).catch(() => {});
    } else {
      // Sem sessão (confirmação por e-mail): grava no primeiro login.
      window.localStorage.setItem("agrointel.pending_terms_accept", "1");
    }
    toast.success("Conta criada!", { description: "Faça login para continuar." });
  }

  return (
    <div className="grid min-h-screen md:grid-cols-2">
      <div className="hidden flex-col justify-between bg-sidebar p-12 text-sidebar-foreground md:flex">
        <div className="flex items-center gap-2 text-xl font-bold">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
            <Sprout className="h-5 w-5" />
          </span>
          AgroIntel AI
        </div>
        <div className="space-y-4">
          <h2 className="text-3xl font-bold">Decisões mais inteligentes na sua lavoura.</h2>
          <p className="text-sidebar-foreground/80">
            Acompanhe lucro por hectare, simule preços e pergunte ao Consultor IA o que importa para a sua safra.
          </p>
        </div>
        <p className="text-sm text-sidebar-foreground/60">© {new Date().getFullYear()} AgroIntel AI</p>
      </div>

      <div className="flex items-center justify-center p-6 md:p-12">
        <div className="w-full max-w-md">
          <div className="mb-8 flex items-center gap-2 md:hidden">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-primary text-primary-foreground">
              <Sprout className="h-5 w-5" />
            </span>
            <span className="text-xl font-bold">AgroIntel AI</span>
          </div>
          {recovering ? (
            <form onSubmit={handleNewPassword} className="space-y-4">
              <h1 className="text-xl font-semibold">Criar nova senha</h1>
              <div className="space-y-2">
                <Label htmlFor="np-password">Nova senha</Label>
                <Input id="np-password" name="password" type="password" minLength={6} required autoComplete="new-password" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="np-confirm">Confirmar nova senha</Label>
                <Input id="np-confirm" name="confirm" type="password" minLength={6} required autoComplete="new-password" />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Salvando..." : "Salvar nova senha"}
              </Button>
            </form>
          ) : forgot ? (
            <form onSubmit={handleForgot} className="space-y-4">
              <h1 className="text-xl font-semibold">Recuperar senha</h1>
              <p className="text-sm text-muted-foreground">
                Informe seu e-mail e enviaremos um link para criar uma nova senha.
              </p>
              <div className="space-y-2">
                <Label htmlFor="fp-email">E-mail</Label>
                <Input id="fp-email" name="email" type="email" required autoComplete="email" />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Enviando..." : "Enviar link"}
              </Button>
              <Button type="button" variant="ghost" className="w-full" onClick={() => setForgot(false)}>
                Voltar
              </Button>
            </form>
          ) : (
          <Tabs defaultValue="signin">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="signin">Entrar</TabsTrigger>
              <TabsTrigger value="signup">Criar conta</TabsTrigger>
            </TabsList>

            <TabsContent value="signin" className="mt-6">
              <form onSubmit={handleSignIn} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="si-email">E-mail</Label>
                  <Input id="si-email" name="email" type="email" required autoComplete="email" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="si-password">Senha</Label>
                  <Input id="si-password" name="password" type="password" required autoComplete="current-password" />
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? "Entrando..." : "Entrar"}
                </Button>
                <button
                  type="button"
                  onClick={() => setForgot(true)}
                  className="w-full text-center text-sm text-primary underline"
                >
                  Esqueci minha senha
                </button>
              </form>
            </TabsContent>

            <TabsContent value="signup" className="mt-6">
              <form onSubmit={handleSignUp} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="su-name">Nome</Label>
                  <Input id="su-name" name="name" type="text" required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="su-email">E-mail</Label>
                  <Input id="su-email" name="email" type="email" required autoComplete="email" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="su-password">Senha</Label>
                  <Input id="su-password" name="password" type="password" minLength={6} required autoComplete="new-password" />
                </div>
                <div className="flex items-start gap-2">
                  <Checkbox
                    id="su-terms"
                    checked={accepted}
                    onCheckedChange={(v) => setAccepted(v === true)}
                  />
                  <Label htmlFor="su-terms" className="text-sm font-normal leading-snug">
                    Li e concordo com os{" "}
                    <a href="/termos" target="_blank" rel="noreferrer" className="text-primary underline">
                      Termos de Uso
                    </a>{" "}
                    e a{" "}
                    <a href="/privacidade" target="_blank" rel="noreferrer" className="text-primary underline">
                      Política de Privacidade
                    </a>
                    .
                  </Label>
                </div>
                <Button type="submit" className="w-full" disabled={loading || !accepted}>
                  {loading ? "Criando..." : "Criar conta"}
                </Button>
              </form>
            </TabsContent>
          </Tabs>
          )}
        </div>
      </div>
    </div>
  );
}