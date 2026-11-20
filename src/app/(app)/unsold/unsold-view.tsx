"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, PackageCheck, PackageX, Users, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, ErrorState, LoadingRows, PageHeader, StatCard } from "@/components/app/common";
import { useQuery } from "@/hooks/use-query";
import { formatPeso, formatQty } from "@/lib/format";
import { addDays, formatDate, todayManila } from "@/lib/dates";

interface Row {
  staff_id: string;
  staff_name: string;
  is_active: boolean;
  product_id: string;
  product_name: string;
  selling_price: number;
  assigned_qty: number | null;
  sold_qty: number;
  unsold_qty: number | null;
  unsold_value: number;
}

interface StaffGroup {
  id: string;
  name: string;
  unsold: Row[];
  products: number;
  pieces: number;
  value: number;
  sold: number;
}

export function UnsoldView() {
  const today = todayManila();
  const yesterday = addDays(today, -1);
  const [date, setDate] = useState(yesterday);

  const { data, error, loading, reload } = useQuery(
    async (sb) => {
      const { data, error } = await sb.rpc("report_unsold", { p_date: date });
      if (error) throw error;
      return ((data ?? []) as Row[]).map((r) => ({
        ...r,
        selling_price: Number(r.selling_price),
        assigned_qty: r.assigned_qty === null ? null : Number(r.assigned_qty),
        sold_qty: Number(r.sold_qty),
        unsold_qty: r.unsold_qty === null ? null : Number(r.unsold_qty),
        unsold_value: Number(r.unsold_value),
      }));
    },
    [date],
    { realtime: ["sales"], refetchOnFocus: true },
  );
  const busy = loading && !data;

  const groups = useMemo(() => {
    const map = new Map<string, StaffGroup>();
    for (const r of data ?? []) {
      let g = map.get(r.staff_id);
      if (!g) {
        g = { id: r.staff_id, name: r.staff_name, unsold: [], products: 0, pieces: 0, value: 0, sold: 0 };
        map.set(r.staff_id, g);
      }
      g.products += 1;
      g.sold += r.sold_qty;
      // Unsold = pieces left from a set quantity, or a product with no sales at all.
      if (r.unsold_qty !== null ? r.unsold_qty > 0 : r.sold_qty === 0) {
        g.unsold.push(r);
        g.pieces += r.unsold_qty ?? 0;
        g.value += r.unsold_value;
      }
    }
    return Array.from(map.values()).sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
  }, [data]);

  const totals = groups.reduce(
    (a, g) => ({ pieces: a.pieces + g.pieces, value: a.value + g.value, sold: a.sold + g.sold, withUnsold: a.withUnsold + (g.unsold.length ? 1 : 0) }),
    { pieces: 0, value: 0, sold: 0, withUnsold: 0 },
  );
  const dayLabel = date === today ? "Today" : date === yesterday ? "Yesterday" : formatDate(date, { weekday: "short", month: "short", day: "numeric" });

  return (
    <>
      <PageHeader
        title="Unsold Products"
        description={`What each staff member had left unsold — ${formatDate(date, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}.`}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button variant="outline" size="icon" aria-label="Previous day" onClick={() => setDate(addDays(date, -1))}>
          <ChevronLeft />
        </Button>
        <span className="min-w-28 text-center text-sm font-medium">{dayLabel}</span>
        <Button variant="outline" size="icon" aria-label="Next day" onClick={() => setDate(addDays(date, 1))} disabled={date >= today}>
          <ChevronRight />
        </Button>
        <Input type="date" className="w-auto" value={date} max={today} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Day" />
        {date !== yesterday && (
          <Button variant="ghost" size="sm" onClick={() => setDate(yesterday)}>
            Yesterday
          </Button>
        )}
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Pieces unsold" value={formatQty(totals.pieces)} icon={PackageX} tone={totals.pieces > 0 ? "warning" : "default"} loading={busy} />
        <StatCard label="Value unsold" value={formatPeso(totals.value)} icon={Wallet} loading={busy} hint="Unsold pieces × price" />
        <StatCard label="Pieces sold" value={formatQty(totals.sold)} icon={PackageCheck} tone="brand" loading={busy} />
        <StatCard label="Staff with unsold" value={`${totals.withUnsold}/${groups.length}`} icon={Users} loading={busy} />
      </div>

      {error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : busy ? (
        <Card>
          <LoadingRows rows={5} />
        </Card>
      ) : !groups.length ? (
        <Card>
          <EmptyState icon={PackageX} title="No staff products that day" description="No staff had products assigned on this day." />
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          {groups.map((g) => (
            <Card key={g.id} className="gap-0 py-0">
              <CardHeader className="border-b py-4">
                <CardTitle>{g.name}</CardTitle>
                <CardDescription>
                  {!g.unsold.length
                    ? `Everything sold · ${formatQty(g.sold)} pieces`
                    : g.pieces > 0
                      ? `${formatQty(g.pieces)} pieces unsold · ${formatPeso(g.value)} · sold ${formatQty(g.sold)}`
                      : `${g.unsold.length} ${g.unsold.length === 1 ? "product" : "products"} with no sales`}
                </CardDescription>
              </CardHeader>
              <CardContent className="px-0">
                {!g.unsold.length ? (
                  <p className="flex items-center justify-center gap-2 py-6 text-sm text-success">
                    <PackageCheck className="size-4" aria-hidden /> Nothing left unsold
                  </p>
                ) : (
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
                      {g.unsold.map((r) => (
                        <TableRow key={r.product_id}>
                          <TableCell className="pl-4">
                            <div className="font-medium">{r.product_name}</div>
                            <div className="text-xs text-muted-foreground">{formatPeso(r.selling_price)} each</div>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{r.assigned_qty !== null ? formatQty(r.assigned_qty) : "—"}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatQty(r.sold_qty)}</TableCell>
                          <TableCell className="text-right font-semibold tabular-nums text-warning">
                            {r.unsold_qty !== null ? formatQty(r.unsold_qty) : "No sales"}
                          </TableCell>
                          <TableCell className="pr-4 text-right tabular-nums">{r.unsold_qty !== null ? formatPeso(r.unsold_value) : "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                    {g.pieces > 0 && (
                      <TableFooter>
                        <TableRow>
                          <TableCell className="pl-4">Total</TableCell>
                          <TableCell />
                          <TableCell />
                          <TableCell className="text-right tabular-nums">{formatQty(g.pieces)}</TableCell>
                          <TableCell className="pr-4 text-right tabular-nums">{formatPeso(g.value)}</TableCell>
                        </TableRow>
                      </TableFooter>
                    )}
                  </Table>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
