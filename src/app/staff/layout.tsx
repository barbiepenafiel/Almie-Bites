import { Suspense } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getRole } from "@/lib/auth-role";
import { StaffShell } from "@/components/staff/staff-shell";
import { StaffDataProvider } from "@/components/staff/staff-data";
import { InactiveNotice } from "@/components/staff/inactive-notice";
import { BrandLogo } from "@/components/app/brand-logo";


// Signed-in area: depends on the session and may redirect to /login, so it is
// rendered per request rather than validated as an instant (prerendered) route.
export const instant = false;
async function StaffGate({ children }: { children: React.ReactNode }) {
  // Session checks read the clock (token expiry); render this part per request.
  await connection();
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims?.sub) redirect("/login");
  const role = await getRole(supabase);
  if (role === "admin") redirect("/dashboard");
  if (role !== "staff") return <InactiveNotice />;
  return (
    <StaffDataProvider>
      <StaffShell>{children}</StaffShell>
    </StaffDataProvider>
  );
}

function Fallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background" aria-busy="true">
      <BrandLogo size={64} priority className="animate-pulse" />
    </div>
  );
}

export default function StaffLayout({ children }: LayoutProps<"/staff">) {
  return (
    <Suspense fallback={<Fallback />}>
      <StaffGate>{children}</StaffGate>
    </Suspense>
  );
}
