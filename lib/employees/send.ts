/**
 * Send through one of an employee's connected integrations: stored credentials are mapped
 * onto the adapter's shape (channel-credentials.ts) and a token refreshed during the send
 * (Gmail) is saved back, encrypted. Every outbound path — inbound auto-replies, the
 * send_message tool, follow-ups run by the 24/7 tick — goes through here.
 *
 * A row that can never send (an old one-click connection without a WhatsApp number, an
 * SMTP-only email row, …) is flagged `status='error'` with reason `credentials_incomplete`
 * instead of staying "connected" while every send fails (SW-7).
 */
import { dispatchChannelSend, isMessagingChannel, type ChannelSendOutcome } from "./channels/dispatch";
import { adapterCredentials, missingSendCredentials, persistRefreshedCredentials } from "./channel-credentials";
import { markIntegrationError } from "./integration-store";
import type { AIEmployeeIntegrationRow } from "./types";

export async function sendThroughIntegration(
  integration: AIEmployeeIntegrationRow,
  message: { to: string; body: string; subject?: string }
): Promise<ChannelSendOutcome> {
  const credentials = adapterCredentials(integration);
  if (isMessagingChannel(integration.kind)) {
    const missing = missingSendCredentials(integration.kind, credentials);
    if (missing.length) {
      if (integration.employee_id) {
        await markIntegrationError(integration.employee_id, integration.kind, {
          reason: "credentials_incomplete",
          source: "send",
          detail: `missing ${missing.join(", ")}`,
          at: new Date().toISOString()
        });
      }
      throw new Error(`${integration.kind}: this connection is incomplete (missing ${missing.join(", ")}) — reconnect it`);
    }
  }
  return dispatchChannelSend(
    { kind: integration.kind, credentials, to: message.to, body: message.body, subject: message.subject },
    {
      onCredentialsRefreshed: async (patch) => {
        Object.assign(credentials, patch);
        if (integration.id) await persistRefreshedCredentials(integration.id, integration.credentials, patch);
      }
    }
  );
}
