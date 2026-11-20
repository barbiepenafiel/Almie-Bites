"use client";

import { useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Download, FileDown, Info, Loader2, Printer } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ErrorState, LoadingRows, PageHeader } from "@/components/app/common";
import { useAppData } from "@/components/app/app-data";
import { unwrap, useQuery } from "@/hooks/use-query";
import { cn } from "@/lib/utils";
import { downloadCsv, errorMessage, formatPeso, groupExpenses, formatQty, money } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import { exportBlocksToPdf } from "@/lib/pdf";
import { addDays, formatDate, formatDateTime, formatTime, manilaEndExclusiveISO, manilaStartISO, todayManila } from "@/lib/dates";
import { fetchDaily, fetchExpenseCategories, fetchPayments, fetchProducts, fetchStaffReport, totalsOf } from "@/lib/report-utils";
import type { Expense, Sale } from "@/lib/types";
import { buildStaffSales, StaffCashTable, type JuiceSale, type StaffCashRecord } from "./staff-cash-table";

export function SummaryView() {
  const { settings } = useAppData();
  const today = todayManila();
  const [date, setDate] = useState(today);
  const [downloading, setDownloading] = useState(false);
  const [makingPdf, setMakingPdf] = useState(false);
  const pdfRef = useRef<HTMLDivElement>(null);

  /** PDF of exactly what prints: the page title/date + the summary sections. */
  async function downloadPdf() {
    const root = pdfRef.current;
    if (!root || !data) return;
    setMakingPdf(true);
    try {
      const header = root.firstElementChild as HTMLElement | null;
      const area = root.querySelector<HTMLElement>(".print-area");
      const blocks = [header, ...(area ? (Array.from(area.children) as HTMLElement[]) : [])].filter(Boolean) as HTMLElement[];
      const business = settings?.business_name ?? "Almie Bites";
      await exportBlocksToPdf(
        blocks,
        `${business.replace(/[^\w]+/g, "-").toLowerCase()}_daily-summary_${date}.pdf`,
        `${business} · Daily Summary · ${formatDate(date)}`,
      );
      toast.success("Daily summary PDF downloaded");
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't create the PDF. Try Print → Save as PDF instead."));
    } finally {
      setMakingPdf(false);
    }
  }

  const { data, error, loading, reload } = useQuery(
    async (sb) => {
      const [daily, products, payments, cats, expenses, staff] = await Promise.all([
        fetchDaily(sb, date, date),
        fetchProducts(sb, date, date),
        fetchPayments(sb, date, date),
        fetchExpenseCategories(sb, date, date),
        sb.from("expenses").select("*, categories(id, name, is_inventory_purchase), inventory_items(id, name, unit)").eq("expense_date", date).order("created_at"),
        fetchStaffReport(sb, date, date).catch(() => []),
      ]);
      // Cash received + Juice income (empty until the migration is applied).
      const [cash, juice] = await Promise.all([
        sb.from("staff_cash").select("staff_id, cash, juice_sale_id").eq("day", date),
        sb
          .from("sales")
          .select("staff_id, total_amount")
          .eq("is_cash_over", true)
          .eq("status", "completed")
          .gte("sold_at", manilaStartISO(date))
          .lt("sold_at", manilaEndExclusiveISO(date)),
      ]);
      return {
        daily,
        products,
        payments,
        cats,
        expenses: unwrap(expenses) as Expense[],
        staff,
        cash: (cash.error ? [] : cash.data ?? []) as StaffCashRecord[],
        juice: (juice.error ? [] : juice.data ?? []) as JuiceSale[],
      };
    },
    [date],
    { realtime: ["sales", "expenses"] },
  );
  const t = useMemo(() => totalsOf(data?.daily ?? []), [data]);
  const expenseGroups = useMemo(() => groupExpenses(data?.expenses ?? []), [data]);

  /** Each staff member's sales for the day (active staff, or anyone who sold), plus sales made by the owner. */
  const staffSales = useMemo(
    () => buildStaffSales(data?.staff ?? [], data?.cash ?? [], data?.juice ?? [], { transactions: t.transactions, items: t.items, sales: t.sales }),
    [data, t],
  );

  const summaryRows: { label: string; value: number; strong?: boolean; tone?: "pos" | "neg"; note?: string }[] = [
    { label: "Gross sales", value: t.sales, note: "All completed sales before expenses" },
    { label: "Total sales", value: t.sales, strong: true, note: "Voided sales excluded" },
    { label: "Inventory purchases", value: t.inventoryPurchases, note: "Ingredients, packaging and linked stock purchases" },
    { label: "Other expenses", value: t.otherExpenses, note: "Transport, utilities, equipment, etc." },
    { label: "Total expenses", value: t.expenses, strong: true },
    { label: "Estimated profit", value: t.profit, strong: true, tone: t.profit >= 0 ? "pos" : "neg", note: "Total sales − total expenses" },
    { label: "Cost of goods sold", value: t.cogs, note: "Cost per piece × pieces sold (at the time of each sale)" },
    {
      label: "Gross profit",
      value: t.sales - t.cogs,
      strong: true,
      tone: t.sales - t.cogs >= 0 ? "pos" : "neg",
      note: "Total sales − cost of goods sold",
    },
  ];

  /** One CSV with everything for the selected day (fetched fresh). */
  async function downloadSummary() {
    if (!data) return;
    setDownloading(true);
    try {
      const sb = createClient();
      const [salesRes, staff] = await Promise.all([
        sb
          .from("sales")
          .select("*, sale_items(product_name, quantity, unit_price, subtotal), staff(id, full_name)")
          .gte("sold_at", manilaStartISO(date))
          .lt("sold_at", manilaEndExclusiveISO(date))
          .order("sold_at"),
        fetchStaffReport(sb, date, date).catch(() => []),
      ]);
      if (salesRes.error) throw salesRes.error;
      const sales = (salesRes.data ?? []) as Sale[];
      const business = settings?.business_name ?? "Almie Bites";
      const rows: (string | number)[][] = [];
      const section = (title: string, header: string[]) => {
        rows.push([]);
        rows.push([title.toUpperCase()]);
        rows.push(header);
      };

      rows.push(["Date", formatDate(date, { weekday: "long", month: "long", day: "numeric", year: "numeric" })]);
      rows.push(["Generated", `${formatDateTime(new Date().toISOString())} (Philippine time)`]);

      section("Financial summary", ["Item", "Amount (PHP)", "Note"]);
      summaryRows.forEach((r) => rows.push([r.label, money(r.value), r.note ?? ""]));
      rows.push(["Transactions", t.transactions, "Completed sales"]);
      rows.push(["Products sold", t.items, "Pieces / items"]);
      rows.push(["Average sale", money(t.averageSale), ""]);
      rows.push(["Voided sales", t.voided, "Not counted in totals"]);

      section("Sales by product", ["Product", "Quantity", "Sales (PHP)", "Cost of goods (PHP)", "Gross profit (PHP)"]);
      data.products.forEach((p) => rows.push([p.product_name, Number(p.quantity), money(Number(p.revenue)), money(Number(p.cost)), money(Number(p.revenue) - Number(p.cost))]));
      rows.push(["Total", t.items, money(t.sales), money(t.cogs), money(t.sales - t.cogs)]);

      section("Sales by payment method", ["Payment method", "Transactions", "Amount (PHP)"]);
      data.payments.forEach((p) => rows.push([p.payment_method, p.transactions, money(Number(p.total))]));

      if (staffSales.length) {
        const pay = new Map(staff.map((r) => [r.staff_id, Number(r.earnings)]));
        section("Sales by staff", ["Staff", "Transactions", "Products sold", "Sales (PHP)", "Cash received (PHP)", "Juice income (PHP)", "Short (PHP)", "Pay (PHP)"]);
        staffSales.forEach((s) =>
          rows.push([
            s.name,
            s.transactions,
            s.items,
            money(s.expected),
            s.cash === null ? "" : money(s.cash),
            s.juice ? money(s.juice) : "",
            s.short ? money(s.short) : "",
            pay.has(s.key) ? money(pay.get(s.key)!) : "",
          ]),
        );
        const sumOf = (f: (r: (typeof staffSales)[number]) => number) => money(staffSales.reduce((a, r) => a + f(r), 0));
        rows.push(["Total", "", "", sumOf((r) => r.expected), sumOf((r) => r.cash ?? 0), sumOf((r) => r.juice), sumOf((r) => r.short), ""]);
      }

      section("Sales transactions", ["Time", "Transaction #", "Sold by", "Payment", "Items", "Status", "Total (PHP)"]);
      sales.forEach((x) =>
        rows.push([
          formatTime(x.sold_at),
          x.transaction_number,
          x.staff?.full_name ?? "Owner",
          x.payment_method,
          (x.sale_items ?? []).map((i) => `${i.product_name} x${formatQty(i.quantity)}`).join("; "),
          x.status === "voided" ? "VOIDED" : "Completed",
          money(Number(x.total_amount)),
        ]),
      );

      section("Expenses", ["Expense", "Category", "Quantity", "Purchases", "Amount (PHP)"]);
      expenseGroups.forEach((g) => rows.push([g.name, g.category, g.qtyLabel, g.entries, money(g.amount)]));
      rows.push(["Total", "", "", data.expenses.length, money(t.expenses)]);

      section("Expenses by category", ["Category", "Entries", "Amount (PHP)"]);
      data.cats.forEach((c) => rows.push([c.category_name, c.entries, money(Number(c.total))]));

      downloadCsv(`${business.replace(/[^\w]+/g, "-").toLowerCase()}_daily-summary_${date}.csv`, [`${business} - Daily Summary`], rows);
      toast.success("Daily summary downloaded");
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't create the download."));
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div ref={pdfRef}>
      <PageHeader
        title="Daily Summary"
        description={`${settings?.business_name ?? "Almie Bites"} · ${formatDate(date, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}`}
        actions={
          <>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="icon" aria-label="Previous day" onClick={() => setDate((d) => addDays(d, -1))}>
                <ChevronLeft />
              </Button>
              <Input type="date" aria-label="Summary date" className="w-40" value={date} max={today} onChange={(e) => e.target.value && setDate(e.target.value)} />
              <Button variant="outline" size="icon" aria-label="Next day" disabled={date >= today} onClick={() => setDate((d) => addDays(d, 1))}>
                <ChevronRight />
              </Button>
            </div>
            {date !== today && (
              <Button variant="ghost" onClick={() => setDate(today)}>
                Today
              </Button>
            )}
            <Button onClick={downloadPdf} disabled={!data || makingPdf}>
              {makingPdf ? <Loader2 className="animate-spin" /> : <FileDown />} {makingPdf ? "Making PDF…" : "Download PDF"}
            </Button>
            <Button variant="outline" onClick={downloadSummary} disabled={!data || downloading}>
              {downloading ? <Loader2 className="animate-spin" /> : <Download />} CSV
            </Button>
            <Button variant="outline" onClick={() => window.print()}>
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
        <div className="print-area grid gap-6">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {[
              { label: "Total sales", value: formatPeso(t.sales) },
              { label: "Total expenses", value: formatPeso(t.expenses) },
              { label: "Estimated profit", value: formatPeso(t.profit), tone: t.profit >= 0 ? "text-success" : "text-danger" },
              { label: "Transactions", value: String(t.transactions) },
              { label: "Products sold", value: formatQty(t.items) },
              { label: "Average sale", value: formatPeso(t.averageSale) },
              { label: "Inventory purchases", value: formatPeso(t.inventoryPurchases) },
              { label: "Other expenses", value: formatPeso(t.otherExpenses) },
            ].map((c) => (
              <Card key={c.label} size="sm">
                <CardContent>
                  <p className="text-xs text-muted-foreground">{c.label}</p>
                  <p className={cn("mt-1 text-xl font-semibold tabular-nums", c.tone)}>{c.value}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="grid gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Financial summary</CardTitle>
                <CardDescription>
                  {t.transactions} transaction{t.transactions === 1 ? "" : "s"}
                  {t.voided ? ` · ${t.voided} voided (excluded)` : ""}
                </CardDescription>
              </CardHeader>
              <CardContent className="px-0">
                <Table>
                  <TableBody>
                    {summaryRows.map((r) => (
                      <TableRow key={r.label} className={r.strong ? "bg-muted/40" : ""}>
                        <TableCell className="pl-4">
                          <div className={r.strong ? "font-semibold" : ""}>{r.label}</div>
                          {r.note && <div className="text-xs text-muted-foreground">{r.note}</div>}
                        </TableCell>
                        <TableCell
                          className={cn(
                            "pr-4 text-right tabular-nums",
                            r.strong && "font-semibold",
                            r.tone === "pos" && "text-success",
                            r.tone === "neg" && "text-danger",
                          )}
                        >
                          {formatPeso(r.value)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <p className="mx-4 mt-3 flex gap-2 rounded-lg bg-secondary/70 p-3 text-xs text-secondary-foreground">
                  <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                  <span>
                    <strong>Estimated profit</strong> treats every purchase made today as today&apos;s cost — even supplies you will
                    use on later days — so it can dip on restock days and look higher on other days.
                  </span>
                </p>
              </CardContent>
            </Card>

          </div>

          {staffSales.length > 0 && (
            <StaffCashTable date={date} rows={staffSales} totalSales={t.sales} onSaved={reload} />
          )}

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Sales by product</CardTitle>
              </CardHeader>
              <CardContent className="px-0">
                {!data?.products.length ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">No sales on this day.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="pl-4">Product</TableHead>
                        <TableHead className="text-right">Qty</TableHead>
                        <TableHead className="pr-4 text-right">Sales</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.products.map((p) => (
                        <TableRow key={p.product_id ?? p.product_name}>
                          <TableCell className="pl-4">{p.product_name}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatQty(p.quantity)}</TableCell>
                          <TableCell className="pr-4 text-right tabular-nums">{formatPeso(p.revenue)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                    <TableFooter>
                      <TableRow>
                        <TableCell className="pl-4">Total</TableCell>
                        <TableCell className="text-right tabular-nums">{formatQty(t.items)}</TableCell>
                        <TableCell className="pr-4 text-right tabular-nums">{formatPeso(t.sales)}</TableCell>
                      </TableRow>
                    </TableFooter>
                  </Table>
                )}
                {!!data?.payments.length && (
                  <div className="mx-4 mt-4 grid gap-1 text-sm">
                    <p className="text-xs font-medium text-muted-foreground">By payment method</p>
                    {data.payments.map((p) => (
                      <div key={p.payment_method} className="flex justify-between">
                        <span>
                          {p.payment_method} <span className="text-xs text-muted-foreground">({p.transactions})</span>
                        </span>
                        <span className="tabular-nums">{formatPeso(p.total)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Expenses</CardTitle>
              </CardHeader>
              <CardContent className="px-0">
                {!data?.expenses.length ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">No expenses on this day.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="pl-4">Expense</TableHead>
                        <TableHead>Category</TableHead>
                        <TableHead className="pr-4 text-right">Amount</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {expenseGroups.map((g) => (
                        <TableRow key={g.key}>
                          <TableCell className="pl-4">
                            {g.name}
                            {g.qtyLabel && <span className="text-xs text-muted-foreground"> × {g.qtyLabel}</span>}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">{g.category}</TableCell>
                          <TableCell className="pr-4 text-right tabular-nums">{formatPeso(g.amount)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                    <TableFooter>
                      <TableRow>
                        <TableCell className="pl-4" colSpan={2}>
                          Total
                        </TableCell>
                        <TableCell className="pr-4 text-right tabular-nums">{formatPeso(t.expenses)}</TableCell>
                      </TableRow>
                    </TableFooter>
                  </Table>
                )}
                {!!data?.cats.length && (
                  <div className="mx-4 mt-4 grid gap-1 text-sm">
                    <p className="text-xs font-medium text-muted-foreground">By category</p>
                    {data.cats.map((c) => (
                      <div key={c.category_name} className="flex justify-between">
                        <span>{c.category_name}</span>
                        <span className="tabular-nums">{formatPeso(c.total)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
