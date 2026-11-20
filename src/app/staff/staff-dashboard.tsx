"use client";

import Link from "next/link";
import { ArrowRight, CircleAlert, Package, PiggyBank, Receipt, ShoppingBag, Store, TrendingUp } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ErrorState, LoadingRows, StatCard } from "@/components/app/common";
import { useStaffData } from "@/components/staff/staff-data";
import { useQuery } from "@/hooks/use-query";
import { cn } from "@/lib/utils";
import { formatPeso, formatQty } from "@/lib/format";
import { formatLongToday, formatTime, todayManila } from "@/lib/dates";
import { canSell, maxSellable, describeEarning, fetchStaffProducts, fetchStaffSales, fetchStaffSummary, nextTier } from "@/lib/staff-utils";

export function StaffDashboard() {
  const { profile } = useStaffData();
  const today = todayManila();

  const { data, error, loading, reload } = useQuery(
    async (sb) => {
      const [summary, products, sales] = await Promise.all([
        fetchStaffSummary(sb, today, today),
        fetchStaffProducts(sb),
        fetchStaffSales(sb, today, today, 5),
      ]);
      return { summary, products, sales };
    },
    [today],
    { refetchOnFocus: true, pollMs: 30_000 },
  );
  const s = data?.summary;
  const sellable = (data?.products ?? []).filter(canSell).length;
  const zeroCount = (data?.products ?? []).filter((p) => p.sold_today === 0).length;
  const busy = loading && !data;
  const tiered = profile?.earning_type === "daily_tier";
  const manual = profile?.earning_type === "manual";
  const upcoming = tiered ? nextTier(profile?.pay_tiers, s?.sales_total ?? 0) : null;

  // What is still unsold today: assigned pieces not sold yet, or products with no sales at all.
  const unsold = (data?.products ?? [])
    .map((p) => {
      const left = p.assigned_qty !== null ? Math.max(0, Number(p.assigned_qty) - Number(p.sold_today)) : null;
      return { ...p, left, value: left !== null ? left * Number(p.selling_price) : 0 };
    })
    .filter((p) => (p.left !== null ? p.left > 0 : Number(p.sold_today) === 0))
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
  const unsoldPieces = unsold.reduce((a, p) => a + (p.left ?? 0), 0);
  const unsoldValue = unsold.reduce((a, p) => a + p.value, 0);

  return (
    <>
      <div className="mb-6">
        <p className="text-sm text-muted-foreground">{formatLongToday()}</p>
        <h1 className="font-heading text-2xl font-semibold tracking-tight sm:text-3xl">
          Welcome, {profile?.full_name ?? "…"}!
        </h1>
        {profile && (
          <p className="mt-1 text-sm text-muted-foreground">
            You earn {describeEarning(profile).toLowerCase()}.
          </p>
        )}
      </div>

      <Link href="/staff/sell" className={cn(buttonVariants({ size: "lg" }), "mb-6 h-14 w-full text-base sm:w-auto sm:px-8")}>
        <ShoppingBag className="size-5" /> Record a sale
      </Link>

      {error && (
        <div className="mb-4">
          <ErrorState message={error} onRetry={reload} />
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <div className="col-span-2 lg:col-span-1">
          <StatCard label="Today's total sales" value={formatPeso(s?.sales_total)} icon={TrendingUp} tone="brand" loading={busy} />
        </div>
        <StatCard label="Products sold" value={formatQty(s?.items_sold)} icon={Package} loading={busy} />
        <StatCard
          label={manual ? "Paid to me today" : tiered ? "Estimated pay today" : "My earnings today"}
          value={formatPeso(s?.earnings)}
          icon={PiggyBank}
          loading={busy}
          hint={upcoming ? `${formatPeso(upcoming.min_sales - (s?.sales_total ?? 0))} more sales → ${formatPeso(upcoming.pay)}` : "Estimated"}
        />
        <StatCard label="Transactions" value={s?.transactions ?? 0} icon={Receipt} loading={busy} />
        <StatCard
          label="Products available"
          value={`${sellable}/${data?.products.length ?? 0}`}
          icon={Store}
          loading={busy}
          hint="Assigned & in stock"
        />
      </div>

      {!busy && !!data?.products.length && (
        <Card className="mb-6 gap-0 py-0">
          <CardHeader className="border-b py-4">
            <CardTitle>Unsold products today</CardTitle>
            <CardAction>
              <Link href="/staff/unsold" className={buttonVariants({ variant: "ghost", size: "sm" })}>
                Yesterday <ArrowRight />
              </Link>
            </CardAction>
            <CardDescription>
              {unsold.length === 0
                ? "Everything assigned to you today is sold. Great job!"
                : unsoldPieces > 0
                  ? `${formatQty(unsoldPieces)} pieces left · worth ${formatPeso(unsoldValue)} if sold`
                  : `${unsold.length} ${unsold.length === 1 ? "product has" : "products have"} no sales yet`}
            </CardDescription>
          </CardHeader>
          {unsold.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Product</TableHead>
                  <TableHead className="text-right">Assigned</TableHead>
                  <TableHead className="text-right">Sold</TableHead>
                  <TableHead className="text-right">Unsold</TableHead>
                  <TableHead className="pr-4 text-right">Value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {unsold.map((p) => (
                  <TableRow key={p.product_id}>
                    <TableCell className="pl-4">
                      <div className="font-medium">{p.name}</div>
                      <div className="text-xs text-muted-foreground">{formatPeso(p.selling_price)} each</div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{p.assigned_qty !== null ? formatQty(p.assigned_qty) : "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatQty(p.sold_today)}</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums text-warning">
                      {p.left !== null ? formatQty(p.left) : "No sales yet"}
                    </TableCell>
                    <TableCell className="pr-4 text-right tabular-nums">{p.left !== null ? formatPeso(p.value) : "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
              {unsoldPieces > 0 && (
                <TableFooter>
                  <TableRow>
                    <TableCell className="pl-4">Total unsold</TableCell>
                    <TableCell />
                    <TableCell />
                    <TableCell className="text-right tabular-nums">{formatQty(unsoldPieces)}</TableCell>
                    <TableCell className="pr-4 text-right tabular-nums">{formatPeso(unsoldValue)}</TableCell>
                  </TableRow>
                </TableFooter>
              )}
            </Table>
          )}
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <Card className="gap-0 py-0">
          <CardHeader className="border-b py-4">
            <CardTitle>My products today</CardTitle>
            <CardDescription>
              {data?.products.some((p) => p.is_daily) ? "Assigned to you for today" : "Your regular products"}
              {zeroCount > 0 && <> · {zeroCount} with no sales yet</>}
            </CardDescription>
          </CardHeader>
          {busy ? (
            <LoadingRows rows={4} />
          ) : !data?.products.length ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No products assigned to you today. Please check with the owner.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Product</TableHead>
                  <TableHead className="text-right">Assigned</TableHead>
                  <TableHead className="text-right">Sold</TableHead>
                  <TableHead className="text-right">Left</TableHead>
                  <TableHead className="pr-4 text-right">Sales</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.products.map((p) => {
                  const zero = p.sold_today === 0;
                  const left = maxSellable(p);
                  return (
                    <TableRow key={p.product_id} className={cn(zero && "bg-warning-soft/60 hover:bg-warning-soft")}>
                      <TableCell className="pl-4">
                        <div className="font-medium">{p.name}</div>
                        {zero && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-warning">
                            <CircleAlert className="size-3" aria-hidden /> No sales yet today
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{p.assigned_qty !== null ? formatQty(p.assigned_qty) : "—"}</TableCell>
                      <TableCell className="text-right font-medium tabular-nums">{formatQty(p.sold_today)}</TableCell>
                      <TableCell className={cn("text-right tabular-nums", left !== null && left <= 0 && "text-danger")}>
                        {left === null ? "—" : formatQty(left)}
                      </TableCell>
                      <TableCell className="pr-4 text-right tabular-nums">{formatPeso(p.sales_today)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell className="pl-4">Total</TableCell>
                  <TableCell />
                  <TableCell className="text-right tabular-nums">{formatQty(s?.items_sold)}</TableCell>
                  <TableCell />
                  <TableCell className="pr-4 text-right tabular-nums">{formatPeso(s?.sales_total)}</TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          )}
        </Card>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Recent transactions</CardTitle>
            <CardAction>
              <Link href="/staff/sales" className={buttonVariants({ variant: "ghost", size: "sm" })}>
                All <ArrowRight />
              </Link>
            </CardAction>
          </CardHeader>
          <CardContent>
            {busy ? (
              <LoadingRows rows={3} />
            ) : !data?.sales.length ? (
              <p className="py-4 text-center text-sm text-muted-foreground">Nothing yet today.</p>
            ) : (
              <ul className="divide-y">
                {data.sales.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {t.items.map((i) => `${i.product_name} ×${formatQty(i.quantity)}`).join(", ")}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatTime(t.sold_at)} · {t.payment_method}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className={cn("font-semibold tabular-nums", t.status === "voided" && "line-through text-muted-foreground")}>
                        {formatPeso(t.total_amount)}
                      </p>
                      {t.status === "voided" && <Badge variant="destructive">Voided</Badge>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
