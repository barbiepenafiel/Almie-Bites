export type CategoryType = "product" | "inventory" | "expense" | "payment";

export interface BusinessSettings {
  owner_id: string;
  business_name: string;
  logo_url: string | null;
  currency: string;
  currency_symbol: string;
  default_min_stock: number;
  allow_negative_stock: boolean;
  owner_name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
}

export interface Category {
  id: string;
  name: string;
  type: CategoryType;
  is_inventory_purchase: boolean;
  sort_order: number;
}

export interface InventoryItem {
  id: string;
  name: string;
  category: string;
  unit: string;
  current_stock: number;
  minimum_stock: number;
  purchase_price: number;
  stock_value: number;
  /** e.g. "1 kg pack"; set when the item is bought in packs and sold by the piece */
  pack_unit: string | null;
  /** estimated pieces per pack (decimals allowed, e.g. 12.5) */
  pieces_per_pack: number | null;
  /** last purchase price per pack */
  pack_price: number | null;
  supplier: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface RecipeLine {
  id?: string;
  inventory_item_id: string;
  quantity_used: number;
  inventory_items?: Pick<InventoryItem, "id" | "name" | "unit" | "purchase_price" | "current_stock"> | null;
}

export interface Product {
  id: string;
  name: string;
  category: string;
  description: string | null;
  selling_price: number;
  is_available: boolean;
  created_at: string;
  updated_at: string;
  product_recipes?: RecipeLine[];
}

export interface SaleItem {
  id: string;
  sale_id: string;
  product_id: string | null;
  product_name: string;
  quantity: number;
  unit_price: number;
  subtotal: number;
  unit_cost: number;
}

export interface Sale {
  id: string;
  transaction_number: string;
  total_amount: number;
  total_cost: number;
  payment_method: string;
  status: "completed" | "voided";
  void_reason: string | null;
  voided_at: string | null;
  notes: string | null;
  sold_at: string;
  created_at: string;
  staff_id?: string | null;
  total_staff_earnings?: number;
  staff?: { id: string; full_name: string } | null;
  sale_items?: SaleItem[];
}

export interface Expense {
  id: string;
  name: string;
  category_id: string | null;
  amount: number;
  quantity: number | null;
  unit_price: number | null;
  inventory_item_id: string | null;
  stock_added: number;
  payment_method: string;
  notes: string | null;
  receipt_path: string | null;
  expense_date: string;
  created_at: string;
  categories?: Pick<Category, "id" | "name" | "is_inventory_purchase"> | null;
  inventory_items?: Pick<InventoryItem, "id" | "name" | "unit"> | null;
}

export type MovementType =
  | "initial"
  | "purchase"
  | "restock"
  | "sale"
  | "sale_reversal"
  | "adjustment"
  | "stock_count"
  | "damaged"
  | "expired"
  | "expense_reversal";

export interface InventoryMovement {
  id: string;
  inventory_item_id: string;
  movement_type: MovementType;
  quantity: number;
  previous_stock: number;
  new_stock: number;
  sale_id: string | null;
  expense_id: string | null;
  reference_id: string | null;
  notes: string | null;
  unit_cost?: number | null;
  created_at: string;
  inventory_items?: Pick<InventoryItem, "id" | "name" | "unit"> | null;
  sales?: Pick<Sale, "id" | "transaction_number"> | null;
  expenses?: Pick<Expense, "id" | "name"> | null;
}

export interface DailyReportRow {
  day: string;
  sales_total: number;
  transactions: number;
  items_sold: number;
  cost_of_goods: number;
  expenses_total: number;
  inventory_purchases: number;
  other_expenses: number;
  voided_count: number;
}

export interface ProductReportRow {
  product_id: string | null;
  product_name: string;
  category: string;
  quantity: number;
  revenue: number;
  cost: number;
  transactions: number;
}

export interface PaymentReportRow {
  payment_method: string;
  transactions: number;
  total: number;
}

export interface ExpenseCategoryReportRow {
  category_id: string | null;
  category_name: string;
  is_inventory_purchase: boolean;
  entries: number;
  total: number;
}

export type StockStatus = "in" | "low" | "out";

export function stockStatus(item: Pick<InventoryItem, "current_stock" | "minimum_stock">): StockStatus {
  const s = Number(item.current_stock);
  if (s <= 0) return "out";
  if (s <= Number(item.minimum_stock)) return "low";
  return "in";
}

export const MOVEMENT_LABELS: Record<MovementType, string> = {
  initial: "Initial stock",
  purchase: "Stock purchase",
  restock: "Restock",
  sale: "Sale deduction",
  sale_reversal: "Sale reversal",
  adjustment: "Manual adjustment",
  stock_count: "Stock count",
  damaged: "Damaged",
  expired: "Expired",
  expense_reversal: "Purchase reversal",
};

/* ------------------------------------------------------------------ */
/* Staff                                                              */
/* ------------------------------------------------------------------ */
export type EarningType = "daily_tier" | "profit_share" | "after_recovery" | "percentage" | "per_item" | "per_product";

export interface PayTier {
  min_sales: number;
  pay: number;
}

export const EARNING_TYPE_LABELS: Record<EarningType, string> = {
  daily_tier: "Daily pay based on total sales",
  profit_share: "Percentage of gross profit (sales − cost)",
  after_recovery: "Commission after the expense is recovered",
  percentage: "Percentage of sales",
  per_item: "Fixed amount per item sold",
  per_product: "Different amount per product",
};

export interface Staff {
  id: string;
  user_id: string | null;
  full_name: string;
  staff_code: string | null;
  email: string | null;
  phone: string | null;
  is_active: boolean;
  earning_type: EarningType;
  commission_rate: number;
  rate_per_item: number;
  pay_tiers: PayTier[];
  payout_method: string;
  notes: string | null;
  created_at: string;
  staff_product_assignments?: { product_id: string; earning_rate: number }[];
}

export interface StaffReportRow {
  staff_id: string;
  full_name: string;
  staff_code: string | null;
  is_active: boolean;
  earning_type: EarningType;
  transactions: number;
  items_sold: number;
  sales_total: number;
  earnings: number;
  earned_total: number;
  paid_total: number;
  unpaid: number;
}

export interface StaffDailyRow {
  day: string;
  staff_id: string;
  transactions: number;
  items_sold: number;
  sales_total: number;
  earnings: number;
}

export interface StaffProductRow {
  staff_id: string;
  product_name: string;
  quantity: number;
  sales_total: number;
  earnings: number;
}

export interface StaffPayment {
  id: string;
  staff_id: string;
  amount: number;
  payment_method: string;
  payment_date: string;
  period_start: string | null;
  period_end: string | null;
  notes: string | null;
  created_at: string;
  staff?: Pick<Staff, "id" | "full_name"> | null;
}

/** What a staff login sees about itself (from staff_profile()). */
export interface StaffProfile {
  id: string;
  full_name: string;
  staff_code: string | null;
  email: string | null;
  phone: string | null;
  earning_type: EarningType;
  commission_rate: number;
  rate_per_item: number;
  pay_tiers: PayTier[];
  created_at: string;
  business_name: string;
  logo_url: string | null;
  payment_methods: string[];
}

export interface StaffSellableProduct {
  product_id: string;
  name: string;
  category: string;
  description: string | null;
  selling_price: number;
  is_available: boolean;
  earning_per_item: number;
  /** what inventory can still make (null = not linked to inventory) */
  available_qty: number | null;
  /** today's assigned quantity (null = no limit) */
  assigned_qty: number | null;
  sold_today: number;
  sales_today: number;
  /** what this staff member can still sell today (null = no limit) */
  remaining_qty: number | null;
  /** true when today's list comes from a daily assignment */
  is_daily: boolean;
}

export interface StaffSummary {
  transactions: number;
  items_sold: number;
  sales_total: number;
  earnings: number;
  earned_total: number;
  paid_total: number;
  unpaid: number;
  products: { product_name: string; quantity: number; sales_total: number; earnings: number }[];
  days: { day: string; transactions: number; items_sold: number; sales_total: number; earnings: number }[];
}

export interface StaffSaleRecord {
  id: string;
  transaction_number: string;
  sold_at: string;
  payment_method: string;
  status: "completed" | "voided";
  notes: string | null;
  total_amount: number;
  total_staff_earnings: number;
  items: { product_name: string; quantity: number; unit_price: number; subtotal: number; earning: number }[];
}

/* ------------------------------------------------------------------ */
/* Expense recovery targets                                           */
/* ------------------------------------------------------------------ */
export type RecoveryScope = "day" | "batch" | "purchase";
export type RecoveryStatus = "not_recovered" | "partial" | "recovered" | "exceeded";

export const RECOVERY_SCOPE_LABELS: Record<RecoveryScope, string> = {
  day: "One day",
  batch: "Batch (until closed)",
  purchase: "Specific purchase",
};

export const RECOVERY_STATUS_LABELS: Record<RecoveryStatus, string> = {
  not_recovered: "Not yet recovered",
  partial: "Partially recovered",
  recovered: "Fully recovered",
  exceeded: "Sales exceed target",
};

export interface RecoveryRow {
  target_id: string;
  product_id: string;
  product_name: string;
  scope: RecoveryScope;
  start_date: string;
  end_date: string | null;
  expense_id: string | null;
  expense_name: string | null;
  expense_date: string | null;
  assigned_expense: number;
  target_amount: number;
  sales_total: number;
  recovered: number;
  remaining: number;
  above_target: number;
  percent: number;
  status: RecoveryStatus;
  is_open: boolean;
  notes: string | null;
}

/* ------------------------------------------------------------------ */
/* Daily assignments                                                  */
/* ------------------------------------------------------------------ */
export interface DailyAssignmentRow {
  staff_id: string;
  staff_name: string;
  product_id: string;
  product_name: string;
  source: "daily" | "regular" | "unassigned";
  assigned_qty: number | null;
  sold_qty: number;
  sales_total: number;
  remaining_qty: number | null;
  inventory_left: number | null;
  zero_sales: boolean;
}

/* ------------------------------------------------------------------ */
/* Supply requests                                                    */
/* ------------------------------------------------------------------ */
export type RequestStatus = "pending" | "approved" | "rejected" | "cancelled";

export interface RequestableItem {
  id: string;
  name: string;
  category: string;
  unit: string;
  pack_unit: string | null;
  pieces_per_pack: number | null;
}

export interface StaffRequest {
  id: string;
  item_name: string;
  unit: string;
  pack_unit: string | null;
  pieces_per_pack: number | null;
  quantity: number;
  approved_quantity: number | null;
  status: RequestStatus;
  notes: string | null;
  admin_note: string | null;
  added_to_assignment: boolean;
  created_at: string;
  decided_at: string | null;
}

export interface SupplyRequest {
  id: string;
  staff_id: string;
  inventory_item_id: string;
  quantity: number;
  notes: string | null;
  status: RequestStatus;
  approved_quantity: number | null;
  admin_note: string | null;
  expense_id: string | null;
  added_to_assignment: boolean;
  decided_at: string | null;
  created_at: string;
  staff?: { id: string; full_name: string } | null;
  inventory_items?: Pick<InventoryItem, "id" | "name" | "unit" | "pack_unit" | "pieces_per_pack" | "purchase_price" | "pack_price" | "current_stock"> | null;
}
