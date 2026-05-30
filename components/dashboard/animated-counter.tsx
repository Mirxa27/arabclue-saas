"use client";

import { useState, useEffect, useRef, memo } from "react";
import { cn } from "@/lib/utils";

interface AnimatedCounterProps {
  value: number;
  className?: string;
  duration?: number; // ms
  formatter?: (n: number) => string;
}

export const AnimatedCounter = memo(function AnimatedCounter({
  value,
  className,
  duration = 900,
  formatter = (n) => Math.round(n).toLocaleString("en-US"),
}: AnimatedCounterProps) {
  const [display, setDisplay] = useState(0);
  const raf = useRef<number | null>(null);
  const start = useRef<number>(performance.now());
  const from = useRef<number>(0);

  useEffect(() => {
    from.current = display;
    start.current = performance.now();

    const step = (now: number) => {
      const elapsed = now - start.current;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - (1 - progress) * (1 - progress);
      setDisplay(from.current + (value - from.current) * eased);
      if (progress < 1) {
        raf.current = requestAnimationFrame(step);
      }
    };

    raf.current = requestAnimationFrame(step);
    return () => {
      if (raf.current !== null) cancelAnimationFrame(raf.current);
    };
  }, [value, duration]);

  return (
    <span
      className={cn("tabular-nums", className)}
      aria-label={`${value}`}
    >
      {formatter(display)}
    </span>
  );
});