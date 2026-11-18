"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Boxes,
  History,
  MoreHorizontal,
  PackagePlus,
  Pencil,
  Plus,
  Search,
  SlidersHorizontal,
  Trash2,
  Wallet,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ConfirmDialog,
  EmptyState,
  ErrorState,
  LoadingRows,
  PageHeader,
  SimpleSelect,
  StatCard,
  StockBadge,
} from "@/components/app/common";
import { InventoryItemDialog, StockDialog, type StockMode } from "@/components/inventory/inventory-dialogs";
import { MovementHistory } from "@/components/inventory/movement-history";
import { useAppData } from "@/components/app/app-data";
import { unwrap, useQuery } from "@/hooks/use-query";
import { createClient } from "@/lib/supabase/client";
import { errorMessage, formatPeso, formatQty } from "@/lib/format";
import { formatDate, toManilaDate } from "@/lib/dates";
import { stockStatus, type InventoryItem } from "@/lib/types";

type SortKey = "name" | "quantity" | "price" | "value" | "updated" | "created";

export function InventoryView() {
  const { categoriesOf } = useAppData();
  const [tab, setTab] = useState("items");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [status, setStatus] = useState("all");
  const [sort, setSort] = useState<SortKey>("name");

  const [editing, setEditing] = useState<InventoryItem | null>(null);
  const [itemOpen, setItemOpen] = useState(false);
  const [stockItem, setStockItem] = useState<InventoryItem | null>(null);
  const [stockMode, setStockMode] = useState<StockMode>("restock");
  const [stockOpen, setStockOpen] = useState(false);
  const [deleting, setDeleting] = useState<InventoryItem | null>(null);
  const [historyItem, setHistoryItem] = useState<string>("all");

  const { data, error, loading, reload } = useQuery(
    async (sb) => unwrap(await sb.from("inventory_items").select("*").order("name")) as InventoryItem[],
    [],
    { realtime: ["inventory_items"] },
  );
  const items = useMemo(() => data ?? [], [data]);

  const stats = useMemo(() => {
    let low = 0,
      out = 0,
      value = 0;
    for (const i of items) {
      const s = stockStatus(i);
      if (s === "low") low++;
      if (s === "out") out++;
      value += Number(i.stock_value);
    }
    return { low, out, value };
  }, [items]);

  const categoryOptions = useMemo(() => {
    const names = new Set([...categoriesOf("inventory").map((c) => c.name), ...items.map((i) => i.category)]);
    return [{ value: "all", label: "All categories" }, ...[...names].sort().map((n) => ({ value: n, label: n }))];
  }, [categoriesOf, items]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const list = items.filter(
      (i) =>
        (!term || i.name.toLowerCase().includes(term) || (i.supplier ?? "").toLowerCase().includes(term)) &&
        (category === "all" || i.category === category) &&
        (status === "all" || stockStatus(i) === status),
    );
    const by: Record<SortKey, (a: InventoryItem, b: InventoryItem) => number> = {
      name: (a, b) => a.name.localeCompare(b.name),
      quantity: (a, b) => Number(a.current_stock) - Number(b.current_stock),
      price: (a, b) => Number(b.purchase_price) - Number(a.purchase_price),
      value: (a, b) => Number(b.stock_value) - Number(a.stock_value),
      updated: (a, b) => b.updated_at.localeCompare(a.updated_at),
      created: (a, b) => b.created_at.localeCompare(a.created_at),
    };
    return [...list].sort(by[sort]);
  }, [items, search, category, status, sort]);

  function openStock(item: InventoryItem | null, mode: StockMode) {
    setStockItem(item);
    setStockMode(mode);
    setStockOpen(true);
  }

  async function deleteItem(item: InventoryItem) {
    const { error: err } = await createClient().from("inventory_items").delete().eq("id", item.id);
    if (err) {
      toast.error(errorMessage(err));
      throw err;
    }
    toast.success(`${item.name} deleted`);
    reload();
  }

  return (
    <>
      <PageHeader
        title="Inventory"
        description="Ingredients, supplies and packaging — with live stock levels."
        actions={
          <>
            <Button variant="outline" onClick={() => openStock(null, "restock")}>
              <PackagePlus /> Restock
            </Button>
            <Button
              onClick={() => {
                setEditing(null);
                setItemOpen(true);
              }}
            >
              <Plus /> Add item
            </Button>
          </>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Items tracked" value={items.length} icon={Boxes} tone="brand" loading={loading && !data} />
        <StatCard label="Low stock" value={stats.low} icon={AlertTriangle} tone="warning" loading={loading && !data} />
        <StatCard label="Out of stock" value={stats.out} icon={XCircle} tone="negative" loading={loading && !data} />
        <StatCard label="Inventory value" value={formatPeso(stats.value)} icon={Wallet} tone="positive" loading={loading && !data} hint="Stock × cost per unit" />
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as string)}>
        <TabsList>
          <TabsTrigger value="items">
            <Boxes /> Items
          </TabsTrigger>
          <TabsTrigger value="history">
            <History /> Stock history
          </TabsTrigger>
        </TabsList>

        <TabsContent value="items">
          <Card className="gap-0 py-0">
            <div className="flex flex-col gap-2 border-b p-3 md:flex-row md:items-center">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search items or suppliers…"
                  aria-label="Search inventory"
                  className="pl-8"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <div className="grid grid-cols-3 gap-2 md:flex">
                <SimpleSelect aria-label="Category filter" className="md:w-44" value={category} onChange={setCategory} options={categoryOptions} />
                <SimpleSelect
                  aria-label="Stock status filter"
                  className="md:w-36"
                  value={status}
                  onChange={setStatus}
                  options={[
                    { value: "all", label: "All status" },
                    { value: "in", label: "In stock" },
                    { value: "low", label: "Low stock" },
                    { value: "out", label: "Out of stock" },
                  ]}
                />
                <SimpleSelect
                  aria-label="Sort by"
                  className="md:w-40"
                  value={sort}
                  onChange={(v) => setSort(v as SortKey)}
                  options={[
                    { value: "name", label: "Sort: Name" },
                    { value: "quantity", label: "Sort: Lowest stock" },
                    { value: "price", label: "Sort: Highest cost" },
                    { value: "value", label: "Sort: Highest value" },
                    { value: "updated", label: "Sort: Last updated" },
                    { value: "created", label: "Sort: Date added" },
                  ]}
                />
              </div>
            </div>

            {error ? (
              <div className="p-4">
                <ErrorState message={error} onRetry={reload} />
              </div>
            ) : loading && !data ? (
              <LoadingRows rows={8} />
            ) : filtered.length === 0 ? (
              <EmptyState
                icon={Boxes}
                title={items.length ? "No items match your filters" : "No inventory items yet"}
                description={items.length ? "Try a different search or filter." : "Add the ingredients and supplies you use."}
                action={
                  !items.length && (
                    <Button onClick={() => setItemOpen(true)}>
                      <Plus /> Add item
                    </Button>
                  )
                }
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-4">Item</TableHead>
                    <TableHead className="hidden md:table-cell">Category</TableHead>
                    <TableHead className="text-right">Stock</TableHead>
                    <TableHead className="hidden text-right sm:table-cell">Min.</TableHead>
                    <TableHead className="hidden text-right lg:table-cell">Cost / unit</TableHead>
                    <TableHead className="hidden text-right lg:table-cell">Value</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="hidden xl:table-cell">Updated</TableHead>
                    <TableHead className="w-10 pr-4">
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((i) => (
                    <TableRow key={i.id}>
                      <TableCell className="pl-4">
                        <div className="font-medium">{i.name}</div>
                        <div className="text-xs text-muted-foreground">
                          <span className="md:hidden">{i.category} · </span>
                          {i.pieces_per_pack ? `${formatQty(i.pieces_per_pack)} pcs per ${i.pack_unit ?? "pack"}` : i.supplier ? `Supplier: ${i.supplier}` : i.unit}
                        </div>
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground md:table-cell">{i.category}</TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {formatQty(i.current_stock)} <span className="text-xs font-normal text-muted-foreground">{i.unit}</span>
                      </TableCell>
                      <TableCell className="hidden text-right tabular-nums text-muted-foreground sm:table-cell">
                        {formatQty(i.minimum_stock)}
                      </TableCell>
                      <TableCell className="hidden text-right tabular-nums lg:table-cell">{formatPeso(i.purchase_price)}</TableCell>
                      <TableCell className="hidden text-right tabular-nums lg:table-cell">{formatPeso(i.stock_value)}</TableCell>
                      <TableCell>
                        <StockBadge status={stockStatus(i)} />
                      </TableCell>
                      <TableCell className="hidden text-xs text-muted-foreground xl:table-cell">
                        {formatDate(toManilaDate(i.updated_at))}
                      </TableCell>
                      <TableCell className="pr-4">
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={
                              <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${i.name}`}>
                                <MoreHorizontal />
                              </Button>
                            }
                          />
                          <DropdownMenuContent align="end" className="w-48">
                            <DropdownMenuItem onClick={() => openStock(i, "restock")}>
                              <PackagePlus /> Restock
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => openStock(i, "deduct")}>
                              <SlidersHorizontal /> Adjust stock
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => {
                                setHistoryItem(i.id);
                                setTab("history");
                              }}
                            >
                              <History /> View history
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() => {
                                setEditing(i);
                                setItemOpen(true);
                              }}
                            >
                              <Pencil /> Edit details
                            </DropdownMenuItem>
                            <DropdownMenuItem variant="destructive" onClick={() => setDeleting(i)}>
                              <Trash2 /> Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="history">
          <MovementHistory items={items} itemId={historyItem} onItemChange={setHistoryItem} />
        </TabsContent>
      </Tabs>

      <InventoryItemDialog open={itemOpen} onOpenChange={setItemOpen} item={editing} onSaved={reload} />
      <StockDialog open={stockOpen} onOpenChange={setStockOpen} item={stockItem} defaultMode={stockMode} onSaved={reload} />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete ${deleting?.name ?? "item"}?`}
        description="This removes the item and its stock history. Past sales and expenses stay, but lose the link to this item. Items used in product recipes can't be deleted."
        onConfirm={() => (deleting ? deleteItem(deleting) : undefined)}
      />
    </>
  );
}
