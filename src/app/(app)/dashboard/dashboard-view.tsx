"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  Boxes,
  CheckCircle2,
  ChefHat,
  Package,
  PackagePlus,
  PiggyBank,
  Plus,
  ReceiptText,
  ShoppingCart,
  TrendingUp,
  Wallet,
  XCircle,
} from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { ErrorState, LoadingRows, StatCard, StockBadge } from "@/components/app/common";
import { DateRangeFilter } from "@/components/app/date-range-filter";
import { SalesExpensesChart } from "@/components/charts/sales-expenses-chart";
import { SaleDialog } from "@/components/sales/sale-dialog";
import { ExpenseDialog } from "@/components/expenses/expense-dialog";
import { StockDialog } from "@/components/inventory/inventory-dialogs";
import { ProductDialog } from "@/components/products/product-dialog";
import { useAppData } from "@/components/app/app-data";
import { unwrap, useQuery } from "@/hooks/use-query";
import { cn } from "@/lib/utils";
import { formatPeso, formatQty } from "@/lib/format";
import {
  addDays,
  describeRange,
  formatDate,
  formatDateTime,
  formatLongToday,
  manilaEndExclusiveISO,
  manilaStartISO,
  rangeForPreset,
  startOfMonth,
  startOfWeek,
  todayManila,
  type DateRange,
} from "@/lib/dates";
import { fetchDaily, fetchProducts, fetchRecovery, groupRows, totalsOf, type Grouping } from "@/lib/report-utils";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ABOVE_TARGET_NOTE, RecoveryTable } from "@/components/recovery/recovery";
import { stockStatus, type Expense, type InventoryItem, type Sale } from "@/lib/types";

const TREND_WINDOWS: Record<Grouping, { label: string; start: (end: string) => string }> = {
  day: { label: "Last 14 days", start: (end) => addDays(end, -13) },
  week: { label: "Last 12 weeks", start: (end) => startOfWeek(addDays(end, -7 * 11)) },
  month: { label: "Last 12 months", start: (end) => startOfMonth(addDays(startOfMonth(end), -334)) },
};

export function DashboardView() {
  const { settings } = useAppData();
  const [range, setRange] = useState<DateRange>(rangeForPreset("today"));
  const [trend, setTrend] = useState<Grouping>("day");
  const [dialog, setDialog] = useState<null | "sale" | "expense" | "restock" | "product">(null);
  const isToday = range.preset === "today";
  const label = isToday ? "Today's" : "Period";

  const summary = useQuery(
    async (sb) => {
      const [daily, products] = await Promise.all([fetchDaily(sb, range.start, range.end), fetchProducts(sb, range.start, range.end)]);
      return { daily, products };
    },
    [range.start, range.end],
    { realtime: ["sales", "expenses"] },
  );

  const trendEnd = todayManila();
  const trendStart = TREND_WINDOWS[trend].start(trendEnd);
  const trendQ = useQuery((sb) => fetchDaily(sb, trendStart, trendEnd), [trendStart, trendEnd], { realtime: ["sales", "expenses"] });

  const inventory = useQuery(
    async (sb) => unwrap(await sb.from("inventory_items").select("*").order("name")) as InventoryItem[],
    [],
    { realtime: ["inventory_items"] },
  );

  // Pack items: purchases (packs/pieces) and pieces sold in the selected range.
  const pieces = useQuery(
    async (sb) => {
      const [moves, buys] = await Promise.all([
        sb
          .from("inventory_movements")
          .select("inventory_item_id, movement_type, quantity")
          .in("movement_type", ["sale", "sale_reversal", "purchase", "restock"])
          .gte("created_at", manilaStartISO(range.start))
          .lt("created_at", manilaEndExclusiveISO(range.end))
          .limit(5000),
        sb
          .from("expenses")
          .select("inventory_item_id, quantity, stock_added")
          .not("inventory_item_id", "is", null)
          .gte("expense_date", range.start)
          .lte("expense_date", range.end)
          .limit(5000),
      ]);
      const sold = new Map<string, number>();
      const added = new Map<string, number>();
      for (const m of (unwrap(moves) ?? []) as { inventory_item_id: string; movement_type: string; quantity: number }[]) {
        const q = Number(m.quantity);
        if (m.movement_type === "sale" || m.movement_type === "sale_reversal") sold.set(m.inventory_item_id, (sold.get(m.inventory_item_id) ?? 0) - q);
        else added.set(m.inventory_item_id, (added.get(m.inventory_item_id) ?? 0) + q);
      }
      const packs = new Map<string, number>();
      for (const e of (unwrap(buys) ?? []) as { inventory_item_id: string; quantity: number | null; stock_added: number }[]) {
        if (Number(e.stock_added) > 0) packs.set(e.inventory_item_id, (packs.get(e.inventory_item_id) ?? 0) + Number(e.quantity ?? 0));
      }
      return { sold, added, packs };
    },
    [range.start, range.end],
    { realtime: ["inventory_movements"] },
  );

  const recovery = useQuery((sb) => fetchRecovery(sb, null, true), [], { realtime: ["recovery_targets", "sales"] });

  const pendingReq = useQuery(
    async (sb) => {
      const { count, error } = await sb.from("supply_requests").select("id", { count: "exact", head: true }).eq("status", "pending");
      return error ? 0 : (count ?? 0);
    },
    [],
    { realtime: ["supply_requests"] },
  );

  const recent = useQuery(
    async (sb) => {
      const [sales, expenses] = await Promise.all([
        sb.from("sales").select("*, sale_items(product_name, quantity)").eq("status", "completed").order("sold_at", { ascending: false }).limit(6),
        sb.from("expenses").select("*, categories(id, name, is_inventory_purchase)").order("expense_date", { ascending: false }).order("created_at", { ascending: false }).limit(6),
      ]);
      return { sales: unwrap(sales) as Sale[], expenses: unwrap(expenses) as Expense[] };
    },
    [],
    { realtime: ["sales", "expenses"] },
  );

  const totals = useMemo(() => totalsOf(summary.data?.daily ?? []), [summary.data]);
  const inv = useMemo(() => {
    const items = inventory.data ?? [];
    const low = items.filter((i) => stockStatus(i) === "low");
    const out = items.filter((i) => stockStatus(i) === "out");
    const value = items.reduce((s, i) => s + Number(i.stock_value), 0);
    const alerts = [...out, ...low].slice(0, 6);
    return { items, low, out, value, alerts, inStock: items.length - low.length - out.length };
  }, [inventory.data]);
  const packItems = useMemo(() => (inventory.data ?? []).filter((i) => Number(i.pieces_per_pack) > 0), [inventory.data]);
  const packTotals = useMemo(
    () =>
      packItems.reduce(
        (a, i) => ({
          packs: a.packs + (pieces.data?.packs.get(i.id) ?? 0),
          added: a.added + (pieces.data?.added.get(i.id) ?? 0),
          sold: a.sold + (pieces.data?.sold.get(i.id) ?? 0),
          available: a.available + Number(i.current_stock),
        }),
        { packs: 0, added: 0, sold: 0, available: 0 },
      ),
    [packItems, pieces.data],
  );
  const trendRows = useMemo(() => groupRows(trendQ.data ?? [], trend), [trendQ.data, trend]);
  const topProducts = (summary.data?.products ?? []).slice(0, 6);
  const topMax = Math.max(...topProducts.map((p) => Number(p.quantity)), 1);

  const sumLoading = summary.loading && !summary.data;
  const invLoading = inventory.loading && !inventory.data;

  function refreshAll() {
    summary.reload();
    trendQ.reload();
    inventory.reload();
    recent.reload();
    pieces.reload();
    recovery.reload();
  }

  return (
    <>
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm text-muted-foreground">{formatLongToday()}</p>
          <h1 className="font-heading text-2xl font-semibold tracking-tight sm:text-3xl">
            Welcome to {settings?.business_name ?? "Almie Bites"}!
          </h1>
        </div>
        <div className="no-print grid grid-cols-2 gap-2 sm:flex">
          <Button onClick={() => setDialog("sale")}>
            <ShoppingCart /> Record sale
          </Button>
          <Button variant="outline" onClick={() => setDialog("expense")}>
            <ReceiptText /> Add expense
          </Button>
          <Button variant="outline" onClick={() => setDialog("restock")}>
            <PackagePlus /> Restock
          </Button>
          <Button variant="outline" onClick={() => setDialog("product")}>
            <ChefHat /> Add product
          </Button>
        </div>
      </div>

      {(pendingReq.data ?? 0) > 0 && (
        <Link
          href="/requests"
          className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-foreground hover:bg-warning-soft/80"
        >
          <span>
            <strong>
              {pendingReq.data} supply request{pendingReq.data === 1 ? "" : "s"}
            </strong>{" "}
            from staff waiting for you
          </span>
          <span className="flex items-center gap-1 font-medium">
            Review <ArrowRight className="size-4" />
          </span>
        </Link>
      )}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <DateRangeFilter value={range} onChange={setRange} />
        <span className="text-xs text-muted-foreground">{describeRange(range)}</span>
      </div>

      {summary.error && (
        <div className="mb-4">
          <ErrorState message={summary.error} onRetry={summary.reload} />
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label={`${label} sales`} value={formatPeso(totals.sales)} icon={TrendingUp} tone="brand" loading={sumLoading} hint={`${totals.transactions} transaction${totals.transactions === 1 ? "" : "s"}`} />
        <StatCard label={`${label} expenses`} value={formatPeso(totals.expenses)} icon={Wallet} tone="negative" loading={sumLoading} hint={`${formatPeso(totals.inventoryPurchases)} on inventory`} />
        <StatCard
          label="Estimated profit"
          value={formatPeso(totals.profit)}
          icon={PiggyBank}
          tone={totals.profit >= 0 ? "positive" : "negative"}
          loading={sumLoading}
          hint="Sales − expenses"
        />
        <StatCard label="Products sold" value={formatQty(totals.items)} icon={Package} loading={sumLoading} hint={totals.transactions ? `Avg sale ${formatPeso(totals.averageSale)}` : undefined} />
        <StatCard label="Inventory items" value={inv.items.length} icon={Boxes} loading={invLoading} hint="Products & supplies tracked" />
        <StatCard
          label="Low stock items"
          value={inv.low.length + inv.out.length}
          icon={AlertTriangle}
          tone={inv.low.length + inv.out.length ? "warning" : "positive"}
          loading={invLoading}
          hint={inv.out.length ? `${inv.out.length} out of stock` : "At or below minimum"}
        />
        <StatCard label="Inventory value" value={formatPeso(inv.value)} icon={Wallet} tone="positive" loading={invLoading} hint="Stock × cost per unit" />
        <StatCard
          label="Gross profit"
          value={formatPeso(totals.sales - totals.cogs)}
          icon={PiggyBank}
          tone={totals.sales - totals.cogs >= 0 ? "positive" : "negative"}
          loading={sumLoading}
          hint={`Sales − ${formatPeso(totals.cogs)} cost of pieces sold`}
        />
      </div>

      {!!recovery.data?.length && (
        <Card className="mb-6 gap-0 py-0">
          <CardHeader className="border-b py-4">
            <CardTitle>Expense recovery</CardTitle>
            <CardDescription>Open targets · sales earning back what you spent</CardDescription>
            <CardAction>
              <Link href="/recovery" className={buttonVariants({ variant: "ghost", size: "sm" })}>
                Manage <ArrowRight />
              </Link>
            </CardAction>
          </CardHeader>
          <RecoveryTable rows={recovery.data} compact />
          <p className="border-t px-4 py-2 text-[11px] text-muted-foreground">{ABOVE_TARGET_NOTE}</p>
        </Card>
      )}

      {packItems.length > 0 && (
        <Card className="mb-6 gap-0 py-0">
          <CardHeader className="border-b py-4">
            <CardTitle>Pieces stock</CardTitle>
            <CardDescription>
              Items bought in packs and sold by the piece · {describeRange(range)}
            </CardDescription>
          </CardHeader>
          <div className="grid grid-cols-2 gap-3 border-b p-4 sm:grid-cols-4">
            <div>
              <p className="text-xs text-muted-foreground">Packs purchased</p>
              <p className="text-lg font-semibold tabular-nums">{formatQty(packTotals.packs)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Pieces purchased</p>
              <p className="text-lg font-semibold tabular-nums">{formatQty(packTotals.added)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Pieces sold</p>
              <p className="text-lg font-semibold tabular-nums">{formatQty(packTotals.sold)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Pieces available now</p>
              <p className="text-lg font-semibold tabular-nums">{formatQty(packTotals.available)}</p>
            </div>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Item</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Per pack</TableHead>
                <TableHead className="text-right">Available</TableHead>
                <TableHead className="text-right">Sold</TableHead>
                <TableHead className="hidden text-right md:table-cell">Cost / piece</TableHead>
                <TableHead className="hidden text-right lg:table-cell">Value</TableHead>
                <TableHead className="pr-4">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {packItems.map((i) => {
                const ppp = Number(i.pieces_per_pack);
                return (
                  <TableRow key={i.id}>
                    <TableCell className="pl-4">
                      <div className="font-medium">{i.name}</div>
                      <div className="text-xs text-muted-foreground">{i.pack_unit ?? "pack"}</div>
                    </TableCell>
                    <TableCell className="hidden text-right tabular-nums sm:table-cell">{formatQty(ppp)} pcs</TableCell>
                    <TableCell className="text-right tabular-nums">
                      <div className="font-medium">{formatQty(i.current_stock)} pcs</div>
                      <div className="text-xs text-muted-foreground">≈ {formatQty(Math.round((Number(i.current_stock) / ppp) * 10) / 10)} packs</div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatQty(pieces.data?.sold.get(i.id) ?? 0)}</TableCell>
                    <TableCell className="hidden text-right tabular-nums md:table-cell">{formatPeso(i.purchase_price)}</TableCell>
                    <TableCell className="hidden text-right tabular-nums lg:table-cell">{formatPeso(i.stock_value)}</TableCell>
                    <TableCell className="pr-4">
                      <StockBadge status={stockStatus(i)} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}

      <div className="mb-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Sales vs expenses</CardTitle>
            <CardDescription>{TREND_WINDOWS[trend].label}</CardDescription>
            <CardAction>
              <Tabs value={trend} onValueChange={(v) => setTrend(v as Grouping)}>
                <TabsList>
                  <TabsTrigger value="day">Daily</TabsTrigger>
                  <TabsTrigger value="week">Weekly</TabsTrigger>
                  <TabsTrigger value="month">Monthly</TabsTrigger>
                </TabsList>
              </Tabs>
            </CardAction>
          </CardHeader>
          <CardContent>
            {trendQ.error ? (
              <ErrorState message={trendQ.error} onRetry={trendQ.reload} />
            ) : trendQ.loading && !trendQ.data ? (
              <LoadingRows rows={5} />
            ) : (
              <SalesExpensesChart data={trendRows} />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Most sold products</CardTitle>
            <CardDescription>{describeRange(range)}</CardDescription>
          </CardHeader>
          <CardContent>
            {sumLoading ? (
              <LoadingRows rows={4} />
            ) : topProducts.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No sales in this period yet.</p>
            ) : (
              <ol className="grid gap-3">
                {topProducts.map((p, i) => (
                  <li key={p.product_id ?? p.product_name}>
                    <div className="flex items-baseline justify-between gap-2 text-sm">
                      <span className="truncate">
                        <span className="mr-1.5 text-muted-foreground tabular-nums">{i + 1}.</span>
                        <span className="font-medium">{p.product_name}</span>
                      </span>
                      <span className="shrink-0 tabular-nums">
                        {formatQty(p.quantity)} <span className="text-xs text-muted-foreground">sold</span>
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full bg-[var(--chart-sales)]" style={{ width: `${(Number(p.quantity) / topMax) * 100}%` }} />
                      </div>
                      <span className="w-20 text-right text-[11px] text-muted-foreground tabular-nums">{formatPeso(p.revenue)}</span>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="mb-6 grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Inventory overview</CardTitle>
            <CardDescription>Stock status across {inv.items.length} items</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            {invLoading ? (
              <LoadingRows rows={3} />
            ) : (
              <>
                <div className="flex h-3 gap-0.5 overflow-hidden rounded-full bg-muted" role="img" aria-label={`${inv.inStock} in stock, ${inv.low.length} low, ${inv.out.length} out of stock`}>
                  {inv.inStock > 0 && <div className="bg-success" style={{ flex: inv.inStock }} />}
                  {inv.low.length > 0 && <div className="bg-[var(--chart-4)]" style={{ flex: inv.low.length }} />}
                  {inv.out.length > 0 && <div className="bg-danger" style={{ flex: inv.out.length }} />}
                </div>
                <dl className="grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="rounded-lg bg-success-soft p-2">
                    <dt className="flex items-center justify-center gap-1 text-success">
                      <CheckCircle2 className="size-3.5" aria-hidden /> In stock
                    </dt>
                    <dd className="mt-0.5 text-lg font-semibold text-foreground tabular-nums">{inv.inStock}</dd>
                  </div>
                  <div className="rounded-lg bg-warning-soft p-2">
                    <dt className="flex items-center justify-center gap-1 text-warning">
                      <AlertTriangle className="size-3.5" aria-hidden /> Low
                    </dt>
                    <dd className="mt-0.5 text-lg font-semibold text-foreground tabular-nums">{inv.low.length}</dd>
                  </div>
                  <div className="rounded-lg bg-danger-soft p-2">
                    <dt className="flex items-center justify-center gap-1 text-danger">
                      <XCircle className="size-3.5" aria-hidden /> Out
                    </dt>
                    <dd className="mt-0.5 text-lg font-semibold text-foreground tabular-nums">{inv.out.length}</dd>
                  </div>
                </dl>
              </>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Low-stock alerts</CardTitle>
            <CardDescription>Items at or below their minimum stock</CardDescription>
            <CardAction>
              <Link href="/inventory" className={buttonVariants({ variant: "ghost", size: "sm" })}>
                Inventory <ArrowRight />
              </Link>
            </CardAction>
          </CardHeader>
          <CardContent>
            {invLoading ? (
              <LoadingRows rows={3} />
            ) : inv.alerts.length === 0 ? (
              <p className="flex items-center justify-center gap-2 py-6 text-sm text-success">
                <CheckCircle2 className="size-4" aria-hidden /> All items are above their minimum stock.
              </p>
            ) : (
              <ul className="divide-y">
                {inv.alerts.map((i) => (
                  <li key={i.id} className="flex items-center justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{i.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatQty(i.current_stock)} {i.unit} left · min {formatQty(i.minimum_stock)}
                      </p>
                    </div>
                    <StockBadge status={stockStatus(i)} />
                  </li>
                ))}
              </ul>
            )}
            {inv.low.length + inv.out.length > inv.alerts.length && (
              <p className="mt-2 text-xs text-muted-foreground">+{inv.low.length + inv.out.length - inv.alerts.length} more</p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Recent sales</CardTitle>
            <CardAction>
              <Link href="/sales" className={buttonVariants({ variant: "ghost", size: "sm" })}>
                All sales <ArrowRight />
              </Link>
            </CardAction>
          </CardHeader>
          <CardContent>
            {recent.loading && !recent.data ? (
              <LoadingRows rows={4} />
            ) : !recent.data?.sales.length ? (
              <div className="py-6 text-center">
                <p className="mb-2 text-sm text-muted-foreground">No sales recorded yet.</p>
                <Button size="sm" onClick={() => setDialog("sale")}>
                  <Plus /> Record your first sale
                </Button>
              </div>
            ) : (
              <ul className="divide-y">
                {recent.data.sales.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {(s.sale_items ?? []).map((i) => `${i.product_name} ×${formatQty(i.quantity)}`).join(", ") || s.transaction_number}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {s.transaction_number} · {formatDateTime(s.sold_at)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold tabular-nums">{formatPeso(s.total_amount)}</p>
                      <Badge variant="outline" className="text-[10px]">
                        {s.payment_method}
                      </Badge>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent expenses</CardTitle>
            <CardAction>
              <Link href="/expenses" className={buttonVariants({ variant: "ghost", size: "sm" })}>
                All expenses <ArrowRight />
              </Link>
            </CardAction>
          </CardHeader>
          <CardContent>
            {recent.loading && !recent.data ? (
              <LoadingRows rows={4} />
            ) : !recent.data?.expenses.length ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No expenses recorded yet.</p>
            ) : (
              <ul className="divide-y">
                {recent.data.expenses.map((e) => (
                  <li key={e.id} className="flex items-center justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{e.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {e.categories?.name ?? "Uncategorized"} · {formatDate(e.expense_date)}
                      </p>
                    </div>
                    <p className={cn("font-semibold tabular-nums")}>{formatPeso(e.amount)}</p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <SaleDialog open={dialog === "sale"} onOpenChange={(o) => setDialog(o ? "sale" : null)} onSaved={refreshAll} />
      <ExpenseDialog open={dialog === "expense"} onOpenChange={(o) => setDialog(o ? "expense" : null)} onSaved={refreshAll} />
      <StockDialog open={dialog === "restock"} onOpenChange={(o) => setDialog(o ? "restock" : null)} onSaved={refreshAll} />
      <ProductDialog open={dialog === "product"} onOpenChange={(o) => setDialog(o ? "product" : null)} />
    </>
  );
}
