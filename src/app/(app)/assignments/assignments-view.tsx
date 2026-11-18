"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, CircleAlert, ClipboardList, Copy, PackageCheck, Pencil, Users } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, ErrorState, LoadingRows, PageHeader, StatCard } from "@/components/app/common";
import { unwrap, useQuery } from "@/hooks/use-query";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { errorMessage, formatPeso, formatQty, money, toNumber } from "@/lib/format";
import { addDays, formatDate, todayManila } from "@/lib/dates";
import type { DailyAssignmentRow, Product } from "@/lib/types";

interface StaffLite {
  id: string;
  full_name: string;
  is_active: boolean;
}

export function AssignmentsView() {
  const today = todayManila();
  const [date, setDate] = useState(today);
  const [editing, setEditing] = useState<StaffLite | null>(null);

  const { data, error, loading, reload } = useQuery(
    async (sb) => {
      const [staff, rows, products] = await Promise.all([
        sb.from("staff").select("id, full_name, is_active").eq("is_active", true).order("full_name"),
        sb.rpc("report_daily_assignments", { p_date: date }),
        sb
          .from("products")
          .select("*, product_recipes(quantity_used, inventory_items(pieces_per_pack, pack_unit))")
          .order("name"),
      ]);
      if (rows.error) throw rows.error;
      return {
        staff: unwrap(staff) as StaffLite[],
        rows: ((rows.data ?? []) as DailyAssignmentRow[]).map((r) => ({
          ...r,
          assigned_qty: r.assigned_qty === null ? null : Number(r.assigned_qty),
          remaining_qty: r.remaining_qty === null ? null : Number(r.remaining_qty),
          inventory_left: r.inventory_left === null ? null : Number(r.inventory_left),
          sold_qty: Number(r.sold_qty),
          sales_total: Number(r.sales_total),
        })),
        products: unwrap(products) as Product[],
      };
    },
    [date],
    { realtime: ["sales", "daily_assignments", "staff_product_assignments", "inventory_items"] },
  );

  const byStaff = useMemo(() => {
    const m = new Map<string, DailyAssignmentRow[]>();
    for (const r of data?.rows ?? []) m.set(r.staff_id, [...(m.get(r.staff_id) ?? []), r]);
    return m;
  }, [data]);
  const totals = (data?.rows ?? []).reduce(
    (a, r) => ({ sold: a.sold + r.sold_qty, sales: a.sales + r.sales_total, zero: a.zero + (r.zero_sales && r.source !== "unassigned" ? 1 : 0), assigned: a.assigned + (r.source !== "unassigned" ? 1 : 0) }),
    { sold: 0, sales: 0, zero: 0, assigned: 0 },
  );
  const busy = loading && !data;

  return (
    <>
      <PageHeader
        title="Daily Assignments"
        description="Which products each staff member sells today, and how they're selling."
        actions={
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" aria-label="Previous day" onClick={() => setDate((d) => addDays(d, -1))}>
              <ChevronLeft />
            </Button>
            <Input type="date" aria-label="Date" className="w-40" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
            <Button variant="outline" size="icon" aria-label="Next day" onClick={() => setDate((d) => addDays(d, 1))}>
              <ChevronRight />
            </Button>
            {date !== today && (
              <Button variant="ghost" onClick={() => setDate(today)}>
                Today
              </Button>
            )}
          </div>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Products assigned" value={totals.assigned} icon={ClipboardList} tone="brand" loading={busy} hint={formatDate(date)} />
        <StatCard label="Pieces sold" value={formatQty(totals.sold)} icon={PackageCheck} loading={busy} />
        <StatCard label="Staff sales" value={formatPeso(money(totals.sales))} icon={Users} loading={busy} />
        <StatCard label="No sales yet" value={totals.zero} icon={CircleAlert} tone={totals.zero ? "warning" : "default"} loading={busy} hint="Assigned products with 0 sold" />
      </div>

      {error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : busy ? (
        <Card>
          <LoadingRows rows={6} />
        </Card>
      ) : !data?.staff.length ? (
        <Card>
          <EmptyState icon={Users} title="No active staff" description="Add staff in Staff Management first." />
        </Card>
      ) : (
        <div className="grid gap-6 xl:grid-cols-2">
          {data.staff.map((s) => {
            const rows = byStaff.get(s.id) ?? [];
            const isDaily = rows.some((r) => r.source === "daily");
            const sold = rows.reduce((a, r) => a + r.sold_qty, 0);
            const sales = rows.reduce((a, r) => a + r.sales_total, 0);
            return (
              <Card key={s.id} className="gap-0 py-0">
                <CardHeader className="border-b py-4">
                  <CardTitle>{s.full_name}</CardTitle>
                  <CardDescription>
                    {isDaily ? "Daily assignment" : rows.length ? "Regular products (no daily assignment for this day)" : "Nothing assigned"}
                  </CardDescription>
                  <CardAction>
                    <Button size="sm" variant="outline" onClick={() => setEditing(s)}>
                      <Pencil /> Assign
                    </Button>
                  </CardAction>
                </CardHeader>
                {rows.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">No products for this day.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="pl-4">Product</TableHead>
                        <TableHead className="text-right">Assigned</TableHead>
                        <TableHead className="text-right">Sold</TableHead>
                        <TableHead className="text-right">Left</TableHead>
                        <TableHead className="text-right">Sales</TableHead>
                        <TableHead className="hidden pr-4 text-right sm:table-cell">Inventory</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((r) => (
                        <TableRow key={r.product_id} className={cn(r.zero_sales && r.source !== "unassigned" && "bg-warning-soft/60 hover:bg-warning-soft")}>
                          <TableCell className="pl-4">
                            <div className="font-medium">{r.product_name}</div>
                            {r.zero_sales && r.source !== "unassigned" && (
                              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-warning">
                                <CircleAlert className="size-3" aria-hidden /> No sales
                              </span>
                            )}
                            {r.source === "unassigned" && <Badge variant="outline" className="text-[10px]">Not assigned</Badge>}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{r.assigned_qty !== null ? formatQty(r.assigned_qty) : "—"}</TableCell>
                          <TableCell className="text-right font-medium tabular-nums">{formatQty(r.sold_qty)}</TableCell>
                          <TableCell className={cn("text-right tabular-nums", r.remaining_qty !== null && r.remaining_qty <= 0 && "text-success")}>
                            {r.remaining_qty !== null ? formatQty(r.remaining_qty) : "—"}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{formatPeso(r.sales_total)}</TableCell>
                          <TableCell className={cn("hidden pr-4 text-right tabular-nums sm:table-cell", r.inventory_left !== null && r.inventory_left <= 0 && "text-danger")}>
                            {r.inventory_left !== null ? formatQty(r.inventory_left) : "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                    <TableFooter>
                      <TableRow>
                        <TableCell className="pl-4">Total</TableCell>
                        <TableCell />
                        <TableCell className="text-right tabular-nums">{formatQty(sold)}</TableCell>
                        <TableCell />
                        <TableCell className="text-right tabular-nums">{formatPeso(money(sales))}</TableCell>
                        <TableCell className="hidden sm:table-cell" />
                      </TableRow>
                    </TableFooter>
                  </Table>
                )}
              </Card>
            );
          })}
        </div>
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        Every staff sale deducts the linked inventory item immediately, once per transaction. “Inventory” shows how many more the stock can make.
      </p>

      <AssignDialog
        staff={editing}
        date={date}
        products={data?.products ?? []}
        current={editing ? (byStaff.get(editing.id) ?? []).filter((r) => r.source === "daily") : []}
        onOpenChange={(o) => !o && setEditing(null)}
        onSaved={reload}
      />
    </>
  );
}

function AssignDialog({
  staff,
  date,
  products,
  current,
  onOpenChange,
  onSaved,
}: {
  staff: StaffLite | null;
  date: string;
  products: Product[];
  current: DailyAssignmentRow[];
  onOpenChange: (o: boolean) => void;
  onSaved: () => void;
}) {
  // qty = loose pieces, packs = whole packs (only for products sold from a pack item)
  const [lines, setLines] = useState<Record<string, { on: boolean; qty: string; packs: string }>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!staff) return;
    const cur = new Map(current.map((r) => [r.product_id, r.assigned_qty]));
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setError(null);
    setLines(
      Object.fromEntries(
        products.map((p) => [p.id, { on: cur.has(p.id), qty: cur.get(p.id) != null ? String(cur.get(p.id)) : "", packs: "" }]),
      ),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staff, date]);

  /** Pieces sold per pack for a product (pack pieces ÷ pieces used per sale); null if not sold from a pack item. */
  function perPack(productId: string): { pcs: number; unit: string } | null {
    const p = products.find((x) => x.id === productId);
    const link = p?.product_recipes?.[0] as
      | { quantity_used: number; inventory_items?: { pieces_per_pack: number | null; pack_unit: string | null } | null }
      | undefined;
    const ppp = Number(link?.inventory_items?.pieces_per_pack ?? 0);
    const used = Number(link?.quantity_used ?? 1) || 1;
    return ppp > 0 ? { pcs: Math.round((ppp / used) * 1000) / 1000, unit: link?.inventory_items?.pack_unit ?? "pack" } : null;
  }
  function totalPieces(productId: string, l: { qty: string; packs: string }): number | null {
    const pk = perPack(productId);
    const packs = pk && l.packs !== "" ? toNumber(l.packs) : 0;
    if (l.qty === "" && (!pk || l.packs === "")) return null;
    return Math.round(((pk ? packs * pk.pcs : 0) + (l.qty === "" ? 0 : toNumber(l.qty))) * 1000) / 1000;
  }

  async function copyYesterday() {
    if (!staff) return;
    const { data, error: err } = await createClient()
      .from("daily_assignments")
      .select("product_id, quantity")
      .eq("staff_id", staff.id)
      .eq("assign_date", addDays(date, -1));
    if (err) return toast.error(errorMessage(err));
    if (!data?.length) return toast.info("No daily assignment on the previous day.");
    const prev = new Map((data as { product_id: string; quantity: number | null }[]).map((r) => [r.product_id, r.quantity]));
    setLines((ls) =>
      Object.fromEntries(Object.keys(ls).map((id) => [id, { on: prev.has(id), qty: prev.get(id) != null ? String(prev.get(id)) : "", packs: "" }])),
    );
    toast.success("Copied the previous day's assignment — review and save.");
  }

  async function save(clear = false) {
    if (!staff) return;
    const items = clear
      ? []
      : Object.entries(lines)
          .filter(([, l]) => l.on)
          .map(([product_id, l]) => ({ product_id, quantity: totalPieces(product_id, l) }));
    if (
      Object.values(lines).some((l) => l.on && ((l.packs !== "" && toNumber(l.packs) < 0) || (l.qty !== "" && toNumber(l.qty) < 0)))
    )
      return setError("Packs and pieces can't be negative.");
    if (items.some((i) => i.quantity !== null && !(i.quantity > 0))) return setError("Quantities must be more than 0, or blank for no limit.");
    setError(null);
    setBusy(true);
    const { error: err } = await createClient().rpc("save_daily_assignments", { p_staff_id: staff.id, p_date: date, p_items: items });
    setBusy(false);
    if (err) return setError(errorMessage(err));
    toast.success(clear ? `${staff.full_name} is back to regular products for ${formatDate(date)}` : `Saved ${staff.full_name}'s products for ${formatDate(date)}`);
    onOpenChange(false);
    onSaved();
  }

  const count = Object.values(lines).filter((l) => l.on).length;

  return (
    <Dialog open={!!staff} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            Assign products · {staff?.full_name} · {formatDate(date, { weekday: "short", month: "short", day: "numeric" })}
          </DialogTitle>
          <DialogDescription>
            Tick what they can sell this day. Add a quantity to cap how many they can sell (blank = no limit, inventory still applies).
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={copyYesterday}>
            <Copy /> Copy previous day
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setLines((ls) => Object.fromEntries(Object.entries(ls).map(([k, v]) => [k, { ...v, on: true }])))}>
            Select all
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setLines((ls) => Object.fromEntries(Object.entries(ls).map(([k, v]) => [k, { ...v, on: false }])))}>
            Clear
          </Button>
        </div>
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10 pl-3" />
                <TableHead>Product</TableHead>
                <TableHead className="w-56 pr-3">Quantity</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {products.map((p) => {
                const l = lines[p.id] ?? { on: false, qty: "", packs: "" };
                const total = totalPieces(p.id, l);
                const pk = perPack(p.id);
                return (
                  <TableRow key={p.id}>
                    <TableCell className="pl-3">
                      <Checkbox aria-label={`Assign ${p.name}`} checked={l.on} onCheckedChange={(c) => setLines((ls) => ({ ...ls, [p.id]: { ...l, on: !!c } }))} />
                    </TableCell>
                    <TableCell>
                      {p.name}
                      {!p.is_available && <span className="text-xs text-muted-foreground"> · unavailable</span>}
                    </TableCell>
                    <TableCell className="pr-3">
                      <div className="flex items-center gap-1">
                        {pk && (
                          <>
                            <Input
                              aria-label={`${p.name} packs`}
                              type="number"
                              inputMode="numeric"
                              min={0}
                              step="1"
                              placeholder="0"
                              className="h-7 w-14 min-w-0 px-1.5 text-center"
                              disabled={!l.on}
                              value={l.packs}
                              onChange={(e) => setLines((ls) => ({ ...ls, [p.id]: { ...l, packs: e.target.value } }))}
                            />
                            <span className="text-[11px] text-muted-foreground">pack +</span>
                          </>
                        )}
                        <Input
                          aria-label={`${p.name} pieces`}
                          type="number"
                          inputMode="decimal"
                          min={0}
                          step="any"
                          placeholder={pk ? "0" : "No limit"}
                          className={cn("h-7 min-w-0", pk && "w-14 px-1.5 text-center")}
                          disabled={!l.on}
                          value={l.qty}
                          onChange={(e) => setLines((ls) => ({ ...ls, [p.id]: { ...l, qty: e.target.value } }))}
                        />
                        {pk && <span className="text-[11px] text-muted-foreground">pcs</span>}
                      </div>
                      {pk && l.on && (
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          {total === null
                            ? `No limit · 1 ${pk.unit} = ${formatQty(pk.pcs)} pcs`
                            : `${l.packs !== "" && toNumber(l.packs) > 0 ? `${formatQty(l.packs)} × ${formatQty(pk.pcs)}${l.qty !== "" && toNumber(l.qty) > 0 ? ` + ${formatQty(l.qty)}` : ""} = ` : ""}${formatQty(total)} pcs`}
                        </p>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        {error && (
          <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">
            {error}
          </p>
        )}
        <DialogFooter className="sm:justify-between">
          <Button variant="ghost" onClick={() => save(true)} disabled={busy}>
            Use regular products
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={() => save(false)} disabled={busy || count === 0}>
              {busy ? "Saving…" : `Save ${count} product${count === 1 ? "" : "s"}`}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
