"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Field, LoadingRows, PageHeader, SubmitButton } from "@/components/app/common";
import { useStaffData } from "@/components/staff/staff-data";
import { createClient } from "@/lib/supabase/client";
import { errorMessage } from "@/lib/format";
import { formatDate, toManilaDate } from "@/lib/dates";
import { describeEarning } from "@/lib/staff-utils";

export default function StaffAccountPage() {
  const { profile } = useStaffData();
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    if (pw.length < 8) return setErr("Password must be at least 8 characters.");
    if (pw !== pw2) return setErr("Passwords don't match.");
    setErr(null);
    setBusy(true);
    const { error } = await createClient().auth.updateUser({ password: pw });
    setBusy(false);
    if (error) return setErr(errorMessage(error));
    setPw("");
    setPw2("");
    toast.success("Password changed");
  }

  return (
    <>
      <PageHeader title="Account" />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>My profile</CardTitle>
            <CardDescription>Ask the owner if any of this needs changing.</CardDescription>
          </CardHeader>
          <CardContent>
            {!profile ? (
              <LoadingRows rows={4} />
            ) : (
              <dl className="grid gap-3 text-sm">
                {[
                  ["Name", profile.full_name],
                  ["Staff code", profile.staff_code ?? "—"],
                  ["Email", profile.email ?? "—"],
                  ["Phone", profile.phone ?? "—"],
                  ["Works at", profile.business_name],
                  ["How I earn", describeEarning(profile)],
                  ["Member since", formatDate(toManilaDate(profile.created_at))],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-4 border-b pb-2 last:border-0">
                    <dt className="text-muted-foreground">{k}</dt>
                    <dd className="text-right font-medium">{v}</dd>
                  </div>
                ))}
              </dl>
            )}
          </CardContent>
        </Card>
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Change password</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={changePassword} className="grid gap-4" noValidate>
              <Field label="New password" htmlFor="pw1">
                <Input id="pw1" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
              </Field>
              <Field label="Confirm new password" htmlFor="pw2" error={err ?? undefined}>
                <Input id="pw2" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
              </Field>
              <div>
                <SubmitButton busy={busy}>Update password</SubmitButton>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
