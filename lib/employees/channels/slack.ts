/**
 * Slack adapter — used by ops / engineering / chief-of-staff employees.
 */

import { createHmac, timingSafeEqual } from "crypto";

export type SlackCredentials = {
  bot_token: string;          // xoxb-...
  signing_secret?: string;
  default_channel?: string;   // e.g. "#standup"
};

export async function sendSlackMessage(
  creds: SlackCredentials,
  channel: string,
  text: string,
  blocks?: unknown[]
): Promise<{ ts: string }> {
  if (!creds.bot_token) throw new Error("Slack: bot_token missing");
  const res = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      "content-type": "application/json; charset=utf-8",
      authorization: `Bearer ${creds.bot_token}`
    },
    body: JSON.stringify({ channel, text, blocks })
  });
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; ts?: string; error?: string };
  if (!json.ok) throw new Error(`Slack send failed: ${json.error ?? res.statusText}`);
  return { ts: json.ts ?? "" };
}

export function verifySlackSignature(
  signingSecret: string,
  signature: string | null,
  timestamp: string | null,
  rawBody: string
): boolean {
  if (!signingSecret || !signature || !timestamp) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  const ageSec = Math.abs(Math.floor(Date.now() / 1000) - ts);
  if (ageSec > 60 * 5) return false;

  const base = `v0:${timestamp}:${rawBody}`;
  const digest = `v0=${createHmac("sha256", signingSecret).update(base).digest("hex")}`;
  try {
    return timingSafeEqual(Buffer.from(digest), Buffer.from(signature));
  } catch {
    return false;
  }
}

export type SlackInboundMessage = {
  channel: string;
  user?: string;
  text: string;
  threadTs?: string;
};

/** Parse Slack Events API payloads (message + app_mention). */
export function parseSlackEvent(payload: unknown): SlackInboundMessage | null {
  if (!payload || typeof payload !== "object") return null;
  const root = payload as Record<string, unknown>;

  if (root.type === "url_verification" && typeof root.challenge === "string") {
    return { channel: "__challenge__", text: root.challenge };
  }

  if (root.type !== "event_callback") return null;
  const event = root.event;
  if (!event || typeof event !== "object") return null;
  const ev = event as Record<string, unknown>;

  if (ev.subtype === "bot_message" || ev.bot_id) return null;
  if (ev.type !== "message" && ev.type !== "app_mention") return null;

  const text = typeof ev.text === "string" ? ev.text.trim() : "";
  if (!text) return null;

  const channel = typeof ev.channel === "string" ? ev.channel : "";
  if (!channel) return null;

  return {
    channel,
    user: typeof ev.user === "string" ? ev.user : undefined,
    text,
    threadTs: typeof ev.thread_ts === "string" ? ev.thread_ts : undefined
  };
}
