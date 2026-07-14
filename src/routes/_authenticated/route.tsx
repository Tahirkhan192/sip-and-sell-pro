import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { useBusinessConfigLoader } from "@/lib/use-settings";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    return { user: data.user };
  },
  component: AuthLayout,
});

function AuthLayout() {
  const [ready, setReady] = useState(true);
  useEffect(() => setReady(true), []);
  useBusinessConfigLoader();
  if (!ready) return null;
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}

