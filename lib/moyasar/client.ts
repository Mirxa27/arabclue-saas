import { MoyasarApiError, MoyasarPaymentSchema, type MoyasarPayment } from "@/lib/moyasar/types";

const MOYASAR_API_BASE = "https://api.moyasar.com/v1";

function getSecretKey(): string {
  const key = process.env.MOYASAR_SECRET_KEY;
  if (!key) throw new MoyasarApiError("MOYASAR_SECRET_KEY is not configured", 500);
  return key;
}

function authHeader(secretKey: string): string {
  return `Basic ${Buffer.from(`${secretKey}:`).toString("base64")}`;
}

async function moyasarRequest<T>(
  path: string,
  init?: RequestInit & { parse?: (json: unknown) => T }
): Promise<T> {
  const secretKey = getSecretKey();
  let res: Response;
  try {
    res = await fetch(`${MOYASAR_API_BASE}${path}`, {
      ...init,
      headers: {
        accept: "application/json",
        authorization: authHeader(secretKey),
        ...(init?.body ? { "content-type": "application/json" } : {}),
        ...(init?.headers ?? {})
      }
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Moyasar request failed";
    throw new MoyasarApiError(message, 0);
  }

  const text = await res.text();
  let json: unknown = {};
  if (text) {
    try {
      json = JSON.parse(text) as unknown;
    } catch {
      throw new MoyasarApiError(text || res.statusText, res.status);
    }
  }

  if (!res.ok) {
    const message =
      typeof json === "object" && json && "message" in json && typeof (json as { message: unknown }).message === "string"
        ? (json as { message: string }).message
        : res.statusText;
    throw new MoyasarApiError(message, res.status, json);
  }

  if (init?.parse) return init.parse(json);
  return json as T;
}

export function getPublishableKey(): string {
  const key = process.env.NEXT_PUBLIC_MOYASAR_PUBLIC_KEY ?? process.env.MOYASAR_PUBLIC_KEY;
  if (!key) throw new MoyasarApiError("MOYASAR_PUBLIC_KEY is not configured", 500);
  return key;
}

export async function fetchMoyasarPayment(paymentId: string): Promise<MoyasarPayment> {
  return moyasarRequest(`/payments/${paymentId}`, {
    method: "GET",
    parse: (json) => MoyasarPaymentSchema.parse(json)
  });
}

export type CreateInvoicePaymentArgs = {
  givenId: string;
  amountHalalas: number;
  description: string;
  callbackUrl: string;
  metadata: Record<string, string>;
};

/** Server-initiated payment record via Moyasar invoices API alternative: we use form on client; server verifies by id. */
export function verifyPaymentMatchesIntent(args: {
  payment: MoyasarPayment;
  expectedAmountHalalas: number;
  expectedCurrency: string;
  expectedMetadata: Record<string, string>;
}): void {
  const { payment, expectedAmountHalalas, expectedCurrency, expectedMetadata } = args;

  if (payment.status !== "paid") {
    throw new MoyasarApiError(`Payment status is ${payment.status}, expected paid`, 400);
  }
  if (payment.amount !== expectedAmountHalalas) {
    throw new MoyasarApiError("Payment amount mismatch", 400);
  }
  if (payment.currency !== expectedCurrency) {
    throw new MoyasarApiError("Payment currency mismatch", 400);
  }

  for (const [key, value] of Object.entries(expectedMetadata)) {
    const actual = payment.metadata?.[key];
    if (actual !== value) {
      throw new MoyasarApiError(`Payment metadata mismatch for ${key}`, 400);
    }
  }
}
