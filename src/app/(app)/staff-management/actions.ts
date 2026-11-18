"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getRole } from "@/lib/auth-role";

export type ActionResult = { ok: true } | { ok: false; error: string };

/** Verifies the caller is the business owner; returns their id + RLS client. */
async function requireAdmin() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const uid = data?.claims?.sub;
  if (!uid) throw new Error("Please sign in again.");
  if ((await getRole(supabase)) !== "admin") throw new Error("Only the owner can manage staff.");
  return { supabase, uid };
}

/** Loads a staff row through RLS, which proves it belongs to this owner. */
async function ownedStaff(supabase: Awaited<ReturnType<typeof createClient>>, staffId: string) {
  const { data, error } = await supabase.from("staff").select("id, user_id, email, full_name").eq("id", staffId).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Staff member not found.");
  return data as { id: string; user_id: string | null; email: string | null; full_name: string };
}

const fail = (e: unknown): ActionResult => {
  const msg = (e as { message?: string })?.message ?? "Something went wrong.";
  if (/already (been )?registered|already exists/i.test(msg)) return { ok: false, error: "That email is already used by another account." };
  return { ok: false, error: msg };
};

const password = z.string().min(8, "Password must be at least 8 characters.").max(72);

const createSchema = z.object({
  full_name: z.string().trim().min(1, "Full name is required.").max(100),
  email: z.email("Enter a valid email."),
  password,
  staff_code: z.string().trim().max(30).optional(),
  phone: z.string().trim().max(30).optional(),
});

export async function createStaffAccount(input: z.input<typeof createSchema>): Promise<ActionResult> {
  try {
    const v = createSchema.parse(input);
    const { supabase, uid } = await requireAdmin();
    const admin = createAdminClient();
    const { data: created, error } = await admin.auth.admin.createUser({
      email: v.email.trim().toLowerCase(),
      password: v.password,
      email_confirm: true,
      app_metadata: { role: "staff", business_id: uid },
      user_metadata: { full_name: v.full_name },
    });
    if (error) throw error;
    const { error: insErr } = await supabase.from("staff").insert({
      user_id: created.user.id,
      full_name: v.full_name,
      staff_code: v.staff_code || null,
      phone: v.phone || null,
      email: v.email.trim().toLowerCase(),
    });
    if (insErr) {
      await admin.auth.admin.deleteUser(created.user.id); // roll back the login
      if (insErr.code === "23505") throw new Error("That staff code is already used.");
      throw insErr;
    }
    return { ok: true };
  } catch (e) {
    if (e instanceof z.ZodError) return { ok: false, error: e.issues[0]?.message ?? "Invalid input." };
    return fail(e);
  }
}

const updateSchema = z.object({
  full_name: z.string().trim().min(1, "Full name is required.").max(100),
  email: z.email("Enter a valid email."),
  staff_code: z.string().trim().max(30).optional(),
  phone: z.string().trim().max(30).optional(),
  payout_method: z.string().trim().max(40).optional(),
  notes: z.string().trim().max(500).optional(),
});

export async function updateStaffAccount(staffId: string, input: z.input<typeof updateSchema>): Promise<ActionResult> {
  try {
    const v = updateSchema.parse(input);
    const { supabase } = await requireAdmin();
    const row = await ownedStaff(supabase, staffId);
    const email = v.email.trim().toLowerCase();
    if (row.user_id && email !== (row.email ?? "").toLowerCase()) {
      const { error } = await createAdminClient().auth.admin.updateUserById(row.user_id, { email, email_confirm: true });
      if (error) throw error;
    }
    const { error } = await supabase
      .from("staff")
      .update({
        full_name: v.full_name,
        email,
        staff_code: v.staff_code || null,
        phone: v.phone || null,
        payout_method: v.payout_method || "Cash",
        notes: v.notes || null,
      })
      .eq("id", staffId);
    if (error) {
      if (error.code === "23505") throw new Error("That staff code is already used.");
      throw error;
    }
    return { ok: true };
  } catch (e) {
    if (e instanceof z.ZodError) return { ok: false, error: e.issues[0]?.message ?? "Invalid input." };
    return fail(e);
  }
}

export async function resetStaffPassword(staffId: string, newPassword: string): Promise<ActionResult> {
  try {
    const pw = password.parse(newPassword);
    const { supabase } = await requireAdmin();
    const row = await ownedStaff(supabase, staffId);
    if (!row.user_id) throw new Error("This staff member has no login.");
    const { error } = await createAdminClient().auth.admin.updateUserById(row.user_id, { password: pw });
    if (error) throw error;
    return { ok: true };
  } catch (e) {
    if (e instanceof z.ZodError) return { ok: false, error: e.issues[0]?.message ?? "Invalid password." };
    return fail(e);
  }
}

export async function setStaffActive(staffId: string, active: boolean): Promise<ActionResult> {
  try {
    const { supabase } = await requireAdmin();
    const row = await ownedStaff(supabase, staffId);
    const { error } = await supabase.from("staff").update({ is_active: active }).eq("id", staffId);
    if (error) throw error;
    if (row.user_id) {
      // Block sign-in while inactive (the database also refuses inactive staff).
      const { error: banErr } = await createAdminClient().auth.admin.updateUserById(row.user_id, {
        ban_duration: active ? "none" : "876000h",
      });
      if (banErr) throw banErr;
    }
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}
