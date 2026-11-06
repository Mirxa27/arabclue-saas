/**
 * Send through one of an employee's connected integrations: stored credentials are mapped
 * onto the adapter's shape (channel-credentials.ts) and a token refreshed during the send
 * (Gmail) is saved back, encrypted. Every outbound path — inbound auto-replies, the
 * send_message tool, follow-ups run by the 24/7 tick — goes through here.
 */
import { dispatchChannelSend, type ChannelSendOutcome } from "./channels/dispatch";
import { adapterCredentials, persistRefreshedCredentials } from "./channel-credentials";
import type { AIEmployeeIntegrationRow } from "./types";

export async function sendThroughIntegration(
  integration: AIEmployeeIntegrationRow,
  message: { to: string; body: string; subject?: string }
): Promise<ChannelSendOutcome> {
  const credentials = adapterCredentials(integration);
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
