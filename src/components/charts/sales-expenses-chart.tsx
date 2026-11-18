"use client";

import { useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Table2, BarChart3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatPeso, formatPesoCompact } from "@/lib/format";
import type { PeriodRow } from "@/lib/report-utils";

interface Props {
  data: PeriodRow[];
  /** Hide the expenses series (single-series sales chart). */
  salesOnly?: boolean;
  height?: number;
}

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { dataKey: string; value: number; payload: PeriodRow }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className="min-w-40 rounded-lg border bg-popover px-3 py-2 text-xs shadow-md">
      <p className="mb-1.5 font-medium text-foreground">{label}</p>
      {payload.map((p) => (
        <div key={p.dataKey} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <span
              className="size-2.5 rounded-sm"
              style={{ background: p.dataKey === "sales" ? "var(--chart-sales)" : "var(--chart-expenses)" }}
            />
            {p.dataKey === "sales" ? "Sales" : "Expenses"}
          </span>
          <span className="font-medium tabular-nums text-foreground">{formatPeso(p.value)}</span>
        </div>
      ))}
      {payload.length > 1 && (
        <div className="mt-1.5 flex justify-between gap-4 border-t pt-1.5">
          <span className="text-muted-foreground">Est. profit</span>
          <span className="font-medium tabular-nums text-foreground">{formatPeso(row.profit)}</span>
        </div>
      )}
      <p className="mt-1 text-muted-foreground">{row.transactions} transactions</p>
    </div>
  );
}

export function SalesExpensesChart({ data, salesOnly, height = 260 }: Props) {
  const [view, setView] = useState<"chart" | "table">("chart");
  const empty = data.every((d) => d.sales === 0 && (salesOnly || d.expenses === 0));

  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-4 text-xs text-muted-foreground" aria-hidden={view === "table"}>
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm bg-[var(--chart-sales)]" /> Sales
          </span>
          {!salesOnly && (
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm bg-[var(--chart-expenses)]" /> Expenses
            </span>
          )}
        </div>
        <Button
          variant="ghost"
          size="xs"
          onClick={() => setView((v) => (v === "chart" ? "table" : "chart"))}
          aria-label={view === "chart" ? "Show as table" : "Show as chart"}
        >
          {view === "chart" ? <Table2 /> : <BarChart3 />}
          {view === "chart" ? "Table" : "Chart"}
        </Button>
      </div>

      {view === "table" ? (
        <div className="max-h-[300px] overflow-y-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-3">Period</TableHead>
                <TableHead className="text-right">Sales</TableHead>
                {!salesOnly && <TableHead className="text-right">Expenses</TableHead>}
                {!salesOnly && <TableHead className="pr-3 text-right">Est. profit</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((d) => (
                <TableRow key={d.key}>
                  <TableCell className="pl-3">{d.label}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatPeso(d.sales)}</TableCell>
                  {!salesOnly && <TableCell className="text-right tabular-nums">{formatPeso(d.expenses)}</TableCell>}
                  {!salesOnly && <TableCell className="pr-3 text-right tabular-nums">{formatPeso(d.profit)}</TableCell>}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <div className="relative" style={{ height }}>
          {empty && (
            <p className="absolute inset-0 z-10 flex items-center justify-center text-sm text-muted-foreground">
              No sales or expenses in this period yet.
            </p>
          )}
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }} barGap={2} barCategoryGap="22%">
              <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                interval="preserveStartEnd"
                minTickGap={12}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                width={52}
                tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                tickFormatter={(v: number) => formatPesoCompact(v)}
              />
              <Tooltip cursor={{ fill: "var(--muted)", opacity: 0.6 }} content={<ChartTooltip />} />
              <Bar dataKey="sales" name="Sales" fill="var(--chart-sales)" radius={[4, 4, 0, 0]} maxBarSize={28} />
              {!salesOnly && (
                <Bar dataKey="expenses" name="Expenses" fill="var(--chart-expenses)" radius={[4, 4, 0, 0]} maxBarSize={28} />
              )}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
