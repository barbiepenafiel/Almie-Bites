"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { KeyRound, LineChart, MoreHorizontal, Package, Pencil, Plus, Power, HandCoins, Users } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConfirmDialog, EmptyState, ErrorState, LoadingRows, PageHeader } from "@/components/app/common";
import { unwrap, useQuery } from "@/hooks/use-query";
import { cn } from "@/lib/utils";
import { formatPeso, formatQty } from "@/lib/format";
import { formatDate, toManilaDate, todayManila } from "@/lib/dates";
import { ALL_TIME_START, fetchStaffReport } from "@/lib/report-utils";
import { describeEarning } from "@/lib/staff-utils";
import type { Staff } from "@/lib/types";
import { setStaffActive } from "./actions";
import { RatesDialog, ResetPasswordDialog, StaffFormDialog } from "./staff-dialogs";

export function StaffManagementView() {
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Staff | null>(null);
  const [ratesFor, setRatesFor] = useState<Staff | null>(null);
  const [pwFor, setPwFor] = useState<Staff | null>(null);
  const [toggling, setToggling] = useState<Staff | null>(null);

  const { data, error, loading, reload } = useQuery(
    async (sb) => {
      const [staff, report] = await Promise.all([
        sb.from("staff").select("*, staff_product_assignments(product_id, earning_rate)").order("created_at"),
        fetchStaffReport(sb, ALL_TIME_START, todayManila()),
      ]);
      return { staff: unwrap(staff) as Staff[], report };
    },
    [],
    { realtime: ["staff", "sales", "staff_payments"] },
  );
  const stats = useMemo(() => new Map((data?.report ?? []).map((r) => [r.staff_id, r])), [data]);

  async function toggleActive(s: Staff) {
    const res = await setStaffActive(s.id, !s.is_active);
    if (!res.ok) {
      toast.error(res.error);
      throw new Error(res.error);
    }
    toast.success(`${s.full_name} ${s.is_active ? "deactivated — they can no longer sign in" : "activated"}`);
    reload();
  }

  return (
    <>
      <PageHeader
        title="Staff Management"
        description="Staff accounts, the products they sell and how they earn."
        actions={
          <Button
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            <Plus /> Add staff
          </Button>
        }
      />

      {error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : loading && !data ? (
        <Card>
          <LoadingRows rows={5} />
        </Card>
      ) : !data?.staff.length ? (
        <Card>
          <EmptyState
            icon={Users}
            title="No staff yet"
            description="Create a login for each staff member. They'll get their own dashboard to record sales and see their earnings."
            action={
              <Button onClick={() => setFormOpen(true)}>
                <Plus /> Add staff
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {data.staff.map((s) => {
            const r = stats.get(s.id);
            const assigned = s.staff_product_assignments?.length ?? 0;
            return (
              <Card key={s.id} className={cn(!s.is_active && "opacity-70")}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <span className="flex size-9 items-center justify-center rounded-full bg-foreground text-sm font-semibold text-background">
                      {s.full_name.charAt(0).toUpperCase()}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate">{s.full_name}</span>
                      <span className="block text-xs font-normal text-muted-foreground">
                        {s.staff_code ? `${s.staff_code} · ` : ""}
                        {s.email}
                      </span>
                    </span>
                  </CardTitle>
                  <CardAction className="flex items-center gap-1">
                    {s.is_active ? <Badge variant="outline">Active</Badge> : <Badge variant="destructive">Inactive</Badge>}
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${s.full_name}`}>
                            <MoreHorizontal />
                          </Button>
                        }
                      />
                      <DropdownMenuContent align="end" className="w-52">
                        <DropdownMenuItem onClick={() => setRatesFor(s)}>
                          <Package /> Products &amp; earnings
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => {
                            setEditing(s);
                            setFormOpen(true);
                          }}
                        >
                          <Pencil /> Edit details
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setPwFor(s)}>
                          <KeyRound /> Reset password
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant={s.is_active ? "destructive" : "default"} onClick={() => setToggling(s)}>
                          <Power /> {s.is_active ? "Deactivate" : "Activate"}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </CardAction>
                </CardHeader>
                <CardContent className="grid gap-3">
                  <dl className="grid grid-cols-3 gap-2 rounded-lg bg-muted/50 p-3 text-center">
                    <div>
                      <dt className="text-[11px] text-muted-foreground">Total sales</dt>
                      <dd className="font-semibold tabular-nums">{formatPeso(r?.sales_total)}</dd>
                    </div>
                    <div>
                      <dt className="text-[11px] text-muted-foreground">Products sold</dt>
                      <dd className="font-semibold tabular-nums">{formatQty(r?.items_sold)}</dd>
                    </div>
                    <div>
                      <dt className="text-[11px] text-muted-foreground">Total earned</dt>
                      <dd className="font-semibold tabular-nums">{formatPeso(r?.earned_total)}</dd>
                    </div>
                    <div>
                      <dt className="text-[11px] text-muted-foreground">Paid</dt>
                      <dd className="font-semibold tabular-nums">{formatPeso(r?.paid_total)}</dd>
                    </div>
                    <div className="col-span-2">
                      <dt className="text-[11px] text-muted-foreground">Unpaid earnings</dt>
                      <dd className={cn("font-semibold tabular-nums", (r?.unpaid ?? 0) > 0 && "text-warning")}>{formatPeso(r?.unpaid)}</dd>
                    </div>
                  </dl>
                  <div className="grid gap-1 text-sm">
                    <p>
                      <span className="text-muted-foreground">Earns: </span>
                      {describeEarning(s)}
                    </p>
                    <p>
                      <span className="text-muted-foreground">Assigned products: </span>
                      {assigned ? assigned : <span className="text-warning">none yet — they can&apos;t sell anything</span>}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Paid via {s.payout_method} · Added {formatDate(toManilaDate(s.created_at))}
                    </p>
                  </div>
                </CardContent>
                <CardFooter className="flex-wrap gap-2 border-t py-3">
                  <Button size="sm" variant="outline" onClick={() => setRatesFor(s)}>
                    <Package /> Products &amp; earnings
                  </Button>
                  <Link href={`/staff-sales?staff=${s.id}`} className={buttonVariants({ size: "sm", variant: "ghost" })}>
                    <LineChart /> Sales
                  </Link>
                  <Link href={`/staff-payroll?staff=${s.id}`} className={buttonVariants({ size: "sm", variant: "ghost" })}>
                    <HandCoins /> Pay
                  </Link>
                </CardFooter>
              </Card>
            );
          })}
        </div>
      )}

      <CardDescription className="mt-6 text-xs">
        Staff sign in on the same login page and only see their own dashboard, sales and earnings. Deactivated staff are blocked from signing in;
        their sales history is kept.
      </CardDescription>

      <StaffFormDialog open={formOpen} onOpenChange={setFormOpen} staff={editing} onSaved={reload} />
      <RatesDialog open={!!ratesFor} onOpenChange={(o) => !o && setRatesFor(null)} staff={ratesFor} onSaved={reload} />
      <ResetPasswordDialog open={!!pwFor} onOpenChange={(o) => !o && setPwFor(null)} staff={pwFor} />
      <ConfirmDialog
        open={!!toggling}
        onOpenChange={(o) => !o && setToggling(null)}
        title={toggling?.is_active ? `Deactivate ${toggling?.full_name}?` : `Activate ${toggling?.full_name}?`}
        description={
          toggling?.is_active
            ? "They will be signed out of new sessions and can't record sales. Their sales and earnings history stays."
            : "They will be able to sign in and record sales again."
        }
        confirmLabel={toggling?.is_active ? "Deactivate" : "Activate"}
        destructive={!!toggling?.is_active}
        onConfirm={() => (toggling ? toggleActive(toggling) : undefined)}
      />
    </>
  );
}
