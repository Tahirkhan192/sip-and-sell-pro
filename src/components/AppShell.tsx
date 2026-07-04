import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  ShoppingCart,
  Receipt,
  Package,
  Truck,
  Wallet,
  Boxes,
  BarChart3,
  Bike,
  Send,
  LogOut,
  Moon,
  Sun,
  Coffee,
  Menu,
  ChefHat,
  Tag,
  Users,
  Settings as SettingsIcon,
  ArrowLeftRight,
  BookOpen,
  Banknote,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";

type NavItem = { to: string; label: string; icon: typeof LayoutDashboard; exact?: boolean };
const NAV: NavItem[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { to: "/pos", label: "POS", icon: ShoppingCart },
  { to: "/sales", label: "Sales", icon: Receipt },
  { to: "/products", label: "Products", icon: Package },
  { to: "/categories", label: "Categories", icon: Tag },
  { to: "/recipes", label: "Recipes", icon: ChefHat },
  { to: "/production", label: "Production", icon: ChefHat },
  { to: "/stock-items", label: "Stock Items", icon: Boxes },
  { to: "/stock-transfer", label: "Stock Transfer", icon: ArrowLeftRight },
  { to: "/purchases", label: "Purchases", icon: Truck },
  { to: "/customers", label: "Customers", icon: Users },
  { to: "/expenses", label: "Expenses", icon: Wallet },
  { to: "/cash-movements", label: "Cash Movements", icon: Banknote },
  { to: "/daily-closing", label: "Daily Closing", icon: BookOpen },
  { to: "/delivery-expenses", label: "Delivery Expenses", icon: Bike },
  { to: "/delivery-report", label: "Delivery Report", icon: Send },
  { to: "/stock", label: "Stock", icon: Boxes },
  { to: "/reports", label: "Reports", icon: BarChart3 },
  { to: "/settings", label: "Settings", icon: SettingsIcon },
];

function useTheme() {
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    if (typeof window === "undefined") return "light";
    return (localStorage.getItem("theme") as "light" | "dark") ?? "light";
  });
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem("theme", theme);
  }, [theme]);
  return { theme, toggle: () => setTheme((t) => (t === "dark" ? "light" : "dark")) };
}

function AppSidebar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <Sidebar>
      <SidebarHeader className="border-b border-sidebar-border">
        <div className="flex items-center gap-2 px-2 py-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
            <Coffee className="h-5 w-5" />
          </div>
          <div>
            <div className="text-base font-semibold leading-tight text-sidebar-foreground">Café Manager</div>
            <div className="text-xs text-sidebar-foreground/60">Single café edition</div>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV.map((item) => {
                const active = item.exact ? pathname === item.to : pathname.startsWith(item.to);
                return (
                  <SidebarMenuItem key={item.to}>
                    <SidebarMenuButton asChild isActive={active}>
                      <Link to={item.to as "/"} className="flex items-center gap-2">
                        <item.icon className="h-4 w-4" />
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border p-2">
        <div className="text-[10px] text-sidebar-foreground/50 px-2 py-1">v1.0 · Future-ready</div>
      </SidebarFooter>
    </Sidebar>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const { theme, toggle } = useTheme();

  async function signOut() {
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-background">
        <AppSidebar />
        <div className="flex flex-1 flex-col">
          <header className="no-print sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/80 px-3 backdrop-blur md:px-6">
            <SidebarTrigger>
              <Menu className="h-5 w-5" />
            </SidebarTrigger>
            <div className="flex-1" />
            <Button variant="ghost" size="icon" onClick={toggle} aria-label="Toggle theme">
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
            <Button variant="ghost" size="icon" onClick={signOut} aria-label="Sign out">
              <LogOut className="h-4 w-4" />
            </Button>
          </header>
          <main className="flex-1 p-4 md:p-6">{children}</main>
          <Toaster richColors position="top-right" />
        </div>
      </div>
    </SidebarProvider>
  );
}
