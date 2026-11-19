import type { SupabaseClient } from "@supabase/supabase-js";
import { formatPeso } from "@/lib/format";
import type { EarningType, PayTier, StaffSaleRecord, StaffSellableProduct, StaffSummary } from "@/lib/types";

const n = (v: unknown) => Number(v ?? 0) || 0;

export const DEFAULT_TIERS: PayTier[] = [
  { min_sales: 2000, pay: 250 },
  { min_sales: 5000, pay: 500 },
];

export function sortTiers(tiers: PayTier[] | null | undefined): PayTier[] {
  return [...(tiers ?? [])].map((t) => ({ min_sales: n(t.min_sales), pay: n(t.pay) })).sort((a, b) => a.min_sales - b.min_sales);
}

/** Pay for a day's total sales: the highest tier reached (not added together). */
export function tierPay(tiers: PayTier[] | null | undefined, sales: number): number {
  let pay = 0;
  for (const t of sortTiers(tiers)) if (sales >= t.min_sales) pay = t.pay;
  return pay;
}

/** The next tier above the given sales, if any. */
export function nextTier(tiers: PayTier[] | null | undefined, sales: number): PayTier | null {
  return sortTiers(tiers).find((t) => t.min_sales > sales) ?? null;
}

export function describeTiers(tiers: PayTier[] | null | undefined) {
  const list = sortTiers(tiers);
  if (!list.length) return "no pay tiers set";
  return list.map((t) => `${formatPeso(t.pay)} at ${formatPeso(t.min_sales)}+`).join(", ");
}

export function describeEarning(s: { earning_type: EarningType; commission_rate: number; rate_per_item: number; pay_tiers?: PayTier[] | null }) {
  if (s.earning_type === "manual") return "Your pay is what the owner gives you (recorded as payments)";
  if (s.earning_type === "daily_tier") return `Daily pay from your total sales: ${describeTiers(s.pay_tiers)}`;
  if (s.earning_type === "after_recovery")
    return `${n(s.commission_rate)}% of sales after each product's expense is recovered`;
  if (s.earning_type === "profit_share") return `${n(s.commission_rate)}% of the profit on what you sell (sales minus cost)`;
  if (s.earning_type === "percentage") return `${n(s.commission_rate)}% of every sale you make`;
  if (s.earning_type === "per_item") return `${formatPeso(s.rate_per_item)} for every item you sell`;
  return "A set amount for each product you sell";
}

export async function fetchStaffSummary(sb: SupabaseClient, start: string, end: string): Promise<StaffSummary> {
  const { data, error } = await sb.rpc("staff_summary", { p_start: start, p_end: end });
  if (error) throw error;
  const s = data as StaffSummary;
  return {
    ...s,
    transactions: n(s.transactions),
    items_sold: n(s.items_sold),
    sales_total: n(s.sales_total),
    earnings: n(s.earnings),
    earned_total: n(s.earned_total),
    paid_total: n(s.paid_total),
    unpaid: n(s.unpaid),
    products: (s.products ?? []).map((p) => ({ ...p, quantity: n(p.quantity), sales_total: n(p.sales_total), earnings: n(p.earnings) })),
    days: (s.days ?? []).map((d) => ({ ...d, transactions: n(d.transactions), items_sold: n(d.items_sold), sales_total: n(d.sales_total), earnings: n(d.earnings) })),
  };
}

export async function fetchStaffSales(sb: SupabaseClient, start: string, end: string, limit = 100): Promise<StaffSaleRecord[]> {
  const { data, error } = await sb.rpc("staff_sales", { p_start: start, p_end: end, p_limit: limit });
  if (error) throw error;
  return ((data ?? []) as StaffSaleRecord[]).map((s) => ({
    ...s,
    total_amount: n(s.total_amount),
    total_staff_earnings: n(s.total_staff_earnings),
    items: (s.items ?? []).map((i) => ({ ...i, quantity: n(i.quantity), unit_price: n(i.unit_price), subtotal: n(i.subtotal), earning: n(i.earning) })),
  }));
}

export async function fetchStaffProducts(sb: SupabaseClient): Promise<StaffSellableProduct[]> {
  const { data, error } = await sb.rpc("staff_products");
  if (error) throw error;
  return ((data ?? []) as StaffSellableProduct[]).map((p) => ({
    ...p,
    selling_price: n(p.selling_price),
    earning_per_item: n(p.earning_per_item),
    available_qty: p.available_qty === null || p.available_qty === undefined ? null : n(p.available_qty),
    assigned_qty: p.assigned_qty === null || p.assigned_qty === undefined ? null : n(p.assigned_qty),
    remaining_qty: p.remaining_qty === null || p.remaining_qty === undefined ? null : n(p.remaining_qty),
    sold_today: n(p.sold_today),
    sales_today: n(p.sales_today),
    is_daily: !!p.is_daily,
  }));
}

/** Most a staff member can still sell of a product today (null = no limit). */
export function maxSellable(p: StaffSellableProduct): number | null {
  const limits = [p.available_qty, p.remaining_qty].filter((v): v is number => v !== null);
  return limits.length ? Math.max(0, Math.min(...limits)) : null;
}

/** Product is sellable right now: available, in stock, and assigned quantity left. */
export function canSell(p: StaffSellableProduct) {
  const max = maxSellable(p);
  return p.is_available && (max === null || max > 0);
}
