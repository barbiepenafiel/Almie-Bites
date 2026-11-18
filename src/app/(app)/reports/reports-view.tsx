"use client";

import { useMemo, useState } from "react";
import { Download, FileBarChart, Printer } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, ErrorState, Field, LoadingRows, PageHeader, SimpleSelect, StockBadge } from "@/components/app/common";
import { DateRangeFilter } from "@/components/app/date-range-filter";
import { SalesExpensesChart } from "@/components/charts/sales-expenses-chart";
import { useAppData } from "@/components/app/app-data";
import { unwrap, useQuery } from "@/hooks/use-query";
import { downloadCsv, formatPeso, formatQty, money } from "@/lib/format";
import { daysBetween, describeRange, formatDate, formatDateTime, startOfMonth, todayManila, type DateRange } from "@/lib/dates";
import { autoGrouping, fetchDaily, fetchProducts, groupRows, type Grouping } from "@/lib/report-utils";
import { stockStatus, type Expense, type InventoryItem, type Product } from "@/lib/types";

type ReportType =
  | "daily_sales"
  | "weekly_sales"
  | "monthly_sales"
  | "daily_expense"
  | "monthly_expense"
  | "product_sales"
  | "inventory"
  | "low_stock"
  | "profit";

const REPORTS: Record<ReportType, { label: string; dated: boolean; filter?: "product" | "expense" | "inventory" }> = {
  daily_sales: { label: "Daily Sales Report", dated: true },
  weekly_sales: { label: "Weekly Sales Report", dated: true },
  monthly_sales: { label: "Monthly Sales Report", dated: true },
  daily_expense: { label: "Daily Expense Report", dated: true, filter: "expense" },
  monthly_expense: { label: "Monthly Expense Report", dated: true, filter: "expense" },
  product_sales: { label: "Product Sales Report", dated: true, filter: "product" },
  inventory: { label: "Inventory Report", dated: false, filter: "inventory" },
  low_stock: { label: "Low Stock Report", dated: false, filter: "inventory" },
  profit: { label: "Profit Summary Report", dated: true },
};

type Cell = string | number;
interface Built {
  headers: string[];
  align: ("left" | "right")[];
  rows: { cells: Cell[]; display?: React.ReactNode[] }[];
  footer?: Cell[];
  chart?: { data: ReturnType<typeof groupRows>; salesOnly?: boolean };
}

async function fetchAllExpenses(sb: SupabaseClient, start: string, end: string): Promise<Expense[]> {
  const out: Expense[] = [];
  for (let from = 0; ; from += 1000) {
    const res = await sb
      .from("expenses")
      .select("*, categories(id, name, is_inventory_purchase), inventory_items(id, name, unit)")
      .gte("expense_date", start)
      .lte("expense_date", end)
      .order("expense_date")
      .order("created_at")
      .range(from, from + 999);
    const rows = unwrap(res) as Expense[];
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}

export function ReportsView() {
  const { settings, categoriesOf } = useAppData();
  const [type, setType] = useState<ReportType>("daily_sales");
  const [range, setRange] = useState<DateRange>(() => ({ start: startOfMonth(todayManila()), end: todayManila(), preset: "month" }));
  const [productId, setProductId] = useState("all");
  const [productCat, setProductCat] = useState("all");
  const [expenseCat, setExpenseCat] = useState("all");
  const [invCat, setInvCat] = useState("all");
  const meta = REPORTS[type];

  const { data: products } = useQuery(async (sb) => unwrap(await sb.from("products").select("id, name, category").order("name")) as Product[], []);

  const { data, error, loading, reload } = useQuery(
    async (sb) => {
      if (type === "inventory" || type === "low_stock")
        return { kind: "inv" as const, items: unwrap(await sb.from("inventory_items").select("*").order("category").order("name")) as InventoryItem[] };
      if (type === "product_sales") return { kind: "prod" as const, prods: await fetchProducts(sb, range.start, range.end) };
      if (type === "daily_expense" || type === "monthly_expense")
        return { kind: "exp" as const, expenses: await fetchAllExpenses(sb, range.start, range.end) };
      return { kind: "daily" as const, daily: await fetchDaily(sb, range.start, range.end) };
    },
    [type, range.start, range.end],
  );

  const built: Built | null = useMemo(() => {
    if (!data) return null;
    if (data.kind === "daily") {
      if (type === "profit") {
        const by = autoGrouping(daysBetween(range.start, range.end));
        const g = groupRows(data.daily, by);
        const rows = g.map((p) => {
          return {
            cells: [p.label, p.sales, money(p.cogs), money(p.sales - p.cogs), p.inventoryPurchases, p.otherExpenses, p.expenses, p.profit],
          };
        });
        const sum = (i: number) => money(rows.reduce((s, r) => s + Number(r.cells[i]), 0));
        return {
          headers: ["Period", "Sales", "Cost of goods sold", "Gross profit", "Inventory purchases", "Other expenses", "Total expenses", "Estimated profit"],
          align: ["left", "right", "right", "right", "right", "right", "right", "right"],
          rows,
          footer: ["Total", sum(1), sum(2), sum(3), sum(4), sum(5), sum(6), sum(7)],
          chart: { data: g },
        };
      }
      const by: Grouping = type === "weekly_sales" ? "week" : type === "monthly_sales" ? "month" : "day";
      const g = groupRows(data.daily, by);
      const rows = g.map((p) => ({ cells: [p.label, p.transactions, p.items, p.sales, p.transactions ? money(p.sales / p.transactions) : 0] }));
      const tx = g.reduce((s, p) => s + p.transactions, 0);
      const sales = money(g.reduce((s, p) => s + p.sales, 0));
      return {
        headers: [by === "day" ? "Date" : by === "week" ? "Week" : "Month", "Transactions", "Products sold", "Sales", "Average sale"],
        align: ["left", "right", "right", "right", "right"],
        rows,
        footer: ["Total", tx, g.reduce((s, p) => s + p.items, 0), sales, tx ? money(sales / tx) : 0],
        chart: { data: g, salesOnly: true },
      };
    }
    if (data.kind === "prod") {
      const list = data.prods.filter(
        (p) => (productId === "all" || p.product_id === productId) && (productCat === "all" || p.category === productCat),
      );
      const total = list.reduce((s, p) => s + Number(p.revenue), 0);
      return {
        headers: ["Product", "Category", "Qty sold", "Sales", "Cost of goods sold", "Gross profit", "% of sales"],
        align: ["left", "left", "right", "right", "right", "right", "right"],
        rows: list.map((p) => ({
          cells: [p.product_name, p.category, Number(p.quantity), Number(p.revenue), Number(p.cost), money(Number(p.revenue) - Number(p.cost)), total ? `${Math.round((Number(p.revenue) / total) * 100)}%` : "0%"],
        })),
        footer: [
          "Total",
          "",
          list.reduce((s, p) => s + Number(p.quantity), 0),
          money(total),
          money(list.reduce((s, p) => s + Number(p.cost), 0)),
          money(list.reduce((s, p) => s + Number(p.revenue) - Number(p.cost), 0)),
          "100%",
        ],
      };
    }
    if (data.kind === "exp") {
      const list = data.expenses.filter((e) => expenseCat === "all" || (expenseCat === "none" ? !e.category_id : e.category_id === expenseCat));
      if (type === "daily_expense") {
        return {
          headers: ["Date", "Expense", "Category", "Qty", "Payment", "Amount"],
          align: ["left", "left", "left", "right", "left", "right"],
          rows: list.map((e) => ({
            cells: [formatDate(e.expense_date), e.name, e.categories?.name ?? "Uncategorized", e.quantity ?? "", e.payment_method, Number(e.amount)],
          })),
          footer: ["Total", `${list.length} entries`, "", "", "", money(list.reduce((s, e) => s + Number(e.amount), 0))],
        };
      }
      const map = new Map<string, { label: string; inv: number; other: number; n: number }>();
      for (const e of list) {
        const k = startOfMonth(e.expense_date);
        const r = map.get(k) ?? { label: formatDate(k, { month: "long", year: "numeric" }), inv: 0, other: 0, n: 0 };
        const isInv = !!e.inventory_item_id || !!e.categories?.is_inventory_purchase;
        if (isInv) r.inv += Number(e.amount);
        else r.other += Number(e.amount);
        r.n++;
        map.set(k, r);
      }
      const rows = [...map.values()].map((r) => ({ cells: [r.label, r.n, money(r.inv), money(r.other), money(r.inv + r.other)] as Cell[] }));
      const sum = (i: number) => money(rows.reduce((s, r) => s + Number(r.cells[i]), 0));
      return {
        headers: ["Month", "Entries", "Inventory purchases", "Other expenses", "Total"],
        align: ["left", "right", "right", "right", "right"],
        rows,
        footer: ["Total", sum(1), sum(2), sum(3), sum(4)],
      };
    }
    // inventory
    const items = data.items.filter((i) => (invCat === "all" || i.category === invCat) && (type === "inventory" || stockStatus(i) !== "in"));
    const label = { in: "In stock", low: "Low stock", out: "Out of stock" };
    return {
      headers:
        type === "inventory"
          ? ["Item", "Category", "Unit", "Stock", "Minimum", "Cost / unit", "Stock value", "Status", "Supplier"]
          : ["Item", "Category", "Unit", "Stock", "Minimum", "Short by", "Status", "Supplier"],
      align:
        type === "inventory"
          ? ["left", "left", "left", "right", "right", "right", "right", "left", "left"]
          : ["left", "left", "left", "right", "right", "right", "left", "left"],
      rows: items.map((i) => {
        const st = stockStatus(i);
        const base: Cell[] = [i.name, i.category, i.unit, Number(i.current_stock), Number(i.minimum_stock)];
        const cells: Cell[] =
          type === "inventory"
            ? [...base, Number(i.purchase_price), Number(i.stock_value), label[st], i.supplier ?? ""]
            : [...base, Math.max(0, Number(i.minimum_stock) - Number(i.current_stock)), label[st], i.supplier ?? ""];
        const display: React.ReactNode[] = cells.map((c, idx) => (idx === cells.length - 2 ? <StockBadge key="b" status={st} /> : null));
        return { cells, display };
      }),
      footer:
        type === "inventory"
          ? ["Total", `${items.length} items`, "", "", "", "", money(items.reduce((s, i) => s + Number(i.stock_value), 0)), "", ""]
          : undefined,
    };
  }, [data, type, range, productId, productCat, expenseCat, invCat]);

  const moneyCols = useMemo(() => {
    const h = built?.headers ?? [];
    return new Set(
      h.map((x, i) => (/(sales|amount|cost|profit|value|purchases|expenses|total|average)/i.test(x) && !/qty|entries|transactions/i.test(x) ? i : -1)).filter((i) => i >= 0),
    );
  }, [built]);

  const fmt = (c: Cell, i: number) => (typeof c === "number" ? (moneyCols.has(i) ? formatPeso(c) : formatQty(c)) : c);

  function exportCsv() {
    if (!built) return;
    const rows = built.rows.map((r) => r.cells);
    if (built.footer) rows.push(built.footer);
    const suffix = meta.dated ? `${range.start}_to_${range.end}` : todayManila();
    downloadCsv(`almie-bites_${type}_${suffix}.csv`, built.headers, rows);
  }

  const productOptions = [{ value: "all", label: "All products" }, ...(products ?? []).map((p) => ({ value: p.id, label: p.name }))];
  const productCatOptions = [
    { value: "all", label: "All categories" },
    ...[...new Set([...categoriesOf("product").map((c) => c.name), ...(products ?? []).map((p) => p.category)])].map((n) => ({ value: n, label: n })),
  ];

  return (
    <>
      <PageHeader
        title="Reports"
        description="Clear summaries you can export to CSV or print."
        actions={
          <>
            <Button variant="outline" onClick={exportCsv} disabled={!built?.rows.length}>
              <Download /> Export CSV
            </Button>
            <Button variant="outline" onClick={() => window.print()} disabled={!built}>
              <Printer /> Print
            </Button>
          </>
        }
      />

      <Card className="no-print mb-6">
        <CardContent className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Field label="Report">
            <SimpleSelect
              aria-label="Report type"
              value={type}
              onChange={(v) => setType(v as ReportType)}
              options={(Object.keys(REPORTS) as ReportType[]).map((k) => ({ value: k, label: REPORTS[k].label }))}
            />
          </Field>
          {meta.dated && (
            <Field label="Date range" className="lg:col-span-2">
              <DateRangeFilter
                value={range}
                onChange={setRange}
                presets={["today", "yesterday", "week", "last7", "month", "last30", "custom"]}
              />
            </Field>
          )}
          {meta.filter === "product" && (
            <>
              <Field label="Product">
                <SimpleSelect aria-label="Product" value={productId} onChange={setProductId} options={productOptions} />
              </Field>
              <Field label="Product category">
                <SimpleSelect aria-label="Product category" value={productCat} onChange={setProductCat} options={productCatOptions} />
              </Field>
            </>
          )}
          {meta.filter === "expense" && (
            <Field label="Expense category">
              <SimpleSelect
                aria-label="Expense category"
                value={expenseCat}
                onChange={setExpenseCat}
                options={[
                  { value: "all", label: "All categories" },
                  ...categoriesOf("expense").map((c) => ({ value: c.id, label: c.name })),
                  { value: "none", label: "Uncategorized" },
                ]}
              />
            </Field>
          )}
          {meta.filter === "inventory" && (
            <Field label="Inventory category">
              <SimpleSelect
                aria-label="Inventory category"
                value={invCat}
                onChange={setInvCat}
                options={[{ value: "all", label: "All categories" }, ...categoriesOf("inventory").map((c) => ({ value: c.name, label: c.name }))]}
              />
            </Field>
          )}
        </CardContent>
      </Card>

      <Card className="print-area">
        <CardContent className="grid gap-4">
          <div className="flex flex-col gap-1 border-b pb-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="font-heading text-lg font-semibold">{settings?.business_name ?? "Almie Bites"}</p>
              <h2 className="text-xl font-semibold">{meta.label}</h2>
            </div>
            <div className="text-sm text-muted-foreground sm:text-right">
              <p>{meta.dated ? describeRange(range) : `As of ${formatDateTime(new Date().toISOString())}`}</p>
              <p className="text-xs">Generated {formatDateTime(new Date().toISOString())} · Philippine time</p>
            </div>
          </div>

          {error ? (
            <ErrorState message={error} onRetry={reload} />
          ) : loading || !built ? (
            <LoadingRows rows={8} />
          ) : built.rows.length === 0 ? (
            <EmptyState icon={FileBarChart} title="Nothing to report" description="There are no records for the selected filters." />
          ) : (
            <>
              {built.chart && built.chart.data.length > 1 && (
                <div className="no-print">
                  <SalesExpensesChart data={built.chart.data} salesOnly={built.chart.salesOnly} height={220} />
                </div>
              )}
              <div className="-mx-4">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {built.headers.map((h, i) => (
                        <TableHead key={h} className={`${built.align[i] === "right" ? "text-right" : ""} ${i === 0 ? "pl-4" : ""} ${i === built.headers.length - 1 ? "pr-4" : ""}`}>
                          {h}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {built.rows.map((r, ri) => (
                      <TableRow key={ri}>
                        {r.cells.map((c, i) => (
                          <TableCell
                            key={i}
                            className={`${built.align[i] === "right" ? "text-right tabular-nums" : ""} ${i === 0 ? "pl-4 font-medium" : ""} ${i === r.cells.length - 1 ? "pr-4" : ""}`}
                          >
                            {r.display?.[i] ?? fmt(c, i)}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                  {built.footer && (
                    <TableFooter>
                      <TableRow>
                        {built.footer.map((c, i) => (
                          <TableCell key={i} className={`${built.align[i] === "right" ? "text-right tabular-nums" : ""} ${i === 0 ? "pl-4" : ""} ${i === built.footer!.length - 1 ? "pr-4" : ""}`}>
                            {fmt(c, i)}
                          </TableCell>
                        ))}
                      </TableRow>
                    </TableFooter>
                  )}
                </Table>
              </div>
              {type === "profit" && (
                <p className="text-xs text-muted-foreground">
                  Estimated profit = sales − all expenses (inventory purchases included).
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </>
  );
}
