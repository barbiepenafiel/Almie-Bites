"use client";

import { useMemo, useRef, useState } from "react";
import { CheckCircle2, ClipboardCheck, Loader2, PackageX } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { EmptyState, ErrorState, Field, LoadingRows, PageHeader, SimpleSelect } from "@/components/app/common";
import { useStaffData } from "@/components/staff/staff-data";
import { useQuery } from "@/hooks/use-query";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { errorMessage, formatPeso, formatQty, money } from "@/lib/format";
import { fetchStaffProducts, fetchStaffSummary, maxSellable, nextTier, tierPay } from "@/lib/staff-utils";
import { todayManila } from "@/lib/dates";
import type { StaffSellableProduct } from "@/lib/types";
import { newUuid } from "@/lib/uuid";

/**
 * Staff record sales by counting what they have LEFT.
 * For each product: sold = pieces they have now − pieces left.
 */
export function QuickSale() {
  const { profile } = useStaffData();
  const payments = profile?.payment_methods ?? ["Cash", "GCash", "Other"];
  const today = todayManila();
  const { data, error, loading, reload } = useQuery(
    async (sb) => {
      const [products, summary] = await Promise.all([fetchStaffProducts(sb), fetchStaffSummary(sb, today, today)]);
      return { products, todaySales: summary.sales_total };
    },
    [today],
    { refetchOnFocus: true, pollMs: 30_000 },
  );
  const products = useMemo(() => data?.products ?? [], [data]);
  const tiered = profile?.earning_type === "daily_tier";

  const [left, setLeft] = useState<Record<string, string>>({}); // product_id -> typed "left" count
  const [payment, setPayment] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [lastSale, setLastSale] = useState<{ total: number; items: number; earned: number } | null>(null);
  const clientRef = useRef<string | null>(null); // one id per sale attempt; reused on retry

  /** What the staff member has right now (null = unknown, can't count leftovers). */
  const have = (p: StaffSellableProduct) => maxSellable(p);

  type Line = { p: StaffSellableProduct; has: number; leftNow: number; sold: number };
  const { lines, problems } = useMemo(() => {
    const out: Line[] = [];
    const errs: Record<string, string> = {};
    for (const p of products) {
      const raw = left[p.product_id];
      if (raw === undefined || raw === "") continue;
      const has = have(p);
      if (has === null) continue;
      const leftNow = Number(raw);
      if (!Number.isFinite(leftNow) || leftNow < 0) errs[p.product_id] = "Enter 0 or more.";
      else if (leftNow > has) errs[p.product_id] = `You only have ${formatQty(has)}.`;
      else if (has - leftNow > 0) out.push({ p, has, leftNow, sold: Math.round((has - leftNow) * 1000) / 1000 });
    }
    return { lines: out, problems: errs };
  }, [products, left]);

  const total = money(lines.reduce((s, l) => s + l.sold * l.p.selling_price, 0));
  const items = lines.reduce((s, l) => s + l.sold, 0);
  const earned = money(lines.reduce((s, l) => s + l.sold * l.p.earning_per_item, 0));
  const todaySoFar = data?.todaySales ?? 0;
  const dayTotal = money(todaySoFar + total);
  const dayPay = tierPay(profile?.pay_tiers, dayTotal);
  const upcoming = nextTier(profile?.pay_tiers, dayTotal);
  const method = payment || payments[0] || "Cash";
  const hasProblems = Object.keys(problems).length > 0;

  function setLeftFor(id: string, value: string) {
    clientRef.current = null; // counts changed → it's a new sale
    setLastSale(null);
    setLeft((l) => ({ ...l, [id]: value }));
  }

  async function confirmSale() {
    if (!lines.length || busy || hasProblems) return;
    setBusy(true);
    clientRef.current ??= newUuid();
    const { error: err } = await createClient().rpc("record_sale", {
      p_items: lines.map((l) => ({ product_id: l.p.product_id, quantity: l.sold })),
      p_payment_method: method,
      p_notes: notes.trim() || null,
      p_client_ref: clientRef.current,
    });
    setBusy(false);
    if (err) {
      toast.error(errorMessage(err));
      reload();
      return;
    }
    setLastSale({ total, items, earned: tiered ? dayPay : earned });
    toast.success(`Sale saved · ${formatQty(items)} sold · ${formatPeso(total)}`);
    clientRef.current = null;
    setLeft({});
    setNotes("");
    setSheetOpen(false);
    reload();
  }

  const summaryPanel = (
    <div className="grid gap-4">
      {lines.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Type how many you have left on each product. What you sold is worked out for you.</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {lines.map((l) => (
            <li key={l.p.product_id} className="flex items-center justify-between gap-3 px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{l.p.name}</p>
                <p className="text-xs text-muted-foreground tabular-nums">
                  had {formatQty(l.has)} − left {formatQty(l.leftNow)} = <span className="font-medium text-foreground">{formatQty(l.sold)} sold</span>
                </p>
              </div>
              <span className="shrink-0 text-sm font-medium tabular-nums">{formatPeso(l.sold * l.p.selling_price)}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Payment method">
          <SimpleSelect aria-label="Payment method" value={method} onChange={setPayment} options={payments.map((m) => ({ value: m, label: m }))} />
        </Field>
        <Field label="Notes (optional)" htmlFor="qs-notes">
          <Input id="qs-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={200} />
        </Field>
      </div>

      <div className="rounded-lg bg-muted/60 p-3">
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-muted-foreground">Sold · {formatQty(items)} pcs</span>
          <span className="font-heading text-3xl font-semibold tabular-nums">{formatPeso(total)}</span>
        </div>
        {tiered ? (
          <div className="mt-2 grid gap-0.5 border-t pt-2 text-right text-xs text-muted-foreground">
            <p>
              Today so far {formatPeso(todaySoFar)} + this = <span className="text-foreground">{formatPeso(dayTotal)}</span>
            </p>
            <p>
              Estimated pay today: <span className="font-semibold text-foreground">{formatPeso(dayPay)}</span>
              {upcoming && <> · {formatPeso(upcoming.min_sales - dayTotal)} more to reach {formatPeso(upcoming.pay)}</>}
            </p>
          </div>
        ) : (
          earned > 0 && <p className="mt-1 text-right text-xs text-muted-foreground">You earn about {formatPeso(earned)}</p>
        )}
      </div>

      <Button size="lg" className="h-12 text-base" disabled={!lines.length || busy || hasProblems} onClick={confirmSale}>
        {busy ? <Loader2 className="animate-spin" /> : <CheckCircle2 />}
        {busy ? "Saving…" : `Save sale · ${formatPeso(total)}`}
      </Button>
    </div>
  );

  return (
    <>
      <PageHeader title="Record Sale" description="Count what you have left on each product and type it in. We work out what you sold." />

      {lastSale && (
        <div className="mb-4 flex items-center gap-3 rounded-xl border border-success/30 bg-success-soft p-3 text-sm" role="status">
          <CheckCircle2 className="size-5 shrink-0 text-success" aria-hidden />
          <span>
            Saved: <strong>{formatQty(lastSale.items)} sold</strong> for <strong>{formatPeso(lastSale.total)}</strong>
            {lastSale.earned > 0 && <> · {tiered ? "estimated pay today" : "you earned"} {formatPeso(lastSale.earned)}</>}.
          </span>
        </div>
      )}

      {error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : loading && !data ? (
        <Card>
          <LoadingRows rows={6} />
        </Card>
      ) : products.length === 0 ? (
        <Card>
          <EmptyState icon={PackageX} title="No products assigned yet" description="Ask the owner to assign the products you sell today." />
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_24rem]">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3">
            {products.map((p) => {
              const has = have(p);
              const raw = left[p.product_id] ?? "";
              const err = problems[p.product_id];
              const line = lines.find((l) => l.p.product_id === p.product_id);
              const unavailable = !p.is_available;
              return (
                <Card key={p.product_id} size="sm" className={cn("gap-2", (unavailable || has === null) && "opacity-70", line && "ring-2 ring-foreground")}>
                  <CardContent className="grid gap-2">
                    <div className="flex items-start justify-between gap-1">
                      <p className="leading-tight font-semibold">{p.name}</p>
                      <span className="text-sm font-medium tabular-nums text-muted-foreground">{formatPeso(p.selling_price)}</span>
                    </div>
                    {has === null ? (
                      <p className="text-xs text-muted-foreground">No starting count. Ask the owner to assign a quantity for today.</p>
                    ) : (
                      <>
                        <div className="flex items-baseline justify-between rounded-md bg-muted/60 px-2 py-1.5">
                          <span className="text-xs text-muted-foreground">You have</span>
                          <span className="font-heading text-xl font-semibold tabular-nums">{formatQty(has)}</span>
                        </div>
                        <Field label="Left now" htmlFor={`left-${p.product_id}`} error={err}>
                          <Input
                            id={`left-${p.product_id}`}
                            type="number"
                            inputMode="numeric"
                            min={0}
                            max={has}
                            step="1"
                            placeholder={formatQty(has)}
                            disabled={unavailable || has <= 0}
                            className="h-10 text-center text-lg"
                            value={raw}
                            aria-invalid={!!err}
                            onChange={(e) => setLeftFor(p.product_id, e.target.value)}
                          />
                        </Field>
                        <p className={cn("text-xs tabular-nums", line ? "font-medium text-foreground" : "text-muted-foreground")}>
                          {line ? `Sold ${formatQty(line.sold)} · ${formatPeso(line.sold * p.selling_price)}` : "Sold 0"}
                        </p>
                      </>
                    )}
                    <div className="flex flex-wrap gap-1 text-[11px]">
                      {p.assigned_qty !== null && <Badge variant="outline">{formatQty(p.assigned_qty)} assigned</Badge>}
                      {p.sold_today > 0 && <Badge variant="secondary">{formatQty(p.sold_today)} saved today</Badge>}
                      {unavailable && <Badge variant="outline">Unavailable</Badge>}
                      {has !== null && has <= 0 && <Badge variant="outline" className="border-danger/30 text-danger">Nothing left</Badge>}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Desktop summary */}
          <Card className="sticky top-6 hidden h-fit lg:flex">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ClipboardCheck className="size-4" aria-hidden /> This sale
              </CardTitle>
            </CardHeader>
            <CardContent>{summaryPanel}</CardContent>
          </Card>
        </div>
      )}

      {/* Mobile summary bar + sheet */}
      {lines.length > 0 && (
        <div className="fixed inset-x-0 bottom-16 z-30 border-t bg-background/95 px-4 py-3 backdrop-blur lg:hidden">
          <Button size="lg" className="h-12 w-full justify-between text-base" onClick={() => setSheetOpen(true)} disabled={hasProblems}>
            <span className="flex items-center gap-2">
              <ClipboardCheck /> {formatQty(items)} sold
            </span>
            <span className="tabular-nums">Review · {formatPeso(total)}</span>
          </Button>
        </div>
      )}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="bottom" className="max-h-[88vh] overflow-y-auto rounded-t-2xl px-4 pb-6">
          <SheetHeader className="px-0">
            <SheetTitle>This sale</SheetTitle>
          </SheetHeader>
          {summaryPanel}
        </SheetContent>
      </Sheet>
    </>
  );
}
