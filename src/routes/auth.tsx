import { createFileRoute, useNavigate, redirect } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Coffee, WifiOff } from "lucide-react";
import {
  enrolThisDevice,
  isOnline,
  localAuthStatus,
  resolveAccess,
  unlockThisDevice,
  type AuthSnapshot,
} from "@/data/auth/local-auth";

export const Route = createFileRoute("/auth")({
  validateSearch: (s: Record<string, unknown>): { next?: string } => ({
    next: typeof s.next === "string" ? s.next : undefined,
  }),

  // PHASE 7 — a cloud session OR a valid enrolled local session sends the user
  // straight into the app. An online user who has not enrolled this device
  // stays here to choose a device unlock code first.
  beforeLoad: async ({ search }) => {
    if (typeof window === "undefined") return;
    const dest = search.next && search.next.startsWith("/") && !search.next.startsWith("//") ? search.next : "/";
    const access = await resolveAccess();
    if (access.mode === "offline" || (access.mode === "online" && access.enrolled)) {
      throw redirect({ href: dest });
    }
  },
  component: AuthPage,
});

function safeNext(next: string | undefined): string {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

function AuthPage() {
  const navigate = useNavigate();
  const { next } = Route.useSearch();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  /** Local device state: enrolment prompt (online) or offline unlock. */
  const [snapshot, setSnapshot] = useState<AuthSnapshot | null>(null);
  const [needsEnrolment, setNeedsEnrolment] = useState(false);
  const [unlockCode, setUnlockCode] = useState("");
  const [unlockConfirm, setUnlockConfirm] = useState("");
  const [forceUnlock, setForceUnlock] = useState(false);
  const online = isOnline() && !forceUnlock;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const snap = await localAuthStatus();
        if (cancelled) return;
        setSnapshot(snap);
        if (snap.identity && !snap.identity.revoked_at) setEmail((e) => e || snap.identity!.email);
        const access = await resolveAccess();
        if (!cancelled && access.mode === "online" && !access.enrolled) setNeedsEnrolment(true);
      } catch {
        // no local database yet — plain online login still works
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const enrolledEmail = snapshot?.identity && !snapshot.identity.revoked_at ? snapshot.identity.email : null;

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    try {
      if (!email || !password) {
        toast.error("Please enter email and password");
        return;
      }
      if (!import.meta.env.VITE_SUPABASE_URL || !import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY) {
        const msg = "Authentication is not configured (missing environment variables).";
        console.error(msg);
        toast.error(msg);
        return;
      }
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        console.error("[Auth] signIn error:", error);
        toast.error(error.message || "Sign in failed");
        return;
      }
      if (!data.session) {
        toast.error("Sign in failed: no session returned");
        return;
      }
      const access = await resolveAccess();
      if (access.mode === "online" && !access.enrolled) {
        setNeedsEnrolment(true);
        toast.success("Signed in — set a device unlock code to work offline");
        return;
      }
      toast.success("Welcome back");
      window.location.href = safeNext(next);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unexpected sign in error";
      console.error("[Auth] signIn exception:", err);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  async function handleSignUp(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    try {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: window.location.origin + safeNext(next) },
      });
      if (error) {
        console.error("[Auth] signUp error:", error);
        toast.error(error.message || "Sign up failed");
        return;
      }
      toast.success("Account created — you can sign in now");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unexpected sign up error";
      console.error("[Auth] signUp exception:", err);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  async function handleEnrol(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    if (unlockCode.length < 4) {
      toast.error("Use an unlock code of at least 4 characters");
      return;
    }
    if (unlockCode !== unlockConfirm) {
      toast.error("The two unlock codes do not match");
      return;
    }
    setLoading(true);
    try {
      await enrolThisDevice(unlockCode);
      toast.success("This device can now be used offline");
      window.location.href = safeNext(next);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Enrolment failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleUnlock(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    try {
      await unlockThisDevice(email || enrolledEmail || "", unlockCode);
      toast.success("Unlocked — working offline");
      window.location.href = safeNext(next);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Unlock failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-background via-secondary/40 to-background">
      <Card className="w-full max-w-md shadow-xl">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Coffee className="h-6 w-6" />
          </div>
          <CardTitle className="text-2xl">Khyber Delicious Food</CardTitle>
          <CardDescription>
            {needsEnrolment
              ? "Set a device unlock code for offline use"
              : online
                ? "Sign in to manage your café"
                : "You are offline — unlock this device"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {needsEnrolment ? (
            <form onSubmit={handleEnrol} className="space-y-3">
              <p className="text-xs text-muted-foreground">
                The unlock code is stored only as a one-way hash on this device. It is never your
                account password and never leaves this machine.
              </p>
              <div className="space-y-2">
                <Label>Unlock code</Label>
                <Input type="password" minLength={4} required value={unlockCode} onChange={(e) => setUnlockCode(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Confirm unlock code</Label>
                <Input type="password" minLength={4} required value={unlockConfirm} onChange={(e) => setUnlockConfirm(e.target.value)} />
              </div>
              <Button className="w-full" type="submit" disabled={loading}>
                {loading ? "…" : "Enrol this device"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="w-full"
                onClick={() => (window.location.href = safeNext(next))}
              >
                Skip — stay online only
              </Button>
            </form>
          ) : !online && enrolledEmail ? (
            <form onSubmit={handleUnlock} className="space-y-3">
              <div className="flex items-center gap-2 rounded-md border bg-muted/40 p-2 text-xs text-muted-foreground">
                <WifiOff className="h-4 w-4" /> No internet — signing in with the local device code.
              </div>
              <div className="space-y-2">
                <Label>Email</Label>
                <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Unlock code</Label>
                <Input type="password" required value={unlockCode} onChange={(e) => setUnlockCode(e.target.value)} />
              </div>
              <Button className="w-full" type="submit" disabled={loading}>
                {loading ? "…" : "Unlock offline"}
              </Button>
            </form>
          ) : (
            <Tabs defaultValue="signin">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="signin">Sign in</TabsTrigger>
                <TabsTrigger value="signup">Sign up</TabsTrigger>
              </TabsList>
              <TabsContent value="signin">
                <form onSubmit={handleSignIn} className="space-y-3 pt-4">
                  <div className="space-y-2"><Label>Email</Label><Input type="email" required value={email} onChange={(e)=>setEmail(e.target.value)} /></div>
                  <div className="space-y-2"><Label>Password</Label><Input type="password" required value={password} onChange={(e)=>setPassword(e.target.value)} /></div>
                  <Button className="w-full" type="submit" disabled={loading}>
                    {loading ? (
                      <span className="inline-flex items-center gap-2">
                        <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                        Signing in…
                      </span>
                    ) : (
                      "Sign in"
                    )}
                  </Button>
                  {enrolledEmail ? (
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full"
                      onClick={() => {
                        setEmail(enrolledEmail);
                        setNeedsEnrolment(false);
                        void handleUnlockFallback();
                      }}
                    >
                      Use device unlock code instead
                    </Button>
                  ) : null}
                </form>
              </TabsContent>
              <TabsContent value="signup">
                <form onSubmit={handleSignUp} className="space-y-3 pt-4">
                  <div className="space-y-2"><Label>Email</Label><Input type="email" required value={email} onChange={(e)=>setEmail(e.target.value)} /></div>
                  <div className="space-y-2"><Label>Password</Label><Input type="password" required minLength={6} value={password} onChange={(e)=>setPassword(e.target.value)} /></div>
                  <Button className="w-full" type="submit" disabled={loading}>{loading?"…":"Create account"}</Button>
                  <p className="text-xs text-muted-foreground text-center">The first account created becomes Admin.</p>
                </form>
              </TabsContent>
            </Tabs>
          )}
        </CardContent>
      </Card>
    </div>
  );

  /** Lets an enrolled user choose the local unlock code even while online. */
  function handleUnlockFallback() {
    setUnlockCode("");
    setForceUnlock(true);
  }
}
