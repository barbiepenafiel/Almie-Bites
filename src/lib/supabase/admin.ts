import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "./env";

/**
 * Privileged Supabase client (bypasses RLS). SERVER ONLY.
 * Used exclusively by admin-verified server actions to manage staff logins.
 */
export function createAdminClient(): SupabaseClient {
  if (typeof window !== "undefined") throw new Error("Admin client must never run in the browser.");
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error(
      "Staff accounts need SUPABASE_SECRET_KEY in your environment (server-only, never NEXT_PUBLIC_).",
    );
  }
  return createSupabaseClient(SUPABASE_URL, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
