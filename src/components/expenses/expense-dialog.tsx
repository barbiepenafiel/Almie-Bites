"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Paperclip, X } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, SimpleSelect, SubmitButton } from "@/components/app/common";
import { useAppData } from "@/components/app/app-data";
import { createClient } from "@/lib/supabase/client";
import { errorMessage, formatPeso, formatQty, money, toNumber } from "@/lib/format";
import { todayManila } from "@/lib/dates";
import type { Expense, InventoryItem } from "@/lib/types";

const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;

export function ExpenseDialog({
  open,
  onOpenChange,
  expense,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  expense?: Expense | null;
  onSaved?: () => void;
}) {
  const { categoriesOf, paymentMethods } = useAppData();
  const cats = categoriesOf("expense");
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [amount, setAmount] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const [date, setDate] = useState(todayManila());
  const [payment, setPayment] = useState("Cash");
  const [notes, setNotes] = useState("");
  const [itemId, setItemId] = useState("");
  const [addToStock, setAddToStock] = useState(true);
  const [stockQty, setStockQty] = useState("");
  const [updateCost, setUpdateCost] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const [removeReceipt, setRemoveReceipt] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setErrors({});
    setFile(null);
    setRemoveReceipt(false);
    setName(expense?.name ?? "");
    setCategoryId(expense?.category_id ?? cats.find((c) => c.is_inventory_purchase)?.id ?? cats[0]?.id ?? "");
    setAmount(expense ? String(expense.amount) : "");
    setQuantity(expense?.quantity != null ? String(expense.quantity) : "");
    setUnitPrice(expense?.unit_price != null ? String(expense.unit_price) : "");
    setDate(expense?.expense_date ?? todayManila());
    setPayment(expense?.payment_method ?? paymentMethods[0] ?? "Cash");
    setNotes(expense?.notes ?? "");
    setItemId(expense?.inventory_item_id ?? "");
    setAddToStock(expense ? Number(expense.stock_added) > 0 : true);
    setStockQty(expense && Number(expense.stock_added) > 0 ? String(expense.stock_added) : "");
    setUpdateCost(!expense);
    /* eslint-enable react-hooks/set-state-in-effect */
    createClient()
      .from("inventory_items")
      .select("*")
      .order("name")
      .then(({ data }) => setItems((data ?? []) as InventoryItem[]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, expense]);

  const selectedCat = cats.find((c) => c.id === categoryId);
  const item = items.find((i) => i.id === itemId);
  const showInventory = !!selectedCat?.is_inventory_purchase || !!itemId;
  const ppp = toNumber(item?.pieces_per_pack);
  const packItem = !!itemId && ppp > 0;
  // For pack items, "quantity" is packs; stock is added in pieces (packs × pieces per pack).
  const effectiveStockQty =
    stockQty !== "" ? stockQty : packItem && quantity !== "" ? String(Math.round(toNumber(quantity) * ppp * 1000) / 1000) : quantity;

  // Amount auto-fills from quantity × unit price when both are entered.
  const computed = useMemo(() => {
    const q = toNumber(quantity);
    const u = toNumber(unitPrice);
    return quantity !== "" && unitPrice !== "" ? money(q * u) : null;
  }, [quantity, unitPrice]);

  function pickItem(id: string) {
    setItemId(id);
    const it = items.find((i) => i.id === id);
    if (it && !name.trim()) setName(it.name);
    if (it && unitPrice === "") {
      const price = Number(it.pieces_per_pack) > 0 ? Number(it.pack_price ?? 0) : Number(it.purchase_price);
      if (price > 0) setUnitPrice(String(price));
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    const amt = amount === "" && computed !== null ? computed : Number(amount);
    if (!name.trim()) errs.name = "Expense name is required.";
    if ((amount === "" && computed === null) || !Number.isFinite(amt) || amt < 0) errs.amount = "Enter the amount paid.";
    if (quantity !== "" && !(toNumber(quantity) > 0)) errs.quantity = "Quantity must be more than 0.";
    if (!date) errs.date = "Choose a date.";
    const doStock = !!itemId && addToStock;
    if (doStock && !(toNumber(effectiveStockQty) > 0)) errs.stockQty = "Enter how much stock to add.";
    if (file && file.size > MAX_RECEIPT_BYTES) errs.file = "Receipt must be 5 MB or smaller.";
    setErrors(errs);
    if (Object.keys(errs).length) return;

    setBusy(true);
    const supabase = createClient();
    try {
      let receiptPath: string | null | undefined = undefined; // undefined = keep existing
      if (file) {
        const { data: auth } = await supabase.auth.getUser();
        const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
        const path = `${auth.user?.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const up = await supabase.storage.from("receipts").upload(path, file, { contentType: file.type, upsert: false });
        if (up.error) throw up.error;
        receiptPath = path;
      } else if (removeReceipt) {
        receiptPath = null;
      }

      const payload: Record<string, unknown> = {
        name: name.trim(),
        category_id: categoryId || null,
        amount: amt,
        quantity: quantity === "" ? null : Number(quantity),
        unit_price: unitPrice === "" ? null : Number(unitPrice),
        inventory_item_id: itemId || null,
        add_to_stock: doStock,
        stock_quantity: doStock ? Number(effectiveStockQty) : null,
        update_item_cost: doStock && updateCost && amt > 0,
        pack_price: packItem && toNumber(quantity) > 0 ? money(amt / toNumber(quantity)) : null,
        payment_method: payment,
        notes: notes.trim() || null,
        expense_date: date,
      };
      if (receiptPath !== undefined) payload.receipt_path = receiptPath ?? "";

      const { error } = await supabase.rpc("save_expense", { p_data: payload, p_expense_id: expense?.id ?? null });
      if (error) throw error;

      // Clean up the replaced receipt file (best effort).
      if (expense?.receipt_path && receiptPath !== undefined) {
        void supabase.storage.from("receipts").remove([expense.receipt_path]);
      }
      toast.success(
        doStock && item
          ? `Expense saved and ${formatQty(effectiveStockQty)} ${item.unit} added to ${item.name}`
          : expense
            ? "Expense updated"
            : `Expense recorded · ${formatPeso(amt)}`,
      );
      onOpenChange(false);
      onSaved?.();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[94vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{expense ? "Edit expense" : "Add expense"}</DialogTitle>
          <DialogDescription>Ingredients, packaging, transport, utilities and other costs.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Category">
              <SimpleSelect aria-label="Expense category" value={categoryId} onChange={setCategoryId} options={cats.map((c) => ({ value: c.id, label: c.name }))} />
            </Field>
            <Field label="Date" htmlFor="ex-date" error={errors.date}>
              <Input id="ex-date" type="date" value={date} max={todayManila()} onChange={(e) => setDate(e.target.value)} />
            </Field>
          </div>

          {showInventory && (
            <Field label="Inventory item (optional)" hint="Link a purchase to an item to restock it automatically.">
              <SimpleSelect
                aria-label="Inventory item"
                value={itemId}
                onChange={pickItem}
                placeholder="Not linked to inventory"
                options={[{ value: "", label: "Not linked to inventory" }, ...items.map((i) => ({ value: i.id, label: `${i.name} (${i.unit})` }))]}
              />
            </Field>
          )}

          <Field label="Expense name" htmlFor="ex-name" error={errors.name}>
            <Input id="ex-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Hotdog, Cups, Tricycle fare" aria-invalid={!!errors.name} />
          </Field>

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Field label={packItem ? `Packs (${item?.pack_unit ?? "pack"})` : "Quantity (optional)"} htmlFor="ex-qty" error={errors.quantity}>
              <Input id="ex-qty" type="number" inputMode="decimal" min={0} step="any" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
            </Field>
            <Field label={packItem ? "Price per pack (₱)" : "Price / unit (optional)"} htmlFor="ex-unit">
              <Input id="ex-unit" type="number" inputMode="decimal" min={0} step="0.01" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} />
            </Field>
            <Field label="Amount (₱)" htmlFor="ex-amount" error={errors.amount} className="col-span-2 sm:col-span-1" hint={computed !== null ? `Qty × price = ${formatPeso(computed)}` : undefined}>
              <Input
                id="ex-amount"
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                value={amount}
                placeholder={computed !== null ? String(computed) : "0.00"}
                onChange={(e) => setAmount(e.target.value)}
                aria-invalid={!!errors.amount}
              />
            </Field>
          </div>

          {itemId && item && (
            <div className="grid gap-3 rounded-lg border bg-muted/40 p-3">
              <label className="flex items-start gap-2.5 text-sm">
                <Checkbox checked={addToStock} onCheckedChange={(c) => setAddToStock(!!c)} className="mt-0.5" />
                <span>
                  <span className="font-medium">Add this purchase to {item.name} stock</span>
                  <span className="block text-xs text-muted-foreground">
                    Current stock: {formatQty(item.current_stock)} {item.unit}. The expense is counted once; stock updates automatically.
                  </span>
                </span>
              </label>
              {addToStock && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field
                    label={`Stock to add (${packItem ? "pieces" : item.unit})`}
                    htmlFor="ex-stock"
                    error={errors.stockQty}
                    hint={
                      stockQty === "" && quantity
                        ? packItem
                          ? `${formatQty(quantity)} packs × ${formatQty(ppp)} = ${formatQty(effectiveStockQty)} pieces`
                          : "Defaults to the quantity above"
                        : undefined
                    }
                  >
                    <Input id="ex-stock" type="number" inputMode="decimal" min={0} step="any" value={stockQty} placeholder={effectiveStockQty || "0"} onChange={(e) => setStockQty(e.target.value)} />
                  </Field>
                  <label className="flex items-center gap-2 self-end pb-2 text-sm">
                    <Checkbox checked={updateCost} onCheckedChange={(c) => setUpdateCost(!!c)} />
                    Update cost per unit
                  </label>
                </div>
              )}
            </div>
          )}

          <Field label="Payment method">
            <SimpleSelect aria-label="Payment method" value={payment} onChange={setPayment} options={paymentMethods.map((p) => ({ value: p, label: p }))} />
          </Field>
          <Field label="Notes (optional)" htmlFor="ex-notes">
            <Textarea id="ex-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>

          <Field label="Receipt image (optional)" error={errors.file}>
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/*,application/pdf"
                capture="environment"
                className="sr-only"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
                <Paperclip /> {file ? "Change file" : expense?.receipt_path && !removeReceipt ? "Replace receipt" : "Attach receipt"}
              </Button>
              {file && <span className="max-w-48 truncate text-xs text-muted-foreground">{file.name}</span>}
              {!file && expense?.receipt_path && !removeReceipt && (
                <Button type="button" variant="ghost" size="sm" onClick={() => setRemoveReceipt(true)}>
                  <X /> Remove current receipt
                </Button>
              )}
            </div>
          </Field>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <SubmitButton busy={busy}>{expense ? "Save changes" : "Add expense"}</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
