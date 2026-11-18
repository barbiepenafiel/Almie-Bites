"use client";

import { useState } from "react";
import { History } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, ErrorState, LoadingRows, SimpleSelect } from "@/components/app/common";
import { DateRangeFilter } from "@/components/app/date-range-filter";
import { unwrap, useQuery } from "@/hooks/use-query";
import { cn } from "@/lib/utils";
import { formatQty } from "@/lib/format";
import { formatDateTime, manilaEndExclusiveISO, manilaStartISO, rangeForPreset, type DateRange } from "@/lib/dates";
import { MOVEMENT_LABELS, type InventoryItem, type InventoryMovement, type MovementType } from "@/lib/types";

const PAGE = 50;

export function MovementHistory({
  items,
  itemId,
  onItemChange,
}: {
  items: InventoryItem[];
  itemId: string;
  onItemChange: (id: string) => void;
}) {
  const [type, setType] = useState("all");
  const [range, setRange] = useState<DateRange>(rangeForPreset("last30"));
  const [limit, setLimit] = useState(PAGE);

  const { data, error, loading, reload } = useQuery(
    async (sb) => {
      let q = sb
        .from("inventory_movements")
        .select(
          "*, inventory_items(id, name, unit), sales(id, transaction_number), expenses(id, name)",
          { count: "exact" },
        )
        .gte("created_at", manilaStartISO(range.start))
        .lt("created_at", manilaEndExclusiveISO(range.end))
        .order("created_at", { ascending: false })
        .range(0, limit - 1);
      if (itemId !== "all") q = q.eq("inventory_item_id", itemId);
      if (type !== "all") q = q.eq("movement_type", type);
      const res = await q;
      return { rows: unwrap(res) as InventoryMovement[], count: res.count ?? 0 };
    },
    [itemId, type, range.start, range.end, limit],
    { realtime: ["inventory_movements"] },
  );

  const rows = data?.rows ?? [];

  return (
    <Card className="gap-0 py-0">
      <div className="flex flex-col gap-2 border-b p-3 md:flex-row md:flex-wrap md:items-center">
        <SimpleSelect
          aria-label="Item"
          className="md:w-52"
          value={itemId}
          onChange={(v) => {
            onItemChange(v);
            setLimit(PAGE);
          }}
          options={[{ value: "all", label: "All items" }, ...items.map((i) => ({ value: i.id, label: i.name }))]}
        />
        <SimpleSelect
          aria-label="Movement type"
          className="md:w-48"
          value={type}
          onChange={(v) => {
            setType(v);
            setLimit(PAGE);
          }}
          options={[
            { value: "all", label: "All movement types" },
            ...(Object.keys(MOVEMENT_LABELS) as MovementType[]).map((t) => ({ value: t, label: MOVEMENT_LABELS[t] })),
          ]}
        />
        <DateRangeFilter value={range} onChange={(r) => (setRange(r), setLimit(PAGE))} />
      </div>
      {error ? (
        <div className="p-4">
          <ErrorState message={error} onRetry={reload} />
        </div>
      ) : loading && !data ? (
        <LoadingRows rows={8} />
      ) : rows.length === 0 ? (
        <EmptyState icon={History} title="No stock movements" description="Restocks, sales deductions and adjustments will show up here." />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Date &amp; time</TableHead>
                <TableHead>Item</TableHead>
                <TableHead>Movement</TableHead>
                <TableHead className="text-right">Change</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Before</TableHead>
                <TableHead className="text-right">After</TableHead>
                <TableHead className="hidden pr-4 md:table-cell">Reason / reference</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((m) => {
                const q = Number(m.quantity);
                const unit = m.inventory_items?.unit ?? "";
                return (
                  <TableRow key={m.id}>
                    <TableCell className="pl-4 text-xs whitespace-nowrap text-muted-foreground">{formatDateTime(m.created_at)}</TableCell>
                    <TableCell className="font-medium">{m.inventory_items?.name ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{MOVEMENT_LABELS[m.movement_type]}</Badge>
                    </TableCell>
                    <TableCell className={cn("text-right font-medium tabular-nums", q >= 0 ? "text-success" : "text-danger")}>
                      {q >= 0 ? "+" : "−"}
                      {formatQty(Math.abs(q))} <span className="text-xs font-normal text-muted-foreground">{unit}</span>
                    </TableCell>
                    <TableCell className="hidden text-right tabular-nums text-muted-foreground sm:table-cell">{formatQty(m.previous_stock)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatQty(m.new_stock)}</TableCell>
                    <TableCell className="hidden max-w-xs pr-4 text-xs text-muted-foreground md:table-cell">
                      <div className="truncate">{m.notes ?? "—"}</div>
                      {m.sales && <div className="text-foreground">Sale {m.sales.transaction_number}</div>}
                      {m.expenses && <div className="text-foreground">Expense: {m.expenses.name}</div>}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <div className="flex items-center justify-between border-t px-4 py-3 text-xs text-muted-foreground">
            <span>
              Showing {rows.length} of {data?.count ?? rows.length}
            </span>
            {(data?.count ?? 0) > rows.length && (
              <Button size="sm" variant="outline" onClick={() => setLimit((l) => l + PAGE)} disabled={loading}>
                Load more
              </Button>
            )}
          </div>
        </>
      )}
    </Card>
  );
}
