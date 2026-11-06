/**
 * POST /api/employees/webhooks/telegram/[id] — Telegram Bot API webhook for one AI employee.
 *
 * F29: Telegram echoes the `secret_token` given to setWebhook in
 * X-Telegram-Bot-Api-Secret-Token. It is the only proof the update came from
 * Telegram, so a missing stored secret refuses everything (503) and the header is
 * compared in constant time (403). Updates are claimed by update_id (unique per bot)
 * and answered in after().
 */
import { after, NextResponse, type NextRequest } from "next/server";
import { parseTelegramUpdate, type TelegramIncoming } from "@/lib/employees/channels/telegram";
import { loadEmployeeIntegration, touchIntegrationLastEvent } from "@/lib/employees/integration-store";
import { handleInboundMessage, logAction } from "@/lib/employees/runtime";
import { readTextBody, WEBHOOK_MAX_BYTES } from "@/lib/http/raw-body";
import { safeEqual } from "@/lib/security/compare";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { claimInboundEvents, errorText, inboundAck, processClaimedInbound } from "@/lib/webhooks/inbound-claims";
import {
  capInboundText,
  forbidden,
  invalidJson,
  isEmployeeId,
  logInboundRejected,
  nonEmptyString,
  notConfigured
} from "./shared";

export const TELEGRAM_INBOUND_ROUTE = "POST /api/employees/webhooks/telegram/:id";
/** webhook_events.provider; update_id is only unique per bot, so the key is `${employeeId}:${update_id}`. */
export const TELEGRAM_WEBHOOK_PROVIDER = "telegram";

export async function receiveTelegramWebhook(req: NextRequest, employeeId: string): Promise<NextResponse> {
  const limited = await enforceRateLimit(req, "employees:webhook:telegram", 180, 60_000, employeeId);
  if (limited instanceof NextResponse) return limited;

  const integration = isEmployeeId(employeeId) ? await loadEmployeeIntegration(employeeId, "telegram") : null;
  if (!integration) return NextResponse.json({ error: "no telegram integration" }, { status: 404 });

  const expected = nonEmptyString(integration.credentials.webhook_secret);
  if (!expected) {
    await logInboundRejected(employeeId, "telegram", "no_webhook_secret");
    return notConfigured("telegram webhook secret not configured — reconnect the bot");
  }
  const got = req.headers.get("x-telegram-bot-api-secret-token");
  if (!got || !safeEqual(got, expected)) return forbidden();

  const raw = await readTextBody(req, WEBHOOK_MAX_BYTES);
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return invalidJson();
  }

  const updateId = payload && typeof payload === "object" ? (payload as { update_id?: unknown }).update_id : undefined;
  const incoming = parseTelegramUpdate(payload);
  if (typeof updateId !== "number" || !incoming || !incoming.text?.trim()) {
    return NextResponse.json({ ok: true, skipped: true });
  }

  const item: TelegramIncoming = { ...incoming, text: capInboundText(incoming.text) };
  const summary = await claimInboundEvents(TELEGRAM_WEBHOOK_PROVIDER, [{ eventId: `${employeeId}:${updateId}`, item }]);

  const claimed = summary.claimed;
  after(async () => {
    await processClaimedInbound<TelegramIncoming>({
      provider: TELEGRAM_WEBHOOK_PROVIDER,
      route: TELEGRAM_INBOUND_ROUTE,
      claimed,
      orderKey: (m) => String(m.chatId),
      handle: async (m) => {
        await handleInboundMessage({
          employeeId,
          channel: "telegram",
          externalId: String(m.chatId),
          text: m.text,
          contactName: m.fromName ?? m.from
        });
      },
      onFailure: (m, err) =>
        logAction({
          employeeId,
          action: "inbound_message",
          channel: "telegram",
          target: String(m.chatId),
          status: "failure",
          result: { error: errorText(err) }
        })
    });
    if (claimed.length > 0) await touchIntegrationLastEvent([integration.id]);
  });

  return inboundAck(summary, TELEGRAM_INBOUND_ROUTE);
}
