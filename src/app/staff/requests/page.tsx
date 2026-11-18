"use client";

import { useMemo, useState } from "react";
import { PackagePlus, Plus, Send, ShoppingBasket, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ConfirmDialog, EmptyState, ErrorState, Field, LoadingRows, PageHeader, SimpleSelect } from "@/components/app/common";
import { RequestStatusBadge } from "@/components/staff/request-badge";
import { useQuery } from "@/hooks/use-query";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { errorMessage, formatPacks, formatQty, toNumber } from "@/lib/format";
import { formatDateTime } from "@/lib/dates";
import type { RequestableItem, StaffRequest } from "@/lib/types";

/** Items waiting to be sent: item id → total pieces/units */
type Basket = Record<string, number>;

export default function StaffRequestsPage() {
  const [itemId, setItemId] = useState("");
  const [packs, setPacks] = useState("");
  const [pcs, setPcs] = useState("");
  const [basket, setBasket] = useState<Basket>({});
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<StaffRequest | null>(null);

  const { data, error: loadError, loading, reload } = useQuery(
    async (sb) => {
      const [items, mine] = await Promise.all([sb.rpc("staff_request_items"), sb.rpc("staff_my_requests", { p_limit: 50 })]);
      if (items.error) throw items.error;
      if (mine.error) throw mine.error;
      return { items: (items.data ?? []) as RequestableItem[], mine: (mine.data ?? []) as StaffRequest[] };
    },
    [],
    { refetchOnFocus: true, pollMs: 30_000 },
  );
  const byId = useMemo(() => new Map((data?.items ?? []).map((i) => [i.id, i])), [data]);
  const item = byId.get(itemId) ?? null;
  const ppp = toNumber(item?.pieces_per_pack);
  const amount = Math.round(((ppp > 0 ? toNumber(packs) * ppp : 0) + toNumber(pcs)) * 1000) / 1000;
  const lines = Object.entries(basket)
    .map(([id, qty]) => ({ item: byId.get(id), qty }))
    .filter((l): l is { item: RequestableItem; qty: number } => !!l.item);

  function addToList(e: React.FormEvent) {
    e.preventDefault();
    if (!item) return setError("Choose what you need.");
    if (toNumber(packs) < 0 || toNumber(pcs) < 0) return setError("Amounts can't be negative.");
    if (!(amount > 0)) return setError("Enter how many you need.");
    setError(null);
    setBasket((b) => ({ ...b, [item.id]: Math.round(((b[item.id] ?? 0) + amount) * 1000) / 1000 }));
    toast.success(`Added ${formatPacks(amount, item.pieces_per_pack, item.unit)} ${item.name}`, { duration: 1500 });
    setItemId("");
    setPacks("");
    setPcs("");
  }

  async function sendAll() {
    if (!lines.length || busy) return;
    setBusy(true);
    const { data: n, error: err } = await createClient().rpc("staff_create_requests", {
      p_items: lines.map((l) => ({ item_id: l.item.id, quantity: l.qty })),
      p_notes: notes || null,
    });
    setBusy(false);
    if (err) return setError(errorMessage(err));
    toast.success(`Sent ${n ?? lines.length} request${(n ?? lines.length) === 1 ? "" : "s"} to the owner`);
    setBasket({});
    setNotes("");
    reload();
  }

  async function cancel(r: StaffRequest) {
    const { error: err } = await createClient().rpc("staff_cancel_request", { p_request_id: r.id });
    if (err) {
      toast.error(errorMessage(err));
      throw err;
    }
    toast.success("Request cancelled");
    reload();
  }

  const pending = (data?.mine ?? []).filter((r) => r.status === "pending").length;

  return (
    <>
      <PageHeader title="Request Supplies" description="Add everything you need to your list, then send it to the owner in one go." />
      <div className="grid gap-6 lg:grid-cols-[24rem_1fr]">
        <div className="grid h-fit gap-6">
          <Card className="h-fit">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <PackagePlus className="size-4" aria-hidden /> Add an item
              </CardTitle>
            </CardHeader>
            <CardContent>
              {loadError ? (
                <ErrorState message={loadError} onRetry={reload} />
              ) : (
                <form onSubmit={addToList} className="grid gap-4" noValidate>
                  <Field label="What do you need?">
                    <SimpleSelect
                      aria-label="Item"
                      value={itemId}
                      onChange={(v) => {
                        setItemId(v);
                        setPacks("");
                        setPcs("");
                        setError(null);
                      }}
                      placeholder="Choose an item…"
                      options={(data?.items ?? []).map((i) => ({ value: i.id, label: basket[i.id] ? `${i.name} (in list)` : i.name }))}
                    />
                  </Field>
                  {item && (
                    <div className={cn("grid gap-3", ppp > 0 && "grid-cols-2")}>
                      {ppp > 0 && (
                        <Field label={`Packs (${item.pack_unit ?? "pack"})`} htmlFor="rq-packs" hint={`1 pack = ${formatQty(ppp)} pcs`}>
                          <Input id="rq-packs" type="number" inputMode="numeric" min={0} step="1" value={packs} placeholder="0" onChange={(e) => setPacks(e.target.value)} className="h-10 text-center text-lg" />
                        </Field>
                      )}
                      <Field label={ppp > 0 ? "+ Pieces" : `How many (${item.unit})`} htmlFor="rq-pcs">
                        <Input id="rq-pcs" type="number" inputMode="decimal" min={0} step="any" value={pcs} placeholder="0" onChange={(e) => setPcs(e.target.value)} className="h-10 text-center text-lg" />
                      </Field>
                    </div>
                  )}
                  {item && amount > 0 && (
                    <p className="rounded-md bg-muted/60 px-3 py-2 text-sm">
                      {formatQty(amount)} {ppp > 0 ? "pcs" : item.unit}
                      {ppp > 0 && <span className="text-muted-foreground"> ({formatPacks(amount, ppp)})</span>}
                    </p>
                  )}
                  {error && (
                    <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">
                      {error}
                    </p>
                  )}
                  <Button type="submit" variant="outline" size="lg" className="h-11" disabled={!item}>
                    <Plus /> Add to list
                  </Button>
                </form>
              )}
            </CardContent>
          </Card>

          <Card className="h-fit">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShoppingBasket className="size-4" aria-hidden /> My list ({lines.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              {lines.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">Nothing in your list yet.</p>
              ) : (
                <ul className="divide-y rounded-lg border">
                  {lines.map((l) => (
                    <li key={l.item.id} className="flex items-center justify-between gap-2 px-3 py-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{l.item.name}</p>
                        <p className="text-xs text-muted-foreground">{formatPacks(l.qty, l.item.pieces_per_pack, l.item.unit)}</p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Remove ${l.item.name}`}
                        onClick={() =>
                          setBasket((b) => {
                            const n = { ...b };
                            delete n[l.item.id];
                            return n;
                          })
                        }
                      >
                        <Trash2 />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              <Field label="Note for the owner (optional)" htmlFor="rq-notes">
                <Input id="rq-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Running low, busy afternoon" maxLength={200} />
              </Field>
              <Button size="lg" className="h-11" disabled={!lines.length || busy} onClick={sendAll}>
                <Send /> {busy ? "Sending…" : lines.length ? `Send ${lines.length} item${lines.length === 1 ? "" : "s"} to the owner` : "Send request"}
              </Button>
            </CardContent>
          </Card>
        </div>

        <Card className="gap-0 py-0">
          <CardHeader className="border-b py-4">
            <CardTitle>My requests</CardTitle>
            <CardDescription>{pending ? `${pending} waiting for the owner` : "Latest first"}</CardDescription>
          </CardHeader>
          {loading && !data ? (
            <LoadingRows rows={4} />
          ) : !data?.mine.length ? (
            <EmptyState icon={PackagePlus} title="No requests yet" description="When you need more supplies, add them to your list and send." />
          ) : (
            <ul className="divide-y">
              {data.mine.map((r) => (
                <li key={r.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {r.item_name} · {formatPacks(r.quantity, r.pieces_per_pack, r.unit)}
                    </p>
                    {r.status === "approved" && r.approved_quantity !== null && Number(r.approved_quantity) !== Number(r.quantity) && (
                      <p className="text-sm">Approved: {formatPacks(r.approved_quantity, r.pieces_per_pack, r.unit)}</p>
                    )}
                    {r.added_to_assignment && <p className="text-xs text-success">Added to your products for today</p>}
                    {r.notes && <p className="text-xs text-muted-foreground">You: {r.notes}</p>}
                    {r.admin_note && <p className="text-xs">Owner: {r.admin_note}</p>}
                    <p className="text-[11px] text-muted-foreground">{formatDateTime(r.created_at)}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1.5">
                    <RequestStatusBadge status={r.status} />
                    {r.status === "pending" && (
                      <Button size="xs" variant="ghost" onClick={() => setCancelling(r)}>
                        Cancel
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <ConfirmDialog
        open={!!cancelling}
        onOpenChange={(o) => !o && setCancelling(null)}
        title="Cancel this request?"
        description={cancelling ? `${cancelling.item_name} · ${formatPacks(cancelling.quantity, cancelling.pieces_per_pack, cancelling.unit)}` : undefined}
        confirmLabel="Cancel request"
        onConfirm={() => (cancelling ? cancel(cancelling) : undefined)}
      />
    </>
  );
}
