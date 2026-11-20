"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { CircleUser, History, Home, LogOut, PackagePlus, PackageX, ShoppingBag, Wallet, ReceiptText } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { ErrorState } from "@/components/app/common";
import { useStaffData } from "@/components/staff/staff-data";
import { BrandLogo } from "@/components/app/brand-logo";

const NAV = [
  { href: "/staff", label: "My Dashboard", short: "Home", icon: Home },
  { href: "/staff/sell", label: "Record Sale", short: "Sell", icon: ShoppingBag },
  { href: "/staff/requests", label: "Request Supplies", short: "Request", icon: PackagePlus },
  { href: "/staff/sales", label: "My Sales", short: "Sales", icon: History },
  { href: "/staff/unsold", label: "Unsold Yesterday", short: "Unsold", icon: PackageX },
  { href: "/staff/earnings", label: "My Earnings", short: "Earnings", icon: Wallet },
  { href: "/staff/payments", label: "My Payment History", short: "Payments", icon: ReceiptText },
  { href: "/staff/account", label: "Account", short: "Account", icon: CircleUser },
];
// Bottom bar on phones (5 slots); the rest stay in the sidebar / top bar.
const MOBILE_NAV = ["/staff", "/staff/sell", "/staff/requests", "/staff/sales", "/staff/earnings"];

function isActive(pathname: string, href: string) {
  return href === "/staff" ? pathname === "/staff" : pathname === href || pathname.startsWith(href + "/");
}

export function StaffShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { profile, error, refresh } = useStaffData();
  const business = profile?.business_name ?? "Almie Bites";

  async function signOut() {
    await createClient().auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="no-print sticky top-0 hidden h-screen w-60 shrink-0 flex-col gap-6 border-r border-sidebar-border bg-sidebar px-3 py-5 md:flex">
        <Link href="/staff" className="flex items-center gap-2.5 px-2">
          <BrandLogo src={profile?.logo_url} size={40} priority />
          <span className="min-w-0">
            <span className="block truncate font-heading text-lg font-semibold leading-tight">{business}</span>
            <span className="block text-[11px] text-muted-foreground">Staff</span>
          </span>
        </Link>
        <nav className="grid gap-1" aria-label="Staff">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = isActive(pathname, href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  active ? "bg-sidebar-primary text-sidebar-primary-foreground" : "text-sidebar-foreground/80 hover:bg-sidebar-accent",
                )}
              >
                <Icon className="size-4.5" aria-hidden /> {label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto grid gap-2 px-2">
          {profile && <p className="truncate text-xs text-muted-foreground">Signed in as {profile.full_name}</p>}
          <Button variant="outline" size="sm" onClick={signOut}>
            <LogOut /> Sign out
          </Button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print sticky top-0 z-30 flex h-14 items-center justify-between border-b bg-background/90 px-4 backdrop-blur md:hidden">
          <span className="flex items-center gap-2">
            <BrandLogo src={profile?.logo_url} size={32} />
            <span className="font-heading text-base font-semibold">{business}</span>
          </span>
          <span className="flex items-center gap-1">
            <Link
              href="/staff/account"
              aria-label="Account"
              className={cn("flex size-8 items-center justify-center rounded-lg", isActive(pathname, "/staff/account") ? "bg-primary text-primary-foreground" : "hover:bg-muted")}
            >
              <CircleUser className="size-4.5" aria-hidden />
            </Link>
            <Button variant="ghost" size="icon" onClick={signOut} aria-label="Sign out">
              <LogOut />
            </Button>
          </span>
        </header>

        <main className="mx-auto w-full max-w-5xl flex-1 px-4 pt-6 pb-28 sm:px-6 md:pb-10">
          {error ? (
            <div className="mx-auto max-w-md">
              <ErrorState message={error} onRetry={() => void refresh()} />
            </div>
          ) : (
            children
          )}
        </main>

        {/* Mobile bottom navigation */}
        <nav
          aria-label="Staff"
          className="no-print fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
        >
          {NAV.filter((n) => MOBILE_NAV.includes(n.href)).map(({ href, short, icon: Icon }) => {
            const active = isActive(pathname, href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium",
                  active ? "text-foreground" : "text-muted-foreground",
                )}
              >
                <span className={cn("flex h-7 w-12 items-center justify-center rounded-full", active && "bg-primary text-primary-foreground")}>
                  <Icon className="size-4.5" aria-hidden />
                </span>
                {short}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
