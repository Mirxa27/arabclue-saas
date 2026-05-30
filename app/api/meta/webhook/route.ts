export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/db/supabase";
import { verifyMetaWebhook } from "@/lib/meta/oauth";
import { processSocialInbound } from "@/lib/social/handover";
import type { Platform } from "@/lib/social/types";

type MetaWebhookBody = {
  object?: string;
  entry?: Array<{
    id?: string;
    changes?: Array<{
      field?: string;
      value?: {
        from?: { id?: string; username?: string };
        text?: string;
        message?: string;
        comment_id?: string;
      };
    }>;
    messaging?: Array<{
      sender?: { id?: string };
      message?: { text?: string };
    }>;
  }>;
};

async function merchantForExternalId(externalId: string, platform: Platform): Promise<string | null> {
  const supabase = getServiceSupabase();
  const { data } = await supabase
    .from("social_channels")
    .select("merchant_id")
    .eq("platform", platform)
    .eq("external_id", externalId)
    .maybeSingle();
  return data?.merchant_id ?? null;
}

/** Meta (Instagram / WhatsApp) webhook — verification + inbound messages for engager handover. */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const challenge = verifyMetaWebhook(
    url.searchParams.get("hub.mode"),
    url.searchParams.get("hub.verify_token"),
    url.searchParams.get("hub.challenge")
  );
  if (!challenge) return new NextResponse("forbidden", { status: 403 });
  return new NextResponse(challenge, { status: 200 });
}

export async function POST(req: NextRequest) {
  const supabase = getServiceSupabase();
  const body = (await req.json()) as MetaWebhookBody;

  for (const entry of body.entry ?? []) {
    const entryId = entry.id ?? "";

    for (const change of entry.changes ?? []) {
      if (change.field !== "comments") continue;
      const merchantId = await merchantForExternalId(entryId, "instagram");
      if (!merchantId) continue;
      const from = change.value?.from?.username ?? change.value?.from?.id ?? "unknown";
      const text = change.value?.text ?? change.value?.message ?? "";
      if (!text) continue;
      await processSocialInbound(supabase, {
        merchantId,
        platform: "instagram",
        kind: "comment",
        from,
        text
      });
    }

    for (const msg of entry.messaging ?? []) {
      const merchantId = await merchantForExternalId(entryId, "whatsapp");
      if (!merchantId) continue;
      const text = msg.message?.text ?? "";
      if (!text) continue;
      await processSocialInbound(supabase, {
        merchantId,
        platform: "whatsapp",
        kind: "dm",
        from: msg.sender?.id ?? "unknown",
        text
      });
    }
  }

  return NextResponse.json({ ok: true });
}
