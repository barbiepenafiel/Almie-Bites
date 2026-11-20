"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, PackageCheck, PackageX, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, ErrorState, LoadingRows, PageHeader, StatCard } from "@/components/app/common";
import { useQuery } from "@/hooks/use-query";
import { formatPeso, formatQty } from "@/lib/format";
import { addDays, formatDate, todayManila } from "@/lib/dates";

interface Row {
  product_id: string;
  name: string;
  selling_price: number;
  assigned_qty: number | null;
  sold_qty: number;
  unsold_qty: number | null;
  unsold_value: number;
}

export default function StaffUnsoldPage() {
  const today = todayManila();
  const yesterday = addDays(today, -1);
  const [date, setDate] = useState(yesterday);

  const { data, error, loading, reload } = useQuery(
    async (sb) => {
      const { data, error } = await sb.rpc("staff_unsold", { p_date: date });
      if (error) throw error;
      return ((data ?? []) as Row[]).map((r) => ({
        ...r,
        assigned_qty: r.assigned_qty === null ? null : Number(r.assigned_qty),
        sold_qty: Number(r.sold_qty),
        unsold_qty: r.unsold_qty === null ? null : Number(r.unsold_qty),
        unsold_value: Number(r.unsold_value),
      }));
    },
    [date],
    { refetchOnFocus: true },
  );
  const busy = loading && !data;
  const all = data ?? [];
  // Unsold = pieces left from a set quantity, or a product with no sales at all.
  const unsold = all.filter((r) => (r.unsold_qty !== null ? r.unsold_qty > 0 : r.sold_qty === 0));
  const pieces = unsold.reduce((a, r) => a + (r.unsold_qty ?? 0), 0);
  const value = unsold.reduce((a, r) => a + r.unsold_value, 0);
  const sold = all.reduce((a, r) => a + r.sold_qty, 0);
  const label = date === yesterday ? "Yesterday" : formatDate(date, { weekday: "long", month: "short", day: "numeric" });

  return (
    <>
      <PageHeader
        title="Unsold Products"
        description={`What was left unsold ${date === yesterday ? "yesterday" : "on this day"} — ${formatDate(date, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}.`}
      />

      <div className="mb-4 flex items-center gap-2">
        <Button variant="outline" size="icon" aria-label="Previous day" onClick={() => setDate(addDays(date, -1))} disabled={date <= addDays(today, -60)}>
          <ChevronLeft />
        </Button>
        <span className="min-w-36 text-center text-sm font-medium">{label}</span>
        <Button variant="outline" size="icon" aria-label="Next day" onClick={() => setDate(addDays(date, 1))} disabled={date >= yesterday}>
          <ChevronRight />
        </Button>
        {date !== yesterday && (
          <Button variant="ghost" size="sm" onClick={() => setDate(yesterday)}>
            Back to yesterday
          </Button>
        )}
      </div>

      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Pieces unsold" value={formatQty(pieces)} icon={PackageX} tone={pieces > 0 ? "warning" : "default"} loading={busy} />
        <StatCard label="Value unsold" value={formatPeso(value)} icon={Wallet} loading={busy} hint="Unsold pieces × price" />
        <StatCard label="Pieces sold" value={formatQty(sold)} icon={PackageCheck} tone="brand" loading={busy} />
      </div>

      <Card className="gap-0 py-0">
        {error ? (
          <div className="p-4">
            <ErrorState message={error} onRetry={reload} />
          </div>
        ) : busy ? (
          <LoadingRows rows={4} />
        ) : !all.length ? (
          <EmptyState icon={PackageX} title="No products that day" description="You had no products assigned on this day." />
        ) : !unsold.length ? (
          <EmptyState icon={PackageCheck} title="Everything was sold" description="Nothing was left unsold on this day. Great job!" />
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
              {unsold.map((r) => (
                <TableRow key={r.product_id}>
                  <TableCell className="pl-4">
                    <div className="font-medium">{r.name}</div>
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
            {pieces > 0 && (
              <TableFooter>
                <TableRow>
                  <TableCell className="pl-4">Total unsold</TableCell>
                  <TableCell />
                  <TableCell />
                  <TableCell className="text-right tabular-nums">{formatQty(pieces)}</TableCell>
                  <TableCell className="pr-4 text-right tabular-nums">{formatPeso(value)}</TableCell>
                </TableRow>
              </TableFooter>
            )}
          </Table>
        )}
      </Card>
    </>
  );
}
