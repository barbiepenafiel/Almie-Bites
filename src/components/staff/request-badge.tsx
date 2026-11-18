"use client";

import { Ban, CheckCircle2, Clock, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { RequestStatus } from "@/lib/types";

export function RequestStatusBadge({ status }: { status: RequestStatus }) {
  const map = {
    pending: { cls: "border-warning/20 bg-warning-soft text-warning", Icon: Clock, label: "Pending" },
    approved: { cls: "border-success/20 bg-success-soft text-success", Icon: CheckCircle2, label: "Approved" },
    rejected: { cls: "border-danger/20 bg-danger-soft text-danger", Icon: XCircle, label: "Rejected" },
    cancelled: { cls: "", Icon: Ban, label: "Cancelled" },
  }[status];
  return (
    <Badge variant={status === "cancelled" ? "outline" : "default"} className={map.cls}>
      <map.Icon data-icon="inline-start" aria-hidden /> {map.label}
    </Badge>
  );
}
