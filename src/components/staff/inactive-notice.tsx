"use client";

import { useRouter } from "next/navigation";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

export function InactiveNotice() {
  const router = useRouter();
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-sm text-center">
        <span className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-muted">
          <Lock className="size-5" aria-hidden />
        </span>
        <h1 className="font-heading text-2xl font-semibold">Account inactive</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your staff account has been deactivated. Please contact the owner of Almie Bites.
        </p>
        <Button
          className="mt-6"
          variant="outline"
          onClick={async () => {
            await createClient().auth.signOut();
            router.replace("/login");
            router.refresh();
          }}
        >
          Sign out
        </Button>
      </div>
    </main>
  );
}
