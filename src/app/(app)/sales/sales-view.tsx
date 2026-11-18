"use client";

import { Fragment, useMemo, useState } from "react";
import {
  Ban,
  ChevronDown,
  ChevronRight,
  Hash,
  MoreHorizontal,
  Package,
  Pencil,
  Plus,
  Receipt,
  Search,
  ShoppingCart,
  Trash2,
  TrendingUp,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConfirmDialog, EmptyState, ErrorState, Field, LoadingRows, PageHeader, SimpleSelect, StatCard } from "@/components/app/common";
import { DateRangeFilter } from "@/components/app/date-range-filter";
import { SaleDialog } from "@/components/sales/sale-dialog";
import { useAppData } from "@/components/app/app-data";
import { unwrap, useQuery } from "@/hooks/use-query";
import { createClient } from "@/lib/supabase/client";
import { errorMessage, formatPeso, formatQty } from "@/lib/format";
import {
  describeRange,
  formatDateTime,
  manilaEndExclusiveISO,
  manilaStartISO,
  rangeForPreset,
  type DateRange,
} from "@/lib/dates";
import { fetchDaily, fetchPayments, fetchProducts, groupRows, totalsOf, type Grouping } from "@/lib/report-utils";
import type { Product, Sale } from "@/lib/types";

const PAGE = 30;

export function SalesView() {
  const { paymentMethods } = useAppData();
  const [range, setRange] = useState<DateRange>(rangeForPreset("today"));
  const [productId, setProductId] = useState("all");
  const [payment, setPayment] = useState("all");
  const [status, setStatus] = useState("completed");
  const [soldBy, setSoldBy] = useState("all");
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [breakdown, setBreakdown] = useState<"product" | "payment" | Grouping>("product");

  const [saleOpen, setSaleOpen] = useState(false);
  const [editing, setEditing] = useState<Sale | null>(null);
  const [voiding, setVoiding] = useState<Sale | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [deleting, setDeleting] = useState<Sale | null>(null);

  const { data: staffList } = useQuery(async (sb) => {
    const { data } = await sb.from("staff").select("id, full_name").order("full_name");
    return (data ?? []) as { id: string; full_name: string }[];
  }, []);

  const { data: products } = useQuery(
    async (sb) => unwrap(await sb.from("products").select("id, name").order("name")) as Pick<Product, "id" | "name">[],
    [],
  );

  const term = search.trim().replace(/[,()%*]/g, " ").trim();
  const list = useQuery(
    async (sb) => {
      const base = staffList?.length ? "*, sale_items(*), staff(id, full_name)" : "*, sale_items(*)";
      const select = productId === "all" ? base : `${base}, match:sale_items!inner(product_id)`;
      let q = sb
        .from("sales")
        .select(select, { count: "exact" })
        .gte("sold_at", manilaStartISO(range.start))
        .lt("sold_at", manilaEndExclusiveISO(range.end))
        .order("sold_at", { ascending: false })
        .range(0, limit - 1);
      if (productId !== "all") q = q.eq("match.product_id", productId);
      if (payment !== "all") q = q.eq("payment_method", payment);
      if (status !== "all") q = q.eq("status", status);
      if (soldBy === "owner") q = q.is("staff_id", null);
      else if (soldBy !== "all") q = q.eq("staff_id", soldBy);
      if (term) q = q.or(`transaction_number.ilike.*${term}*,notes.ilike.*${term}*`);
      const res = await q;
      return { rows: unwrap(res) as unknown as Sale[], count: res.count ?? 0 };
    },
    [range.start, range.end, productId, payment, status, soldBy, term, limit, staffList?.length ?? 0],
    { realtime: ["sales"] },
  );

  const summary = useQuery(
    async (sb) => {
      const [daily, prods, pays] = await Promise.all([
        fetchDaily(sb, range.start, range.end),
        fetchProducts(sb, range.start, range.end),
        fetchPayments(sb, range.start, range.end),
      ]);
      return { daily, prods, pays };
    },
    [range.start, range.end],
    { realtime: ["sales"] },
  );
  const totals = useMemo(() => totalsOf(summary.data?.daily ?? []), [summary.data]);

  function reloadAll() {
    list.reload();
    summary.reload();
  }

  async function doVoid(s: Sale) {
    const { error } = await createClient().rpc("void_sale", { p_sale_id: s.id, p_reason: voidReason || null });
    if (error) {
      toast.error(errorMessage(error));
      throw error;
    }
    toast.success(`${s.transaction_number} voided — stock returned`);
    reloadAll();
  }
  async function doDelete(s: Sale) {
    const { error } = await createClient().rpc("delete_sale", { p_sale_id: s.id });
    if (error) {
      toast.error(errorMessage(error));
      throw error;
    }
    toast.success(`${s.transaction_number} deleted`);
    reloadAll();
  }

  const rows = list.data?.rows ?? [];
  const sumLoading = summary.loading && !summary.data;

  return (
    <>
      <PageHeader
        title="Sales"
        description={`Showing ${describeRange(range)}`}
        actions={
          <Button
            onClick={() => {
              setEditing(null);
              setSaleOpen(true);
            }}
          >
            <Plus /> Record sale
          </Button>
        }
      />

      <div className="mb-4">
        <DateRangeFilter value={range} onChange={(r) => (setRange(r), setLimit(PAGE))} />
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Total sales" value={formatPeso(totals.sales)} icon={TrendingUp} tone="brand" loading={sumLoading} />
        <StatCard label="Transactions" value={totals.transactions} icon={Receipt} loading={sumLoading} hint={totals.voided ? `${totals.voided} voided (not counted)` : undefined} />
        <StatCard label="Products sold" value={formatQty(totals.items)} icon={Package} loading={sumLoading} />
        <StatCard label="Average sale" value={formatPeso(totals.averageSale)} icon={Hash} loading={sumLoading} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_22rem]">
        <Card className="min-w-0 gap-0 py-0">
          <div className="flex flex-col gap-2 border-b p-3 md:flex-row md:items-center">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="Search transaction # or notes…" aria-label="Search sales" className="pl-8" value={search} onChange={(e) => (setSearch(e.target.value), setLimit(PAGE))} />
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 md:flex">
              {!!staffList?.length && (
                <SimpleSelect
                  aria-label="Sold by"
                  className="md:w-36"
                  value={soldBy}
                  onChange={(v) => (setSoldBy(v), setLimit(PAGE))}
                  options={[{ value: "all", label: "Anyone" }, { value: "owner", label: "Owner" }, ...staffList.map((x) => ({ value: x.id, label: x.full_name }))]}
                />
              )}
              <SimpleSelect
                aria-label="Product"
                className="md:w-40"
                value={productId}
                onChange={(v) => (setProductId(v), setLimit(PAGE))}
                options={[{ value: "all", label: "All products" }, ...(products ?? []).map((p) => ({ value: p.id, label: p.name }))]}
              />
              <SimpleSelect
                aria-label="Payment"
                className="md:w-32"
                value={payment}
                onChange={(v) => (setPayment(v), setLimit(PAGE))}
                options={[{ value: "all", label: "All payments" }, ...paymentMethods.map((p) => ({ value: p, label: p }))]}
              />
              <SimpleSelect
                aria-label="Status"
                className="md:w-32"
                value={status}
                onChange={(v) => (setStatus(v), setLimit(PAGE))}
                options={[
                  { value: "completed", label: "Completed" },
                  { value: "voided", label: "Voided" },
                  { value: "all", label: "All status" },
                ]}
              />
            </div>
          </div>

          {list.error ? (
            <div className="p-4">
              <ErrorState message={list.error} onRetry={list.reload} />
            </div>
          ) : list.loading && !list.data ? (
            <LoadingRows rows={8} />
          ) : rows.length === 0 ? (
            <EmptyState
              icon={ShoppingCart}
              title="No sales found"
              description="Sales you record will appear here."
              action={
                <Button onClick={() => setSaleOpen(true)}>
                  <Plus /> Record sale
                </Button>
              }
            />
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8 pl-3" />
                    <TableHead>Transaction</TableHead>
                    <TableHead className="hidden sm:table-cell">Date &amp; time</TableHead>
                    <TableHead className="hidden md:table-cell">Items</TableHead>
                    <TableHead>Payment</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="w-10 pr-3" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((s) => {
                    const isOpen = expanded.has(s.id);
                    const voided = s.status === "voided";
                    const qty = (s.sale_items ?? []).reduce((a, i) => a + Number(i.quantity), 0);
                    return (
                      <Fragment key={s.id}>
                        <TableRow className={voided ? "text-muted-foreground" : ""}>
                          <TableCell className="pl-3">
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              aria-label={isOpen ? "Hide items" : "Show items"}
                              aria-expanded={isOpen}
                              onClick={() =>
                                setExpanded((set) => {
                                  const n = new Set(set);
                                  if (n.has(s.id)) n.delete(s.id);
                                  else n.add(s.id);
                                  return n;
                                })
                              }
                            >
                              {isOpen ? <ChevronDown /> : <ChevronRight />}
                            </Button>
                          </TableCell>
                          <TableCell>
                            <div className="font-medium">{s.transaction_number}</div>
                            <div className="text-xs text-muted-foreground sm:hidden">{formatDateTime(s.sold_at)}</div>
                            {s.staff && <div className="text-xs text-muted-foreground">by {s.staff.full_name}</div>}
                            {voided && <Badge variant="destructive" className="mt-0.5">Voided</Badge>}
                          </TableCell>
                          <TableCell className="hidden text-xs whitespace-nowrap sm:table-cell">{formatDateTime(s.sold_at)}</TableCell>
                          <TableCell className="hidden max-w-56 truncate text-xs md:table-cell">
                            {(s.sale_items ?? []).map((i) => `${i.product_name} ×${formatQty(i.quantity)}`).join(", ")}
                            <span className="text-muted-foreground"> ({formatQty(qty)})</span>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">{s.payment_method}</Badge>
                          </TableCell>
                          <TableCell className={`text-right font-semibold tabular-nums ${voided ? "line-through" : ""}`}>{formatPeso(s.total_amount)}</TableCell>
                          <TableCell className="pr-3">
                            <DropdownMenu>
                              <DropdownMenuTrigger
                                render={
                                  <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${s.transaction_number}`}>
                                    <MoreHorizontal />
                                  </Button>
                                }
                              />
                              <DropdownMenuContent align="end" className="w-44">
                                <DropdownMenuItem
                                  disabled={voided}
                                  onClick={() => {
                                    setEditing(s);
                                    setSaleOpen(true);
                                  }}
                                >
                                  <Pencil /> Edit
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  disabled={voided}
                                  onClick={() => {
                                    setVoidReason("");
                                    setVoiding(s);
                                  }}
                                >
                                  <Ban /> Void
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem variant="destructive" onClick={() => setDeleting(s)}>
                                  <Trash2 /> Delete
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        </TableRow>
                        {isOpen && (
                          <TableRow className="bg-muted/30 hover:bg-muted/30">
                            <TableCell />
                            <TableCell colSpan={6} className="py-3 pr-4">
                              <div className="grid gap-1 text-sm">
                                {(s.sale_items ?? []).map((i) => (
                                  <div key={i.id} className="flex justify-between gap-4">
                                    <span>
                                      {i.product_name} <span className="text-muted-foreground">× {formatQty(i.quantity)} @ {formatPeso(i.unit_price)}</span>
                                    </span>
                                    <span className="tabular-nums">{formatPeso(i.subtotal)}</span>
                                  </div>
                                ))}
                                {s.notes && <p className="text-xs text-muted-foreground">Note: {s.notes}</p>}
                                {voided && s.void_reason && <p className="text-xs text-danger">Void reason: {s.void_reason}</p>}
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
              <div className="flex items-center justify-between border-t px-4 py-3 text-xs text-muted-foreground">
                <span>
                  Showing {rows.length} of {list.data?.count ?? rows.length}
                </span>
                {(list.data?.count ?? 0) > rows.length && (
                  <Button size="sm" variant="outline" onClick={() => setLimit((l) => l + PAGE)}>
                    Load more
                  </Button>
                )}
              </div>
            </>
          )}
        </Card>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Breakdown</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            <Tabs value={breakdown} onValueChange={(v) => setBreakdown(v as typeof breakdown)}>
              <TabsList className="w-full">
                <TabsTrigger value="product">Product</TabsTrigger>
                <TabsTrigger value="payment">Payment</TabsTrigger>
                <TabsTrigger value="day">Day</TabsTrigger>
                <TabsTrigger value="week">Week</TabsTrigger>
                <TabsTrigger value="month">Month</TabsTrigger>
              </TabsList>
            </Tabs>
            {sumLoading ? (
              <LoadingRows rows={4} />
            ) : summary.error ? (
              <ErrorState message={summary.error} onRetry={summary.reload} />
            ) : breakdown === "product" ? (
              <BreakdownList
                rows={(summary.data?.prods ?? []).map((p) => ({ label: p.product_name, sub: `${formatQty(p.quantity)} sold`, value: Number(p.revenue) }))}
                total={totals.sales}
              />
            ) : breakdown === "payment" ? (
              <BreakdownList
                rows={(summary.data?.pays ?? []).map((p) => ({ label: p.payment_method, sub: `${p.transactions} transactions`, value: Number(p.total) }))}
                total={totals.sales}
              />
            ) : (
              <BreakdownList
                rows={groupRows(summary.data?.daily ?? [], breakdown)
                  .reverse()
                  .map((p) => ({ label: p.label, sub: `${p.transactions} transactions · ${formatQty(p.items)} items`, value: p.sales }))}
                total={totals.sales}
                showZero
              />
            )}
          </CardContent>
        </Card>
      </div>

      <SaleDialog open={saleOpen} onOpenChange={setSaleOpen} sale={editing} onSaved={reloadAll} />
      <ConfirmDialog
        open={!!voiding}
        onOpenChange={(o) => !o && setVoiding(null)}
        title={`Void ${voiding?.transaction_number ?? "sale"}?`}
        description="The sale stays in history marked as voided, is excluded from totals and staff earnings, and any stock it deducted is returned to stock."
        confirmLabel="Void sale"
        onConfirm={() => (voiding ? doVoid(voiding) : undefined)}
      >
        <Field label="Reason (optional)" htmlFor="void-reason">
          <Input id="void-reason" value={voidReason} onChange={(e) => setVoidReason(e.target.value)} placeholder="e.g. Wrong order" />
        </Field>
      </ConfirmDialog>
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete ${deleting?.transaction_number ?? "sale"} permanently?`}
        description="This removes the sale completely (and any stock it deducted is returned). Use Void instead if you want to keep a record."
        onConfirm={() => (deleting ? doDelete(deleting) : undefined)}
      />
    </>
  );
}

function BreakdownList({
  rows,
  total,
  showZero,
}: {
  rows: { label: string; sub?: string; value: number }[];
  total: number;
  showZero?: boolean;
}) {
  const shown = showZero ? rows : rows.filter((r) => r.value > 0);
  if (!shown.length) return <p className="py-6 text-center text-sm text-muted-foreground">No sales in this period.</p>;
  const max = Math.max(...shown.map((r) => r.value), 1);
  return (
    <ul className="grid max-h-[28rem] gap-3 overflow-y-auto pr-1">
      {shown.map((r) => (
        <li key={r.label}>
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span className="truncate font-medium">{r.label}</span>
            <span className="shrink-0 tabular-nums">{formatPeso(r.value)}</span>
          </div>
          <div className="mt-1 flex items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-[var(--chart-sales)]" style={{ width: `${(r.value / max) * 100}%` }} />
            </div>
            <span className="w-10 text-right text-[11px] text-muted-foreground tabular-nums">
              {total > 0 ? Math.round((r.value / total) * 100) : 0}%
            </span>
          </div>
          {r.sub && <p className="text-[11px] text-muted-foreground">{r.sub}</p>}
        </li>
      ))}
    </ul>
  );
}
