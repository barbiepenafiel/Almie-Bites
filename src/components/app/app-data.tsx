"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { BusinessSettings, Category, CategoryType } from "@/lib/types";

interface AppData {
  userEmail: string;
  settings: BusinessSettings | null;
  categories: Category[];
  categoriesOf: (type: CategoryType) => Category[];
  paymentMethods: string[];
  loading: boolean;
  setupError: string | null;
  refresh: () => Promise<void>;
}

const AppDataContext = createContext<AppData | null>(null);

const FALLBACK_PAYMENTS = ["Cash", "GCash", "Other"];

export function AppDataProvider({ userEmail, children }: { userEmail: string; children: React.ReactNode }) {
  const [settings, setSettings] = useState<BusinessSettings | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [setupError, setSetupError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const supabase = createClient();
    const first = await supabase.from("business_settings").select("*").maybeSingle();
    const error = first.error;
    let s = first.data;
    if (error) {
      setSetupError(error.message);
      setLoading(false);
      return;
    }
    if (!s) {
      // First visit for an account created before the migration: seed defaults.
      const init = await supabase.rpc("initialize_account");
      if (init.error) {
        setSetupError(init.error.message);
        setLoading(false);
        return;
      }
      ({ data: s } = await supabase.from("business_settings").select("*").maybeSingle());
    }
    const { data: cats } = await supabase
      .from("categories")
      .select("id, name, type, is_inventory_purchase, sort_order")
      .order("sort_order")
      .order("name");
    setSettings(s as BusinessSettings | null);
    setCategories((cats ?? []) as Category[]);
    setSetupError(null);
    setLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  const value = useMemo<AppData>(() => {
    const categoriesOf = (type: CategoryType) => categories.filter((c) => c.type === type);
    const payments = categoriesOf("payment").map((c) => c.name);
    return {
      userEmail,
      settings,
      categories,
      categoriesOf,
      paymentMethods: payments.length ? payments : FALLBACK_PAYMENTS,
      loading,
      setupError,
      refresh,
    };
  }, [userEmail, settings, categories, loading, setupError, refresh]);

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>;
}

export function useAppData() {
  const ctx = useContext(AppDataContext);
  if (!ctx) throw new Error("useAppData must be used inside AppDataProvider");
  return ctx;
}
