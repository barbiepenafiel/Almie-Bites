"use client";

import { useEffect, useMemo, useState } from "react";
import { BadgeCheck, HandCoins, Hourglass, Plus, Trash2, Wallet } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ConfirmDialog, EmptyState, ErrorState, Field, LoadingRows, PageHeader, SimpleSelect, StatCard, SubmitButton } from "@/components/app/common";
import { DateRangeFilter } from "@/components/app/date-range-filter";
import { useAppData } from "@/components/app/app-data";
import { unwrap, useQuery } from "@/hooks/use-query";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { errorMessage, formatPeso, formatQty, money, toNumber } from "@/lib/format";
import { describeRange, formatDate, rangeForPreset, todayManila, type DateRange } from "@/lib/dates";
import { fetchStaffReport } from "@/lib/report-utils";
import type { StaffPayment, StaffReportRow } from "@/lib/types";

export function PayrollView({ initialStaff }: { initialStaff: string }) {
  const [range, setRange] = useState<DateRange>(rangeForPreset("week"));
  const [staffId, setStaffId] = useState(initialStaff);
  const [payFor, setPayFor] = useState<StaffReportRow | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [deleting, setDeleting] = useState<StaffPayment | null>(null);

  const { data, error, loading, reload } = useQuery(
    async (sb) => {
      let pq = sb.from("staff_payments").select("*, staff(id, full_name)").order("payment_date", { ascending: false }).order("created_at", { ascending: false }).limit(200);
      if (staffId !== "all") pq = pq.eq("staff_id", staffId);
      const [report, payments] = await Promise.all([fetchStaffReport(sb, range.start, range.end), pq]);
      return { report, payments: unwrap(payments) as StaffPayment[] };
    },
    [range.start, range.end, staffId],
    { realtime: ["sales", "staff_payments"] },
  );
  const rows = useMemo(() => (data?.report ?? []).filter((r) => staffId === "all" || r.staff_id === staffId), [data, staffId]);
  const t = rows.reduce(
    (a, r) => ({ earned: a.earned + Number(r.earned_total), paid: a.paid + Number(r.paid_total), unpaid: a.unpaid + Number(r.unpaid), period: a.period + Number(r.earnings) }),
    { earned: 0, paid: 0, unpaid: 0, period: 0 },
  );
  const busy = loading && !data;

  async function removePayment(p: StaffPayment) {
    const { error: err } = await createClient().from("staff_payments").delete().eq("id", p.id);
    if (err) {
      toast.error(errorMessage(err));
      throw err;
    }
    toast.success("Payment record deleted");
    reload();
  }

  return (
    <>
      <PageHeader
        title="Staff Earnings & Payments"
        description="What each staff member earned, what you've paid and what's still owed."
        actions={
          <Button
            onClick={() => {
              setPayFor(null);
              setPayOpen(true);
            }}
            disabled={!data?.report.length}
          >
            <Plus /> Record payment
          </Button>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <DateRangeFilter value={range} onChange={setRange} />
        <SimpleSelect
          aria-label="Staff"
          className="w-44"
          value={staffId}
          onChange={setStaffId}
          options={[{ value: "all", label: "All staff" }, ...(data?.report ?? []).map((r) => ({ value: r.staff_id, label: r.full_name }))]}
        />
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Earned in period" value={formatPeso(money(t.period))} icon={HandCoins} tone="brand" loading={busy} hint={describeRange(range)} />
        <StatCard label="Total earned (all time)" value={formatPeso(money(t.earned))} icon={Wallet} loading={busy} />
        <StatCard label="Total paid" value={formatPeso(money(t.paid))} icon={BadgeCheck} loading={busy} />
        <StatCard label="Unpaid balance" value={formatPeso(money(t.unpaid))} icon={Hourglass} tone={t.unpaid > 0 ? "warning" : "default"} loading={busy} />
      </div>

      {error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : busy ? (
        <Card>
          <LoadingRows rows={6} />
        </Card>
      ) : !data?.report.length ? (
        <Card>
          <EmptyState icon={HandCoins} title="No staff yet" description="Add staff in Staff Management first." />
        </Card>
      ) : (
        <div className="grid gap-6">
          <Card className="gap-0 py-0">
            <CardHeader className="border-b py-4">
              <CardTitle>Payroll summary</CardTitle>
              <CardDescription>Sales period: {describeRange(range)}. Balances are all-time.</CardDescription>
            </CardHeader>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Staff</TableHead>
                  <TableHead className="text-right">Period sales</TableHead>
                  <TableHead className="hidden text-right md:table-cell">Products sold</TableHead>
                  <TableHead className="text-right">Period earnings</TableHead>
                  <TableHead className="hidden text-right lg:table-cell">Total earned</TableHead>
                  <TableHead className="text-right">Paid</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                  <TableHead className="pr-4" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.staff_id}>
                    <TableCell className="pl-4 font-medium">{r.full_name}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatPeso(r.sales_total)}</TableCell>
                    <TableCell className="hidden text-right tabular-nums md:table-cell">{formatQty(r.items_sold)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatPeso(r.earnings)}</TableCell>
                    <TableCell className="hidden text-right tabular-nums lg:table-cell">{formatPeso(r.earned_total)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatPeso(r.paid_total)}</TableCell>
                    <TableCell className={cn("text-right font-semibold tabular-nums", Number(r.unpaid) > 0 && "text-warning")}>{formatPeso(r.unpaid)}</TableCell>
                    <TableCell className="pr-4 text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setPayFor(r);
                          setPayOpen(true);
                        }}
                      >
                        Pay
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>

          <Card className="gap-0 py-0">
            <CardHeader className="border-b py-4">
              <CardTitle>Payment history</CardTitle>
            </CardHeader>
            {!data.payments.length ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No payments recorded yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-4">Date</TableHead>
                    <TableHead>Staff</TableHead>
                    <TableHead className="hidden md:table-cell">Covers</TableHead>
                    <TableHead className="hidden sm:table-cell">Method</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="w-10 pr-4" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.payments.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="pl-4 whitespace-nowrap">{formatDate(p.payment_date)}</TableCell>
                      <TableCell>
                        {p.staff?.full_name}
                        {p.notes && <div className="max-w-56 truncate text-xs text-muted-foreground">{p.notes}</div>}
                      </TableCell>
                      <TableCell className="hidden text-xs text-muted-foreground md:table-cell">
                        {p.period_start && p.period_end ? `${formatDate(p.period_start, { month: "short", day: "numeric" })} – ${formatDate(p.period_end)}` : "—"}
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        <Badge variant="outline">{p.payment_method}</Badge>
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">{formatPeso(p.amount)}</TableCell>
                      <TableCell className="pr-4">
                        <Button size="icon-sm" variant="ghost" aria-label="Delete payment" onClick={() => setDeleting(p)}>
                          <Trash2 />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell className="pl-4" colSpan={4}>
                      Total shown
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatPeso(money(data.payments.reduce((s, p) => s + Number(p.amount), 0)))}</TableCell>
                    <TableCell />
                  </TableRow>
                </TableFooter>
              </Table>
            )}
          </Card>
        </div>
      )}

      <PaymentDialog open={payOpen} onOpenChange={setPayOpen} staffRows={data?.report ?? []} preset={payFor} range={range} onSaved={reload} />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete this payment record?"
        description={`${formatPeso(deleting?.amount)} to ${deleting?.staff?.full_name ?? "staff"} on ${deleting ? formatDate(deleting.payment_date) : ""}. Their unpaid balance will go back up.`}
        onConfirm={() => (deleting ? removePayment(deleting) : undefined)}
      />
    </>
  );
}

function PaymentDialog({
  open,
  onOpenChange,
  staffRows,
  preset,
  range,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  staffRows: StaffReportRow[];
  preset: StaffReportRow | null;
  range: DateRange;
  onSaved: () => void;
}) {
  const { paymentMethods } = useAppData();
  const [staffId, setStaffId] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayManila());
  const [method, setMethod] = useState("Cash");
  const [start, setStart] = useState(range.start);
  const [end, setEnd] = useState(range.end);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    const s = preset ?? staffRows[0];
    setStaffId(s?.staff_id ?? "");
    setAmount(s && Number(s.unpaid) > 0 ? String(money(Number(s.unpaid))) : "");
    setDate(todayManila());
    setMethod(paymentMethods[0] ?? "Cash");
    setStart(range.start);
    setEnd(range.end);
    setNotes("");
    setError(null);
    /* eslint-enable react-hooks/set-state-in-effect */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, preset]);

  const sel = staffRows.find((r) => r.staff_id === staffId);
  const over = sel && sel.earning_type !== "manual" && toNumber(amount) > Number(sel.unpaid);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!staffId) return setError("Choose a staff member.");
    if (!(toNumber(amount) > 0)) return setError("Enter an amount greater than ₱0.");
    if (start && end && end < start) return setError("Period end must be after the start.");
    setError(null);
    setBusy(true);
    const { error: err } = await createClient().from("staff_payments").insert({
      staff_id: staffId,
      amount: money(toNumber(amount)),
      payment_method: method,
      payment_date: date,
      period_start: start || null,
      period_end: end || null,
      notes: notes.trim() || null,
    });
    setBusy(false);
    if (err) return setError(errorMessage(err));
    toast.success(`Recorded ${formatPeso(amount)} payment to ${sel?.full_name ?? "staff"}`);
    onOpenChange(false);
    onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Record staff payment</DialogTitle>
          <DialogDescription>Only record money you have actually paid. Earnings are never marked paid automatically.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Staff member">
              <SimpleSelect
                aria-label="Staff member"
                value={staffId}
                onChange={(v) => {
                  setStaffId(v);
                  const r = staffRows.find((x) => x.staff_id === v);
                  setAmount(r && Number(r.unpaid) > 0 ? String(money(Number(r.unpaid))) : "");
                }}
                options={staffRows.map((r) => ({ value: r.staff_id, label: r.full_name }))}
              />
            </Field>
            <Field label="Amount (₱)" htmlFor="pay-amt" hint={sel ? `Unpaid balance: ${formatPeso(sel.unpaid)}` : undefined}>
              <Input id="pay-amt" type="number" inputMode="decimal" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </Field>
            <Field label="Payment date" htmlFor="pay-date">
              <Input id="pay-date" type="date" max={todayManila()} value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label="Payment method">
              <SimpleSelect aria-label="Payment method" value={method} onChange={setMethod} options={paymentMethods.map((m) => ({ value: m, label: m }))} />
            </Field>
            <Field label="Covers sales from" htmlFor="pay-start">
              <Input id="pay-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
            </Field>
            <Field label="to" htmlFor="pay-end">
              <Input id="pay-end" type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
            </Field>
          </div>
          <Field label="Notes (optional)" htmlFor="pay-notes">
            <Textarea id="pay-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          {over && (
            <p className="rounded-md bg-warning-soft px-3 py-2 text-sm text-warning" role="status">
              This is more than the unpaid balance — it will be recorded as an advance.
            </p>
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
            <SubmitButton busy={busy}>Confirm payment</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
