"use client";

import { CalendarDays } from "lucide-react";
import { Input } from "@/components/ui/input";
import { SimpleSelect } from "@/components/app/common";
import { PRESET_LABELS, rangeForPreset, todayManila, type DateRange, type RangePreset } from "@/lib/dates";

const DEFAULT_PRESETS: RangePreset[] = ["today", "yesterday", "week", "last7", "month", "last30", "custom"];

export function DateRangeFilter({
  value,
  onChange,
  presets = DEFAULT_PRESETS,
}: {
  value: DateRange;
  onChange: (range: DateRange) => void;
  presets?: RangePreset[];
}) {
  const today = todayManila();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-2">
        <CalendarDays className="size-4 text-muted-foreground" aria-hidden />
        <SimpleSelect
          aria-label="Date range"
          className="w-40"
          value={value.preset}
          onChange={(p) => {
            const preset = p as RangePreset;
            onChange(preset === "custom" ? { ...value, preset } : rangeForPreset(preset));
          }}
          options={presets.map((p) => ({ value: p, label: PRESET_LABELS[p] }))}
        />
      </div>
      {value.preset === "custom" && (
        <div className="flex items-center gap-1.5">
          <Input
            type="date"
            aria-label="Start date"
            className="h-8 w-[9.5rem]"
            value={value.start}
            max={value.end || today}
            onChange={(e) => e.target.value && onChange({ ...value, start: e.target.value })}
          />
          <span className="text-muted-foreground">to</span>
          <Input
            type="date"
            aria-label="End date"
            className="h-8 w-[9.5rem]"
            value={value.end}
            min={value.start}
            onChange={(e) => e.target.value && onChange({ ...value, end: e.target.value })}
          />
        </div>
      )}
    </div>
  );
}
