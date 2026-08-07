import { createFileRoute, Outlet, redirect, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { useBusinessConfigLoader } from "@/lib/use-settings";
import { isModuleVisible, moduleKeyForPath, useMenuVisibility } from "@/lib/menu-visibility";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth", search: {} });
    return { user: data.user };
  },
  component: AuthLayout,
});

/** Blocks navigation to modules the owner switched OFF in Settings → Menu Visibility. */
function useMenuGuard() {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { data: visibility } = useMenuVisibility();
  useEffect(() => {
    if (!visibility) return;
    const key = moduleKeyForPath(pathname);
    if (key && key !== "/" && !isModuleVisible(visibility, key)) {
      navigate({ to: "/", replace: true });
    }
  }, [pathname, visibility, navigate]);
}

function AuthLayout() {
  const [ready, setReady] = useState(true);
  useEffect(() => setReady(true), []);
  useBusinessConfigLoader();
  useMenuGuard();
  if (!ready) return null;
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}


