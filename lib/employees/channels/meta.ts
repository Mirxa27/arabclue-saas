/**
 * Meta Messenger + Instagram Direct adapter (Graph Send API).
 *
 * The merchant connects a Facebook Page (and, for Instagram, the linked IG
 * business account) and stores a Page access token. Both Messenger and Instagram
 * messaging post to the same Send API on the page node; the recipient id is a
 * PSID (Messenger) or IGSID (Instagram), obtained from an inbound message event.
 *
 * Docs:
 *   https://developers.facebook.com/docs/messenger-platform/send-messages
 *   https://developers.facebook.com/docs/messenger-platform/instagram
 */
const GRAPH_VERSION = process.env.META_GRAPH_VERSION ?? "v21.0";

export type MetaMessagingCredentials = {
  page_id: string;
  page_access_token: string;
};

export type MetaSendResult = { messageId: string; recipientId: string };

export type MetaChannel = "meta" | "instagram";

export async function sendMetaDirectMessage(
  channel: MetaChannel,
  creds: MetaMessagingCredentials,
  to: string,
  body: string
): Promise<MetaSendResult> {
  const label = channel === "instagram" ? "Instagram" : "Messenger";
  if (!creds.page_id) throw new Error(`${label}: page_id missing`);
  if (!creds.page_access_token) throw new Error(`${label}: page_access_token missing`);
  if (!to) throw new Error(`${label}: recipient id is required`);

  const res = await fetch(
    `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(creds.page_id)}/messages`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${creds.page_access_token}`
      },
      body: JSON.stringify({
        recipient: { id: to },
        message: { text: body },
        messaging_type: "RESPONSE"
      })
    }
  );

  const json = (await res.json().catch(() => ({}))) as {
    message_id?: string;
    recipient_id?: string;
    error?: { message?: string };
  };
  if (!res.ok || !json.message_id) {
    throw new Error(`${label} send failed: ${json.error?.message ?? res.statusText}`);
  }
  return { messageId: json.message_id, recipientId: json.recipient_id ?? to };
}
