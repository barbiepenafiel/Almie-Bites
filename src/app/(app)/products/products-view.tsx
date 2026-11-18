"use client";

import { useMemo, useState } from "react";
import { ChefHat, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle, CardDescription, CardAction } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { ConfirmDialog, EmptyState, ErrorState, LoadingRows, PageHeader, SimpleSelect } from "@/components/app/common";
import { ProductDialog } from "@/components/products/product-dialog";
import { useAppData } from "@/components/app/app-data";
import { unwrap, useQuery } from "@/hooks/use-query";
import { createClient } from "@/lib/supabase/client";
import { errorMessage, formatPeso, formatQty, money, toNumber } from "@/lib/format";
import type { Product } from "@/lib/types";

export function ProductsView() {
  const { categoriesOf } = useAppData();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [availability, setAvailability] = useState("all");
  const [editing, setEditing] = useState<Product | null>(null);
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState<Product | null>(null);

  const { data, error, loading, reload, setData } = useQuery(
    async (sb) =>
      unwrap(
        await sb
          .from("products")
          .select("*, product_recipes(id, inventory_item_id, quantity_used, inventory_items(id, name, unit, purchase_price, current_stock))")
          .order("name"),
      ) as Product[],
    [],
    { realtime: ["products", "inventory_items"] },
  );
  const products = useMemo(() => data ?? [], [data]);

  const categoryOptions = useMemo(() => {
    const names = new Set([...categoriesOf("product").map((c) => c.name), ...products.map((p) => p.category)]);
    return [{ value: "all", label: "All categories" }, ...[...names].sort().map((n) => ({ value: n, label: n }))];
  }, [categoriesOf, products]);

  const filtered = products.filter(
    (p) =>
      (!search.trim() || p.name.toLowerCase().includes(search.trim().toLowerCase())) &&
      (category === "all" || p.category === category) &&
      (availability === "all" || String(p.is_available) === availability),
  );

  async function toggleAvailable(p: Product, value: boolean) {
    setData((list) => list?.map((x) => (x.id === p.id ? { ...x, is_available: value } : x)));
    const { error: err } = await createClient().from("products").update({ is_available: value }).eq("id", p.id);
    if (err) {
      toast.error(errorMessage(err));
      reload();
    } else toast.success(`${p.name} is now ${value ? "available" : "unavailable"}`);
  }

  async function remove(p: Product) {
    const { error: err } = await createClient().from("products").delete().eq("id", p.id);
    if (err) {
      toast.error(errorMessage(err));
      throw err;
    }
    toast.success(`${p.name} deleted`);
    reload();
  }

  return (
    <>
      <PageHeader
        title="Products"
        description="What you sell and its price."
        actions={
          <Button
            onClick={() => {
              setEditing(null);
              setOpen(true);
            }}
          >
            <Plus /> Add product
          </Button>
        }
      />

      <div className="mb-4 flex flex-col gap-2 md:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search products…" aria-label="Search products" className="bg-card pl-8" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-2 md:flex">
          <SimpleSelect aria-label="Category" className="bg-card md:w-44" value={category} onChange={setCategory} options={categoryOptions} />
          <SimpleSelect
            aria-label="Availability"
            className="bg-card md:w-40"
            value={availability}
            onChange={setAvailability}
            options={[
              { value: "all", label: "All products" },
              { value: "true", label: "Available" },
              { value: "false", label: "Unavailable" },
            ]}
          />
        </div>
      </div>

      {error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : loading && !data ? (
        <Card>
          <LoadingRows rows={6} />
        </Card>
      ) : filtered.length === 0 ? (
        <Card>
          <EmptyState
            icon={ChefHat}
            title={products.length ? "No products match your filters" : "No products yet"}
            description={products.length ? "Try a different search." : "Add the snacks and drinks you sell."}
            action={
              !products.length && (
                <Button onClick={() => setOpen(true)}>
                  <Plus /> Add product
                </Button>
              )
            }
          />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((p) => {
            const link = p.product_recipes?.[0];
            const linked = link?.inventory_items;
            const cost = link && linked ? money(toNumber(link.quantity_used) * toNumber(linked.purchase_price)) : null;
            const profit = cost !== null ? money(toNumber(p.selling_price) - cost) : null;
            const canSell = link && linked ? Math.floor(toNumber(linked.current_stock) / toNumber(link.quantity_used)) : null;
            return (
              <Card key={p.id} className={p.is_available ? "" : "opacity-70"}>
                <CardHeader>
                  <CardTitle className="text-base">{p.name}</CardTitle>
                  <CardDescription>
                    {p.category}
                    {!p.is_available && " · Unavailable"}
                  </CardDescription>
                  <CardAction>
                    <span className="font-heading text-xl font-semibold text-primary tabular-nums">{formatPeso(p.selling_price)}</span>
                  </CardAction>
                </CardHeader>
                <CardContent className="grid gap-3">
                  {link && linked && cost !== null && profit !== null && (
                    <div className="grid gap-2">
                      <div className="grid grid-cols-3 gap-2 rounded-lg bg-muted/50 p-2 text-center">
                        <div>
                          <p className="text-[11px] text-muted-foreground">Cost</p>
                          <p className="text-sm font-medium tabular-nums">{formatPeso(cost)}</p>
                        </div>
                        <div>
                          <p className="text-[11px] text-muted-foreground">Gross profit</p>
                          <p className={`text-sm font-medium tabular-nums ${profit < 0 ? "text-danger" : ""}`}>{formatPeso(profit)}</p>
                        </div>
                        <div>
                          <p className="text-[11px] text-muted-foreground">Margin</p>
                          <p className="text-sm font-medium tabular-nums">
                            {toNumber(p.selling_price) > 0 ? Math.round((profit / toNumber(p.selling_price)) * 100) : 0}%
                          </p>
                        </div>
                      </div>
                      <p className={`text-xs ${canSell !== null && canSell <= 0 ? "text-danger" : "text-muted-foreground"}`}>
                        Sold from {linked.name} ({formatQty(link.quantity_used)} {linked.unit.toLowerCase()} each) ·{" "}
                        {canSell !== null && canSell <= 0 ? "out of stock" : `${formatQty(canSell)} available`}
                      </p>
                    </div>
                  )}
                  {p.description ? (
                    <p className="line-clamp-2 text-sm text-muted-foreground">{p.description}</p>
                  ) : (
                    <p className="text-sm text-muted-foreground/70">No description</p>
                  )}
                </CardContent>
                <CardFooter className="mt-auto justify-between border-t py-3">
                  <label className="flex items-center gap-2 text-xs">
                    <Switch size="sm" checked={p.is_available} onCheckedChange={(v) => toggleAvailable(p, v)} aria-label={`${p.name} available`} />
                    Available
                  </label>
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setEditing(p);
                        setOpen(true);
                      }}
                    >
                      <Pencil /> Edit
                    </Button>
                    <Button size="icon-sm" variant="ghost" aria-label={`Delete ${p.name}`} onClick={() => setDeleting(p)}>
                      <Trash2 />
                    </Button>
                  </div>
                </CardFooter>
              </Card>
            );
          })}
        </div>
      )}

      <ProductDialog open={open} onOpenChange={setOpen} product={editing} onSaved={reload} />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete ${deleting?.name ?? "product"}?`}
        description="The product will be removed. Past sales keep the product name. Tip: switch it to Unavailable instead if you may sell it again."
        onConfirm={() => (deleting ? remove(deleting) : undefined)}
      />
    </>
  );
}
