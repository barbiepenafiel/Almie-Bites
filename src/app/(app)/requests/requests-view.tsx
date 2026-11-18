"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Clock, PackagePlus, Wallet, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ConfirmDialog, EmptyState, ErrorState, Field, LoadingRows, PageHeader, SimpleSelect, StatCard } from "@/components/app/common";
import { RequestStatusBadge } from "@/components/staff/request-badge";
import { useAppData } from "@/components/app/app-data";
import { unwrap, useQuery } from "@/hooks/use-query";
import { createClient } from "@/lib/supabase/client";
import { errorMessage, formatPacks, formatPeso, formatQty, money, toNumber } from "@/lib/format";
import { formatDateTime } from "@/lib/dates";
import type { SupplyRequest } from "@/lib/types";

/** Estimated cost: whole packs at the pack price + loose pieces at cost per piece. */
function estimateCost(r: Pick<SupplyRequest, "inventory_items">, qty: number) {
  const i = r.inventory_items;
  if (!i) return 0;
  const ppp = toNumber(i.pieces_per_pack);
  const perPiece = toNumber(i.purchase_price);
  if (ppp > 0 && toNumber(i.pack_price) > 0) {
    const packs = Math.floor(qty / ppp + 1e-9);
    return money(packs * toNumber(i.pack_price) + (qty - packs * ppp) * perPiece);
  }
  return money(qty * perPiece);
}

export function RequestsView() {
  const [tab, setTab] = useState("pending");
  const [approving, setApproving] = useState<SupplyRequest | null>(null);
  const [rejecting, setRejecting] = useState<SupplyRequest | null>(null);
  const [rejectNote, setRejectNote] = useState("");

  const { data, error, loading, reload } = useQuery(
    async (sb) => {
      const [reqs, links] = await Promise.all([
        sb
          .from("supply_requests")
          .select("*, staff(id, full_name), inventory_items(id, name, unit, pack_unit, pieces_per_pack, purchase_price, pack_price, current_stock)")
          .order("created_at", { ascending: false })
          .limit(200),
        sb.from("product_recipes").select("inventory_item_id, product_id, products(name)"),
      ]);
      return {
        reqs: unwrap(reqs) as SupplyRequest[],
        links: unwrap(links) as unknown as { inventory_item_id: string; product_id: string; products: { name: string } | null }[],
      };
    },
    [],
    { realtime: ["supply_requests", "inventory_items"] },
  );
  const rows = useMemo(() => (data?.reqs ?? []).filter((r) => (tab === "pending" ? r.status === "pending" : true)), [data, tab]);
  const pending = (data?.reqs ?? []).filter((r) => r.status === "pending");
  const pendingCost = money(pending.reduce((s, r) => s + estimateCost(r, Number(r.quantity)), 0));
  const busy = loading && !data;

  async function reject(r: SupplyRequest) {
    const { error: err } = await createClient().rpc("decide_supply_request", { p_request_id: r.id, p_approve: false, p_data: { note: rejectNote } });
    if (err) {
      toast.error(errorMessage(err));
      throw err;
    }
    toast.success(`Request from ${r.staff?.full_name ?? "staff"} rejected`);
    reload();
  }

  return (
    <>
      <PageHeader title="Supply Requests" description="Supplies your staff asked for. Approve, buy if needed, and hand them out." />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard label="Waiting for you" value={pending.length} icon={Clock} tone={pending.length ? "warning" : "default"} loading={busy} />
        <StatCard label="Estimated cost of pending" value={formatPeso(pendingCost)} icon={Wallet} tone="brand" loading={busy} hint="At current cost per piece / pack" />
      </div>

      <Card className="gap-0 py-0">
        <div className="border-b p-3">
          <Tabs value={tab} onValueChange={(v) => setTab(v as string)}>
            <TabsList>
              <TabsTrigger value="pending">Pending ({pending.length})</TabsTrigger>
              <TabsTrigger value="all">All</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        {error ? (
          <div className="p-4">
            <ErrorState message={error} onRetry={reload} />
          </div>
        ) : busy ? (
          <LoadingRows rows={5} />
        ) : rows.length === 0 ? (
          <EmptyState icon={PackagePlus} title={tab === "pending" ? "No pending requests" : "No requests yet"} description="Staff send requests from their Request Supplies page." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Requested</TableHead>
                <TableHead>Staff</TableHead>
                <TableHead>Item</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="hidden text-right md:table-cell">In stock</TableHead>
                <TableHead className="text-right">Est. cost</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="pr-4" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const i = r.inventory_items;
                const qty = Number(r.approved_quantity ?? r.quantity);
                const short = i && toNumber(i.current_stock) < qty;
                return (
                  <TableRow key={r.id}>
                    <TableCell className="pl-4 text-xs whitespace-nowrap text-muted-foreground">{formatDateTime(r.created_at)}</TableCell>
                    <TableCell className="font-medium">{r.staff?.full_name ?? "—"}</TableCell>
                    <TableCell>
                      {i?.name ?? "—"}
                      {r.notes && <div className="max-w-56 truncate text-xs text-muted-foreground">“{r.notes}”</div>}
                      {r.admin_note && <div className="max-w-56 truncate text-xs">You: {r.admin_note}</div>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatPacks(r.quantity, i?.pieces_per_pack, i?.unit)}
                      {r.approved_quantity !== null && Number(r.approved_quantity) !== Number(r.quantity) && (
                        <div className="text-xs text-muted-foreground">gave {formatPacks(r.approved_quantity, i?.pieces_per_pack, i?.unit)}</div>
                      )}
                    </TableCell>
                    <TableCell className={`hidden text-right tabular-nums md:table-cell ${short && r.status === "pending" ? "text-danger" : ""}`}>
                      {i ? formatQty(i.current_stock) : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatPeso(estimateCost(r, qty))}</TableCell>
                    <TableCell>
                      <RequestStatusBadge status={r.status} />
                      {r.expense_id && <div className="text-[11px] text-muted-foreground">Purchase recorded</div>}
                      {r.added_to_assignment && <div className="text-[11px] text-muted-foreground">Added to today</div>}
                    </TableCell>
                    <TableCell className="pr-4">
                      {r.status === "pending" && (
                        <div className="flex justify-end gap-1">
                          <Button size="sm" onClick={() => setApproving(r)}>
                            <Check /> Approve
                          </Button>
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label="Reject"
                            onClick={() => {
                              setRejectNote("");
                              setRejecting(r);
                            }}
                          >
                            <X />
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>

      <ApproveDialog
        request={approving}
        links={data?.links ?? []}
        onOpenChange={(o) => !o && setApproving(null)}
        onSaved={reload}
      />
      <ConfirmDialog
        open={!!rejecting}
        onOpenChange={(o) => !o && setRejecting(null)}
        title={`Reject ${rejecting?.staff?.full_name ?? "staff"}'s request?`}
        description={rejecting ? `${rejecting.inventory_items?.name} · ${formatPacks(rejecting.quantity, rejecting.inventory_items?.pieces_per_pack, rejecting.inventory_items?.unit)}` : undefined}
        confirmLabel="Reject"
        onConfirm={() => (rejecting ? reject(rejecting) : undefined)}
      >
        <Field label="Reason (shown to staff, optional)" htmlFor="rej-note">
          <Input id="rej-note" value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} placeholder="e.g. Use what's left from yesterday" />
        </Field>
      </ConfirmDialog>
    </>
  );
}

function ApproveDialog({
  request,
  links,
  onOpenChange,
  onSaved,
}: {
  request: SupplyRequest | null;
  links: { inventory_item_id: string; product_id: string; products: { name: string } | null }[];
  onOpenChange: (o: boolean) => void;
  onSaved: () => void;
}) {
  const { categoriesOf, paymentMethods } = useAppData();
  const cats = categoriesOf("expense");
  const [packs, setPacks] = useState("");
  const [pcs, setPcs] = useState("");
  const [buy, setBuy] = useState(false);
  const [amount, setAmount] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [payment, setPayment] = useState("Cash");
  const [assign, setAssign] = useState(true);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const i = request?.inventory_items;
  const ppp = toNumber(i?.pieces_per_pack);
  const itemLinks = links.filter((l) => l.inventory_item_id === i?.id);
  const canAssign = itemLinks.length === 1;

  useEffect(() => {
    if (!request) return;
    const q = Number(request.quantity);
    const p = ppp > 0 ? Math.floor(q / ppp + 1e-9) : 0;
    /* eslint-disable react-hooks/set-state-in-effect */
    setPacks(ppp > 0 ? String(p) : "");
    setPcs(String(Math.round((q - p * ppp) * 1000) / 1000));
    setBuy(toNumber(i?.current_stock) < q);
    setAmount("");
    setCategoryId(cats.find((c) => c.is_inventory_purchase)?.id ?? cats[0]?.id ?? "");
    setPayment(paymentMethods[0] ?? "Cash");
    setAssign(true);
    setNote("");
    setError(null);
    /* eslint-enable react-hooks/set-state-in-effect */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);

  const qty = Math.round(((ppp > 0 ? toNumber(packs) * ppp : 0) + toNumber(pcs)) * 1000) / 1000;
  const est = request ? estimateCost(request, qty) : 0;

  async function approve() {
    if (!request) return;
    if (!(qty > 0)) return setError("Quantity must be more than 0.");
    if (buy && amount !== "" && toNumber(amount) < 0) return setError("Amount can't be negative.");
    setError(null);
    setBusy(true);
    const { error: err } = await createClient().rpc("decide_supply_request", {
      p_request_id: request.id,
      p_approve: true,
      p_data: {
        quantity: qty,
        buy,
        amount: buy ? (amount === "" ? est : toNumber(amount)) : null,
        category_id: categoryId || null,
        payment_method: payment,
        update_item_cost: true,
        assign: assign && canAssign,
        note,
      },
    });
    setBusy(false);
    if (err) return setError(errorMessage(err));
    toast.success(`Approved ${formatPacks(qty, i?.pieces_per_pack, i?.unit)} ${i?.name} for ${request.staff?.full_name ?? "staff"}`);
    onOpenChange(false);
    onSaved();
  }

  return (
    <Dialog open={!!request} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            Approve · {request?.staff?.full_name} · {i?.name}
          </DialogTitle>
          <DialogDescription>
            Asked for {request ? formatPacks(request.quantity, i?.pieces_per_pack, i?.unit) : ""} · you have {formatQty(i?.current_stock)} in stock
            {request?.notes && <> · “{request.notes}”</>}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className={ppp > 0 ? "grid grid-cols-2 gap-3" : "grid"}>
            {ppp > 0 && (
              <Field label={`Packs (${i?.pack_unit ?? "pack"})`} htmlFor="ap-packs" hint={`1 pack = ${formatQty(ppp)} pcs`}>
                <Input id="ap-packs" type="number" inputMode="numeric" min={0} step="1" value={packs} onChange={(e) => setPacks(e.target.value)} />
              </Field>
            )}
            <Field label={ppp > 0 ? "+ Pieces" : `Quantity (${i?.unit ?? "units"})`} htmlFor="ap-pcs">
              <Input id="ap-pcs" type="number" inputMode="decimal" min={0} step="any" value={pcs} onChange={(e) => setPcs(e.target.value)} />
            </Field>
          </div>
          <div className="flex items-baseline justify-between rounded-lg bg-muted/60 px-3 py-2 text-sm">
            <span>
              Giving <strong>{formatQty(qty)} pcs</strong>
              {ppp > 0 && <span className="text-muted-foreground"> ({formatPacks(qty, ppp)})</span>}
            </span>
            <span>
              Est. cost <strong className="tabular-nums">{formatPeso(est)}</strong>
            </span>
          </div>

          <div className="grid gap-3 rounded-lg border p-3">
            <label className="flex items-start gap-2.5 text-sm">
              <Checkbox checked={buy} onCheckedChange={(c) => setBuy(!!c)} className="mt-0.5" />
              <span>
                <span className="font-medium">I&apos;m buying this — record the purchase</span>
                <span className="block text-xs text-muted-foreground">Creates one expense and adds the stock. Leave off if you&apos;re giving it from stock you have.</span>
              </span>
            </label>
            {buy && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Amount paid (₱)" htmlFor="ap-amt" hint={`Estimated ${formatPeso(est)}`}>
                  <Input id="ap-amt" type="number" inputMode="decimal" min={0} step="0.01" placeholder={String(est)} value={amount} onChange={(e) => setAmount(e.target.value)} />
                </Field>
                <Field label="Payment method">
                  <SimpleSelect aria-label="Payment method" value={payment} onChange={setPayment} options={paymentMethods.map((m) => ({ value: m, label: m }))} />
                </Field>
                <Field label="Expense category" className="sm:col-span-2">
                  <SimpleSelect aria-label="Expense category" value={categoryId} onChange={setCategoryId} options={cats.map((c) => ({ value: c.id, label: c.name }))} />
                </Field>
              </div>
            )}
          </div>

          <label className="flex items-start gap-2.5 text-sm">
            <Checkbox checked={assign && canAssign} disabled={!canAssign} onCheckedChange={(c) => setAssign(!!c)} className="mt-0.5" />
            <span>
              <span className="font-medium">Add to {request?.staff?.full_name ?? "their"}&apos;s products for today</span>
              <span className="block text-xs text-muted-foreground">
                {canAssign
                  ? `Adds these pieces to their ${itemLinks[0].products?.name ?? "product"} count on Record Sale.`
                  : itemLinks.length === 0
                    ? "This item isn't sold through a product, so there's nothing to add to their sale count."
                    : "This item is used by several products — set their counts in Daily Assignments."}
              </span>
            </span>
          </label>

          <Field label="Note to staff (optional)" htmlFor="ap-note">
            <Input id="ap-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Pick up at 2pm" />
          </Field>
          {error && (
            <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={approve} disabled={busy}>
            {busy ? "Saving…" : "Approve"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
