/**
 * Telegram Bot API adapter.
 *
 * The merchant creates a bot via BotFather, supplies the token to the employee.
 * We set the webhook to /api/employees/webhooks/telegram/{employeeId}.
 */

export type TelegramCredentials = {
  bot_token: string;
  bot_username?: string;
  webhook_secret?: string;
};

export type TelegramIncoming = {
  chatId: number;
  messageId: number;
  from: string;
  fromName?: string;
  text: string;
  timestamp: number;
};

export type TelegramSendResult = {
  remoteId: number;
};

function endpoint(token: string, method: string): string {
  return `https://api.telegram.org/bot${token}/${method}`;
}

export async function sendTelegramText(
  creds: TelegramCredentials,
  chatId: number | string,
  text: string,
  options?: { parse_mode?: "Markdown" | "HTML"; disable_notification?: boolean }
): Promise<TelegramSendResult> {
  if (!creds.bot_token) throw new Error("Telegram: bot_token missing");
  const res = await fetch(endpoint(creds.bot_token, "sendMessage"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: options?.parse_mode,
      disable_notification: options?.disable_notification ?? false
    })
  });
  const json = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    description?: string;
    result?: { message_id?: number };
  };
  if (!res.ok || !json.ok) {
    throw new Error(`Telegram send failed: ${json.description ?? res.statusText}`);
  }
  return { remoteId: json.result?.message_id ?? 0 };
}

/** Configures the bot's webhook so Telegram pushes messages to us. */
export async function registerTelegramWebhook(
  creds: TelegramCredentials,
  url: string,
  secretToken?: string
): Promise<void> {
  const res = await fetch(endpoint(creds.bot_token, "setWebhook"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      url,
      secret_token: secretToken,
      allowed_updates: ["message", "edited_message", "callback_query"]
    })
  });
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string };
  if (!res.ok || !json.ok) {
    throw new Error(`Telegram setWebhook failed: ${json.description ?? res.statusText}`);
  }
}

export function parseTelegramUpdate(payload: unknown): TelegramIncoming | null {
  if (!payload || typeof payload !== "object") return null;
  const update = payload as {
    message?: {
      message_id?: number;
      date?: number;
      chat?: { id?: number; username?: string; first_name?: string };
      from?: { username?: string; first_name?: string; id?: number };
      text?: string;
    };
    edited_message?: {
      message_id?: number;
      date?: number;
      chat?: { id?: number; username?: string; first_name?: string };
      from?: { id?: number; username?: string; first_name?: string };
      text?: string;
    };
    callback_query?: { message?: { chat?: { id?: number }; message_id?: number }; data?: string; from?: { username?: string } };
  };

  const msg = update.message ?? update.edited_message;
  if (msg && msg.chat?.id && msg.text) {
    return {
      chatId: msg.chat.id,
      messageId: msg.message_id ?? 0,
      from: msg.from?.username ?? String(msg.from?.id ?? msg.chat.id),
      fromName: msg.from?.first_name ?? msg.chat?.first_name,
      text: msg.text,
      timestamp: msg.date ?? Math.floor(Date.now() / 1000)
    };
  }
  if (update.callback_query?.message?.chat?.id && update.callback_query.data) {
    return {
      chatId: update.callback_query.message.chat.id,
      messageId: update.callback_query.message.message_id ?? 0,
      from: update.callback_query.from?.username ?? "callback",
      text: update.callback_query.data,
      timestamp: Math.floor(Date.now() / 1000)
    };
  }
  return null;
}
