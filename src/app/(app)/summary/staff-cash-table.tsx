"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { errorMessage, formatPeso, formatQty, money } from "@/lib/format";
import type { StaffReportRow } from "@/lib/types";

export interface StaffCashRecord {
  staff_id: string;
  cash: number;
  juice_sale_id: string | null;
}
export interface JuiceSale {
  staff_id: string | null;
  total_amount: number;
}

export interface StaffSalesRow {
  key: string;
  staffId: string | null;
  name: string;
  transactions: number;
  items: number;
  /** what the sold items add up to (Juice income not included) */
  expected: number;
  cash: number | null;
  juice: number;
  short: number;
  /** cash was saved but sales changed since, so the Juice amount needs recalculating */
  stale: boolean;
}

/** Builds each person's row for the day. Juice income sales are kept apart from the expected amount. */
export function buildStaffSales(
  staff: StaffReportRow[],
  cash: StaffCashRecord[],
  juiceSales: JuiceSale[],
  totals: { transactions: number; items: number; sales: number },
): StaffSalesRow[] {
  const cashBy = new Map(cash.map((c) => [c.staff_id, Number(c.cash)]));
  const juiceBy = new Map<string, { amount: number; count: number }>();
  for (const j of juiceSales) {
    if (!j.staff_id) continue;
    const cur = juiceBy.get(j.staff_id) ?? { amount: 0, count: 0 };
    juiceBy.set(j.staff_id, { amount: cur.amount + Number(j.total_amount), count: cur.count + 1 });
  }
  const rows: StaffSalesRow[] = staff
    .filter((s) => s.is_active || Number(s.transactions) > 0 || cashBy.has(s.staff_id))
    .map((s) => {
      const j = juiceBy.get(s.staff_id) ?? { amount: 0, count: 0 };
      const expected = money(Number(s.sales_total) - j.amount);
      const c = cashBy.has(s.staff_id) ? cashBy.get(s.staff_id)! : null;
      const diff = c === null ? 0 : money(c - expected);
      const juice = c === null ? j.amount : Math.max(0, diff);
      return {
        key: s.staff_id,
        staffId: s.staff_id,
        name: s.full_name,
        transactions: Number(s.transactions) - j.count,
        items: Number(s.items_sold) - j.count,
        expected,
        cash: c,
        juice,
        short: c === null ? 0 : Math.max(0, -diff),
        stale: c !== null && Math.abs(money(j.amount) - money(Math.max(0, diff))) >= 0.01,
      };
    })
    .sort((a, b) => b.expected - a.expected || a.name.localeCompare(b.name));

  const sum = (f: (r: StaffSalesRow) => number) => rows.reduce((acc, r) => acc + f(r), 0);
  const juiceCount = juiceSales.length;
  const ownerTx = totals.transactions - juiceCount - sum((r) => r.transactions);
  if (ownerTx > 0) {
    rows.push({
      key: "owner",
      staffId: null,
      name: "Owner (you)",
      transactions: ownerTx,
      items: Math.max(0, Math.round((totals.items - juiceCount - sum((r) => r.items)) * 1000) / 1000),
      expected: Math.max(0, money(totals.sales - sum((r) => r.expected) - sum((r) => juiceByAmount(juiceBy, r.staffId)))),
      cash: null,
      juice: 0,
      short: 0,
      stale: false,
    });
  }
  return rows;
}

function juiceByAmount(map: Map<string, { amount: number }>, id: string | null) {
  return id ? (map.get(id)?.amount ?? 0) : 0;
}

export function StaffCashTable({
  date,
  rows,
  totalSales,
  onSaved,
}: {
  date: string;
  rows: StaffSalesRow[];
  totalSales: number;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);

  // Reset the boxes to the saved values when the day or saved data changes.
  const savedKey = rows.map((r) => `${r.key}:${r.cash ?? ""}`).join("|");
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraft(Object.fromEntries(rows.filter((r) => r.staffId).map((r) => [r.key, r.cash === null ? "" : String(r.cash)])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, savedKey]);

  async function save(row: StaffSalesRow, force = false) {
    if (!row.staffId) return;
    const raw = (draft[row.key] ?? "").trim();
    const value = raw === "" ? null : Number(raw);
    if (value !== null && (!Number.isFinite(value) || value < 0)) {
      toast.error("Enter the cash as a number (₱0 or more).");
      return;
    }
    if (!force && value === row.cash) return;
    setSaving(row.key);
    const { data, error } = await createClient().rpc("save_staff_cash", {
      p_staff_id: row.staffId,
      p_day: date,
      p_cash: value,
    });
    setSaving(null);
    if (error) {
      toast.error(errorMessage(error));
      return;
    }
    const r = data as { cleared?: boolean; juice?: number; short?: number } | null;
    if (r?.cleared) toast.success(`Cleared cash for ${row.name}`);
    else if (Number(r?.juice) > 0) toast.success(`${row.name}: Juice income ${formatPeso(Number(r?.juice))}`);
    else if (Number(r?.short) > 0) toast.warning(`${row.name} is short ${formatPeso(Number(r?.short))}`);
    else toast.success(`${row.name}: cash matches sales`);
    onSaved();
  }

  const totals = useMemo(() => {
    const staffRows = rows.filter((r) => r.staffId);
    return {
      transactions: rows.reduce((a, r) => a + r.transactions, 0),
      items: rows.reduce((a, r) => a + r.items, 0),
      expected: rows.reduce((a, r) => a + r.expected, 0),
      cash: staffRows.reduce((a, r) => a + (r.cash ?? 0), 0),
      juice: rows.reduce((a, r) => a + r.juice, 0),
      short: rows.reduce((a, r) => a + r.short, 0),
    };
  }, [rows]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sales by staff</CardTitle>
        <CardDescription>
          Type the cash each staff member gives you. Extra cash over their sales is counted as Juice income; less is shown as short.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Staff</TableHead>
                <TableHead className="text-right">Sold</TableHead>
                <TableHead className="text-right">Sales</TableHead>
                <TableHead className="text-right">Cash received</TableHead>
                <TableHead className="text-right">Juice income</TableHead>
                <TableHead className="pr-4 text-right">Short</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.key} className={cn(r.transactions === 0 && r.cash === null && "text-muted-foreground")}>
                  <TableCell className="pl-4">
                    <div>{r.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {r.transactions === 0 ? "no sales" : `${r.transactions} ${r.transactions === 1 ? "sale" : "sales"}`}
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatQty(r.items)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatPeso(r.expected)}</TableCell>
                  <TableCell className="text-right">
                    {r.staffId ? (
                      <div className="ml-auto flex w-36 items-center justify-end gap-1">
                        <span className="text-sm text-muted-foreground">₱</span>
                        <Input
                          aria-label={`Cash received from ${r.name}`}
                          type="number"
                          inputMode="decimal"
                          min={0}
                          step="0.01"
                          placeholder="—"
                          className="h-8 w-28 text-right tabular-nums"
                          value={draft[r.key] ?? ""}
                          disabled={saving === r.key}
                          onChange={(e) => setDraft((d) => ({ ...d, [r.key]: e.target.value }))}
                          onBlur={() => save(r)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              (e.target as HTMLInputElement).blur();
                            }
                          }}
                        />
                        {saving === r.key && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.juice > 0 ? <span className="font-medium text-success">+{formatPeso(r.juice)}</span> : <span className="text-muted-foreground">—</span>}
                    {r.stale && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="no-print ml-2 h-7"
                        onClick={() => save(r, true)}
                        disabled={saving === r.key}
                        title="Sales changed after the cash was entered"
                      >
                        <RefreshCw /> Update
                      </Button>
                    )}
                  </TableCell>
                  <TableCell className="pr-4 text-right tabular-nums">
                    {r.short > 0 ? <span className="font-medium text-danger">{formatPeso(r.short)}</span> : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell className="pl-4">Total</TableCell>
                <TableCell className="text-right tabular-nums">{formatQty(totals.items)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatPeso(totals.expected)}</TableCell>
                <TableCell className="text-right tabular-nums">{totals.cash > 0 ? formatPeso(totals.cash) : "—"}</TableCell>
                <TableCell className="text-right tabular-nums text-success">{totals.juice > 0 ? `+${formatPeso(totals.juice)}` : "—"}</TableCell>
                <TableCell className="pr-4 text-right tabular-nums text-danger">{totals.short > 0 ? formatPeso(totals.short) : "—"}</TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </div>
        <p className="mx-4 mt-3 text-xs text-muted-foreground">
          Total sales for the day, including Juice income: <span className="font-medium text-foreground">{formatPeso(totalSales)}</span>. Leave a cash box empty to remove it.
        </p>
      </CardContent>
    </Card>
  );
}
