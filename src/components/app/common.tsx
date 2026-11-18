"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, XCircle, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { StockStatus } from "@/lib/types";

/* ------------------------------------------------------------------ */
export interface Option {
  value: string;
  label: string;
}

export function SimpleSelect({
  value,
  onChange,
  options,
  placeholder = "Select…",
  className,
  id,
  disabled,
  "aria-label": ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Option[];
  placeholder?: string;
  className?: string;
  id?: string;
  disabled?: boolean;
  "aria-label"?: string;
}) {
  return (
    <Select
      value={value || null}
      onValueChange={(v) => onChange((v as string | null) ?? "")}
      items={options}
      disabled={disabled}
    >
      <SelectTrigger id={id} aria-label={ariaLabel} className={cn("w-full min-w-0", className)}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false}>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/* ------------------------------------------------------------------ */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="font-heading text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="no-print flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "default",
  loading,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon?: LucideIcon;
  tone?: "default" | "positive" | "negative" | "warning" | "brand";
  loading?: boolean;
}) {
  const toneIcon = {
    default: "bg-muted text-foreground/70",
    brand: "bg-foreground text-background",
    positive: "bg-muted text-foreground",
    negative: "bg-muted text-foreground",
    warning: "bg-warning-soft text-warning",
  }[tone];
  return (
    <Card size="sm" className="gap-0">
      <CardContent className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          {loading ? (
            <Skeleton className="mt-2 h-7 w-24" />
          ) : (
            <p className="mt-1 truncate text-2xl font-semibold tabular-nums tracking-tight">{value}</p>
          )}
          {hint && !loading && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
        </div>
        {Icon && (
          <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", toneIcon)}>
            <Icon className="size-4.5" aria-hidden />
          </span>
        )}
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 px-4 py-10 text-center", className)}>
      {Icon && (
        <span className="mb-1 flex size-11 items-center justify-center rounded-full bg-secondary text-primary">
          <Icon className="size-5" aria-hidden />
        </span>
      )}
      <p className="font-medium">{title}</p>
      {description && <p className="max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-danger/30 bg-danger-soft px-4 py-6 text-center text-sm">
      <XCircle className="size-5 text-danger" aria-hidden />
      <p className="text-foreground">{message}</p>
      {onRetry && (
        <Button size="sm" variant="outline" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function LoadingRows({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2 p-4" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-9 w-full" />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
export function StockBadge({ status }: { status: StockStatus }) {
  if (status === "out")
    return (
      <Badge className="border-danger/20 bg-danger-soft text-danger">
        <XCircle data-icon="inline-start" aria-hidden /> Out of stock
      </Badge>
    );
  if (status === "low")
    return (
      <Badge className="border-warning/20 bg-warning-soft text-warning">
        <AlertTriangle data-icon="inline-start" aria-hidden /> Low stock
      </Badge>
    );
  return (
    <Badge className="border-success/20 bg-success-soft text-success">
      <CheckCircle2 data-icon="inline-start" aria-hidden /> In stock
    </Badge>
  );
}

/* ------------------------------------------------------------------ */
export function Field({
  label,
  htmlFor,
  error,
  hint,
  children,
  className,
}: {
  label: string;
  htmlFor?: string;
  error?: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("grid gap-1.5", className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Delete",
  destructive = true,
  onConfirm,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: () => Promise<void> | void;
  children?: React.ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <AlertDialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description && <AlertDialogDescription>{description}</AlertDialogDescription>}
        </AlertDialogHeader>
        {children}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant={destructive ? "destructive" : "default"}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
                onOpenChange(false);
              } catch {
                // Keep the dialog open; the caller reports the error.
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy && <Loader2 className="animate-spin" aria-hidden />}
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function SubmitButton({
  busy,
  children,
  ...props
}: React.ComponentProps<typeof Button> & { busy?: boolean }) {
  return (
    <Button type="submit" disabled={busy || props.disabled} {...props}>
      {busy && <Loader2 className="animate-spin" aria-hidden />}
      {children}
    </Button>
  );
}
