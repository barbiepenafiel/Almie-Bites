"use client";

import { useMemo, useState } from "react";
import { Boxes, FileText, MoreHorizontal, Pencil, Plus, ReceiptText, Search, Target, Trash2, Truck, Wallet } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConfirmDialog, EmptyState, ErrorState, LoadingRows, PageHeader, SimpleSelect, StatCard } from "@/components/app/common";
import { DateRangeFilter } from "@/components/app/date-range-filter";
import { ExpenseDialog } from "@/components/expenses/expense-dialog";
import { RecoveryDialog, type RecoveryDraft } from "@/components/recovery/recovery";
import { useAppData } from "@/components/app/app-data";
import { unwrap, useQuery } from "@/hooks/use-query";
import { createClient } from "@/lib/supabase/client";
import { errorMessage, formatPeso, formatQty } from "@/lib/format";
import { describeRange, formatDate, rangeForPreset, type DateRange } from "@/lib/dates";
import { fetchDaily, fetchExpenseCategories, groupRows, totalsOf, type Grouping } from "@/lib/report-utils";
import type { Expense } from "@/lib/types";

const PAGE = 30;

export function ExpensesView() {
  const { categoriesOf } = useAppData();
  const cats = categoriesOf("expense");
  const [range, setRange] = useState<DateRange>(rangeForPreset("today"));
  const [categoryId, setCategoryId] = useState("all");
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [grouping, setGrouping] = useState<Grouping | "category">("category");

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [deleting, setDeleting] = useState<Expense | null>(null);
  const [reverseStock, setReverseStock] = useState(true);
  const [recoveryFor, setRecoveryFor] = useState<RecoveryDraft | null>(null);

  const term = search.trim().replace(/[,()%*]/g, " ").trim();
  const list = useQuery(
    async (sb) => {
      let q = sb
        .from("expenses")
        .select("*, categories(id, name, is_inventory_purchase), inventory_items(id, name, unit)", { count: "exact" })
        .gte("expense_date", range.start)
        .lte("expense_date", range.end)
        .order("expense_date", { ascending: false })
        .order("created_at", { ascending: false })
        .range(0, limit - 1);
      if (categoryId === "none") q = q.is("category_id", null);
      else if (categoryId !== "all") q = q.eq("category_id", categoryId);
      if (term) q = q.or(`name.ilike.*${term}*,notes.ilike.*${term}*`);
      const res = await q;
      return { rows: unwrap(res) as Expense[], count: res.count ?? 0 };
    },
    [range.start, range.end, categoryId, term, limit],
    { realtime: ["expenses"] },
  );

  const summary = useQuery(
    async (sb) => {
      const [daily, byCat] = await Promise.all([fetchDaily(sb, range.start, range.end), fetchExpenseCategories(sb, range.start, range.end)]);
      return { daily, byCat };
    },
    [range.start, range.end],
    { realtime: ["expenses"] },
  );
  const totals = useMemo(() => totalsOf(summary.data?.daily ?? []), [summary.data]);
  const sumLoading = summary.loading && !summary.data;

  function reloadAll() {
    list.reload();
    summary.reload();
  }

  async function viewReceipt(path: string) {
    const { data, error } = await createClient().storage.from("receipts").createSignedUrl(path, 300);
    if (error || !data) return toast.error(errorMessage(error, "Couldn't open the receipt."));
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  async function remove(e: Expense) {
    const { error } = await createClient().rpc("delete_expense", { p_expense_id: e.id, p_reverse_stock: reverseStock });
    if (error) {
      toast.error(errorMessage(error));
      throw error;
    }
    if (e.receipt_path) void createClient().storage.from("receipts").remove([e.receipt_path]);
    toast.success("Expense deleted");
    reloadAll();
  }

  const rows = list.data?.rows ?? [];
  const breakdownRows =
    grouping === "category"
      ? (summary.data?.byCat ?? []).map((c) => ({ label: c.category_name, sub: `${c.entries} entr${c.entries === 1 ? "y" : "ies"}`, value: Number(c.total) }))
      : groupRows(summary.data?.daily ?? [], grouping)
          .reverse()
          .map((p) => ({ label: p.label, sub: undefined, value: p.expenses }));
  const max = Math.max(...breakdownRows.map((r) => r.value), 1);

  return (
    <>
      <PageHeader
        title="Expenses"
        description={`Showing ${describeRange(range)}`}
        actions={
          <Button
            onClick={() => {
              setEditing(null);
              setOpen(true);
            }}
          >
            <Plus /> Add expense
          </Button>
        }
      />
      <div className="mb-4">
        <DateRangeFilter value={range} onChange={(r) => (setRange(r), setLimit(PAGE))} />
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Total expenses" value={formatPeso(totals.expenses)} icon={Wallet} tone="negative" loading={sumLoading} />
        <StatCard label="Inventory purchases" value={formatPeso(totals.inventoryPurchases)} icon={Boxes} tone="brand" loading={sumLoading} hint="Ingredients & packaging" />
        <StatCard label="Other expenses" value={formatPeso(totals.otherExpenses)} icon={Truck} loading={sumLoading} hint="Transport, utilities, etc." />
        <StatCard label="Entries" value={list.data?.count ?? "—"} icon={ReceiptText} loading={list.loading && !list.data} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_22rem]">
        <Card className="min-w-0 gap-0 py-0">
          <div className="flex flex-col gap-2 border-b p-3 md:flex-row md:items-center">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="Search expenses…" aria-label="Search expenses" className="pl-8" value={search} onChange={(e) => (setSearch(e.target.value), setLimit(PAGE))} />
            </div>
            <SimpleSelect
              aria-label="Category"
              className="md:w-52"
              value={categoryId}
              onChange={(v) => (setCategoryId(v), setLimit(PAGE))}
              options={[{ value: "all", label: "All categories" }, ...cats.map((c) => ({ value: c.id, label: c.name })), { value: "none", label: "Uncategorized" }]}
            />
          </div>
          {list.error ? (
            <div className="p-4">
              <ErrorState message={list.error} onRetry={list.reload} />
            </div>
          ) : list.loading && !list.data ? (
            <LoadingRows rows={8} />
          ) : rows.length === 0 ? (
            <EmptyState
              icon={ReceiptText}
              title="No expenses found"
              description="Record purchases and other costs to see your true profit."
              action={
                <Button onClick={() => setOpen(true)}>
                  <Plus /> Add expense
                </Button>
              }
            />
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-4">Expense</TableHead>
                    <TableHead className="hidden sm:table-cell">Date</TableHead>
                    <TableHead className="hidden md:table-cell">Category</TableHead>
                    <TableHead className="hidden lg:table-cell">Payment</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="w-10 pr-4" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell className="pl-4">
                        <div className="font-medium">{e.name}</div>
                        <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                          <span className="sm:hidden">{formatDate(e.expense_date)}</span>
                          {e.quantity != null && (
                            <span>
                              Qty {formatQty(e.quantity)}
                              {e.unit_price != null && ` @ ${formatPeso(e.unit_price)}`}
                            </span>
                          )}
                          {Number(e.stock_added) > 0 && e.inventory_items && (
                            <span className="text-success">
                              +{formatQty(e.stock_added)} {e.inventory_items.unit} {e.inventory_items.name}
                            </span>
                          )}
                          {e.notes && <span className="max-w-48 truncate">{e.notes}</span>}
                        </div>
                      </TableCell>
                      <TableCell className="hidden text-xs whitespace-nowrap sm:table-cell">{formatDate(e.expense_date)}</TableCell>
                      <TableCell className="hidden md:table-cell">
                        <Badge variant="outline">{e.categories?.name ?? "Uncategorized"}</Badge>
                      </TableCell>
                      <TableCell className="hidden text-xs lg:table-cell">{e.payment_method}</TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">{formatPeso(e.amount)}</TableCell>
                      <TableCell className="pr-4">
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={
                              <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${e.name}`}>
                                <MoreHorizontal />
                              </Button>
                            }
                          />
                          <DropdownMenuContent align="end" className="w-44">
                            {e.receipt_path && (
                              <DropdownMenuItem onClick={() => viewReceipt(e.receipt_path!)}>
                                <FileText /> View receipt
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem
                              onClick={() => {
                                setEditing(e);
                                setOpen(true);
                              }}
                            >
                              <Pencil /> Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() =>
                                setRecoveryFor({ expense_id: e.id, scope: "purchase", assigned_expense: Number(e.amount), start_date: e.expense_date })
                              }
                            >
                              <Target /> Set recovery target
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              variant="destructive"
                              onClick={() => {
                                setReverseStock(true);
                                setDeleting(e);
                              }}
                            >
                              <Trash2 /> Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
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
            <CardTitle>Expense breakdown</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            <SimpleSelect
              aria-label="Group by"
              value={grouping}
              onChange={(v) => setGrouping(v as typeof grouping)}
              options={[
                { value: "category", label: "By category" },
                { value: "day", label: "By day" },
                { value: "week", label: "By week" },
                { value: "month", label: "By month" },
              ]}
            />
            {sumLoading ? (
              <LoadingRows rows={4} />
            ) : summary.error ? (
              <ErrorState message={summary.error} onRetry={summary.reload} />
            ) : breakdownRows.length === 0 || totals.expenses === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No expenses in this period.</p>
            ) : (
              <ul className="grid max-h-[28rem] gap-3 overflow-y-auto pr-1">
                {breakdownRows.map((r) => (
                  <li key={r.label}>
                    <div className="flex items-baseline justify-between gap-2 text-sm">
                      <span className="truncate font-medium">{r.label}</span>
                      <span className="tabular-nums">{formatPeso(r.value)}</span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-[var(--chart-expenses)]" style={{ width: `${(r.value / max) * 100}%` }} />
                    </div>
                    {r.sub && <p className="text-[11px] text-muted-foreground">{r.sub}</p>}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <RecoveryDialog open={!!recoveryFor} onOpenChange={(o) => !o && setRecoveryFor(null)} draft={recoveryFor} />
      <ExpenseDialog open={open} onOpenChange={setOpen} expense={editing} onSaved={reloadAll} />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete expense "${deleting?.name ?? ""}"?`}
        description="This permanently removes the expense from your records and totals."
        onConfirm={() => (deleting ? remove(deleting) : undefined)}
      >
        {deleting && Number(deleting.stock_added) > 0 && (
          <label className="flex items-start gap-2 rounded-md bg-muted p-3 text-sm">
            <Checkbox checked={reverseStock} onCheckedChange={(c) => setReverseStock(!!c)} className="mt-0.5" />
            <span>
              Also remove the {formatQty(deleting.stock_added)} {deleting.inventory_items?.unit} added to{" "}
              {deleting.inventory_items?.name ?? "inventory"}
            </span>
          </label>
        )}
      </ConfirmDialog>
    </>
  );
}
