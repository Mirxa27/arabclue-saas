/**
 * WhatsApp Cloud API adapter.
 *
 * The merchant supplies their own WhatsApp Business phone number ID and an
 * access token (stored encrypted in ai_employee_integrations.credentials).
 * We use the official Cloud API — no third-party gateway.
 *
 * Inbound: /api/employees/webhooks/whatsapp/[id] verifies X-Hub-Signature-256 with
 * the integration's `app_secret` (lib/employees/inbound/whatsapp.ts).
 */
import { graphUrl } from "@/lib/meta/graph";

export type WhatsAppCredentials = {
  phone_number_id: string;
  access_token: string;
  app_secret?: string;
  verify_token?: string;
};

export type WhatsAppIncoming = {
  from: string;            // E.164 phone
  messageId: string;
  /** Seconds since the epoch (WhatsApp's own unit). */
  timestamp: number;
  /** The business number that received it (value.metadata.phone_number_id), when present. */
  phoneNumberId?: string;
  type: "text" | "image" | "audio" | "document" | "button" | "interactive";
  text?: string;
  contactName?: string;
};

export type WhatsAppSendResult = {
  remoteId: string;
};

function endpoint(phoneNumberId: string): string {
  return graphUrl([phoneNumberId, "messages"]);
}

export async function sendWhatsAppText(
  creds: WhatsAppCredentials,
  to: string,
  body: string
): Promise<WhatsAppSendResult> {
  if (!creds.phone_number_id) throw new Error("WhatsApp: phone_number_id missing");
  if (!creds.access_token) throw new Error("WhatsApp: access_token missing");

  const res = await fetch(endpoint(creds.phone_number_id), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${creds.access_token}`
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: { preview_url: false, body }
    })
  });

  const json = (await res.json().catch(() => ({}))) as {
    error?: { message: string };
    messages?: { id: string }[];
  };

  if (!res.ok) {
    throw new Error(`WhatsApp send failed: ${json?.error?.message ?? res.statusText}`);
  }
  const remoteId = json.messages?.[0]?.id;
  if (!remoteId) throw new Error("WhatsApp send: no message id returned");
  return { remoteId };
}

export async function sendWhatsAppTemplate(
  creds: WhatsAppCredentials,
  to: string,
  templateName: string,
  languageCode: string,
  components?: unknown[]
): Promise<WhatsAppSendResult> {
  const res = await fetch(endpoint(creds.phone_number_id), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${creds.access_token}`
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: { name: templateName, language: { code: languageCode }, components }
    })
  });
  const json = (await res.json().catch(() => ({}))) as {
    error?: { message: string };
    messages?: { id: string }[];
  };
  if (!res.ok) throw new Error(`WhatsApp template failed: ${json?.error?.message ?? res.statusText}`);
  return { remoteId: json.messages?.[0]?.id ?? "" };
}

/** Parses the Meta webhook payload into a normalised list of incoming messages. */
export function parseWhatsAppWebhook(payload: unknown): WhatsAppIncoming[] {
  const out: WhatsAppIncoming[] = [];
  if (!payload || typeof payload !== "object") return out;
  const rawEntries = (payload as { entry?: unknown }).entry;
  const entries = Array.isArray(rawEntries) ? rawEntries : [];
  for (const entry of entries) {
    const rawChanges = entry && typeof entry === "object" ? (entry as { changes?: unknown }).changes : undefined;
    const changes = Array.isArray(rawChanges) ? rawChanges : [];
    for (const change of changes) {
      if (!change || typeof change !== "object") continue;
      const value = (change as { value?: Record<string, unknown> }).value;
      if (!value || typeof value !== "object") continue;
      const messages = Array.isArray(value.messages) ? (value.messages as unknown[]) : [];
      const contacts = Array.isArray(value.contacts)
        ? (value.contacts as Array<{ profile?: { name?: string }; wa_id?: string }>)
        : [];
      const metadata = value.metadata as { phone_number_id?: unknown } | undefined;
      const phoneNumberId =
        typeof metadata?.phone_number_id === "string" || typeof metadata?.phone_number_id === "number"
          ? String(metadata.phone_number_id)
          : undefined;

      for (const m of messages) {
        const msg = m as {
          from?: string;
          id?: string;
          timestamp?: string;
          type?: string;
          text?: { body?: string };
          button?: { text?: string };
          interactive?: { button_reply?: { title?: string } };
        };
        if (!msg.from || !msg.id) continue;

        const contactName = contacts.find((c) => c.wa_id === msg.from)?.profile?.name;
        const type = (msg.type as WhatsAppIncoming["type"]) ?? "text";
        const text =
          msg.text?.body ??
          msg.button?.text ??
          msg.interactive?.button_reply?.title ??
          "";

        out.push({
          from: msg.from,
          messageId: msg.id,
          timestamp: msg.timestamp ? Number(msg.timestamp) : Math.floor(Date.now() / 1000),
          phoneNumberId,
          type,
          text,
          contactName
        });
      }
    }
  }
  return out;
}
