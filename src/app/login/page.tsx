import { Suspense } from "react";
import { LoginForm } from "./login-form";
import { BrandLogo } from "@/components/app/brand-logo";

export const metadata = { title: "Sign in" };

async function LoginFormFromParams({ searchParams }: { searchParams: PageProps<"/login">["searchParams"] }) {
  const sp = await searchParams;
  const next =
    typeof sp.next === "string" && sp.next.startsWith("/") && !sp.next.startsWith("//") ? sp.next : "/dashboard";
  return <LoginForm next={next} authError={sp.error === "auth"} />;
}

export default function LoginPage(props: PageProps<"/login">) {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-10">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 [background-image:radial-gradient(var(--border)_1px,transparent_1px)] [background-size:22px_22px] [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_75%)]"
      />
      <div className="relative w-full max-w-sm">
        <div className="mb-6 text-center">
          <BrandLogo size={112} priority className="mx-auto mb-3 shadow-lg shadow-black/10" />
          <h1 className="font-heading text-3xl font-semibold">Almie Bites</h1>
          <p className="mt-1 text-sm text-muted-foreground">Inventory &amp; daily sales, in one place.</p>
        </div>
        <Suspense fallback={<div className="h-72 animate-pulse rounded-xl bg-card ring-1 ring-foreground/10" />}>
          <LoginFormFromParams searchParams={props.searchParams} />
        </Suspense>
      </div>
    </main>
  );
}
