"use client";

function sessionId(): string {
  if (typeof window === "undefined") return "ssr";
  const key = "arabclue_sid";
  let id = sessionStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem(key, id);
  }
  return id;
}

export function trackClientEvent(name: string, props?: Record<string, unknown>) {
  if (typeof navigator !== "undefined" && navigator.doNotTrack === "1") return;

  fetch("/api/analytics/track", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, props, sessionId: sessionId() })
  }).catch(() => undefined);
}
