import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

// TanStack Router escapes literal dots with [.]; the URL path is /.lovable/oauth/consent.
export const Route = createFileRoute("/.lovable/oauth/consent")({
  ssr: false,
  validateSearch: (s: Record<string, unknown>) => ({
    authorization_id: typeof s.authorization_id === "string" ? s.authorization_id : "",
  }),
  beforeLoad: async ({ search, location }) => {
    if (!search.authorization_id) throw new Error("Missing authorization_id");
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      const next = location.pathname + location.searchStr;
      throw redirect({ to: "/auth", search: { next } });
    }
  },
  loader: async ({ location }) => {
    const authorizationId = new URLSearchParams(location.search).get("authorization_id")!;
    const authAny = supabase.auth as any;
    const { data, error } = await authAny.oauth.getAuthorizationDetails(authorizationId);
    if (error) throw error;
    const immediate = data?.redirect_url ?? data?.redirect_to;
    if (immediate && !data?.client) throw redirect({ href: immediate });
    return data;
  },
  component: Consent,
  errorComponent: ({ error }) => (
    <main className="min-h-screen flex items-center justify-center p-6">
      <Card className="max-w-md w-full">
        <CardHeader>
          <CardTitle>Authorization error</CardTitle>
          <CardDescription>Could not load this authorization request.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{String((error as Error)?.message ?? error)}</p>
        </CardContent>
      </Card>
    </main>
  ),
});

function Consent() {
  const details = Route.useLoaderData() as any;
  const { authorization_id } = Route.useSearch();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decide(approve: boolean) {
    setBusy(true);
    setError(null);
    const authAny = supabase.auth as any;
    const { data, error } = approve
      ? await authAny.oauth.approveAuthorization(authorization_id)
      : await authAny.oauth.denyAuthorization(authorization_id);
    if (error) {
      setBusy(false);
      setError(error.message);
      return;
    }
    const target = data?.redirect_url ?? data?.redirect_to;
    if (!target) {
      setBusy(false);
      setError("No redirect returned by the authorization server.");
      return;
    }
    window.location.href = target;
  }

  const clientName = details?.client?.name ?? "an app";

  return (
    <main className="min-h-screen flex items-center justify-center p-6 bg-gradient-to-br from-background via-secondary/40 to-background">
      <Card className="max-w-md w-full shadow-xl">
        <CardHeader>
          <CardTitle>Connect {clientName}</CardTitle>
          <CardDescription>
            {clientName} is requesting access to Café Manager as you.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="text-sm text-muted-foreground space-y-2">
            <p>This lets {clientName} use this app's tools as you. Your app permissions and data policies still apply.</p>
            {details?.client?.redirect_uri && (
              <p className="text-xs break-all">Redirect: {details.client.redirect_uri}</p>
            )}
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <div className="flex gap-2 justify-end">
            <Button variant="outline" disabled={busy} onClick={() => decide(false)}>Deny</Button>
            <Button disabled={busy} onClick={() => decide(true)}>Approve</Button>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
