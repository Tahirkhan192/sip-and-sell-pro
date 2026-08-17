import { createFileRoute, Outlet, redirect, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { resolveAccess } from "@/data/auth/local-auth";
import { AppShell } from "@/components/AppShell";
import { useBusinessConfigLoader } from "@/lib/use-settings";
import { isModuleVisible, moduleKeyForPath, useMenuVisibility } from "@/lib/menu-visibility";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  // PHASE 7 — online cloud session first; a valid enrolled local session is
  // the only offline fallback. SQLite data alone never authenticates anyone.
  beforeLoad: async () => {
    const access = await resolveAccess();
    if (access.mode === "signed-out") throw redirect({ to: "/auth", search: {} });
    return { access };
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


