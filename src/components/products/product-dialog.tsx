"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Field, SimpleSelect, SubmitButton } from "@/components/app/common";
import { useAppData } from "@/components/app/app-data";
import { createClient } from "@/lib/supabase/client";
import { errorMessage, formatPeso, formatQty, money, toNumber } from "@/lib/format";
import type { InventoryItem, Product } from "@/lib/types";

export function ProductDialog({
  open,
  onOpenChange,
  product,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product?: Product | null;
  onSaved?: () => void;
}) {
  const { categoriesOf } = useAppData();
  const productCats = categoriesOf("product");
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [price, setPrice] = useState("");
  const [description, setDescription] = useState("");
  const [available, setAvailable] = useState(true);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [itemId, setItemId] = useState("");
  const [perSale, setPerSale] = useState("1");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setErrors({});
    setName(product?.name ?? "");
    setCategory(product?.category ?? productCats[0]?.name ?? "Snacks");
    setPrice(product ? String(product.selling_price) : "");
    setDescription(product?.description ?? "");
    setAvailable(product?.is_available ?? true);
    const link = product?.product_recipes?.[0];
    setItemId(link?.inventory_item_id ?? "");
    setPerSale(link ? String(Number(link.quantity_used)) : "1");
    /* eslint-enable react-hooks/set-state-in-effect */
    createClient()
      .from("inventory_items")
      .select("*")
      .order("name")
      .then(({ data }) => setItems((data ?? []) as InventoryItem[]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, product]);

  const linkedItem = items.find((i) => i.id === itemId) ?? null;
  const cost = linkedItem ? money(toNumber(linkedItem.purchase_price) * toNumber(perSale)) : 0;
  const profit = money(toNumber(price) - cost);

  const categoryOptions = useMemo(() => {
    const names = productCats.map((c) => c.name);
    if (category && !names.includes(category)) names.push(category);
    return names.map((n) => ({ value: n, label: n }));
  }, [productCats, category]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = "Product name is required.";
    if (price === "" || !Number.isFinite(Number(price)) || Number(price) < 0) errs.price = "Enter a selling price of ₱0 or more.";
    if (itemId && !(toNumber(perSale) > 0)) errs.perSale = "Must be more than 0.";
    setErrors(errs);
    if (Object.keys(errs).length) return;

    setBusy(true);
    const { error } = await createClient().rpc("save_product", {
      p_data: { name: name.trim(), category, description, selling_price: Number(price), is_available: available },
      p_recipe: itemId ? [{ inventory_item_id: itemId, quantity_used: toNumber(perSale) }] : [],
      p_product_id: product?.id ?? null,
    });
    setBusy(false);
    if (error) {
      toast.error(errorMessage(error));
      return;
    }
    toast.success(product ? `${name.trim()} updated` : `${name.trim()} added`);
    onOpenChange(false);
    onSaved?.();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{product ? "Edit product" : "Add product"}</DialogTitle>
          <DialogDescription>Products are what you sell. Link one to an inventory item to deduct pieces on every sale.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Product name" htmlFor="p-name" error={errors.name}>
              <Input id="p-name" value={name} onChange={(e) => setName(e.target.value)} aria-invalid={!!errors.name} autoFocus />
            </Field>
            <Field label="Selling price (₱)" htmlFor="p-price" error={errors.price}>
              <Input
                id="p-price"
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                aria-invalid={!!errors.price}
              />
            </Field>
            <Field label="Category">
              <SimpleSelect aria-label="Product category" value={category} onChange={setCategory} options={categoryOptions} />
            </Field>
            <div className="flex items-end">
              <label className="flex h-8 items-center gap-2.5 text-sm">
                <Switch checked={available} onCheckedChange={setAvailable} />
                Available for sale
              </label>
            </div>
          </div>
          <div className="grid gap-3 rounded-lg border bg-muted/40 p-3">
            <div>
              <p className="text-sm font-medium">Sold from inventory</p>
              <p className="text-xs text-muted-foreground">Each sale deducts pieces from this item and records their cost.</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
              <Field label="Inventory item">
                <SimpleSelect
                  aria-label="Inventory item"
                  value={itemId}
                  onChange={setItemId}
                  placeholder="Not linked (stock stays the same)"
                  options={[
                    { value: "", label: "Not linked (stock stays the same)" },
                    ...items.map((i) => ({ value: i.id, label: `${i.name} · ${formatQty(i.current_stock)} ${i.unit} left` })),
                  ]}
                />
              </Field>
              <Field label="Pieces per sale" htmlFor="p-per" error={errors.perSale}>
                <Input id="p-per" type="number" inputMode="decimal" min={0} step="any" disabled={!itemId} value={perSale} onChange={(e) => setPerSale(e.target.value)} />
              </Field>
            </div>
            {linkedItem && (
              <div className="grid grid-cols-3 gap-2 text-center text-sm">
                <div>
                  <p className="text-[11px] text-muted-foreground">Cost per sale</p>
                  <p className="font-medium tabular-nums">{formatPeso(cost)}</p>
                </div>
                <div>
                  <p className="text-[11px] text-muted-foreground">Gross profit</p>
                  <p className={`font-medium tabular-nums ${profit < 0 ? "text-danger" : ""}`}>{formatPeso(profit)}</p>
                </div>
                <div>
                  <p className="text-[11px] text-muted-foreground">Margin</p>
                  <p className="font-medium tabular-nums">{toNumber(price) > 0 ? Math.round((profit / toNumber(price)) * 100) : 0}%</p>
                </div>
              </div>
            )}
          </div>
          <Field label="Description (optional)" htmlFor="p-desc">
            <Textarea id="p-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <SubmitButton busy={busy}>{product ? "Save changes" : "Add product"}</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
