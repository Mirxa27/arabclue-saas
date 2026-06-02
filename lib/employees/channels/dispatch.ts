/**
 * Central outbound-channel dispatch.
 *
 * Both the runtime (`sendOnChannel`) and the tool layer (`send_message`) route
 * through `dispatchChannelSend` so the channel matrix lives in exactly one place.
 * Adding a channel means adding one `case` here — nothing else needs to change.
 */
import type { IntegrationKind } from "../types";
import { sendWhatsAppText, type WhatsAppCredentials } from "./whatsapp";
import { sendTelegramText, type TelegramCredentials } from "./telegram";
import { sendSlackMessage, type SlackCredentials } from "./slack";
import { sendEmail, type EmailCredentials } from "./email";
import { sendSms, type TwilioSmsCredentials } from "./sms";
import { sendWebhookMessage, type WebhookCredentials } from "./webhook";
import { sendMetaDirectMessage, type MetaMessagingCredentials } from "./meta";

/** Channels that support direct 1:1 text dispatch from an employee. */
export const MESSAGING_CHANNELS = [
  "whatsapp",
  "telegram",
  "slack",
  "email",
  "gmail",
  "twilio_sms",
  "webhook",
  "meta",
  "instagram"
] as const satisfies readonly IntegrationKind[];

export type MessagingChannel = (typeof MESSAGING_CHANNELS)[number];

export function isMessagingChannel(kind: IntegrationKind): kind is MessagingChannel {
  return (MESSAGING_CHANNELS as readonly string[]).includes(kind);
}

/**
 * Thrown when a non-messaging integration (commerce, finance, dev, analytics, or
 * a social platform whose DM API is not generally available) is asked to send a
 * direct text message. This is a permanent contract, not an unfinished stub.
 */
export class UnsupportedChannelError extends Error {
  readonly kind: IntegrationKind;
  constructor(kind: IntegrationKind) {
    super(
      `Channel "${kind}" does not support direct text messages. ` +
        `Supported channels: ${MESSAGING_CHANNELS.join(", ")}.`
    );
    this.name = "UnsupportedChannelError";
    this.kind = kind;
  }
}

export type ChannelSendOutcome = { remoteId: string };

export async function dispatchChannelSend(args: {
  kind: IntegrationKind;
  credentials: Record<string, unknown>;
  to: string;
  body: string;
  subject?: string;
}): Promise<ChannelSendOutcome> {
  const { kind, credentials, to, body, subject } = args;
  switch (kind) {
    case "whatsapp": {
      const r = await sendWhatsAppText(credentials as unknown as WhatsAppCredentials, to, body);
      return { remoteId: r.remoteId };
    }
    case "telegram": {
      const r = await sendTelegramText(credentials as unknown as TelegramCredentials, to, body);
      return { remoteId: String(r.remoteId) };
    }
    case "slack": {
      const creds = credentials as unknown as SlackCredentials;
      const channel = to || creds.default_channel || "#general";
      const r = await sendSlackMessage(creds, channel, body);
      return { remoteId: r.ts };
    }
    case "email":
    case "gmail": {
      const creds = credentials as unknown as EmailCredentials;
      const r = await sendEmail(
        { from: creds.from || "noreply@arabclue.com", reply_to: creds.reply_to, api_key: creds.api_key },
        { to, subject: subject ?? "Message from your team", text: body }
      );
      return { remoteId: r.id };
    }
    case "twilio_sms": {
      const r = await sendSms(credentials as unknown as TwilioSmsCredentials, to, body);
      return { remoteId: r.sid };
    }
    case "webhook": {
      const r = await sendWebhookMessage(credentials as unknown as WebhookCredentials, to, body, subject);
      return { remoteId: r.id };
    }
    case "meta":
    case "instagram": {
      const r = await sendMetaDirectMessage(kind, credentials as unknown as MetaMessagingCredentials, to, body);
      return { remoteId: r.messageId };
    }
    default:
      throw new UnsupportedChannelError(kind);
  }
}
