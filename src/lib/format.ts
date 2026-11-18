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
