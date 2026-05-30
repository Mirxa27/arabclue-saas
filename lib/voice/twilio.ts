/**
 * Twilio phone number provisioning for voice agent telephony bridge.
 * Uses REST API directly — no SDK dependency.
 */

export type TwilioConfig = {
  accountSid: string;
  authToken: string;
  voiceWebhookUrl: string;
};

export function getTwilioConfig(): TwilioConfig | null {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (!accountSid || !authToken || !siteUrl) return null;
  return {
    accountSid,
    authToken,
    voiceWebhookUrl: `${siteUrl}/api/voice/twilio/inbound`
  };
}

function authHeader(cfg: TwilioConfig): string {
  return `Basic ${Buffer.from(`${cfg.accountSid}:${cfg.authToken}`).toString("base64")}`;
}

async function twilioFetch<T>(cfg: TwilioConfig, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${cfg.accountSid}${path}`, {
    ...init,
    headers: {
      authorization: authHeader(cfg),
      "content-type": "application/x-www-form-urlencoded",
      ...(init?.headers ?? {})
    },
    signal: AbortSignal.timeout(20_000)
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Twilio ${path} → ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

type AvailableNumbersResponse = {
  available_phone_numbers?: Array<{ phone_number: string; friendly_name: string }>;
};

type IncomingNumberResponse = {
  sid: string;
  phone_number: string;
  friendly_name: string;
};

/** Search and purchase a local SA number, wired to our voice inbound webhook. */
export async function provisionVoiceNumber(cfg: TwilioConfig): Promise<{ sid: string; phoneNumber: string }> {
  const country = process.env.TWILIO_NUMBER_COUNTRY ?? "SA";
  const search = await twilioFetch<AvailableNumbersResponse>(
    cfg,
    `/AvailablePhoneNumbers/${country}/Local.json?Limit=1`
  );
  const candidate = search.available_phone_numbers?.[0];
  if (!candidate) {
    throw new Error(`No available Twilio numbers in ${country}. Try TWILIO_NUMBER_COUNTRY=US for testing.`);
  }

  const purchased = await twilioFetch<IncomingNumberResponse>(cfg, "/IncomingPhoneNumbers.json", {
    method: "POST",
    body: new URLSearchParams({
      PhoneNumber: candidate.phone_number,
      VoiceUrl: cfg.voiceWebhookUrl,
      VoiceMethod: "POST",
      FriendlyName: "arabclue voice agent"
    })
  });

  return { sid: purchased.sid, phoneNumber: purchased.phone_number };
}

/** Release a previously provisioned number. */
export async function releaseVoiceNumber(cfg: TwilioConfig, incomingSid: string): Promise<void> {
  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${cfg.accountSid}/IncomingPhoneNumbers/${incomingSid}.json`,
    {
      method: "DELETE",
      headers: { authorization: authHeader(cfg) },
      signal: AbortSignal.timeout(15_000)
    }
  );
  if (!res.ok && res.status !== 404) {
    const text = await res.text().catch(() => "");
    throw new Error(`Twilio release failed: ${res.status} ${text.slice(0, 120)}`);
  }
}
