"use client";

import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

import { useState } from "react";
import { BadgeCheck, Hourglass, PiggyBank, Wallet } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ErrorState, LoadingRows, PageHeader, StatCard } from "@/components/app/common";
import { DateRangeFilter } from "@/components/app/date-range-filter";
import { useStaffData } from "@/components/staff/staff-data";
import { useQuery } from "@/hooks/use-query";
import { formatPeso, formatQty } from "@/lib/format";
import { describeRange, formatDate, rangeForPreset, type DateRange } from "@/lib/dates";
import { describeEarning, fetchStaffSummary } from "@/lib/staff-utils";

export default function StaffEarningsPage() {
  const { profile } = useStaffData();
  const [range, setRange] = useState<DateRange>(rangeForPreset("week"));
  const { data: s, error, loading, reload } = useQuery((sb) => fetchStaffSummary(sb, range.start, range.end), [range.start, range.end], {
    refetchOnFocus: true,
  });
  const busy = loading && !s;
  const tiered = profile?.earning_type === "daily_tier";

  return (
    <>
      <PageHeader
        title="My Earnings"
        description={describeRange(range)}
        actions={
          <Link href="/staff/payments" className={buttonVariants({ variant: "outline", size: "sm" })}>
            Payment history
          </Link>
        }
      />
      <div className="mb-4">
        <DateRangeFilter value={range} onChange={setRange} presets={["today", "yesterday", "week", "month", "custom"]} />
      </div>
      {error && <ErrorState message={error} onRetry={reload} />}

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Earned in this period" value={formatPeso(s?.earnings)} icon={PiggyBank} tone="brand" loading={busy} hint={`From ${formatPeso(s?.sales_total)} sales`} />
        <StatCard label="Total earned (all time)" value={formatPeso(s?.earned_total)} icon={Wallet} loading={busy} />
        <StatCard label="Already paid to me" value={formatPeso(s?.paid_total)} icon={BadgeCheck} loading={busy} />
        <StatCard label="Unpaid balance" value={formatPeso(s?.unpaid)} icon={Hourglass} tone={(s?.unpaid ?? 0) > 0 ? "warning" : "default"} loading={busy} />
      </div>

      {profile && (
        <p className="mb-6 rounded-lg border bg-card px-4 py-3 text-sm">
          <span className="font-medium">How you earn:</span> {describeEarning(profile)}. Voided sales
          don&apos;t count. Payments are recorded by the owner.
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>By product</CardTitle>
            {tiered && <CardDescription>Your pay is per day (see By day), not per product.</CardDescription>}
          </CardHeader>
          <CardContent className="px-0">
            {busy ? (
              <LoadingRows rows={4} />
            ) : !s?.products.length ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No sales in this period.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-4">Product</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    {!tiered && <TableHead className="pr-4 text-right">Earned</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {s.products.map((p) => (
                    <TableRow key={p.product_name}>
                      <TableCell className="pl-4">{p.product_name}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatQty(p.quantity)}</TableCell>
                      {!tiered && <TableCell className="pr-4 text-right tabular-nums">{formatPeso(p.earnings)}</TableCell>}
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell className="pl-4">Total</TableCell>
                    <TableCell className="text-right tabular-nums">{formatQty(s.items_sold)}</TableCell>
                    {!tiered && <TableCell className="pr-4 text-right tabular-nums">{formatPeso(s.earnings)}</TableCell>}
                  </TableRow>
                </TableFooter>
              </Table>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>By day</CardTitle>
            <CardDescription>Philippine time</CardDescription>
          </CardHeader>
          <CardContent className="px-0">
            {busy ? (
              <LoadingRows rows={4} />
            ) : !s?.days.length ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No sales in this period.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-4">Date</TableHead>
                    <TableHead className="text-right">Sales</TableHead>
                    <TableHead className="pr-4 text-right">{tiered ? "Pay" : "Earned"}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[...s.days].reverse().map((d) => (
                    <TableRow key={d.day}>
                      <TableCell className="pl-4">{formatDate(d.day, { weekday: "short", month: "short", day: "numeric" })}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatPeso(d.sales_total)}</TableCell>
                      <TableCell className="pr-4 text-right tabular-nums">{formatPeso(d.earnings)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
