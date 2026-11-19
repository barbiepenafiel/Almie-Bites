"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Field, SimpleSelect, SubmitButton } from "@/components/app/common";
import { useAppData } from "@/components/app/app-data";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { errorMessage, formatPeso, formatQty, money, toNumber } from "@/lib/format";
import { todayManila } from "@/lib/dates";
import type { InventoryItem } from "@/lib/types";

const UNIT_SUGGESTIONS = ["Piece", "Pack", "Kg", "Gram", "Liter", "ml", "Bottle", "Sachet", "Box", "Dozen", "Tray"];

/* ======================================================================
 * Add / edit inventory item
 * ==================================================================== */
const itemSchema = z.object({
  name: z.string().trim().min(1, "Item name is required.").max(100),
  category: z.string().trim().min(1, "Choose a category."),
  unit: z.string().trim().min(1, "Unit is required.").max(30),
  current_stock: z.number({ error: "Enter a number." }).min(0, "Stock can't be negative."),
  minimum_stock: z.number({ error: "Enter a number." }).min(0, "Can't be negative."),
  purchase_price: z.number({ error: "Enter a number." }).min(0, "Can't be negative."),
  supplier: z.string().trim().max(100).optional(),
  notes: z.string().trim().max(500).optional(),
  pack_unit: z.string().trim().max(40).optional(),
  pieces_per_pack: z.number({ error: "Enter a number." }).positive("Must be more than 0.").nullable(),
  pack_price: z.number({ error: "Enter a number." }).min(0, "Can't be negative.").nullable(),
});
type ItemErrors = Partial<Record<keyof z.infer<typeof itemSchema>, string>>;

export function InventoryItemDialog({
  open,
  onOpenChange,
  item,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item?: InventoryItem | null;
  onSaved?: () => void;
}) {
  const { categoriesOf, settings } = useAppData();
  const categories = categoriesOf("inventory");
  const [form, setForm] = useState({
    name: "",
    category: "",
    unit: "Piece",
    current_stock: "0",
    minimum_stock: "",
    purchase_price: "0",
    supplier: "",
    notes: "",
    pack_unit: "",
    pieces_per_pack: "",
    pack_price: "",
  });
  const [errors, setErrors] = useState<ItemErrors>({});
  const [busy, setBusy] = useState(false);
  const [packed, setPacked] = useState(false); // bought in packs, sold by the piece

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setErrors({});
    setPacked(!!item?.pieces_per_pack);
    /* eslint-enable react-hooks/set-state-in-effect */
    setForm(
      item
        ? {
            name: item.name,
            category: item.category,
            unit: item.unit,
            current_stock: String(item.current_stock),
            minimum_stock: String(item.minimum_stock),
            purchase_price: String(item.purchase_price),
            supplier: item.supplier ?? "",
            notes: item.notes ?? "",
            pack_unit: item.pack_unit ?? "",
            pieces_per_pack: item.pieces_per_pack != null ? String(Number(item.pieces_per_pack)) : "",
            pack_price: item.pack_price != null ? String(Number(item.pack_price)) : "",
          }
        : {
            name: "",
            category: categories[0]?.name ?? "Ingredient",
            unit: "Piece",
            current_stock: "0",
            minimum_stock: String(settings?.default_min_stock ?? 5),
            purchase_price: "0",
            supplier: "",
            notes: "",
            pack_unit: "",
            pieces_per_pack: "",
            pack_price: "",
          },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, item]);

  const categoryOptions = useMemo(() => {
    const names = categories.map((c) => c.name);
    if (form.category && !names.includes(form.category)) names.push(form.category);
    return names.map((n) => ({ value: n, label: n }));
  }, [categories, form.category]);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = itemSchema.safeParse({
      ...form,
      current_stock: form.current_stock === "" ? 0 : Number(form.current_stock),
      minimum_stock: form.minimum_stock === "" ? 0 : Number(form.minimum_stock),
      purchase_price: form.purchase_price === "" ? 0 : Number(form.purchase_price),
      pieces_per_pack: packed && form.pieces_per_pack !== "" ? Number(form.pieces_per_pack) : null,
      pack_price: packed && form.pack_price !== "" ? Number(form.pack_price) : null,
    });
    if (packed && !(Number(form.pieces_per_pack) > 0)) {
      setErrors({ pieces_per_pack: "Enter how many pieces are in one pack." });
      return;
    }
    if (!parsed.success) {
      const fe = parsed.error.flatten().fieldErrors;
      setErrors(Object.fromEntries(Object.entries(fe).map(([k, v]) => [k, v?.[0]])) as ItemErrors);
      return;
    }
    setErrors({});
    setBusy(true);
    const supabase = createClient();
    const v = parsed.data;
    const payload = {
      name: v.name,
      category: v.category,
      unit: v.pieces_per_pack ? "Piece" : v.unit,
      minimum_stock: v.minimum_stock,
      purchase_price: v.purchase_price,
      supplier: v.supplier || null,
      notes: v.notes || null,
      pack_unit: v.pieces_per_pack ? v.pack_unit || "1 pack" : null,
      pieces_per_pack: v.pieces_per_pack,
      pack_price: v.pieces_per_pack ? v.pack_price : null,
    };
    const { error } = item
      ? await supabase.from("inventory_items").update(payload).eq("id", item.id)
      : await supabase.from("inventory_items").insert({ ...payload, current_stock: v.current_stock });
    setBusy(false);
    if (error) {
      toast.error(errorMessage(error));
      return;
    }
    toast.success(item ? `${v.name} updated` : `${v.name} added to inventory`);
    onOpenChange(false);
    onSaved?.();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{item ? "Edit inventory item" : "Add inventory item"}</DialogTitle>
          <DialogDescription>
            {item
              ? "Stock quantity changes through Restock / Adjust so every change is recorded in history."
              : "Ingredients, supplies and packaging you keep in stock."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-4" noValidate>
          <Field label="Item name" htmlFor="item-name" error={errors.name}>
            <Input id="item-name" value={form.name} onChange={set("name")} aria-invalid={!!errors.name} autoFocus />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Category" error={errors.category}>
              <SimpleSelect
                aria-label="Category"
                value={form.category}
                onChange={(v) => setForm((f) => ({ ...f, category: v }))}
                options={categoryOptions}
              />
            </Field>
            <Field label="Unit of measurement" htmlFor="item-unit" error={errors.unit} hint={packed ? "Counted in pieces" : undefined}>
              <Input id="item-unit" list="unit-suggestions" value={packed ? "Piece" : form.unit} disabled={packed} onChange={set("unit")} />
              <datalist id="unit-suggestions">
                {UNIT_SUGGESTIONS.map((u) => (
                  <option key={u} value={u} />
                ))}
              </datalist>
            </Field>
          </div>
          <div className="grid gap-3 rounded-lg border bg-muted/40 p-3">
            <label className="flex items-start gap-3">
              <Switch checked={packed} onCheckedChange={setPacked} className="mt-0.5" />
              <span>
                <span className="block text-sm font-medium">Bought in packs, sold by the piece?</span>
                <span className="block text-xs text-muted-foreground">
                  {packed
                    ? "Stock is counted in pieces. Buying 3 packs of 29 adds 87 pieces."
                    : `Off: stock and cost are per ${form.unit || "unit"} (e.g. oil per Kg).`}
                </span>
              </span>
            </label>
            {packed && (
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Bought as" htmlFor="item-pack" hint="e.g. 1 kg pack">
                <Input id="item-pack" value={form.pack_unit} placeholder="1 kg pack" onChange={set("pack_unit")} />
              </Field>
              <Field label="Pieces per pack" htmlFor="item-ppp" error={errors.pieces_per_pack} hint="Decimals OK (12.5)">
                <Input
                  id="item-ppp"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="any"
                  value={form.pieces_per_pack}
                  onChange={(e) => {
                    const ppp = e.target.value;
                    setForm((f) => ({
                      ...f,
                      pieces_per_pack: ppp,
                      purchase_price: Number(ppp) > 0 && f.pack_price !== "" ? String(Math.round((Number(f.pack_price) / Number(ppp)) * 10000) / 10000) : f.purchase_price,
                    }));
                  }}
                />
              </Field>
              <Field label="Price per pack (₱)" htmlFor="item-pp" error={errors.pack_price}>
                <Input
                  id="item-pp"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  value={form.pack_price}
                  onChange={(e) => {
                    const price = e.target.value;
                    setForm((f) => ({
                      ...f,
                      pack_price: price,
                      purchase_price: Number(f.pieces_per_pack) > 0 && price !== "" ? String(Math.round((Number(price) / Number(f.pieces_per_pack)) * 10000) / 10000) : f.purchase_price,
                    }));
                  }}
                />
              </Field>
            </div>
            )}
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            {!item && (
              <Field label={packed ? "Initial stock (pieces)" : `Initial stock (${form.unit || "units"})`} htmlFor="item-stock" error={errors.current_stock}>
                <Input id="item-stock" type="number" inputMode="decimal" min={0} step="any" value={form.current_stock} onChange={set("current_stock")} />
              </Field>
            )}
            <Field label="Minimum stock" htmlFor="item-min" error={errors.minimum_stock} hint="Low-stock alert level">
              <Input id="item-min" type="number" inputMode="decimal" min={0} step="any" value={form.minimum_stock} onChange={set("minimum_stock")} />
            </Field>
            <Field
              label={packed ? "Cost per piece (₱)" : `Cost per ${form.unit || "unit"} (₱)`}
              htmlFor="item-price"
              error={errors.purchase_price}
              hint={packed && form.pack_price ? "= price per pack ÷ pieces per pack" : packed ? undefined : `What you pay for 1 ${form.unit || "unit"}`}
            >
              <Input id="item-price" type="number" inputMode="decimal" min={0} step="0.0001" value={form.purchase_price} onChange={set("purchase_price")} />
            </Field>
          </div>
          <Field label="Supplier (optional)" htmlFor="item-supplier">
            <Input id="item-supplier" value={form.supplier} onChange={set("supplier")} />
          </Field>
          <Field label="Notes (optional)" htmlFor="item-notes">
            <Textarea id="item-notes" rows={2} value={form.notes} onChange={set("notes")} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <SubmitButton busy={busy}>{item ? "Save changes" : "Add item"}</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ======================================================================
 * Restock / adjust stock
 * ==================================================================== */
export type StockMode = "restock" | "deduct" | "damaged" | "expired" | "stock_count";

const MODE_INFO: Record<StockMode, { label: string; help: string; qtyLabel: string }> = {
  restock: { label: "Restock (add)", help: "Add stock you bought or received.", qtyLabel: "Quantity to add" },
  deduct: { label: "Deduct / use", help: "Remove stock used outside of recorded sales.", qtyLabel: "Quantity to deduct" },
  damaged: { label: "Damaged", help: "Remove stock that was damaged or spoiled.", qtyLabel: "Quantity damaged" },
  expired: { label: "Expired", help: "Remove stock that expired.", qtyLabel: "Quantity expired" },
  stock_count: { label: "Set counted stock", help: "Set stock to what you physically counted.", qtyLabel: "Counted stock" },
};

export function StockDialog({
  open,
  onOpenChange,
  item,
  defaultMode = "restock",
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item?: InventoryItem | null;
  defaultMode?: StockMode;
  onSaved?: () => void;
}) {
  const { categoriesOf, paymentMethods } = useAppData();
  const expenseCats = categoriesOf("expense");
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [itemId, setItemId] = useState("");
  const [mode, setMode] = useState<StockMode>(defaultMode);
  const [qty, setQty] = useState("");
  const [notes, setNotes] = useState("");
  const [asExpense, setAsExpense] = useState(true);
  const [amount, setAmount] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [payment, setPayment] = useState("Cash");
  const [updateCost, setUpdateCost] = useState(true);
  const [restockBy, setRestockBy] = useState<"packs" | "pieces">("packs");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setMode(defaultMode);
    setQty("");
    setNotes("");
    setAmount("");
    setError(null);
    setAsExpense(true);
    setUpdateCost(true);
    setRestockBy("packs");
    setPayment(paymentMethods[0] ?? "Cash");
    setCategoryId(expenseCats.find((c) => c.is_inventory_purchase)?.id ?? expenseCats[0]?.id ?? "");
    setItemId(item?.id ?? "");
    /* eslint-enable react-hooks/set-state-in-effect */
    if (!item) {
      createClient()
        .from("inventory_items")
        .select("*")
        .order("name")
        .then(({ data }) => setItems((data ?? []) as InventoryItem[]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, item, defaultMode]);

  const selected = item ?? items.find((i) => i.id === itemId) ?? null;
  const ppp = toNumber(selected?.pieces_per_pack);
  // Restocking a pack item: enter packs (stock goes up by packs × pieces per pack) or exact pieces.
  const packMode = mode === "restock" && ppp > 0 && restockBy === "packs";
  const entered = toNumber(qty);
  const q = packMode ? Math.round(entered * ppp * 1000) / 1000 : entered; // pieces / units
  const current = toNumber(selected?.current_stock);
  const resulting =
    mode === "restock" ? current + q : mode === "stock_count" ? q : current - q;
  const suggestedAmount = selected
    ? packMode && toNumber(selected.pack_price) > 0
      ? money(entered * toNumber(selected.pack_price))
      : money(q * toNumber(selected.purchase_price))
    : 0;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return setError("Choose an inventory item.");
    if (qty === "" || !Number.isFinite(Number(qty))) return setError("Enter a quantity.");
    if (mode === "stock_count" ? q < 0 : q <= 0) return setError("Quantity must be greater than zero.");
    const recordExpense = mode === "restock" && asExpense;
    // By packs the last pack price is a fair default; by pieces/kilos it would be an
    // average cost, not what was paid, so the real amount must be typed.
    if (recordExpense && !packMode && amount === "")
      return setError("Type the amount you actually paid (from your receipt).");
    const amt = amount === "" ? suggestedAmount : toNumber(amount);
    if (recordExpense && amt < 0) return setError("Amount can't be negative.");
    setError(null);
    setBusy(true);
    const supabase = createClient();
    const { error: err } = recordExpense
      ? await supabase.rpc("save_expense", {
          p_data: {
            name: selected.name,
            category_id: categoryId || null,
            amount: amt,
            quantity: packMode ? entered : q,
            unit_price: packMode ? (entered > 0 ? money(amt / entered) : null) : q > 0 ? money(amt / q) : null,
            pack_price: packMode && entered > 0 ? money(amt / entered) : null,
            inventory_item_id: selected.id,
            add_to_stock: true,
            stock_quantity: q,
            update_item_cost: updateCost && amt > 0,
            payment_method: payment,
            notes: notes || null,
            expense_date: todayManila(),
          },
        })
      : await supabase.rpc("adjust_stock", {
          p_item_id: selected.id,
          p_type: mode === "deduct" ? "adjustment" : mode,
          p_quantity: mode === "deduct" ? -q : q,
          p_notes: notes || null,
        });
    setBusy(false);
    if (err) return setError(errorMessage(err));
    toast.success(
      recordExpense
        ? `Added ${packMode ? `${formatQty(entered)} pack(s) = ` : ""}${formatQty(q)} ${selected.unit} of ${selected.name} and recorded ${formatPeso(amt)} expense`
        : `${selected.name} stock updated`,
    );
    onOpenChange(false);
    onSaved?.();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{item ? `Update stock · ${item.name}` : "Restock inventory"}</DialogTitle>
          <DialogDescription>{MODE_INFO[mode].help}</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-4" noValidate>
          {!item && (
            <Field label="Inventory item">
              <SimpleSelect
                aria-label="Inventory item"
                value={itemId}
                onChange={setItemId}
                placeholder="Choose an item…"
                options={items.map((i) => ({ value: i.id, label: `${i.name} (${formatQty(i.current_stock)} ${i.unit})` }))}
              />
            </Field>
          )}
          <Field label="Type of change">
            <SimpleSelect
              aria-label="Type of change"
              value={mode}
              onChange={(v) => setMode(v as StockMode)}
              options={(Object.keys(MODE_INFO) as StockMode[]).map((m) => ({ value: m, label: MODE_INFO[m].label }))}
            />
          </Field>
          {mode === "restock" && ppp > 0 && (
            <div className="grid gap-1.5">
              <span className="text-sm font-medium">Restock by</span>
              <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1" role="radiogroup" aria-label="Restock by">
                {(["packs", "pieces"] as const).map((u) => (
                  <button
                    key={u}
                    type="button"
                    role="radio"
                    aria-checked={restockBy === u}
                    onClick={() => {
                      setRestockBy(u);
                      setQty("");
                      setAmount("");
                    }}
                    className={cn(
                      "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                      restockBy === u ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {u === "packs" ? `Packs (${selected?.pack_unit ?? "pack"})` : "Pieces"}
                  </button>
                ))}
              </div>
            </div>
          )}
          <Field
            label={
              packMode
                ? `Packs bought (${selected?.pack_unit ?? "pack"} = ${formatQty(ppp)} pieces)`
                : mode === "restock" && ppp > 0
                  ? "Pieces to add"
                  : `${MODE_INFO[mode].qtyLabel}${selected ? ` (${selected.unit})` : ""}`
            }
            htmlFor="stock-qty"
            hint={
              selected
                ? `${packMode && qty !== "" ? `${formatQty(entered)} × ${formatQty(ppp)} = ${formatQty(q)} pieces · ` : ""}Current: ${formatQty(current)} ${selected.unit} → after: ${qty === "" ? "—" : formatQty(resulting)} ${selected.unit}`
                : undefined
            }
          >
            <Input id="stock-qty" type="number" inputMode="decimal" min={0} step="any" value={qty} onChange={(e) => setQty(e.target.value)} autoFocus />
          </Field>

          {mode === "restock" && (
            <div className="grid gap-3 rounded-lg border bg-muted/40 p-3">
              <label className="flex items-start gap-2.5 text-sm">
                <Checkbox checked={asExpense} onCheckedChange={(c) => setAsExpense(!!c)} className="mt-0.5" />
                <span>
                  <span className="font-medium">Also record this purchase as an expense</span>
                  <span className="block text-xs text-muted-foreground">
                    Records one expense and adds the stock together — no double entry.
                  </span>
                </span>
              </label>
              {asExpense && (
                <>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field
                      label={packMode ? "Amount paid (₱)" : "Amount paid (₱) *"}
                      htmlFor="stock-amount"
                      hint={
                        packMode
                          ? suggestedAmount
                            ? `Leave empty to use ${formatPeso(suggestedAmount)} (last pack price)`
                            : undefined
                          : "Required — type what you paid"
                      }
                    >
                      <Input
                        id="stock-amount"
                        type="number"
                        inputMode="decimal"
                        min={0}
                        step="0.01"
                        required={!packMode}
                        placeholder={packMode && suggestedAmount ? String(suggestedAmount) : "0.00"}
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                      />
                    </Field>
                    <Field label="Payment method">
                      <SimpleSelect aria-label="Payment method" value={payment} onChange={setPayment} options={paymentMethods.map((p) => ({ value: p, label: p }))} />
                    </Field>
                  </div>
                  <Field label="Expense category">
                    <SimpleSelect
                      aria-label="Expense category"
                      value={categoryId}
                      onChange={setCategoryId}
                      options={expenseCats.map((c) => ({ value: c.id, label: c.name }))}
                    />
                  </Field>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={updateCost} onCheckedChange={(c) => setUpdateCost(!!c)} />
                    Update the item&apos;s cost per unit from this purchase
                  </label>
                </>
              )}
            </div>
          )}

          <Field label="Reason / notes (optional)" htmlFor="stock-notes">
            <Input id="stock-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Bought at public market" />
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
            <SubmitButton busy={busy}>Save</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
