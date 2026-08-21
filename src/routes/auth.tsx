import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { toast } from "sonner";
import { Coffee, Delete } from "lucide-react";
import { signInWithPasscode, isDefaultPasscode } from "@/lib/passcode";

export const Route = createFileRoute("/auth")({
  ssr: false,
  validateSearch: (s: Record<string, unknown>): { next?: string } => ({
    next: typeof s.next === "string" ? s.next : undefined,
  }),
  beforeLoad: async ({ search }) => {
    if (typeof window === "undefined") return;
    const { data } = await supabase.auth.getSession();
    if (data.session) {
      const dest = search.next && search.next.startsWith("/") && !search.next.startsWith("//") ? search.next : "/";
      throw redirect({ href: dest });
    }
  },
  head: () => ({
    meta: [
      { title: "Sign in — Khyber Delicious Food" },
      { name: "description", content: "Enter your passcode to open Khyber Delicious Food on this computer." },
      { property: "og:title", content: "Sign in — Khyber Delicious Food" },
      { property: "og:description", content: "Offline passcode sign-in for Khyber Delicious Food." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuthPage,
});

function safeNext(next: string | undefined): string {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

function AuthPage() {
  const { next } = Route.useSearch();
  const [pin, setPin] = useState("");
  const [loading, setLoading] = useState(false);
  const [isDefault, setIsDefault] = useState(false);

  useEffect(() => {
    isDefaultPasscode().then(setIsDefault).catch(() => setIsDefault(false));
  }, []);

  async function submit(value: string) {
    if (loading) return;
    setLoading(true);
    try {
      const res = await signInWithPasscode(value);
      if (!res.ok) {
        toast.error(res.error);
        setPin("");
        return;
      }
      window.location.href = safeNext(next);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sign in failed");
    } finally {
      setLoading(false);
    }
  }

  function press(digit: string) {
    setPin((p) => (p.length >= 12 ? p : p + digit));
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-background via-secondary/40 to-background">
      <Card className="w-full max-w-sm shadow-xl">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Coffee className="h-6 w-6" />
          </div>
          <CardTitle className="text-2xl">Khyber Delicious Food</CardTitle>
          <CardDescription>Enter your passcode to continue</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void submit(pin);
            }}
          >
            <Input
              autoFocus
              type="password"
              inputMode="numeric"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
              className="text-center text-2xl tracking-[0.5em] h-14"
              aria-label="Passcode"
            />
            <div className="grid grid-cols-3 gap-2">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
                <Button key={d} type="button" variant="secondary" className="h-12 text-lg" onClick={() => press(d)}>
                  {d}
                </Button>
              ))}
              <Button type="button" variant="ghost" className="h-12" onClick={() => setPin("")}>
                Clear
              </Button>
              <Button type="button" variant="secondary" className="h-12 text-lg" onClick={() => press("0")}>
                0
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="h-12"
                aria-label="Delete last digit"
                onClick={() => setPin((p) => p.slice(0, -1))}
              >
                <Delete className="h-5 w-5" />
              </Button>
            </div>
            <Button className="w-full h-12" type="submit" disabled={loading || pin.length < 4}>
              {loading ? "Opening…" : "Unlock"}
            </Button>
            {isDefault && (
              <p className="text-xs text-muted-foreground text-center">
                Default passcode is <code>1234</code>. You can change it in Settings.
              </p>
            )}
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
