/**
 * WhatsApp Cloud API adapter.
 *
 * The merchant supplies their own WhatsApp Business phone number ID and an
 * access token (stored encrypted in ai_employee_integrations.credentials).
 * We use the official Cloud API — no third-party gateway.
 *
 * Webhook verification: see /app/api/employees/webhooks/whatsapp/route.ts.
 */

const GRAPH_VERSION = process.env.META_GRAPH_VERSION ?? "v21.0";

export type WhatsAppCredentials = {
  phone_number_id: string;
  access_token: string;
  app_secret?: string;
  verify_token?: string;
};

export type WhatsAppIncoming = {
  from: string;            // E.164 phone
  messageId: string;
  timestamp: number;
  type: "text" | "image" | "audio" | "document" | "button" | "interactive";
  text?: string;
  contactName?: string;
};

export type WhatsAppSendResult = {
  remoteId: string;
};

function endpoint(phoneNumberId: string): string {
  return `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`;
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
  const entries = (payload as { entry?: unknown[] }).entry ?? [];
  for (const entry of entries) {
    const changes = (entry as { changes?: unknown[] }).changes ?? [];
    for (const change of changes) {
      const value = (change as { value?: Record<string, unknown> }).value;
      if (!value) continue;
      const messages = (value.messages as unknown[] | undefined) ?? [];
      const contacts = (value.contacts as Array<{ profile?: { name?: string }; wa_id?: string }> | undefined) ?? [];

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
          type,
          text,
          contactName
        });
      }
    }
  }
  return out;
}
