"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, Hourglass, Lock, LockOpen, MoreHorizontal, Pencil, Plus, Target, Trash2, TrendingUp, Wallet } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConfirmDialog, EmptyState, ErrorState, LoadingRows, PageHeader, SimpleSelect, StatCard } from "@/components/app/common";
import { ABOVE_TARGET_NOTE, RecoveryDialog, RecoveryTable, type RecoveryDraft } from "@/components/recovery/recovery";
import { useQuery } from "@/hooks/use-query";
import { createClient } from "@/lib/supabase/client";
import { errorMessage, formatPeso, money } from "@/lib/format";
import { todayManila } from "@/lib/dates";
import { fetchRecovery } from "@/lib/report-utils";
import type { RecoveryRow } from "@/lib/types";

export function RecoveryView() {
  const [filter, setFilter] = useState("open");
  const [draft, setDraft] = useState<RecoveryDraft | null>(null);
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState<RecoveryRow | null>(null);

  const { data, error, loading, reload } = useQuery((sb) => fetchRecovery(sb), [], { realtime: ["recovery_targets", "sales"] });
  const rows = useMemo(() => (data ?? []).filter((r) => filter === "all" || r.is_open), [data, filter]);
  const t = rows.reduce(
    (a, r) => ({
      target: a.target + Number(r.target_amount),
      recovered: a.recovered + Number(r.recovered),
      remaining: a.remaining + Number(r.remaining),
      above: a.above + Number(r.above_target),
    }),
    { target: 0, recovered: 0, remaining: 0, above: 0 },
  );
  const busy = loading && !data;

  async function setClosed(r: RecoveryRow, close: boolean) {
    const today = todayManila();
    const end = close ? (r.start_date > today ? r.start_date : today) : null;
    const { error: err } = await createClient().from("recovery_targets").update({ end_date: end }).eq("id", r.target_id);
    if (err) return toast.error(errorMessage(err));
    toast.success(close ? `${r.product_name} target closed — later sales no longer count toward it` : `${r.product_name} target reopened`);
    reload();
  }

  async function remove(r: RecoveryRow) {
    const { error: err } = await createClient().from("recovery_targets").delete().eq("id", r.target_id);
    if (err) {
      toast.error(errorMessage(err));
      throw err;
    }
    toast.success("Recovery target deleted (sales and expenses are unchanged)");
    reload();
  }

  return (
    <>
      <PageHeader
        title="Expense Recovery"
        description="How much of what you spent on each product its sales have earned back."
        actions={
          <Button
            onClick={() => {
              setDraft(null);
              setOpen(true);
            }}
          >
            <Plus /> Add target
          </Button>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Expense to recover" value={formatPeso(money(t.target))} icon={Wallet} tone="brand" loading={busy} />
        <StatCard label="Recovered" value={formatPeso(money(t.recovered))} icon={CheckCircle2} loading={busy} />
        <StatCard label="Still to recover" value={formatPeso(money(t.remaining))} icon={Hourglass} tone={t.remaining > 0 ? "warning" : "default"} loading={busy} />
        <StatCard label="Sales above targets" value={formatPeso(money(t.above))} icon={TrendingUp} loading={busy} hint="Revenue, not profit" />
      </div>

      <Card className="gap-0 py-0">
        <div className="flex items-center justify-between gap-2 border-b p-3">
          <SimpleSelect
            aria-label="Show"
            className="w-48"
            value={filter}
            onChange={setFilter}
            options={[
              { value: "open", label: "Open targets" },
              { value: "all", label: "All targets (incl. closed)" },
            ]}
          />
        </div>
        {error ? (
          <div className="p-4">
            <ErrorState message={error} onRetry={reload} />
          </div>
        ) : busy ? (
          <LoadingRows rows={5} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Target}
            title="No recovery targets"
            description="Example: you spent ₱200 on Nestea Juice supplies — add a ₱200 target and watch juice sales earn it back."
            action={
              <Button onClick={() => setOpen(true)}>
                <Plus /> Add target
              </Button>
            }
          />
        ) : (
          <RecoveryTable
            rows={rows}
            actions={(r) => (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${r.product_name}`}>
                      <MoreHorizontal />
                    </Button>
                  }
                />
                <DropdownMenuContent align="end" className="w-44">
                  <DropdownMenuItem
                    onClick={() => {
                      setDraft({
                        target_id: r.target_id,
                        product_id: r.product_id,
                        scope: r.scope,
                        expense_id: r.expense_id,
                        assigned_expense: Number(r.assigned_expense),
                        target_amount: Number(r.target_amount),
                        start_date: r.start_date,
                        notes: r.notes,
                      });
                      setOpen(true);
                    }}
                  >
                    <Pencil /> Edit
                  </DropdownMenuItem>
                  {r.scope !== "day" &&
                    (r.is_open ? (
                      <DropdownMenuItem onClick={() => setClosed(r, true)}>
                        <Lock /> Close today
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem onClick={() => setClosed(r, false)}>
                        <LockOpen /> Reopen
                      </DropdownMenuItem>
                    ))}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onClick={() => setDeleting(r)}>
                    <Trash2 /> Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          />
        )}
      </Card>
      <p className="mt-3 text-xs text-muted-foreground">{ABOVE_TARGET_NOTE}</p>

      <RecoveryDialog open={open} onOpenChange={setOpen} draft={draft} onSaved={reload} />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete the ${deleting?.product_name ?? ""} recovery target?`}
        description="Only the target is removed. Sales, expenses and staff earnings already recorded stay as they are."
        onConfirm={() => (deleting ? remove(deleting) : undefined)}
      />
    </>
  );
}
