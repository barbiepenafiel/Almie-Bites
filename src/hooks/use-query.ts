"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { errorMessage } from "@/lib/format";

interface Options {
  /** Tables whose changes should trigger a refetch (Supabase Realtime). */
  realtime?: string[];
  enabled?: boolean;
  /** Refetch when the tab regains focus (used where Realtime isn't available, e.g. staff). */
  refetchOnFocus?: boolean;
  /** Also refetch every N ms while the tab is visible. */
  pollMs?: number;
}

/**
 * Minimal data-fetching hook: loading / error state, manual reload,
 * and optional live refresh when the listed tables change.
 */
export function useQuery<T>(
  fetcher: (supabase: SupabaseClient) => Promise<T>,
  deps: unknown[],
  { realtime, enabled = true, refetchOnFocus = false, pollMs }: Options = {},
) {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [version, setVersion] = useState(0);
  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  const reload = useCallback(() => setVersion((v) => v + 1), []);

  // One stable key instead of spreading `deps`, so the effect's dependency
  // list always has the same length (deps are simple values: strings/numbers).
  const depsKey = JSON.stringify(deps);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- show loading while refetching
    setLoading(true);
    fetcherRef
      .current(createClient())
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(errorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [depsKey, version, enabled]);

  useEffect(() => {
    if (!refetchOnFocus || !enabled) return;
    const onFocus = () => {
      if (document.visibilityState === "visible") setVersion((v) => v + 1);
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [refetchOnFocus, enabled]);

  useEffect(() => {
    if (!pollMs || !enabled) return;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") setVersion((v) => v + 1);
    }, pollMs);
    return () => clearInterval(id);
  }, [pollMs, enabled]);

  const tablesKey = realtime?.join(",") ?? "";
  useEffect(() => {
    if (!tablesKey || !enabled) return;
    const supabase = createClient();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const channel = supabase.channel(`live:${tablesKey}:${Math.random().toString(36).slice(2)}`);
    for (const table of tablesKey.split(",")) {
      channel.on("postgres_changes", { event: "*", schema: "public", table }, () => {
        clearTimeout(timer);
        timer = setTimeout(() => setVersion((v) => v + 1), 400);
      });
    }
    channel.subscribe();
    return () => {
      clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [tablesKey, enabled]);

  return { data, error, loading, reload, setData };
}

/** Throws the Supabase error if present, otherwise returns data. */
export function unwrap<T>(res: { data: T | null; error: unknown }): T {
  if (res.error) throw res.error;
  return res.data as T;
}
