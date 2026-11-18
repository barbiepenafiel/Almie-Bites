import Link from "next/link";
import { isSupabaseConfigured } from "@/lib/supabase/env";

export const metadata = { title: "Setup" };

export default function SetupPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-4 px-4 py-10">
      <h1 className="font-heading text-3xl font-semibold">Connect Almie Bites to Supabase</h1>
      <p className="text-muted-foreground">
        The app needs a Supabase project before it can store your products, inventory, sales and expenses.
      </p>
      <ol className="list-decimal space-y-2 pl-5 text-sm">
        <li>Create a free project at supabase.com.</li>
        <li>
          Open <strong>SQL Editor</strong> and run both files in <code>supabase/migrations/</code>, in order.
        </li>
        <li>
          Copy <code>.env.local.example</code> to <code>.env.local</code> and paste your project URL and publishable (anon)
          key from <strong>Project Settings → API</strong>.
        </li>
        <li>Restart the dev server, then sign up with your email.</li>
      </ol>
      {isSupabaseConfigured && (
        <p className="text-sm">
          Supabase is configured. <Link href="/dashboard" className="font-medium text-primary underline">Go to the dashboard →</Link>
        </p>
      )}
    </main>
  );
}
