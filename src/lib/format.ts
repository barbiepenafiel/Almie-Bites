const peso = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", minimumFractionDigits: 2 });
const pesoCompact = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  notation: "compact",
  maximumFractionDigits: 1,
});
const qty = new Intl.NumberFormat("en-PH", { maximumFractionDigits: 3 });

export function formatPeso(value: number | string | null | undefined): string {
  return peso.format(Number(value ?? 0) || 0);
}

/** Short peso label for chart axes: ₱950, ₱1.2K */
export function formatPesoCompact(value: number | string | null | undefined): string {
  const n = Number(value ?? 0) || 0;
  return Math.abs(n) < 1000 ? `₱${Math.round(n)}` : pesoCompact.format(n);
}

export function formatQty(value: number | string | null | undefined): string {
  return qty.format(Number(value ?? 0) || 0);
}

const UNIT_SHORT: Record<string, [string, string]> = {
  piece: ["pc", "pcs"],
  pack: ["pack", "packs"],
  kg: ["kg", "kg"],
  kilo: ["kg", "kg"],
  gram: ["g", "g"],
  liter: ["L", "L"],
  ml: ["ml", "ml"],
  bottle: ["bottle", "bottles"],
  sachet: ["sachet", "sachets"],
  box: ["box", "boxes"],
  dozen: ["dozen", "dozen"],
  tray: ["tray", "trays"],
};

/**
 * Quantity of an expense with its unit, e.g. "4 packs", "17 pcs", "2.05 kg".
 * A restock entered by packs adds more to stock (pieces) than the quantity
 * typed (packs), which is how packs are told apart from pieces.
 */
export function expenseQtyLabel(
  quantity: number | string | null | undefined,
  stockAdded: number | string | null | undefined,
  unit?: string | null,
): string {
  const q = toNumber(quantity);
  return formatUnitQty(q, expenseUnit(q, stockAdded, unit));
}

/** "pack" for a restock entered by packs, otherwise the item's unit (lower-case), or "" if unknown. */
export function expenseUnit(
  quantity: number | string | null | undefined,
  stockAdded: number | string | null | undefined,
  unit?: string | null,
): string {
  const q = toNumber(quantity);
  const added = toNumber(stockAdded);
  if (added > 0 && Math.abs(added - q) > 0.0005) return "pack";
  return (unit ?? "").trim().toLowerCase();
}

/** e.g. formatUnitQty(4, "pack") → "4 packs", formatUnitQty(2.05, "kg") → "2.05 kg". */
export function formatUnitQty(q: number, unitKey: string): string {
  if (!unitKey) return formatQty(q);
  const short = UNIT_SHORT[unitKey];
  return `${formatQty(q)} ${short ? short[q === 1 ? 0 : 1] : unitKey}`;
}

export interface ExpenseGroup {
  key: string;
  name: string;
  category: string;
  /** e.g. "4 packs + 17 pcs", or "" when no quantities were entered */
  qtyLabel: string;
  entries: number;
  amount: number;
}

/** Combines a day's expenses with the same name and category into one line. */
export function groupExpenses(
  expenses: {
    name: string;
    amount: number | string;
    quantity: number | string | null;
    stock_added: number | string | null;
    categories?: { name: string } | null;
    inventory_items?: { unit: string } | null;
  }[],
): ExpenseGroup[] {
  const groups = new Map<string, ExpenseGroup & { qty: Map<string, number> }>();
  for (const e of expenses) {
    const category = e.categories?.name ?? "Uncategorized";
    const key = `${e.name.trim().toLowerCase()}|${category}`;
    let g = groups.get(key);
    if (!g) {
      g = { key, name: e.name.trim(), category, qtyLabel: "", entries: 0, amount: 0, qty: new Map() };
      groups.set(key, g);
    }
    g.entries += 1;
    g.amount += toNumber(e.amount);
    if (e.quantity != null) {
      const u = expenseUnit(e.quantity, e.stock_added, e.inventory_items?.unit);
      g.qty.set(u, (g.qty.get(u) ?? 0) + toNumber(e.quantity));
    }
  }
  return Array.from(groups.values()).map(({ qty, ...g }) => ({
    ...g,
    amount: Math.round(g.amount * 100) / 100,
    qtyLabel: Array.from(qty, ([u, n]) => formatUnitQty(Math.round(n * 1000) / 1000, u)).join(" + "),
  }));
}

export function toNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Round to 2 decimals without float drift. */
export function money(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Turn a Supabase/Postgres error into a friendly message. */
export function errorMessage(err: unknown, fallback = "Something went wrong. Please try again."): string {
  if (!err) return fallback;
  const e = err as { message?: string; code?: string };
  if (e.code === "23505") return "That name already exists. Please use a different name.";
  if (e.code === "23503") {
    if (e.message?.includes("product_recipes"))
      return "This item is used in a product recipe. Remove it from those recipes first.";
    return "This record is linked to other records and can't be removed.";
  }
  if (e.code === "42501") return "You don't have permission to do that. Please sign in again.";
  if (e.code === "PGRST202")
    return "Database functions are missing. Run the Supabase migrations (see README).";
  if (e.code === "42P01" || e.code === "PGRST205")
    return "Database tables are missing. Run the Supabase migrations (see README).";
  if (e.message?.includes("Failed to fetch")) return "Can't reach the server. Check your internet connection.";
  return e.message || fallback;
}

/** CSV export helper (UTF-8 BOM so Excel shows ₱ correctly). */
export function downloadCsv(filename: string, headers: string[], rows: (string | number | null | undefined)[][]) {
  const esc = (v: string | number | null | undefined) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [headers, ...rows].map((r) => r.map(esc).join(",")).join("\r\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** "2 packs + 5 pcs" for pack items, otherwise "63 Piece". */
export function formatPacks(qty: number | string | null | undefined, piecesPerPack?: number | null, unit = "pcs"): string {
  const q = Number(qty ?? 0) || 0;
  const ppp = Number(piecesPerPack ?? 0) || 0;
  if (ppp <= 0) return `${formatQty(q)} ${unit}`;
  const packs = Math.floor(q / ppp + 1e-9);
  const rest = Math.round((q - packs * ppp) * 1000) / 1000;
  if (!packs) return `${formatQty(rest)} pcs`;
  return `${packs} pack${packs === 1 ? "" : "s"}${rest > 0 ? ` + ${formatQty(rest)} pcs` : ""}`;
}
