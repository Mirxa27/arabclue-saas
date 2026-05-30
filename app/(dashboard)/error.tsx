"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function DashboardError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[dashboard]", error);
  }, [error]);

  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="max-w-md text-center border border-rule p-10">
        <h1 className="font-display text-2xl tracking-crisp">Something went wrong</h1>
        <p className="mt-3 text-sm text-ink-soft">
          {error.message || "An unexpected error occurred. Try again or contact support if this persists."}
        </p>
        <Button className="mt-6" type="button" onClick={reset}>
          Try again
        </Button>
      </div>
    </div>
  );
}
