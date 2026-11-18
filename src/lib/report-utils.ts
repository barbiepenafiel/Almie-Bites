import type { SupabaseClient } from "@supabase/supabase-js";
import { formatDate, startOfMonth, startOfWeek } from "@/lib/dates";
import { money, toNumber } from "@/lib/format";
import type {
  RecoveryRow,
  StaffDailyRow,
  StaffProductRow,
  StaffReportRow,
  DailyReportRow,
  ExpenseCategoryReportRow,
  PaymentReportRow,
  ProductReportRow,
} from "@/lib/types";

const num = <T extends object>(row: T): T =>
  Object.fromEntries(
    Object.entries(row).map(([k, v]) => [k, typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v]),
  ) as T;

async function rpc<T extends object>(sb: SupabaseClient, fn: string, start: string, end: string): Promise<T[]> {
  const { data, error } = await sb.rpc(fn, { p_start: start, p_end: end });
  if (error) throw error;
  return ((data ?? []) as T[]).map(num);
}

export const fetchDaily = (sb: SupabaseClient, s: string, e: string) => rpc<DailyReportRow>(sb, "report_daily", s, e);
export const fetchProducts = (sb: SupabaseClient, s: string, e: string) => rpc<ProductReportRow>(sb, "report_products", s, e);
export const fetchPayments = (sb: SupabaseClient, s: string, e: string) => rpc<PaymentReportRow>(sb, "report_payments", s, e);
export const fetchStaffReport = (sb: SupabaseClient, s: string, e: string) => rpc<StaffReportRow>(sb, "report_staff", s, e);
export const fetchStaffDaily = (sb: SupabaseClient, s: string, e: string) => rpc<StaffDailyRow>(sb, "report_staff_daily", s, e);
export async function fetchStaffProductReport(sb: SupabaseClient, s: string, e: string, staffId: string | null) {
  const { data, error } = await sb.rpc("report_staff_products", { p_start: s, p_end: e, p_staff_id: staffId });
  if (error) throw error;
  return ((data ?? []) as StaffProductRow[]).map(num);
}
export async function fetchRecovery(sb: SupabaseClient, asOf: string | null = null, activeOnly = false) {
  const { data, error } = await sb.rpc("report_recovery", { p_as_of: asOf, p_active_only: activeOnly });
  if (error) {
    if (error.code === "PGRST202") return []; // migration not applied yet
    throw error;
  }
  return ((data ?? []) as RecoveryRow[]).map(num);
}
/** Earliest date used for "all time" staff balances. */
export const ALL_TIME_START = "2020-01-01";
export const fetchExpenseCategories = (sb: SupabaseClient, s: string, e: string) =>
  rpc<ExpenseCategoryReportRow>(sb, "report_expense_categories", s, e);

export interface Totals {
  sales: number;
  transactions: number;
  items: number;
  cogs: number;
  expenses: number;
  inventoryPurchases: number;
  otherExpenses: number;
  voided: number;
  profit: number;
  /** Sales − ingredient cost of what was sold − non-inventory expenses */
  actualProfit: number;
  averageSale: number;
}

export function totalsOf(rows: DailyReportRow[]): Totals {
  const t = rows.reduce(
    (a, r) => ({
      sales: a.sales + toNumber(r.sales_total),
      transactions: a.transactions + toNumber(r.transactions),
      items: a.items + toNumber(r.items_sold),
      cogs: a.cogs + toNumber(r.cost_of_goods),
      expenses: a.expenses + toNumber(r.expenses_total),
      inventoryPurchases: a.inventoryPurchases + toNumber(r.inventory_purchases),
      otherExpenses: a.otherExpenses + toNumber(r.other_expenses),
      voided: a.voided + toNumber(r.voided_count),
    }),
    { sales: 0, transactions: 0, items: 0, cogs: 0, expenses: 0, inventoryPurchases: 0, otherExpenses: 0, voided: 0 },
  );
  return {
    ...t,
    sales: money(t.sales),
    expenses: money(t.expenses),
    profit: money(t.sales - t.expenses),
    actualProfit: money(t.sales - t.cogs - t.otherExpenses),
    averageSale: t.transactions ? money(t.sales / t.transactions) : 0,
  };
}

export type Grouping = "day" | "week" | "month";

export interface PeriodRow {
  key: string;
  label: string;
  start: string;
  sales: number;
  expenses: number;
  profit: number;
  transactions: number;
  items: number;
  cogs: number;
  inventoryPurchases: number;
  otherExpenses: number;
}

export function groupRows(rows: DailyReportRow[], by: Grouping): PeriodRow[] {
  const map = new Map<string, PeriodRow>();
  for (const r of rows) {
    const key = by === "day" ? r.day : by === "week" ? startOfWeek(r.day) : startOfMonth(r.day);
    const label =
      by === "day"
        ? formatDate(r.day, { month: "short", day: "numeric" })
        : by === "week"
          ? `Wk of ${formatDate(key, { month: "short", day: "numeric" })}`
          : formatDate(key, { month: "short", year: "numeric" });
    const p =
      map.get(key) ??
      ({ key, label, start: key, sales: 0, expenses: 0, profit: 0, transactions: 0, items: 0, cogs: 0, inventoryPurchases: 0, otherExpenses: 0 } as PeriodRow);
    p.sales += toNumber(r.sales_total);
    p.expenses += toNumber(r.expenses_total);
    p.transactions += toNumber(r.transactions);
    p.items += toNumber(r.items_sold);
    p.cogs += toNumber(r.cost_of_goods);
    p.inventoryPurchases += toNumber(r.inventory_purchases);
    p.otherExpenses += toNumber(r.other_expenses);
    p.profit = money(p.sales - p.expenses);
    map.set(key, p);
  }
  return [...map.values()].map((p) => ({ ...p, sales: money(p.sales), expenses: money(p.expenses) }));
}

export function autoGrouping(days: number): Grouping {
  if (days > 120) return "month";
  if (days > 45) return "week";
  return "day";
}
