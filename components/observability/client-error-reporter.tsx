"use client";

import { useEffect } from "react";

function postClientError(payload: Record<string, unknown>) {
  fetch("/api/observability/client-error", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  }).catch(() => undefined);
}

export function ClientErrorReporter() {
  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      postClientError({
        message: event.message || "Client error",
        stack: event.error instanceof Error ? event.error.stack : undefined,
        url: window.location.href,
        component: "window.error"
      });
    };

    const onRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      postClientError({
        message: reason instanceof Error ? reason.message : String(reason),
        stack: reason instanceof Error ? reason.stack : undefined,
        url: window.location.href,
        component: "unhandledrejection"
      });
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return null;
}
