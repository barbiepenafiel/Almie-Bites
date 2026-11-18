"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { errorMessage } from "@/lib/format";
import type { StaffProfile } from "@/lib/types";

interface StaffData {
  profile: StaffProfile | null;
  error: string | null;
  refresh: () => Promise<void>;
}

const Ctx = createContext<StaffData | null>(null);

export function StaffDataProvider({ children }: { children: React.ReactNode }) {
  const [profile, setProfile] = useState<StaffProfile | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const { data, error: err } = await createClient().rpc("staff_profile");
    if (err) setError(errorMessage(err));
    else {
      setProfile(data as StaffProfile);
      setError(null);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  return <Ctx.Provider value={{ profile, error, refresh }}>{children}</Ctx.Provider>;
}

export function useStaffData() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useStaffData must be used inside StaffDataProvider");
  return ctx;
}
