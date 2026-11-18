"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Minus, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, SimpleSelect, SubmitButton } from "@/components/app/common";
import { useAppData } from "@/components/app/app-data";
import { createClient } from "@/lib/supabase/client";
import { errorMessage, formatPeso, money, toNumber } from "@/lib/format";
import { newUuid } from "@/lib/uuid";
import { manilaDateTimeLocalToISO, toManilaDateTimeLocal } from "@/lib/dates";
import type { Product, Sale } from "@/lib/types";

interface Line {
  key: number;
  product_id: string;
  quantity: string;
  unit_price: string;
}
let k = 0;

export function SaleDialog({
  open,
  onOpenChange,
  sale,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pass a sale (with sale_items) to edit it. */
  sale?: Sale | null;
  onSaved?: () => void;
}) {
  const { paymentMethods } = useAppData();
  const [products, setProducts] = useState<Product[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [payment, setPayment] = useState("Cash");
  const [soldAt, setSoldAt] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [staffList, setStaffList] = useState<{ id: string; full_name: string; is_active: boolean }[]>([]);
  const [soldBy, setSoldBy] = useState("");
  const clientRef = useRef<string | null>(null);

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setError(null);
    setPayment(sale?.payment_method ?? paymentMethods[0] ?? "Cash");
    setSoldAt(toManilaDateTimeLocal(sale?.sold_at ?? new Date()));
    setNotes(sale?.notes ?? "");
    setSoldBy(sale?.staff_id ?? "");
    clientRef.current = null;
    setLines(
      (sale?.sale_items ?? [])
        .filter((i) => i.product_id)
        .map((i) => ({ key: ++k, product_id: i.product_id!, quantity: String(i.quantity), unit_price: String(i.unit_price) })),
    );
    /* eslint-enable react-hooks/set-state-in-effect */
    createClient()
      .from("products")
      .select("*")
      .order("name")
      .then(({ data }) => setProducts((data ?? []) as Product[]));
    createClient()
      .from("staff")
      .select("id, full_name, is_active")
      .order("full_name")
      .then(({ data }) => setStaffList((data ?? []) as { id: string; full_name: string; is_active: boolean }[]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sale]);

  const productMap = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const sellable = products.filter((p) => p.is_available || lines.some((l) => l.product_id === p.id));
  const total = money(lines.reduce((s, l) => s + toNumber(l.quantity) * toNumber(l.unit_price), 0));
  const itemCount = lines.reduce((s, l) => s + toNumber(l.quantity), 0);

  function addProduct(p: Product) {
    clientRef.current = null;
    setLines((ls) => {
      const existing = ls.find((l) => l.product_id === p.id);
      if (existing) return ls.map((l) => (l === existing ? { ...l, quantity: String(toNumber(l.quantity) + 1) } : l));
      return [...ls, { key: ++k, product_id: p.id, quantity: "1", unit_price: String(p.selling_price) }];
    });
  }
  function update(key: number, patch: Partial<Line>) {
    clientRef.current = null;
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!lines.length) return setError("Add at least one product.");
    for (const l of lines) {
      const name = productMap.get(l.product_id)?.name ?? "a product";
      if (!l.product_id) return setError("Choose a product for every line.");
      if (!(toNumber(l.quantity) > 0)) return setError(`Quantity for ${name} must be more than 0.`);
      if (l.unit_price === "" || toNumber(l.unit_price) < 0) return setError(`Enter a valid price for ${name}.`);
    }
    if (!soldAt) return setError("Enter the date and time of the sale.");
    setError(null);
    setBusy(true);
    const items = lines.map((l) => ({ product_id: l.product_id, quantity: Number(l.quantity), unit_price: Number(l.unit_price) }));
    const supabase = createClient();
    const args = {
      p_items: items,
      p_payment_method: payment,
      p_notes: notes || null,
      p_sold_at: manilaDateTimeLocalToISO(soldAt),
      p_staff_id: soldBy || null,
    };
    clientRef.current ??= newUuid();
    const { error: err } = sale
      ? await supabase.rpc("update_sale", { p_sale_id: sale.id, ...args })
      : await supabase.rpc("record_sale", { ...args, p_client_ref: clientRef.current });
    setBusy(false);
    if (err) return setError(errorMessage(err));
    toast.success(sale ? `Sale ${sale.transaction_number} updated` : `Sale recorded · ${formatPeso(total)}`);
    onOpenChange(false);
    onSaved?.();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[94vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{sale ? `Edit sale ${sale.transaction_number}` : "Record sale"}</DialogTitle>
          <DialogDescription>Tap products to add them, adjust quantities, then save.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-4" noValidate>
          {sale?.sale_items?.some((i) => !i.product_id) && (
            <p className="rounded-md bg-warning-soft px-3 py-2 text-sm text-warning" role="status">
              Some items in this sale belong to products that were deleted. They will be removed if you save.
            </p>
          )}
          <div className="flex flex-wrap gap-2" aria-label="Quick add products">
            {products.length === 0 && <p className="text-sm text-muted-foreground">No products yet — add them in Products first.</p>}
            {products
              .filter((p) => p.is_available)
              .map((p) => (
                <Button key={p.id} type="button" variant="outline" size="sm" className="h-9" onClick={() => addProduct(p)}>
                  <Plus /> {p.name} <span className="text-muted-foreground">{formatPeso(p.selling_price)}</span>
                </Button>
              ))}
          </div>

          <div className="rounded-lg border">
            <div className="hidden grid-cols-[1fr_8.5rem_6.5rem_6rem_2rem] gap-2 border-b bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground sm:grid">
              <span>Product</span>
              <span>Quantity</span>
              <span>Price</span>
              <span className="text-right">Subtotal</span>
              <span />
            </div>
            <div className="grid gap-3 p-3 sm:gap-2">
              {lines.length === 0 && <p className="py-3 text-center text-sm text-muted-foreground">No products added yet.</p>}
              {lines.map((l) => {
                const sub = money(toNumber(l.quantity) * toNumber(l.unit_price));
                return (
                  <div key={l.key} className="grid grid-cols-2 items-center gap-2 border-b pb-3 last:border-0 last:pb-0 sm:grid-cols-[1fr_8.5rem_6.5rem_6rem_2rem] sm:border-0 sm:pb-0">
                    <div className="col-span-2 sm:col-span-1">
                      <SimpleSelect
                        aria-label="Product"
                        placeholder="Choose product…"
                        value={l.product_id}
                        onChange={(v) => update(l.key, { product_id: v, unit_price: String(productMap.get(v)?.selling_price ?? l.unit_price) })}
                        options={sellable.map((p) => ({ value: p.id, label: p.name }))}
                      />
                    </div>
                    <div className="flex items-center gap-1">
                      <Button type="button" variant="outline" size="icon-sm" aria-label="Decrease" onClick={() => update(l.key, { quantity: String(Math.max(1, toNumber(l.quantity) - 1)) })}>
                        <Minus />
                      </Button>
                      <Input aria-label="Quantity" type="number" inputMode="decimal" min={0} step="any" className="h-8 text-center" value={l.quantity} onChange={(e) => update(l.key, { quantity: e.target.value })} />
                      <Button type="button" variant="outline" size="icon-sm" aria-label="Increase" onClick={() => update(l.key, { quantity: String(toNumber(l.quantity) + 1) })}>
                        <Plus />
                      </Button>
                    </div>
                    <Input aria-label="Price" type="number" inputMode="decimal" min={0} step="0.01" value={l.unit_price} onChange={(e) => update(l.key, { unit_price: e.target.value })} />
                    <span className="text-right text-sm font-medium tabular-nums">{formatPeso(sub)}</span>
                    <Button type="button" variant="ghost" size="icon-sm" aria-label="Remove line" className="justify-self-end" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>
                      <Trash2 />
                    </Button>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center justify-between border-t bg-secondary/60 px-3 py-3">
              <span className="text-sm text-muted-foreground">{itemCount ? `${itemCount} item${itemCount === 1 ? "" : "s"}` : "Total"}</span>
              <span className="font-heading text-2xl font-semibold tabular-nums">{formatPeso(total)}</span>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {(staffList.length > 0 || soldBy) && (
              <Field label="Sold by" hint={soldBy ? "Staff earnings are calculated with their current rates." : undefined} className="sm:col-span-2">
                <SimpleSelect
                  aria-label="Sold by"
                  value={soldBy || "owner"}
                  onChange={(v) => setSoldBy(v === "owner" ? "" : v)}
                  options={[
                    { value: "owner", label: "Owner (no staff earnings)" },
                    ...staffList
                      .filter((s) => s.is_active || s.id === soldBy)
                      .map((s) => ({ value: s.id, label: s.full_name + (s.is_active ? "" : " (inactive)") })),
                  ]}
                />
              </Field>
            )}
            <Field label="Payment method">
              <SimpleSelect aria-label="Payment method" value={payment} onChange={setPayment} options={paymentMethods.map((p) => ({ value: p, label: p }))} />
            </Field>
            <Field label="Date & time" htmlFor="sale-when">
              <Input id="sale-when" type="datetime-local" value={soldAt} onChange={(e) => setSoldAt(e.target.value)} />
            </Field>
          </div>
          <Field label="Notes (optional)" htmlFor="sale-notes">
            <Input id="sale-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Bulk order for office" />
          </Field>
          {error && (
            <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <SubmitButton busy={busy} disabled={!lines.length}>
              {sale ? "Save changes" : `Record sale · ${formatPeso(total)}`}
            </SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
