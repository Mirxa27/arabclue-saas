"use client";

import { memo } from "react";
import { cn } from "@/lib/utils";

type Status = "healthy" | "degraded" | "critical" | "inactive";

interface PulseIndicatorProps {
  status: Status;
  size?: "sm" | "md";
  className?: string;
}

const statusConfig: Record<
  Status,
  { ring: string; core: string; label: string }
> = {
  healthy: {
    ring: "bg-emerald-500/30",
    core: "bg-emerald-500",
    label: "Online",
  },
  degraded: {
    ring: "bg-amber-500/30",
    core: "bg-amber-500",
    label: "Degraded",
  },
  critical: {
    ring: "bg-red-500/30",
    core: "bg-red-500",
    label: "Critical",
  },
  inactive: {
    ring: "bg-ink-mute/20",
    core: "bg-ink-mute",
    label: "Offline",
  },
};

export const PulseIndicator = memo(function PulseIndicator({
  status,
  size = "md",
  className,
}: PulseIndicatorProps) {
  const { ring, core } = statusConfig[status];
  const dim = size === "sm" ? "w-2 h-2" : "w-3 h-3";
  const ringDim = size === "sm" ? "w-3 h-3" : "w-5 h-5";

  return (
    <span
      className={cn("relative flex items-center justify-center", className)}
      role="status"
      aria-label={statusConfig[status].label}
    >
      {/* Animated ripple ring */}
      <span
        className={cn(
          "absolute rounded-full animate-pulse-ring",
          ringDim,
          ring
        )}
        aria-hidden="true"
      />
      {/* Static core dot */}
      <span className={cn("relative rounded-full z-10", dim, core)} />
    </span>
  );
});
