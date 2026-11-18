"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ImageUp, Pencil, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ConfirmDialog, ErrorState, Field, LoadingRows, PageHeader, StockBadge, SubmitButton } from "@/components/app/common";
import { useAppData } from "@/components/app/app-data";
import { unwrap, useQuery } from "@/hooks/use-query";
import { createClient } from "@/lib/supabase/client";
import { errorMessage, formatQty } from "@/lib/format";
import { stockStatus, type Category, type CategoryType, type InventoryItem } from "@/lib/types";
import { BrandLogo } from "@/components/app/brand-logo";

export function SettingsView() {
  const [tab, setTab] = useState("business");
  return (
    <>
      <PageHeader title="Settings" description="Business profile, stock alerts, categories and payment methods." />
      <Tabs value={tab} onValueChange={(v) => setTab(v as string)}>
        <TabsList className="h-auto! flex-wrap">
          <TabsTrigger value="business">Business</TabsTrigger>
          <TabsTrigger value="stock">Low-stock thresholds</TabsTrigger>
          <TabsTrigger value="categories">Categories</TabsTrigger>
          <TabsTrigger value="payments">Payment methods</TabsTrigger>
        </TabsList>
        <TabsContent value="business">
          <BusinessSettings />
        </TabsContent>
        <TabsContent value="stock">
          <StockSettings />
        </TabsContent>
        <TabsContent value="categories">
          <div className="grid gap-6 lg:grid-cols-3">
            <CategoryManager type="product" title="Product categories" description="Used to group the products you sell." />
            <CategoryManager type="inventory" title="Inventory categories" description="Used to group ingredients and supplies." />
            <CategoryManager
              type="expense"
              title="Expense categories"
              description="Tick “stock purchase” for categories that buy inventory — they count as Inventory Purchases in summaries."
            />
          </div>
        </TabsContent>
        <TabsContent value="payments">
          <div className="max-w-md">
            <CategoryManager type="payment" title="Payment methods" description="Shown when recording sales and expenses." />
          </div>
        </TabsContent>
      </Tabs>
    </>
  );
}

/* ------------------------------------------------------------------ */
function BusinessSettings() {
  const { settings, refresh, userEmail } = useAppData();
  const [form, setForm] = useState({ business_name: "", owner_name: "", phone: "", email: "", address: "", currency_symbol: "₱" });
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!settings) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setForm({
      business_name: settings.business_name,
      owner_name: settings.owner_name ?? "",
      phone: settings.phone ?? "",
      email: settings.email ?? "",
      address: settings.address ?? "",
      currency_symbol: settings.currency_symbol,
    });
  }, [settings]);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form.business_name.trim()) return toast.error("Business name is required.");
    setBusy(true);
    const { error } = await createClient()
      .from("business_settings")
      .update({
        business_name: form.business_name.trim(),
        owner_name: form.owner_name.trim() || null,
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
        address: form.address.trim() || null,
      })
      .eq("owner_id", settings!.owner_id);
    setBusy(false);
    if (error) return toast.error(errorMessage(error));
    toast.success("Business profile saved");
    await refresh();
  }

  async function uploadLogo(file: File) {
    if (file.size > 2 * 1024 * 1024) return toast.error("Logo must be 2 MB or smaller.");
    setUploading(true);
    const sb = createClient();
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() || "png";
      const path = `${settings!.owner_id}/logo-${Date.now()}.${ext}`;
      const up = await sb.storage.from("branding").upload(path, file, { contentType: file.type, upsert: true });
      if (up.error) throw up.error;
      const url = sb.storage.from("branding").getPublicUrl(path).data.publicUrl;
      const { error } = await sb.from("business_settings").update({ logo_url: url }).eq("owner_id", settings!.owner_id);
      if (error) throw error;
      toast.success("Logo updated");
      await refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setUploading(false);
    }
  }

  async function removeLogo() {
    const { error } = await createClient().from("business_settings").update({ logo_url: null }).eq("owner_id", settings!.owner_id);
    if (error) return toast.error(errorMessage(error));
    toast.success("Logo removed");
    await refresh();
  }

  if (!settings) return <LoadingRows rows={5} />;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
      <Card>
        <CardHeader>
          <CardTitle>Business profile</CardTitle>
          <CardDescription>Shown in the sidebar, dashboard and printed reports.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={save} className="grid gap-4">
            <Field label="Business name" htmlFor="b-name">
              <Input id="b-name" value={form.business_name} onChange={set("business_name")} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Owner name" htmlFor="b-owner">
                <Input id="b-owner" value={form.owner_name} onChange={set("owner_name")} />
              </Field>
              <Field label="Phone" htmlFor="b-phone">
                <Input id="b-phone" type="tel" value={form.phone} onChange={set("phone")} />
              </Field>
              <Field label="Business email" htmlFor="b-email" hint={`Signed in as ${userEmail}`}>
                <Input id="b-email" type="email" value={form.email} onChange={set("email")} />
              </Field>
              <Field label="Currency" hint="All amounts are shown in Philippine Peso.">
                <Input value="Philippine Peso (₱ PHP)" disabled />
              </Field>
            </div>
            <Field label="Address" htmlFor="b-address">
              <Textarea id="b-address" rows={2} value={form.address} onChange={set("address")} />
            </Field>
            <div>
              <SubmitButton busy={busy}>Save profile</SubmitButton>
            </div>
          </form>
        </CardContent>
      </Card>
      <Card className="h-fit">
        <CardHeader>
          <CardTitle>Business logo</CardTitle>
          <CardDescription>Square PNG or JPG, up to 2 MB.</CardDescription>
        </CardHeader>
        <CardContent className="grid justify-items-center gap-3">
          <BrandLogo src={settings.logo_url} size={112} className="border" />
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void uploadLogo(f);
              e.target.value = "";
            }}
          />
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
              <ImageUp /> {uploading ? "Uploading…" : "Upload logo"}
            </Button>
            {settings.logo_url && (
              <Button variant="ghost" size="sm" onClick={removeLogo}>
                Remove
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */
function StockSettings() {
  const { settings, refresh } = useAppData();
  const [defaultMin, setDefaultMin] = useState("");
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const { data, error, loading, reload } = useQuery(
    async (sb) => unwrap(await sb.from("inventory_items").select("*").order("name")) as InventoryItem[],
    [],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (settings) setDefaultMin(String(settings.default_min_stock));
  }, [settings]);

  async function saveGeneral(patch: { default_min_stock?: number; allow_negative_stock?: boolean }) {
    const { error: err } = await createClient().from("business_settings").update(patch).eq("owner_id", settings!.owner_id);
    if (err) return toast.error(errorMessage(err));
    toast.success("Stock settings saved");
    await refresh();
  }

  async function saveThresholds() {
    const changes = Object.entries(edits).filter(([id, v]) => {
      const item = data?.find((i) => i.id === id);
      return item && v !== "" && Number(v) >= 0 && Number(v) !== Number(item.minimum_stock);
    });
    if (!changes.length) return toast.info("No changes to save");
    setBusy(true);
    const sb = createClient();
    const results = await Promise.all(changes.map(([id, v]) => sb.from("inventory_items").update({ minimum_stock: Number(v) }).eq("id", id)));
    setBusy(false);
    const failed = results.find((r) => r.error);
    if (failed) toast.error(errorMessage(failed.error));
    else toast.success(`Updated ${changes.length} threshold${changes.length === 1 ? "" : "s"}`);
    setEdits({});
    reload();
  }

  if (!settings) return <LoadingRows rows={5} />;

  return (
    <div className="grid gap-6 lg:grid-cols-[20rem_1fr]">
      <Card className="h-fit">
        <CardHeader>
          <CardTitle>Defaults</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-5">
          <Field label="Default minimum stock for new items" htmlFor="def-min">
            <div className="flex gap-2">
              <Input id="def-min" type="number" min={0} step="any" value={defaultMin} onChange={(e) => setDefaultMin(e.target.value)} />
              <Button
                variant="outline"
                onClick={() => {
                  const n = Number(defaultMin);
                  if (defaultMin === "" || !Number.isFinite(n) || n < 0) return toast.error("Enter 0 or more.");
                  void saveGeneral({ default_min_stock: n });
                }}
              >
                Save
              </Button>
            </div>
          </Field>
          <label className="flex items-start gap-3 text-sm">
            <Switch checked={settings.allow_negative_stock} onCheckedChange={(v) => saveGeneral({ allow_negative_stock: v })} className="mt-0.5" />
            <span>
              <span className="font-medium">Allow selling more pieces than in stock</span>
              <span className="block text-xs text-muted-foreground">
                Off (recommended): a sale is blocked when a product&apos;s inventory item doesn&apos;t have enough pieces. Turn on only to
                authorize selling before the stock is recorded; stock goes negative until you restock or count.
              </span>
            </span>
          </label>
        </CardContent>
      </Card>
      <Card className="gap-0 py-0">
        <CardHeader className="border-b py-4">
          <CardTitle>Item thresholds</CardTitle>
          <CardDescription>An item shows “Low stock” when its stock is at or below its minimum.</CardDescription>
        </CardHeader>
        {error ? (
          <div className="p-4">
            <ErrorState message={error} onRetry={reload} />
          </div>
        ) : loading && !data ? (
          <LoadingRows rows={6} />
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Item</TableHead>
                  <TableHead className="text-right">Current stock</TableHead>
                  <TableHead className="w-36">Minimum</TableHead>
                  <TableHead className="pr-4">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(data ?? []).map((i) => {
                  const v = edits[i.id] ?? String(i.minimum_stock);
                  return (
                    <TableRow key={i.id}>
                      <TableCell className="pl-4 font-medium">{i.name}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatQty(i.current_stock)} <span className="text-xs text-muted-foreground">{i.unit}</span>
                      </TableCell>
                      <TableCell>
                        <Input
                          aria-label={`Minimum stock for ${i.name}`}
                          type="number"
                          min={0}
                          step="any"
                          className="h-8"
                          value={v}
                          onChange={(e) => setEdits((ed) => ({ ...ed, [i.id]: e.target.value }))}
                        />
                      </TableCell>
                      <TableCell className="pr-4">
                        <StockBadge status={stockStatus({ current_stock: i.current_stock, minimum_stock: v === "" ? 0 : Number(v) })} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <div className="flex justify-end gap-2 border-t p-3">
              {Object.keys(edits).length > 0 && (
                <Button variant="ghost" onClick={() => setEdits({})}>
                  Discard
                </Button>
              )}
              <Button onClick={saveThresholds} disabled={busy || !Object.keys(edits).length}>
                Save thresholds
              </Button>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */
function CategoryManager({ type, title, description }: { type: CategoryType; title: string; description: string }) {
  const { categoriesOf, refresh } = useAppData();
  const list = categoriesOf(type);
  const [name, setName] = useState("");
  const [isInv, setIsInv] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [deleting, setDeleting] = useState<Category | null>(null);
  const [busy, setBusy] = useState(false);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    setBusy(true);
    const { error } = await createClient()
      .from("categories")
      .insert({ name: n, type, is_inventory_purchase: type === "expense" && isInv, sort_order: list.length + 1 });
    setBusy(false);
    if (error) return toast.error(errorMessage(error));
    toast.success(`"${n}" added`);
    setName("");
    setIsInv(false);
    await refresh();
  }

  async function rename(c: Category) {
    const n = editName.trim();
    if (!n || n === c.name) return setEditingId(null);
    const sb = createClient();
    const { error } = await sb.from("categories").update({ name: n }).eq("id", c.id);
    if (error) return toast.error(errorMessage(error));
    // Product and inventory categories are stored by name on records; keep them in sync.
    if (type === "product") await sb.from("products").update({ category: n }).eq("category", c.name);
    if (type === "inventory") await sb.from("inventory_items").update({ category: n }).eq("category", c.name);
    toast.success("Renamed");
    setEditingId(null);
    await refresh();
  }

  async function toggleInv(c: Category, v: boolean) {
    const { error } = await createClient().from("categories").update({ is_inventory_purchase: v }).eq("id", c.id);
    if (error) return toast.error(errorMessage(error));
    await refresh();
  }

  async function remove(c: Category) {
    const { error } = await createClient().from("categories").delete().eq("id", c.id);
    if (error) {
      toast.error(errorMessage(error));
      throw error;
    }
    toast.success(`"${c.name}" removed`);
    await refresh();
  }

  return (
    <Card className="h-fit">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <ul className="divide-y rounded-lg border">
          {list.length === 0 && <li className="p-3 text-center text-sm text-muted-foreground">None yet</li>}
          {list.map((c) => (
            <li key={c.id} className="flex items-center gap-2 px-3 py-2">
              {editingId === c.id ? (
                <>
                  <Input
                    aria-label="Category name"
                    className="h-7 flex-1"
                    value={editName}
                    autoFocus
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void rename(c);
                      if (e.key === "Escape") setEditingId(null);
                    }}
                  />
                  <Button size="icon-xs" variant="ghost" aria-label="Save" onClick={() => rename(c)}>
                    <Check />
                  </Button>
                  <Button size="icon-xs" variant="ghost" aria-label="Cancel" onClick={() => setEditingId(null)}>
                    <X />
                  </Button>
                </>
              ) : (
                <>
                  <span className="flex-1 truncate text-sm">{c.name}</span>
                  {type === "expense" && (
                    <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <Checkbox checked={c.is_inventory_purchase} onCheckedChange={(v) => toggleInv(c, !!v)} />
                      Stock purchase
                    </label>
                  )}
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label={`Rename ${c.name}`}
                    onClick={() => {
                      setEditingId(c.id);
                      setEditName(c.name);
                    }}
                  >
                    <Pencil />
                  </Button>
                  <Button size="icon-xs" variant="ghost" aria-label={`Delete ${c.name}`} onClick={() => setDeleting(c)}>
                    <Trash2 />
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
        <form onSubmit={add} className="grid gap-2">
          <div className="flex gap-2">
            <Input aria-label={`New ${title.toLowerCase()}`} placeholder="Add new…" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
            <Button type="submit" variant="outline" disabled={busy || !name.trim()}>
              <Plus /> Add
            </Button>
          </div>
          {type === "expense" && (
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <Checkbox checked={isInv} onCheckedChange={(v) => setIsInv(!!v)} />
              This category is for stock / inventory purchases
            </label>
          )}
        </form>
      </CardContent>
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Remove "${deleting?.name ?? ""}"?`}
        description={
          type === "expense"
            ? "Existing expenses in this category will become Uncategorized."
            : "Existing records keep their current value; it just won't be offered as an option anymore."
        }
        confirmLabel="Remove"
        onConfirm={() => (deleting ? remove(deleting) : undefined)}
      />
    </Card>
  );
}
