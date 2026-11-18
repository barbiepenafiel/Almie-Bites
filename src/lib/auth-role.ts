import type { SupabaseClient } from "@supabase/supabase-js";

export type AppRole = "admin" | "staff" | "inactive_staff" | "anonymous";

/** Resolves the caller's role from the database (source of truth). */
export async function getRole(supabase: SupabaseClient): Promise<AppRole> {
  const { data, error } = await supabase.rpc("my_role");
  if (error) {
    // Before the staff migration is applied, everyone signed in is the owner.
    if (error.code === "PGRST202") return "admin";
    throw error;
  }
  return (data as AppRole) ?? "anonymous";
}
