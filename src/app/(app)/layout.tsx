import { Suspense } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getRole } from "@/lib/auth-role";
import { AppDataProvider } from "@/components/app/app-data";
import { AppShell } from "@/components/app/app-shell";
import { BrandLogo } from "@/components/app/brand-logo";


// Signed-in area: depends on the session and may redirect to /login, so it is
// rendered per request rather than validated as an instant (prerendered) route.
export const instant = false;
async function AuthenticatedShell({ children }: { children: React.ReactNode }) {
  // Session checks read the clock (token expiry); render this part per request.
  await connection();
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) redirect("/login");
  // Staff have their own area; never render the admin UI for them.
  if ((await getRole(supabase)) !== "admin") redirect("/staff");

  return (
    <AppDataProvider userEmail={(claims.email as string | undefined) ?? ""}>
      <AppShell>{children}</AppShell>
    </AppDataProvider>
  );
}

function ShellFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background" aria-busy="true">
      <div className="flex flex-col items-center gap-3">
        <BrandLogo size={64} priority className="animate-pulse" />
        <p className="text-sm text-muted-foreground">Loading Almie Bites…</p>
      </div>
    </div>
  );
}

export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <Suspense fallback={<ShellFallback />}>
      <AuthenticatedShell>{children}</AuthenticatedShell>
    </Suspense>
  );
}
