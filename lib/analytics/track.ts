import { getServiceSupabase } from "@/lib/db/supabase";

export function shouldTrackAnalytics(opts: {
  dntHeader?: string | null;
  disabled?: boolean;
}): boolean {
  if (opts.disabled || process.env.ANALYTICS_DISABLED === "true") return false;
  const dnt = opts.dntHeader?.trim().toLowerCase();
  if (dnt === "1" || dnt === "yes") return false;
  return true;
}

export type AnalyticsEvent = {
  name: string;
  props?: Record<string, unknown>;
  merchantId?: string | null;
  sessionId?: string | null;
};

export async function trackServerEvent(event: AnalyticsEvent, dntHeader?: string | null) {
  if (!shouldTrackAnalytics({ dntHeader })) return;

  const payload = {
    ...event.props,
    sessionId: event.sessionId ?? null,
    at: new Date().toISOString()
  };

  try {
    const supabase = getServiceSupabase();
    await supabase.from("events").insert({
      kind: `analytics.${event.name}`,
      merchant: event.merchantId ?? null,
      payload
    });
  } catch {
    console.info(JSON.stringify({ level: "info", type: "analytics", name: event.name, payload }));
  }
}
