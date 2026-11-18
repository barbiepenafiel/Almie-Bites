"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, Download, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ErrorState, LoadingRows, PageHeader } from "@/components/app/common";
import { useAppData } from "@/components/app/app-data";
import { unwrap, useQuery } from "@/hooks/use-query";
import { cn } from "@/lib/utils";
import { downloadCsv, formatPeso, formatQty, money } from "@/lib/format";
import { addDays, formatDate, formatDateTime, todayManila } from "@/lib/dates";
import { fetchDaily, fetchRecovery, fetchStaffReport, totalsOf } from "@/lib/report-utils";
import { ABOVE_TARGET_NOTE, RecoveryTable } from "@/components/recovery/recovery";

export function DailyClosingView() {
  const { settings } = useAppData();
  const today = todayManila();
  const [date, setDate] = useState(today);

  const { data, error, loading, reload } = useQuery(
    async (sb) => {
      const [daily, staff, payments, recovery] = await Promise.all([
        fetchDaily(sb, date, date),
        fetchStaffReport(sb, date, date),
        sb.from("staff_payments").select("amount").eq("payment_date", date),
        fetchRecovery(sb, date, true),
      ]);
      const paidToday = money((unwrap(payments) as { amount: number }[]).reduce((s, p) => s + Number(p.amount), 0));
      return { daily, staff, paidToday, recovery };
    },
    [date],
    { realtime: ["sales", "expenses", "staff_payments", "recovery_targets"] },
  );

  const t = totalsOf(data?.daily ?? []);
  const staff = data?.staff ?? [];
  const staffSales = money(staff.reduce((s, r) => s + Number(r.sales_total), 0));
  const staffItems = staff.reduce((s, r) => s + Number(r.items_sold), 0);
  const staffEarnings = money(staff.reduce((s, r) => s + Number(r.earnings), 0));
  const remainingPay = money(staff.reduce((s, r) => s + Math.max(0, Number(r.unpaid)), 0));
  const ownerSales = money(t.sales - staffSales);
  const ownerItems = t.items - staffItems;
  const profitAfterStaff = money(t.profit - staffEarnings);
  const cogs = money(t.cogs);
  const grossProfit = money(t.sales - cogs);
  const businessEarnings = money(grossProfit - staffEarnings);
  const title = `${settings?.business_name ?? "Almie Bites"} – Daily Closing Report`;
  const longDate = formatDate(date, { weekday: "long", month: "long", day: "numeric", year: "numeric" });

  const summary: [string, number, string?][] = [
    ["Total business sales", t.sales, `${t.transactions} transactions`],
    ["Total products sold", t.items],
    ["Cost of goods sold", cogs, "Cost per piece × pieces sold"],
    ["Gross profit", grossProfit, "Sales − cost of goods sold"],
    ["Total staff earnings", staffEarnings, "Earned today"],
    ["Business earnings", businessEarnings, "Gross profit − staff earnings"],
    ["Staff payments made today", data?.paidToday ?? 0],
    ["Remaining staff payments", remainingPay, "All unpaid staff earnings to date"],
    ["Total business expenses", t.expenses, "Includes stock purchases"],
    ["Estimated profit (sales − expenses)", t.profit],
    ["Estimated profit after staff earnings", profitAfterStaff],
  ];
  const STRONG = [0, 3, 5, 9, 10];

  function exportCsv() {
    const rows: (string | number)[][] = staff.map((r) => [r.full_name, r.transactions, Number(r.items_sold), Number(r.sales_total), Number(r.earnings)]);
    if (ownerSales > 0 || ownerItems > 0) rows.push(["Owner / direct sales", "", ownerItems, ownerSales, 0]);
    rows.push(["TOTAL", t.transactions, t.items, t.sales, staffEarnings]);
    rows.push([]);
    summary.forEach(([k, v]) => rows.push([k, "", "", v, ""]));
    if (data?.recovery.length) {
      rows.push([]);
      rows.push(["EXPENSE RECOVERY", "Target", "Sales", "Remaining", "Above target"]);
      data.recovery.forEach((r) => rows.push([r.product_name, Number(r.target_amount), Number(r.sales_total), Number(r.remaining), Number(r.above_target)]));
    }
    downloadCsv(`almie-bites_daily-closing_${date}.csv`, ["Staff", "Transactions", "Products sold", "Total sales", "Staff earnings"], rows);
  }

  return (
    <>
      <PageHeader
        title="Daily Closing"
        description="End-of-day sales per staff member, earnings and profit."
        actions={
          <>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="icon" aria-label="Previous day" onClick={() => setDate((d) => addDays(d, -1))}>
                <ChevronLeft />
              </Button>
              <Input type="date" aria-label="Closing date" className="w-40" value={date} max={today} onChange={(e) => e.target.value && setDate(e.target.value)} />
              <Button variant="outline" size="icon" aria-label="Next day" disabled={date >= today} onClick={() => setDate((d) => addDays(d, 1))}>
                <ChevronRight />
              </Button>
            </div>
            <Button variant="outline" onClick={exportCsv} disabled={!data}>
              <Download /> CSV
            </Button>
            <Button variant="outline" onClick={() => window.print()} disabled={!data}>
              <Printer /> Print
            </Button>
          </>
        }
      />

      {error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : loading && !data ? (
        <Card>
          <LoadingRows rows={8} />
        </Card>
      ) : (
        <Card className="print-area">
          <CardHeader className="border-b">
            <CardTitle className="font-heading text-xl">{title}</CardTitle>
            <CardDescription>
              Date: {longDate} · Generated {formatDateTime(new Date().toISOString())} (Philippine time)
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-6 px-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Staff</TableHead>
                  <TableHead className="text-right">Transactions</TableHead>
                  <TableHead className="text-right">Products sold</TableHead>
                  <TableHead className="text-right">Total sales</TableHead>
                  <TableHead className="pr-4 text-right">Staff earnings</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {staff.map((r) => (
                  <TableRow key={r.staff_id}>
                    <TableCell className="pl-4 font-medium">{r.full_name}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.transactions}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatQty(r.items_sold)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatPeso(r.sales_total)}</TableCell>
                    <TableCell className="pr-4 text-right tabular-nums">{formatPeso(r.earnings)}</TableCell>
                  </TableRow>
                ))}
                {(ownerSales > 0 || ownerItems > 0) && (
                  <TableRow>
                    <TableCell className="pl-4 text-muted-foreground">Owner / direct sales</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">—</TableCell>
                    <TableCell className="text-right tabular-nums">{formatQty(ownerItems)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatPeso(ownerSales)}</TableCell>
                    <TableCell className="pr-4 text-right tabular-nums text-muted-foreground">—</TableCell>
                  </TableRow>
                )}
                {staff.length === 0 && ownerSales === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="py-6 text-center text-muted-foreground">
                      No sales on this day.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell className="pl-4 font-semibold">Total</TableCell>
                  <TableCell className="text-right tabular-nums">{t.transactions}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatQty(t.items)}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{formatPeso(t.sales)}</TableCell>
                  <TableCell className="pr-4 text-right font-semibold tabular-nums">{formatPeso(staffEarnings)}</TableCell>
                </TableRow>
              </TableFooter>
            </Table>

            <div className="mx-4 grid gap-0 overflow-hidden rounded-lg border sm:max-w-xl">
              {summary.map(([label, value, note], i) => {
                const strong = STRONG.includes(i);
                return (
                  <div key={label} className={cn("flex items-center justify-between gap-4 border-b px-4 py-2.5 last:border-0", strong && "bg-muted/50")}>
                    <span>
                      <span className={cn("text-sm", strong && "font-semibold")}>{label}</span>
                      {note && <span className="block text-xs text-muted-foreground">{note}</span>}
                    </span>
                    <span className={cn("tabular-nums", strong && "font-semibold", strong && value < 0 && "text-danger")}>
                      {i === 1 ? formatQty(value) : formatPeso(value)}
                    </span>
                  </div>
                );
              })}
            </div>
            {!!data?.recovery.length && (
              <div className="grid gap-2">
                <p className="mx-4 text-sm font-semibold">Expense recovery (as of {formatDate(date, { month: "short", day: "numeric" })})</p>
                <RecoveryTable rows={data.recovery} compact />
                <p className="mx-4 text-xs text-muted-foreground">{ABOVE_TARGET_NOTE}</p>
              </div>
            )}
            <p className="mx-4 text-xs text-muted-foreground">
              Voided sales are excluded. Staff earnings are a cost to the business but are tracked separately from expenses, so
              “after staff earnings” gives the clearer picture.
            </p>
          </CardContent>
        </Card>
      )}
    </>
  );
}
