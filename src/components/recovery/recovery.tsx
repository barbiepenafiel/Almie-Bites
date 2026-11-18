"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, CircleDashed, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Field, SimpleSelect, SubmitButton } from "@/components/app/common";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { errorMessage, formatPeso, toNumber } from "@/lib/format";
import { formatDate, todayManila } from "@/lib/dates";
import {
  RECOVERY_SCOPE_LABELS,
  RECOVERY_STATUS_LABELS,
  type Expense,
  type Product,
  type RecoveryRow,
  type RecoveryScope,
  type RecoveryStatus,
} from "@/lib/types";

/* ------------------------------------------------------------------ */
export function RecoveryBadge({ status }: { status: RecoveryStatus }) {
  const map: Record<RecoveryStatus, { cls: string; Icon: typeof CheckCircle2 }> = {
    not_recovered: { cls: "border-danger/20 bg-danger-soft text-danger", Icon: CircleDashed },
    partial: { cls: "border-warning/20 bg-warning-soft text-warning", Icon: AlertCircle },
    recovered: { cls: "border-success/20 bg-success-soft text-success", Icon: CheckCircle2 },
    exceeded: { cls: "border-success/20 bg-success-soft text-success", Icon: TrendingUp },
  };
  const { cls, Icon } = map[status];
  return (
    <Badge className={cls}>
      <Icon data-icon="inline-start" aria-hidden /> {RECOVERY_STATUS_LABELS[status]}
    </Badge>
  );
}

/** Recovered portion (dark) + above-target portion (lighter) on one track. */
export function RecoveryBar({ row }: { row: RecoveryRow }) {
  const pct = Math.min(100, (toNumber(row.recovered) / Math.max(1, toNumber(row.target_amount))) * 100);
  return (
    <div className="flex items-center gap-2" aria-hidden>
      <div className="h-1.5 w-full min-w-16 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full", row.status === "partial" || row.status === "not_recovered" ? "bg-foreground/70" : "bg-success")} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-12 text-right text-[11px] text-muted-foreground tabular-nums">{Math.round(toNumber(row.percent))}%</span>
    </div>
  );
}

function windowLabel(r: RecoveryRow) {
  if (r.scope === "day") return formatDate(r.start_date);
  return `${formatDate(r.start_date, { month: "short", day: "numeric" })} – ${r.end_date ? formatDate(r.end_date) : "open"}`;
}

/* ------------------------------------------------------------------ */
export function RecoveryTable({
  rows,
  compact,
  actions,
}: {
  rows: RecoveryRow[];
  compact?: boolean;
  actions?: (r: RecoveryRow) => React.ReactNode;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="pl-4">Product</TableHead>
          <TableHead className="text-right">Expense</TableHead>
          <TableHead className="text-right">Sales</TableHead>
          {!compact && <TableHead className="hidden text-right md:table-cell">Recovered</TableHead>}
          <TableHead className="text-right">Remaining</TableHead>
          <TableHead className="text-right">Above target</TableHead>
          <TableHead className="hidden w-36 lg:table-cell">Progress</TableHead>
          <TableHead className={cn(!actions && "pr-4")}>Status</TableHead>
          {actions && <TableHead className="w-10 pr-4" />}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.target_id} className={cn(!r.is_open && "text-muted-foreground")}>
            <TableCell className="pl-4">
              <div className="font-medium text-foreground">{r.product_name}</div>
              <div className="text-xs text-muted-foreground">
                {RECOVERY_SCOPE_LABELS[r.scope]} · {windowLabel(r)}
                {r.expense_name && !compact && <> · {r.expense_name}</>}
              </div>
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {formatPeso(r.target_amount)}
              {toNumber(r.assigned_expense) !== toNumber(r.target_amount) && (
                <div className="text-[11px] text-muted-foreground">spent {formatPeso(r.assigned_expense)}</div>
              )}
            </TableCell>
            <TableCell className="text-right tabular-nums">{formatPeso(r.sales_total)}</TableCell>
            {!compact && <TableCell className="hidden text-right tabular-nums md:table-cell">{formatPeso(r.recovered)}</TableCell>}
            <TableCell className={cn("text-right tabular-nums", toNumber(r.remaining) > 0 && "font-medium text-foreground")}>{formatPeso(r.remaining)}</TableCell>
            <TableCell className="text-right tabular-nums">{formatPeso(r.above_target)}</TableCell>
            <TableCell className="hidden lg:table-cell">
              <RecoveryBar row={r} />
            </TableCell>
            <TableCell className={cn(!actions && "pr-4")}>
              <RecoveryBadge status={r.status} />
              {!r.is_open && <div className="mt-0.5 text-[11px]">Closed</div>}
            </TableCell>
            {actions && <TableCell className="pr-4">{actions(r)}</TableCell>}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export const ABOVE_TARGET_NOTE =
  "“Above target” is sales revenue after the expense is covered, not profit — other ingredients, remaining stock, staff pay and operating costs still apply.";

/* ------------------------------------------------------------------ */
export interface RecoveryDraft {
  target_id?: string;
  product_id?: string;
  scope?: RecoveryScope;
  expense_id?: string | null;
  assigned_expense?: number;
  target_amount?: number;
  start_date?: string;
  notes?: string | null;
}

export function RecoveryDialog({
  open,
  onOpenChange,
  draft,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  draft?: RecoveryDraft | null;
  onSaved?: () => void;
}) {
  const [products, setProducts] = useState<Product[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [productId, setProductId] = useState("");
  const [scope, setScope] = useState<RecoveryScope>("batch");
  const [expenseId, setExpenseId] = useState("");
  const [spent, setSpent] = useState("");
  const [target, setTarget] = useState("");
  const [targetTouched, setTargetTouched] = useState(false);
  const [start, setStart] = useState(todayManila());
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setError(null);
    setProductId(draft?.product_id ?? "");
    setScope(draft?.scope ?? (draft?.expense_id ? "purchase" : "batch"));
    setExpenseId(draft?.expense_id ?? "");
    setSpent(draft?.assigned_expense != null ? String(draft.assigned_expense) : "");
    setTarget(draft?.target_amount != null ? String(draft.target_amount) : "");
    setTargetTouched(draft?.target_amount != null && draft.target_amount !== draft.assigned_expense);
    setStart(draft?.start_date ?? todayManila());
    setNotes(draft?.notes ?? "");
    /* eslint-enable react-hooks/set-state-in-effect */
    const sb = createClient();
    sb.from("products").select("*").order("name").then(({ data }) => setProducts((data ?? []) as Product[]));
    sb.from("expenses")
      .select("*, inventory_items(id, name, unit)")
      .order("expense_date", { ascending: false })
      .limit(100)
      .then(({ data }) => setExpenses((data ?? []) as Expense[]));
  }, [open, draft]);

  const expenseOptions = useMemo(
    () => expenses.map((e) => ({ value: e.id, label: `${formatDate(e.expense_date, { month: "short", day: "numeric" })} · ${e.name} · ${formatPeso(e.amount)}` })),
    [expenses],
  );

  function pickExpense(id: string) {
    setExpenseId(id);
    const e = expenses.find((x) => x.id === id);
    if (e) {
      setSpent(String(e.amount));
      if (!targetTouched) setTarget(String(e.amount));
      if (scope === "purchase") setStart(e.expense_date);
    }
  }

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    if (!productId) return setError("Choose the product.");
    if (scope === "purchase" && !expenseId) return setError("Choose the purchase this target is for.");
    if (spent === "" || toNumber(spent) < 0) return setError("Enter how much was spent.");
    const tgt = target === "" ? toNumber(spent) : toNumber(target);
    if (!(tgt > 0)) return setError("The recovery target must be more than ₱0.");
    setError(null);
    setBusy(true);
    const { error: err } = await createClient().rpc("save_recovery_target", {
      p_data: {
        product_id: productId,
        scope,
        expense_id: expenseId || null,
        assigned_expense: toNumber(spent),
        target_amount: tgt,
        start_date: start,
        notes,
      },
      p_target_id: draft?.target_id ?? null,
    });
    setBusy(false);
    if (err) return setError(errorMessage(err));
    toast.success(draft?.target_id ? "Recovery target updated" : "Recovery target added");
    onOpenChange(false);
    onSaved?.();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{draft?.target_id ? "Edit recovery target" : "Add recovery target"}</DialogTitle>
          <DialogDescription>Track how much of what you spent on a product its sales have earned back.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <Field label="Product">
            <SimpleSelect aria-label="Product" value={productId} onChange={setProductId} placeholder="Choose product…" options={products.map((p) => ({ value: p.id, label: p.name }))} />
          </Field>
          <Field
            label="Applies to"
            hint={
              scope === "day"
                ? "Only that day's sales count."
                : scope === "batch"
                  ? "Sales count from the start date until you close it or add a new batch."
                  : "Sales count from the purchase date until you close it or add a new target."
            }
          >
            <SimpleSelect
              aria-label="Applies to"
              value={scope}
              onChange={(v) => setScope(v as RecoveryScope)}
              options={(Object.keys(RECOVERY_SCOPE_LABELS) as RecoveryScope[]).map((s) => ({ value: s, label: RECOVERY_SCOPE_LABELS[s] }))}
            />
          </Field>
          <Field
            label={scope === "purchase" ? "Purchase (from Expenses)" : "Link a recorded purchase (optional)"}
            hint="Linking uses the expense you already recorded — no duplicate expense is created."
          >
            <SimpleSelect
              aria-label="Purchase"
              value={expenseId}
              onChange={pickExpense}
              placeholder="Not linked"
              options={[{ value: "", label: "Not linked" }, ...expenseOptions]}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Amount spent (₱)" htmlFor="rc-spent">
              <Input
                id="rc-spent"
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                value={spent}
                onChange={(e) => {
                  setSpent(e.target.value);
                  if (!targetTouched) setTarget(e.target.value);
                }}
              />
            </Field>
            <Field label="Sales target (₱)" htmlFor="rc-target" hint="Usually the same">
              <Input
                id="rc-target"
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                value={target}
                onChange={(e) => {
                  setTarget(e.target.value);
                  setTargetTouched(true);
                }}
              />
            </Field>
            <Field label={scope === "day" ? "Day" : "Start date"} htmlFor="rc-start">
              <Input id="rc-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
            </Field>
          </div>
          <Field label="Notes (optional)" htmlFor="rc-notes">
            <Textarea id="rc-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          {error && (
            <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <SubmitButton busy={busy}>{draft?.target_id ? "Save" : "Add target"}</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
