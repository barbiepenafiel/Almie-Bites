"use client";

import { BadgeCheck, Hourglass, ReceiptText, Wallet } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, ErrorState, LoadingRows, PageHeader, StatCard } from "@/components/app/common";
import { useQuery } from "@/hooks/use-query";
import { formatPeso } from "@/lib/format";
import { formatDate, todayManila } from "@/lib/dates";
import { fetchStaffSummary } from "@/lib/staff-utils";

interface Row {
  id: string;
  amount: number;
  payment_method: string;
  payment_date: string;
  period_start: string | null;
  period_end: string | null;
  notes: string | null;
}

export default function StaffPaymentsPage() {
  const today = todayManila();
  const { data, error, loading, reload } = useQuery(
    async (sb) => {
      const [hist, summary] = await Promise.all([sb.rpc("staff_payment_history"), fetchStaffSummary(sb, today, today)]);
      if (hist.error) throw hist.error;
      return { rows: (hist.data ?? []) as Row[], summary };
    },
    [today],
    { refetchOnFocus: true },
  );
  const s = data?.summary;
  const busy = loading && !data;

  return (
    <>
      <PageHeader title="My Payment History" description="Payments the owner has recorded for you." />
      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Total earned" value={formatPeso(s?.earned_total)} icon={Wallet} loading={busy} />
        <StatCard label="Total paid" value={formatPeso(s?.paid_total)} icon={BadgeCheck} tone="brand" loading={busy} />
        <StatCard label="Unpaid balance" value={formatPeso(s?.unpaid)} icon={Hourglass} tone={(s?.unpaid ?? 0) > 0 ? "warning" : "default"} loading={busy} />
      </div>
      <Card className="gap-0 py-0">
        {error ? (
          <div className="p-4">
            <ErrorState message={error} onRetry={reload} />
          </div>
        ) : busy ? (
          <LoadingRows rows={4} />
        ) : !data?.rows.length ? (
          <EmptyState icon={ReceiptText} title="No payments yet" description="When the owner pays you, it will show here." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Date</TableHead>
                <TableHead>Covers</TableHead>
                <TableHead className="hidden sm:table-cell">Method</TableHead>
                <TableHead className="pr-4 text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.rows.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="pl-4 whitespace-nowrap">{formatDate(p.payment_date)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {p.period_start && p.period_end
                      ? `${formatDate(p.period_start, { month: "short", day: "numeric" })} – ${formatDate(p.period_end)}`
                      : "—"}
                    {p.notes && <div className="text-foreground">{p.notes}</div>}
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">{p.payment_method}</TableCell>
                  <TableCell className="pr-4 text-right font-semibold tabular-nums">{formatPeso(p.amount)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </>
  );
}
