"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Info, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ErrorState, LoadingRows, PageHeader } from "@/components/app/common";
import { useAppData } from "@/components/app/app-data";
import { unwrap, useQuery } from "@/hooks/use-query";
import { cn } from "@/lib/utils";
import { formatPeso, formatQty } from "@/lib/format";
import { addDays, formatDate, todayManila } from "@/lib/dates";
import { fetchDaily, fetchExpenseCategories, fetchPayments, fetchProducts, totalsOf } from "@/lib/report-utils";
import type { Expense } from "@/lib/types";

export function SummaryView() {
  const { settings } = useAppData();
  const today = todayManila();
  const [date, setDate] = useState(today);

  const { data, error, loading, reload } = useQuery(
    async (sb) => {
      const [daily, products, payments, cats, expenses] = await Promise.all([
        fetchDaily(sb, date, date),
        fetchProducts(sb, date, date),
        fetchPayments(sb, date, date),
        fetchExpenseCategories(sb, date, date),
        sb.from("expenses").select("*, categories(id, name, is_inventory_purchase)").eq("expense_date", date).order("created_at"),
      ]);
      return { daily, products, payments, cats, expenses: unwrap(expenses) as Expense[] };
    },
    [date],
    { realtime: ["sales", "expenses"] },
  );
  const t = useMemo(() => totalsOf(data?.daily ?? []), [data]);

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

  return (
    <>
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
                      {data.expenses.map((e) => (
                        <TableRow key={e.id}>
                          <TableCell className="pl-4">
                            {e.name}
                            {e.quantity != null && <span className="text-xs text-muted-foreground"> × {formatQty(e.quantity)}</span>}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">{e.categories?.name ?? "Uncategorized"}</TableCell>
                          <TableCell className="pr-4 text-right tabular-nums">{formatPeso(e.amount)}</TableCell>
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
    </>
  );
}
