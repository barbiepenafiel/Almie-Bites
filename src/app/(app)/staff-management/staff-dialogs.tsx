"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Field, SimpleSelect, SubmitButton } from "@/components/app/common";
import { useAppData } from "@/components/app/app-data";
import { createClient } from "@/lib/supabase/client";
import { errorMessage, formatPeso, money, toNumber } from "@/lib/format";
import { EARNING_TYPE_LABELS, type EarningType, type Product, type Staff } from "@/lib/types";
import { DEFAULT_TIERS, sortTiers, tierPay } from "@/lib/staff-utils";
import { createStaffAccount, resetStaffPassword, updateStaffAccount } from "./actions";

/* ------------------------------------------------------------------ */
export function StaffFormDialog({
  open,
  onOpenChange,
  staff,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  staff?: Staff | null;
  onSaved: () => void;
}) {
  const { paymentMethods } = useAppData();
  const [f, setF] = useState({ full_name: "", email: "", password: "", staff_code: "", phone: "", payout_method: "Cash", notes: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setError(null);
    setF({
      full_name: staff?.full_name ?? "",
      email: staff?.email ?? "",
      password: "",
      staff_code: staff?.staff_code ?? "",
      phone: staff?.phone ?? "",
      payout_method: staff?.payout_method ?? paymentMethods[0] ?? "Cash",
      notes: staff?.notes ?? "",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, staff]);

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF((x) => ({ ...x, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = staff
      ? await updateStaffAccount(staff.id, {
          full_name: f.full_name,
          email: f.email,
          staff_code: f.staff_code,
          phone: f.phone,
          payout_method: f.payout_method,
          notes: f.notes,
        })
      : await createStaffAccount({ full_name: f.full_name, email: f.email, password: f.password, staff_code: f.staff_code, phone: f.phone });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    toast.success(staff ? "Staff details saved" : `${f.full_name} can now sign in with ${f.email}`);
    onOpenChange(false);
    onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{staff ? `Edit ${staff.full_name}` : "Add staff account"}</DialogTitle>
          <DialogDescription>
            {staff ? "Update this staff member's details." : "Creates a login for the staff member. Share the email and password with them."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name" htmlFor="sf-name">
              <Input id="sf-name" value={f.full_name} onChange={set("full_name")} autoFocus />
            </Field>
            <Field label="Staff code (optional)" htmlFor="sf-code" hint="e.g. S1">
              <Input id="sf-code" value={f.staff_code} onChange={set("staff_code")} />
            </Field>
            <Field label="Login email" htmlFor="sf-email">
              <Input id="sf-email" type="email" autoComplete="off" value={f.email} onChange={set("email")} />
            </Field>
            <Field label="Phone (optional)" htmlFor="sf-phone">
              <Input id="sf-phone" type="tel" value={f.phone} onChange={set("phone")} />
            </Field>
            {!staff && (
              <Field label="Password" htmlFor="sf-pw" hint="At least 8 characters" className="sm:col-span-2">
                <Input id="sf-pw" type="text" autoComplete="new-password" value={f.password} onChange={set("password")} />
              </Field>
            )}
            {staff && (
              <Field label="How you pay them">
                <SimpleSelect aria-label="Payout method" value={f.payout_method} onChange={(v) => setF((x) => ({ ...x, payout_method: v }))} options={paymentMethods.map((m) => ({ value: m, label: m }))} />
              </Field>
            )}
          </div>
          {staff && (
            <Field label="Notes (optional)" htmlFor="sf-notes">
              <Textarea id="sf-notes" rows={2} value={f.notes} onChange={set("notes")} />
            </Field>
          )}
          {error && (
            <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <SubmitButton busy={busy}>{staff ? "Save" : "Create account"}</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
export function ResetPasswordDialog({ open, onOpenChange, staff }: { open: boolean; onOpenChange: (o: boolean) => void; staff: Staff | null }) {
  const [pw, setPw] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setPw("");
    setError(null);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!staff) return;
    setBusy(true);
    const res = await resetStaffPassword(staff.id, pw);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    toast.success(`Password reset for ${staff.full_name}`);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reset password</DialogTitle>
          <DialogDescription>Set a new password for {staff?.full_name}. Give it to them privately; they can change it in Account.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          <Field label="New password" htmlFor="rp" error={error ?? undefined} hint="At least 8 characters">
            <Input id="rp" type="text" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <SubmitButton busy={busy}>Reset password</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
interface RateLine {
  assigned: boolean;
  rate: string;
}

export function RatesDialog({
  open,
  onOpenChange,
  staff,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  staff: Staff | null;
  onSaved: () => void;
}) {
  const [products, setProducts] = useState<Product[]>([]);
  const [type, setType] = useState<EarningType>("per_product");
  const [commission, setCommission] = useState("");
  const [perItem, setPerItem] = useState("");
  const [tiers, setTiers] = useState<{ key: number; min_sales: string; pay: string }[]>([]);
  const [lines, setLines] = useState<Record<string, RateLine>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || !staff) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setError(null);
    setType(staff.earning_type);
    setCommission(String(staff.commission_rate ?? 0));
    setPerItem(String(staff.rate_per_item ?? 0));
    setTiers(
      sortTiers(staff.pay_tiers?.length ? staff.pay_tiers : DEFAULT_TIERS).map((t, i) => ({ key: i, min_sales: String(t.min_sales), pay: String(t.pay) })),
    );
    /* eslint-enable react-hooks/set-state-in-effect */
    const assigned = new Map((staff.staff_product_assignments ?? []).map((a) => [a.product_id, a.earning_rate]));
    createClient()
      .from("products")
      .select("*")
      .order("name")
      .then(({ data }) => {
        const list = (data ?? []) as Product[];
        setProducts(list);
        setLines(Object.fromEntries(list.map((p) => [p.id, { assigned: assigned.has(p.id), rate: String(assigned.get(p.id) ?? 0) }])));
      });
  }, [open, staff]);

  const assignedCount = Object.values(lines).filter((l) => l.assigned).length;
  const example = useMemo(() => {
    if (type === "after_recovery")
      return `With a ₱200 juice target and ₱300 juice sales, the staff member earns ${toNumber(commission)}% of the ₱100 above target = ${formatPeso((100 * toNumber(commission)) / 100)}.`;
    if (type === "profit_share")
      return `A ₱20 stick that costs ₱10 to buy leaves ₱10 gross profit → staff earns ${formatPeso((10 * toNumber(commission)) / 100)}, business keeps ${formatPeso(10 - (10 * toNumber(commission)) / 100)}.`;
    if (type === "daily_tier") {
      const list = tiers.map((t) => ({ min_sales: toNumber(t.min_sales), pay: toNumber(t.pay) }));
      const top = sortTiers(list).at(-1);
      return top ? `Selling ${formatPeso(top.min_sales)} or more in one day pays ${formatPeso(tierPay(list, top.min_sales))}. Pay is per day, using the highest tier reached.` : null;
    }
    const p = products.find((x) => lines[x.id]?.assigned);
    if (!p) return null;
    const price = toNumber(p.selling_price);
    const each =
      type === "percentage" ? money((price * toNumber(commission)) / 100) : type === "per_item" ? toNumber(perItem) : toNumber(lines[p.id]?.rate);
    return `Selling 10 × ${p.name} (${formatPeso(price)}) earns ${formatPeso(each * 10)}.`;
  }, [products, lines, type, commission, perItem, tiers]);

  async function save() {
    if (!staff) return;
    if ((type === "percentage" || type === "profit_share" || type === "after_recovery") && !(toNumber(commission) >= 0 && toNumber(commission) <= 100))
      return setError("Percentage must be between 0 and 100%.");
    if (type === "per_item" && toNumber(perItem) < 0) return setError("Amount can't be negative.");
    if (Object.values(lines).some((l) => l.assigned && toNumber(l.rate) < 0)) return setError("Rates can't be negative.");
    if (type === "daily_tier") {
      if (!tiers.length) return setError("Add at least one pay tier.");
      if (tiers.some((t) => t.min_sales === "" || t.pay === "" || toNumber(t.min_sales) < 0 || toNumber(t.pay) < 0))
        return setError("Each tier needs a sales amount and pay of ₱0 or more.");
      if (new Set(tiers.map((t) => toNumber(t.min_sales))).size !== tiers.length) return setError("Two tiers have the same sales amount.");
    }
    setError(null);
    setBusy(true);
    const { error: err } = await createClient().rpc("save_staff_rates", {
      p_staff_id: staff.id,
      p_data: {
        earning_type: type,
        commission_rate: toNumber(commission),
        rate_per_item: toNumber(perItem),
        pay_tiers: tiers.map((t) => ({ min_sales: toNumber(t.min_sales), pay: toNumber(t.pay) })),
      },
      p_assignments: Object.entries(lines)
        .filter(([, l]) => l.assigned)
        .map(([product_id, l]) => ({ product_id, earning_rate: toNumber(l.rate) })),
    });
    setBusy(false);
    if (err) return setError(errorMessage(err));
    toast.success(`Products & earnings saved for ${staff.full_name}`);
    onOpenChange(false);
    onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Products &amp; earnings · {staff?.full_name}</DialogTitle>
          <DialogDescription>
            Choose what they can sell and how they earn. New rates apply to future sales only — recorded earnings never change.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <Field label="How this staff member earns">
            <SimpleSelect
              aria-label="Earning method"
              value={type}
              onChange={(v) => setType(v as EarningType)}
              options={(Object.keys(EARNING_TYPE_LABELS) as EarningType[]).map((t) => ({ value: t, label: EARNING_TYPE_LABELS[t] }))}
            />
          </Field>
          {type === "daily_tier" && (
            <div className="rounded-lg border">
              <div className="flex items-center justify-between border-b bg-muted/40 px-3 py-2 text-sm">
                <span className="font-medium">Daily pay tiers</span>
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => setTiers((ts) => [...ts, { key: Date.now(), min_sales: "", pay: "" }])}
                >
                  <Plus /> Add tier
                </Button>
              </div>
              <div className="grid gap-2 p-3">
                <div className="grid grid-cols-[1fr_1fr_2rem] gap-2 text-xs text-muted-foreground">
                  <span>If total sales for the day reach (₱)</span>
                  <span>Pay for the day (₱)</span>
                  <span />
                </div>
                {tiers.map((t) => (
                  <div key={t.key} className="grid grid-cols-[1fr_1fr_2rem] items-center gap-2">
                    <Input
                      aria-label="Sales amount"
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step="100"
                      value={t.min_sales}
                      onChange={(e) => setTiers((ts) => ts.map((x) => (x.key === t.key ? { ...x, min_sales: e.target.value } : x)))}
                    />
                    <Input
                      aria-label="Pay amount"
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step="10"
                      value={t.pay}
                      onChange={(e) => setTiers((ts) => ts.map((x) => (x.key === t.key ? { ...x, pay: e.target.value } : x)))}
                    />
                    <Button variant="ghost" size="icon-sm" aria-label="Remove tier" onClick={() => setTiers((ts) => ts.filter((x) => x.key !== t.key))}>
                      <Trash2 />
                    </Button>
                  </div>
                ))}
                <p className="text-xs text-muted-foreground">
                  Sales below the lowest tier earn ₱0 for that day. Tip: add a ₱0 tier to guarantee a minimum daily pay.
                </p>
              </div>
            </div>
          )}
          {(type === "percentage" || type === "profit_share" || type === "after_recovery") && (
            <Field
              label={type === "profit_share" ? "Share of gross profit (%)" : type === "after_recovery" ? "Commission after recovery (%)" : "Commission (%)"}
              htmlFor="r-comm"
              hint={
                type === "profit_share"
                  ? "Staff earnings = (sales − cost of pieces sold) × %. Business keeps the rest of the gross profit."
                  : type === "after_recovery"
                    ? "Nothing is earned on a product until its expense recovery target is reached; then % of the sales above it. Products without a target earn on every sale."
                  : "Staff earnings = total sales × commission"
              }
            >
              <Input id="r-comm" type="number" inputMode="decimal" min={0} max={100} step="0.5" value={commission} onChange={(e) => setCommission(e.target.value)} />
            </Field>
          )}
          {type === "per_item" && (
            <Field label="Amount per item sold (₱)" htmlFor="r-item" hint="Staff earnings = quantity sold × amount">
              <Input id="r-item" type="number" inputMode="decimal" min={0} step="0.25" value={perItem} onChange={(e) => setPerItem(e.target.value)} />
            </Field>
          )}

          <div className="rounded-lg border">
            <div className="flex items-center justify-between border-b bg-muted/40 px-3 py-2 text-sm">
              <span className="font-medium">Assigned products ({assignedCount})</span>
              <span className="flex gap-2">
                <Button size="xs" variant="ghost" onClick={() => setLines((ls) => Object.fromEntries(Object.entries(ls).map(([k, v]) => [k, { ...v, assigned: true }])))}>
                  Select all
                </Button>
                <Button size="xs" variant="ghost" onClick={() => setLines((ls) => Object.fromEntries(Object.entries(ls).map(([k, v]) => [k, { ...v, assigned: false }])))}>
                  Clear
                </Button>
              </span>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10 pl-3" />
                  <TableHead>Product</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  {type !== "daily_tier" && type !== "profit_share" && type !== "after_recovery" && (
                    <TableHead className="w-36 pr-3">{type === "per_product" ? "Earns per item (₱)" : "Earns per item"}</TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {products.map((p) => {
                  const l = lines[p.id] ?? { assigned: false, rate: "0" };
                  const derived =
                    type === "percentage" ? money((toNumber(p.selling_price) * toNumber(commission)) / 100) : type === "per_item" ? toNumber(perItem) : null;
                  return (
                    <TableRow key={p.id}>
                      <TableCell className="pl-3">
                        <Checkbox
                          aria-label={`Assign ${p.name}`}
                          checked={l.assigned}
                          onCheckedChange={(c) => setLines((ls) => ({ ...ls, [p.id]: { ...l, assigned: !!c } }))}
                        />
                      </TableCell>
                      <TableCell>
                        {p.name}
                        {!p.is_available && <span className="text-xs text-muted-foreground"> · unavailable</span>}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatPeso(p.selling_price)}</TableCell>
                      {type !== "daily_tier" && type !== "profit_share" && type !== "after_recovery" && <TableCell className="pr-3">
                        {derived === null ? (
                          <Input
                            aria-label={`${p.name} earning rate`}
                            type="number"
                            inputMode="decimal"
                            min={0}
                            step="0.25"
                            className="h-7"
                            disabled={!l.assigned}
                            value={l.rate}
                            onChange={(e) => setLines((ls) => ({ ...ls, [p.id]: { ...l, rate: e.target.value } }))}
                          />
                        ) : (
                          <span className="text-sm text-muted-foreground tabular-nums">{l.assigned ? formatPeso(derived) : "—"}</span>
                        )}
                      </TableCell>}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          {example && <p className="text-xs text-muted-foreground">Example: {example}</p>}
          {error && (
            <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
