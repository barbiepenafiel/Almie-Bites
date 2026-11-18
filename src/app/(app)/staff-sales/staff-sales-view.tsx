"use client";

import { useMemo, useState } from "react";
import { Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardAction } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, ErrorState, LoadingRows, PageHeader, SimpleSelect } from "@/components/app/common";
import { DateRangeFilter } from "@/components/app/date-range-filter";
import { useQuery } from "@/hooks/use-query";
import { cn } from "@/lib/utils";
import { formatPeso, formatQty, money } from "@/lib/format";
import { describeRange, formatDate, rangeForPreset, startOfMonth, startOfWeek, type DateRange } from "@/lib/dates";
import { fetchStaffDaily, fetchStaffProductReport, fetchStaffReport, type Grouping } from "@/lib/report-utils";

export function StaffSalesView({ initialStaff }: { initialStaff: string }) {
  const [range, setRange] = useState<DateRange>(rangeForPreset("today"));
  const [staffId, setStaffId] = useState(initialStaff);
  const [grouping, setGrouping] = useState<Grouping>("day");

  const { data, error, loading, reload } = useQuery(
    async (sb) => {
      const [report, daily, products] = await Promise.all([
        fetchStaffReport(sb, range.start, range.end),
        fetchStaffDaily(sb, range.start, range.end),
        fetchStaffProductReport(sb, range.start, range.end, staffId === "all" ? null : staffId),
      ]);
      return { report, daily, products };
    },
    [range.start, range.end, staffId],
    { realtime: ["sales", "staff_payments", "staff"] },
  );

  const report = useMemo(() => (data?.report ?? []).filter((r) => staffId === "all" || r.staff_id === staffId), [data, staffId]);
  const names = useMemo(() => new Map((data?.report ?? []).map((r) => [r.staff_id, r.full_name])), [data]);
  const totals = report.reduce(
    (a, r) => ({ items: a.items + Number(r.items_sold), sales: a.sales + Number(r.sales_total), earnings: a.earnings + Number(r.earnings), unpaid: a.unpaid + Number(r.unpaid), tx: a.tx + r.transactions }),
    { items: 0, sales: 0, earnings: 0, unpaid: 0, tx: 0 },
  );

  // Period rows: one per (period, staff)
  const periods = useMemo(() => {
    const map = new Map<string, { label: string; key: string; byStaff: Map<string, { sales: number; items: number; earnings: number; tx: number }> }>();
    for (const d of data?.daily ?? []) {
      if (staffId !== "all" && d.staff_id !== staffId) continue;
      const key = grouping === "day" ? d.day : grouping === "week" ? startOfWeek(d.day) : startOfMonth(d.day);
      const label =
        grouping === "day"
          ? formatDate(d.day, { weekday: "short", month: "short", day: "numeric" })
          : grouping === "week"
            ? `Week of ${formatDate(key, { month: "short", day: "numeric" })}`
            : formatDate(key, { month: "long", year: "numeric" });
      const p = map.get(key) ?? { label, key, byStaff: new Map() };
      const s = p.byStaff.get(d.staff_id) ?? { sales: 0, items: 0, earnings: 0, tx: 0 };
      s.sales += Number(d.sales_total);
      s.items += Number(d.items_sold);
      s.earnings += Number(d.earnings);
      s.tx += Number(d.transactions);
      p.byStaff.set(d.staff_id, s);
      map.set(key, p);
    }
    return [...map.values()].sort((a, b) => b.key.localeCompare(a.key));
  }, [data, grouping, staffId]);

  const staffOptions = [{ value: "all", label: "All staff" }, ...(data?.report ?? []).map((r) => ({ value: r.staff_id, label: r.full_name }))];
  const busy = loading && !data;
  const maxSales = Math.max(...report.map((r) => Number(r.sales_total)), 1);

  return (
    <>
      <PageHeader title="Staff Sales" description={`Staff performance · ${describeRange(range)}`} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <DateRangeFilter value={range} onChange={setRange} />
        <SimpleSelect aria-label="Staff" className="w-44" value={staffId} onChange={setStaffId} options={staffOptions} />
      </div>

      {error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : busy ? (
        <Card>
          <LoadingRows rows={6} />
        </Card>
      ) : !data?.report.length ? (
        <Card>
          <EmptyState icon={Users} title="No staff yet" description="Add staff in Staff Management to track their sales." />
        </Card>
      ) : (
        <div className="grid gap-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {report.map((r) => (
              <Card key={r.staff_id} size="sm">
                <CardHeader>
                  <CardTitle className="text-base">{r.full_name}</CardTitle>
                  <CardDescription>{r.transactions} transaction{r.transactions === 1 ? "" : "s"}</CardDescription>
                  <CardAction>{!r.is_active && <Badge variant="destructive">Inactive</Badge>}</CardAction>
                </CardHeader>
                <CardContent className="grid gap-3">
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                    <dt className="text-muted-foreground">Total sales</dt>
                    <dd className="text-right font-semibold tabular-nums">{formatPeso(r.sales_total)}</dd>
                    <dt className="text-muted-foreground">Products sold</dt>
                    <dd className="text-right tabular-nums">{formatQty(r.items_sold)}</dd>
                    <dt className="text-muted-foreground">Est. earnings</dt>
                    <dd className="text-right tabular-nums">{formatPeso(r.earnings)}</dd>
                    <dt className="text-muted-foreground">Unpaid (all time)</dt>
                    <dd className={cn("text-right tabular-nums", Number(r.unpaid) > 0 && "font-semibold text-warning")}>{formatPeso(r.unpaid)}</dd>
                  </dl>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                    <div className="h-full rounded-full bg-foreground" style={{ width: `${(Number(r.sales_total) / maxSales) * 100}%` }} />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card className="gap-0 py-0">
            <CardHeader className="border-b py-4">
              <CardTitle>Staff comparison</CardTitle>
            </CardHeader>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Staff</TableHead>
                  <TableHead className="text-right">Transactions</TableHead>
                  <TableHead className="text-right">Products sold</TableHead>
                  <TableHead className="text-right">Total sales</TableHead>
                  <TableHead className="text-right">Earnings</TableHead>
                  <TableHead className="pr-4">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.map((r) => (
                  <TableRow key={r.staff_id}>
                    <TableCell className="pl-4 font-medium">{r.full_name}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.transactions}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatQty(r.items_sold)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatPeso(r.sales_total)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatPeso(r.earnings)}</TableCell>
                    <TableCell className="pr-4">
                      {Number(r.unpaid) > 0 ? (
                        <Badge className="border-warning/20 bg-warning-soft text-warning">Unpaid {formatPeso(r.unpaid)}</Badge>
                      ) : (
                        <Badge className="border-success/20 bg-success-soft text-success">Paid up</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell className="pl-4">Total</TableCell>
                  <TableCell className="text-right tabular-nums">{totals.tx}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatQty(totals.items)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatPeso(money(totals.sales))}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatPeso(money(totals.earnings))}</TableCell>
                  <TableCell className="pr-4 text-xs text-muted-foreground">Unpaid {formatPeso(money(totals.unpaid))}</TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card className="gap-0 py-0">
              <CardHeader className="border-b py-4">
                <CardTitle>Sales over time</CardTitle>
                <CardAction>
                  <Tabs value={grouping} onValueChange={(v) => setGrouping(v as Grouping)}>
                    <TabsList>
                      <TabsTrigger value="day">Daily</TabsTrigger>
                      <TabsTrigger value="week">Weekly</TabsTrigger>
                      <TabsTrigger value="month">Monthly</TabsTrigger>
                    </TabsList>
                  </Tabs>
                </CardAction>
              </CardHeader>
              {periods.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">No staff sales in this period.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-4">Period</TableHead>
                      <TableHead>Staff</TableHead>
                      <TableHead className="text-right">Sold</TableHead>
                      <TableHead className="text-right">Sales</TableHead>
                      <TableHead className="pr-4 text-right">Earnings</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {periods.flatMap((p) =>
                      [...p.byStaff.entries()].map(([sid, s], i) => (
                        <TableRow key={p.key + sid}>
                          <TableCell className="pl-4 text-xs whitespace-nowrap">{i === 0 ? p.label : ""}</TableCell>
                          <TableCell>{names.get(sid) ?? "—"}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatQty(s.items)}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatPeso(s.sales)}</TableCell>
                          <TableCell className="pr-4 text-right tabular-nums">{formatPeso(s.earnings)}</TableCell>
                        </TableRow>
                      )),
                    )}
                  </TableBody>
                </Table>
              )}
            </Card>

            <Card className="gap-0 py-0">
              <CardHeader className="border-b py-4">
                <CardTitle>Product breakdown</CardTitle>
                <CardDescription>
                  {staffId === "all" ? "All staff" : names.get(staffId)} · staff on daily pay earn per day, so their product earnings show ₱0
                </CardDescription>
              </CardHeader>
              {!data.products.length ? (
                <p className="py-8 text-center text-sm text-muted-foreground">No staff sales in this period.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-4">Product</TableHead>
                      {staffId === "all" && <TableHead>Staff</TableHead>}
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">Sales</TableHead>
                      <TableHead className="pr-4 text-right">Earnings</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.products.map((p) => (
                      <TableRow key={p.staff_id + p.product_name}>
                        <TableCell className="pl-4">{p.product_name}</TableCell>
                        {staffId === "all" && <TableCell className="text-muted-foreground">{names.get(p.staff_id)}</TableCell>}
                        <TableCell className="text-right tabular-nums">{formatQty(p.quantity)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatPeso(p.sales_total)}</TableCell>
                        <TableCell className="pr-4 text-right tabular-nums">{formatPeso(p.earnings)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
