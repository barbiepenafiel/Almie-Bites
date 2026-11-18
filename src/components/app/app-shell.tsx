"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { BrandLogo } from "@/components/app/brand-logo";
import {
  BarChart3,
  Boxes,
  CalendarCheck,
  ChefHat,
  LayoutDashboard,
  LogOut,
  Menu,
  ReceiptText,
  Settings,
  ShoppingCart,
  Users,
  LineChart,
  HandCoins,
  ClipboardCheck,
  ClipboardList,
  PackagePlus,
  Target,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { createClient } from "@/lib/supabase/client";
import { useQuery } from "@/hooks/use-query";
import { useAppData } from "@/components/app/app-data";
import { ErrorState } from "@/components/app/common";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/products", label: "Products", icon: ChefHat },
  { href: "/inventory", label: "Inventory", icon: Boxes },
  { href: "/sales", label: "Sales", icon: ShoppingCart },
  { href: "/expenses", label: "Expenses", icon: ReceiptText },
  { href: "/recovery", label: "Expense Recovery", icon: Target },
  { href: "/summary", label: "Daily Summary", icon: CalendarCheck },
  { href: "/reports", label: "Reports", icon: BarChart3 },
  { href: "/settings", label: "Settings", icon: Settings },
];

const STAFF_NAV = [
  { href: "/staff-management", label: "Staff Management", icon: Users },
  { href: "/assignments", label: "Daily Assignments", icon: ClipboardList },
  { href: "/requests", label: "Supply Requests", icon: PackagePlus },
  { href: "/staff-sales", label: "Staff Sales", icon: LineChart },
  { href: "/staff-payroll", label: "Staff Earnings & Pay", icon: HandCoins },
  { href: "/daily-closing", label: "Daily Closing", icon: ClipboardCheck },
];

function Brand() {
  const { settings } = useAppData();
  const name = settings?.business_name ?? "Almie Bites";
  return (
    <Link href="/dashboard" className="flex items-center gap-2.5 px-2">
      <BrandLogo src={settings?.logo_url} size={40} priority />
      <span className="min-w-0">
        <span className="block truncate font-heading text-lg font-semibold leading-tight">{name}</span>
        <span className="block text-[11px] text-muted-foreground">Inventory &amp; Sales</span>
      </span>
    </Link>
  );
}

/** Number of pending staff supply requests (0 if the feature isn't set up yet). */
function usePendingRequests() {
  const { data } = useQuery(
    async (sb) => {
      const { count, error } = await sb.from("supply_requests").select("id", { count: "exact", head: true }).eq("status", "pending");
      return error ? 0 : (count ?? 0);
    },
    [],
    { realtime: ["supply_requests"] },
  );
  return data ?? 0;
}

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pendingRequests = usePendingRequests();
  const pathname = usePathname();
  return (
    <nav className="grid gap-1" aria-label="Main">
      {[...NAV.slice(0, -1), { section: "Staff" } as const, ...STAFF_NAV, { section: "" } as const, NAV[NAV.length - 1]].map((entry, idx) => {
        if ("section" in entry)
          return entry.section ? (
            <p key={idx} className="mt-3 px-3 pb-1 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
              {entry.section}
            </p>
          ) : (
            <div key={idx} className="my-2 border-t border-sidebar-border" />
          );
        const { href, label, icon: Icon } = entry;
        const active = pathname === href || pathname.startsWith(href + "/");
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-sm"
                : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
            )}
          >
            <Icon className="size-4.5 shrink-0" aria-hidden />
            {label}
            {href === "/requests" && pendingRequests > 0 && (
              <span
                className={cn(
                  "ml-auto rounded-full px-1.5 text-[11px] font-semibold tabular-nums",
                  active ? "bg-sidebar-primary-foreground text-sidebar-primary" : "bg-warning-soft text-warning",
                )}
                aria-label={`${pendingRequests} pending`}
              >
                {pendingRequests}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

function UserMenu() {
  const { userEmail } = useAppData();
  const router = useRouter();
  async function signOut() {
    await createClient().auth.signOut();
    router.replace("/login");
    router.refresh();
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" className="h-9 gap-2 px-2">
            <span className="flex size-7 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-primary">
              {userEmail.charAt(0).toUpperCase() || "A"}
            </span>
            <span className="hidden max-w-40 truncate text-sm sm:inline">{userEmail}</span>
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="truncate">{userEmail}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => router.push("/settings")}>
          <Settings aria-hidden /> Settings
        </DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onClick={signOut}>
          <LogOut aria-hidden /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const { setupError, refresh } = useAppData();

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="no-print sticky top-0 hidden h-screen w-64 shrink-0 flex-col gap-6 overflow-y-auto border-r border-sidebar-border bg-sidebar px-3 py-5 lg:flex">
        <Brand />
        <NavLinks />
        <p className="mt-auto px-3 text-[11px] text-muted-foreground">Times shown in Philippine time</p>
      </aside>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="w-72 gap-6 overflow-y-auto bg-sidebar px-3 py-5">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <Brand />
          <NavLinks onNavigate={() => setOpen(false)} />
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/85 px-4 backdrop-blur sm:px-6">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu">
            <Menu />
          </Button>
          <div className="lg:hidden">
            <Brand />
          </div>
          <div className="ml-auto">
            <UserMenu />
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8">
          {setupError ? (
            <div className="mx-auto max-w-lg">
              <ErrorState
                message={`Couldn't load your business data: ${setupError}. Make sure the Supabase migrations have been run.`}
                onRetry={() => void refresh()}
              />
            </div>
          ) : (
            children
          )}
        </main>
      </div>
    </div>
  );
}
