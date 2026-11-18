"use client";

import { useState } from "react";
import { History, Package, PiggyBank, Receipt, TrendingUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingRows, PageHeader, StatCard } from "@/components/app/common";
import { DateRangeFilter } from "@/components/app/date-range-filter";
import { useQuery } from "@/hooks/use-query";
import { useStaffData } from "@/components/staff/staff-data";
import { cn } from "@/lib/utils";
import { formatPeso, formatQty } from "@/lib/format";
import { describeRange, formatDateTime, rangeForPreset, type DateRange } from "@/lib/dates";
import { fetchStaffSales, fetchStaffSummary } from "@/lib/staff-utils";

export default function StaffSalesPage() {
  const { profile } = useStaffData();
  const tiered = profile?.earning_type === "daily_tier";
  const [range, setRange] = useState<DateRange>(rangeForPreset("today"));
  const { data, error, loading, reload } = useQuery(
    async (sb) => {
      const [summary, sales] = await Promise.all([fetchStaffSummary(sb, range.start, range.end), fetchStaffSales(sb, range.start, range.end, 300)]);
      return { summary, sales };
    },
    [range.start, range.end],
    { refetchOnFocus: true },
  );
  const s = data?.summary;
  const busy = loading && !data;

  return (
    <>
      <PageHeader title="My Sales" description={describeRange(range)} />
      <div className="mb-4">
        <DateRangeFilter value={range} onChange={setRange} presets={["today", "yesterday", "week", "month", "custom"]} />
      </div>
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Total sales" value={formatPeso(s?.sales_total)} icon={TrendingUp} tone="brand" loading={busy} />
        <StatCard label="Products sold" value={formatQty(s?.items_sold)} icon={Package} loading={busy} />
        <StatCard label="Transactions" value={s?.transactions ?? 0} icon={Receipt} loading={busy} />
        <StatCard label={tiered ? "Estimated pay" : "My earnings"} value={formatPeso(s?.earnings)} icon={PiggyBank} loading={busy} />
      </div>

      {error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : busy ? (
        <Card>
          <LoadingRows rows={6} />
        </Card>
      ) : !data?.sales.length ? (
        <Card>
          <EmptyState icon={History} title="No sales in this period" />
        </Card>
      ) : (
        <div className="grid gap-3">
          {data.sales.map((t) => {
            const voided = t.status === "voided";
            return (
              <Card key={t.id} size="sm" className={cn(voided && "opacity-70")}>
                <CardContent className="grid gap-2">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">{t.transaction_number}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatDateTime(t.sold_at)} · {t.payment_method}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className={cn("text-lg font-semibold tabular-nums", voided && "line-through")}>{formatPeso(t.total_amount)}</p>
                      {voided ? (
                        <Badge variant="destructive">Voided — not counted</Badge>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          {tiered ? "Counts toward daily pay" : `Earned ${formatPeso(t.total_staff_earnings)}`}
                        </p>
                      )}
                    </div>
                  </div>
                  <ul className="grid gap-0.5 border-t pt-2 text-sm">
                    {t.items.map((i, idx) => (
                      <li key={idx} className="flex justify-between gap-3">
                        <span>
                          {i.product_name} <span className="text-muted-foreground">× {formatQty(i.quantity)} @ {formatPeso(i.unit_price)}</span>
                        </span>
                        <span className="tabular-nums">{formatPeso(i.subtotal)}</span>
                      </li>
                    ))}
                  </ul>
                  {t.notes && <p className="text-xs text-muted-foreground">Note: {t.notes}</p>}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
