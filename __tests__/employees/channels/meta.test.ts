import { describe, it, expect, vi, afterEach } from "vitest";
import {
  classifyMetaSendFailure,
  INSTAGRAM_MAX_TEXT_BYTES,
  inspectMetaPageToken,
  MESSENGER_MAX_TEXT_CHARS,
  MetaConnectError,
  prepareMetaIntegration,
  sendMetaDirectMessage,
  splitMetaText
} from "@/lib/employees/channels/meta";
import { GraphApiError } from "@/lib/meta/graph";

const creds = { page_id: "PAGE1", page_access_token: "PAT" };

afterEach(() => vi.unstubAllGlobals());

describe("sendMetaDirectMessage", () => {
  it("posts to the page Send API with messaging_type RESPONSE (Messenger)", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> =>
        new Response(JSON.stringify({ message_id: "mid_1", recipient_id: "R1" }), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);

    const r = await sendMetaDirectMessage("meta", creds, "PSID1", "hello");
    expect(r).toEqual({ messageId: "mid_1", recipientId: "R1" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/PAGE1/messages");
    expect((init?.headers as Record<string, string>).authorization).toBe("Bearer PAT");
    expect(JSON.parse(init?.body as string)).toMatchObject({
      recipient: { id: "PSID1" },
      message: { text: "hello" },
      messaging_type: "RESPONSE"
    });
  });

  it("works for Instagram and surfaces Graph API errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (): Promise<Response> => new Response(JSON.stringify({ error: { message: "no permission" } }), { status: 403 }))
    );
    await expect(sendMetaDirectMessage("instagram", creds, "IGSID", "x")).rejects.toThrow(
      /Instagram send failed: no permission/
    );
  });

  it("validates credentials and recipient before calling out", async () => {
    await expect(sendMetaDirectMessage("meta", { page_id: "", page_access_token: "x" }, "to", "b")).rejects.toThrow(
      /page_id missing/
    );
    await expect(sendMetaDirectMessage("meta", creds, "", "b")).rejects.toThrow(/recipient id is required/);
  });
});

// ─── Outbound chunking ──────────────────────────────────────────────────────

type FetchCall = [RequestInfo | URL, RequestInit | undefined];

function okSends() {
  let n = 0;
  return vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
    n += 1;
    return new Response(JSON.stringify({ message_id: `mid_${n}`, recipient_id: "R" }), { status: 200 });
  });
}

const sentTexts = (mock: ReturnType<typeof okSends>) =>
  (mock.mock.calls as FetchCall[]).map(([, init]) => (JSON.parse(String(init?.body)) as { message: { text: string } }).message.text);

describe("splitMetaText", () => {
  it("keeps short replies whole", () => {
    expect(splitMetaText("instagram", "  مرحبا بك  ")).toEqual(["مرحبا بك"]);
    expect(splitMetaText("meta", "")).toEqual([]);
  });

  it("cuts Instagram replies at 1000 UTF-8 bytes on code-point boundaries", () => {
    const text = Array.from({ length: 300 }, (_, i) => `كلمة${i}`).join(" "); // ~3000 bytes of Arabic
    const chunks = splitMetaText("instagram", text);
    expect(chunks.length).toBeGreaterThanOrEqual(3);
    for (const c of chunks) {
      expect(Buffer.byteLength(c, "utf8")).toBeLessThanOrEqual(INSTAGRAM_MAX_TEXT_BYTES);
      expect(c).not.toMatch(/�/);
    }
    expect(chunks.join(" ")).toBe(text);
  });

  it("never splits a surrogate pair, even without spaces", () => {
    const chunks = splitMetaText("instagram", "😀".repeat(600)); // 4 bytes each
    for (const c of chunks) {
      expect(Buffer.byteLength(c, "utf8")).toBeLessThanOrEqual(INSTAGRAM_MAX_TEXT_BYTES);
      expect(Array.from(c).every((cp) => cp === "😀")).toBe(true);
    }
    expect(chunks.join("")).toBe("😀".repeat(600));
  });
});

describe("sendMetaDirectMessage chunking", () => {
  it("sends 1200 Arabic letters to Instagram as ≥3 messages of ≤1000 bytes, in order", async () => {
    const fetchMock = okSends();
    vi.stubGlobal("fetch", fetchMock);
    const text = Array.from({ length: 240 }, () => "مرحبا").join(" "); // 1200 letters + spaces
    const r = await sendMetaDirectMessage("instagram", creds, "IGSID", text);
    expect(r.messageId).toBe("mid_1");
    const texts = sentTexts(fetchMock);
    expect(texts.length).toBeGreaterThanOrEqual(3);
    for (const t of texts) expect(Buffer.byteLength(t, "utf8")).toBeLessThanOrEqual(1000);
    expect(texts.join(" ")).toBe(text);
  });

  it("sends 2500 characters to Messenger as 2 messages of ≤2000 characters", async () => {
    const fetchMock = okSends();
    vi.stubGlobal("fetch", fetchMock);
    const text = Array.from({ length: 500 }, () => "abcd").join(" "); // 2499 chars
    await sendMetaDirectMessage("meta", creds, "PSID", text);
    const texts = sentTexts(fetchMock);
    expect(texts).toHaveLength(2);
    for (const t of texts) expect(t.length).toBeLessThanOrEqual(MESSENGER_MAX_TEXT_CHARS);
  });

  it("throws a GraphApiError carrying Meta's code and subcode", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (): Promise<Response> =>
        new Response(JSON.stringify({ error: { message: "Error validating access token", code: 190, error_subcode: 463 } }), {
          status: 401
        })
      )
    );
    const err = await sendMetaDirectMessage("meta", creds, "PSID", "hi").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GraphApiError);
    expect(err).toMatchObject({ code: 190, subcode: 463, status: 401 });
  });
});

// ─── Send failure classification ────────────────────────────────────────────

const graphErr = (code: number | undefined, subcode?: number, status = 400) =>
  new GraphApiError("Messenger send failed", status, { message: "x", code, error_subcode: subcode });

describe("classifyMetaSendFailure", () => {
  it.each([
    [190, undefined, "token_invalid"],
    [200, undefined, "permission_missing"],
    [200, 2534041, "instagram_access_disabled"],
    [10, undefined, "permission_missing"],
    [10, 1893063, "page_restricted"],
    [100, 2534013, "instagram_not_linked"],
    [3, undefined, "capability_missing"]
  ] as const)("code %s/%s breaks the whole channel: %s", (code, subcode, reason) => {
    expect(classifyMetaSendFailure(graphErr(code, subcode))).toMatchObject({ reason, scope: "integration" });
  });

  it.each([
    [10, 2534022, "outside_window"],
    [10, 2018278, "outside_window"],
    [551, undefined, "recipient_unavailable"],
    [100, 2534014, "recipient_unavailable"],
    [100, 2534037, "not_thread_owner"],
    [10, 2018300, "not_thread_owner"]
  ] as const)("code %s/%s concerns one conversation: %s", (code, subcode, reason) => {
    expect(classifyMetaSendFailure(graphErr(code, subcode))).toMatchObject({ reason, scope: "conversation" });
  });

  it("treats rate limits, 5xx and network errors as transient", () => {
    expect(classifyMetaSendFailure(graphErr(613, 2534040))).toMatchObject({ reason: "rate_limited", scope: "transient" });
    expect(classifyMetaSendFailure(graphErr(4))).toMatchObject({ reason: "rate_limited", scope: "transient" });
    expect(classifyMetaSendFailure(graphErr(undefined, undefined, 502))).toMatchObject({ scope: "transient" });
    expect(classifyMetaSendFailure(new TypeError("fetch failed"))).toMatchObject({ reason: "temporary", scope: "transient" });
  });
});

// ─── Connect-time checks ────────────────────────────────────────────────────

const PAGE_TOKEN = "EAAPAGEtoken_0123456789abcdef";

type StubReply = { status: number; body: unknown };

function graphStub(routes: { me: StubReply; subscribe?: StubReply }) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (url.includes("/me?")) return new Response(JSON.stringify(routes.me.body), { status: routes.me.status });
    if (url.includes("/subscribed_apps")) {
      expect(init?.method).toBe("POST");
      const s = routes.subscribe ?? { status: 200, body: { success: true } };
      return new Response(JSON.stringify(s.body), { status: s.status });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
}
const me = (body: Record<string, unknown>): StubReply => ({ status: 200, body });

describe("inspectMetaPageToken", () => {
  it("returns the Page id, name and linked Instagram account for the token", async () => {
    const fetchMock = graphStub({ me: me({ id: "104", name: "متجر النخبة", instagram_business_account: { id: "1784" } }) });
    vi.stubGlobal("fetch", fetchMock);
    expect(await inspectMetaPageToken({ page_access_token: PAGE_TOKEN })).toEqual({
      id: "104",
      name: "متجر النخبة",
      instagramAccountId: "1784"
    });
    const [url, init] = fetchMock.mock.calls[0] as FetchCall;
    expect(String(url)).toMatch(/^https:\/\/graph\.facebook\.com\/v\d+\.\d+\/me\?fields=id%2Cname%2Cinstagram_business_account$/);
    expect((init?.headers as Record<string, string>).authorization).toBe(`Bearer ${PAGE_TOKEN}`);
  });
});

describe("prepareMetaIntegration", () => {
  const input = {
    page_id: "104",
    page_access_token: PAGE_TOKEN,
    app_secret: "app-secret-0123456789",
    verify_token: "verify-token-0123456789"
  };

  it("refuses a token that belongs to another Page or user", async () => {
    vi.stubGlobal("fetch", graphStub({ me: me({ id: "999" }) }));
    await expect(prepareMetaIntegration("meta", input)).rejects.toMatchObject({ code: "page_mismatch" });
    await expect(prepareMetaIntegration("meta", input)).rejects.toBeInstanceOf(MetaConnectError);
  });

  it("refuses a token Meta rejects", async () => {
    vi.stubGlobal(
      "fetch",
      graphStub({ me: { status: 400, body: { error: { message: "Invalid OAuth access token", code: 190 } } } })
    );
    await expect(prepareMetaIntegration("meta", input)).rejects.toMatchObject({ code: "token_invalid" });
  });

  it("Messenger: external_id is the verified page id and the Page is subscribed to messages", async () => {
    vi.stubGlobal("fetch", graphStub({ me: me({ id: "104", name: "Store" }) }));
    const out = await prepareMetaIntegration("meta", { ...input, ig_account_id: "555" });
    expect(out.externalId).toBe("104");
    expect(out.credentials).toEqual(input);
    expect(out.config).toEqual({ connected_via: "manual", page_name: "Store", subscribed: true, subscribed_fields: ["messages"] });
  });

  it("Instagram: fills ig_account_id from the Page and uses it as external_id", async () => {
    vi.stubGlobal("fetch", graphStub({ me: me({ id: "104", instagram_business_account: { id: "17841400000000001" } }) }));
    const out = await prepareMetaIntegration("instagram", input);
    expect(out.externalId).toBe("17841400000000001");
    expect(out.credentials.ig_account_id).toBe("17841400000000001");
  });

  it("Instagram: refuses an ig_account_id not linked to the Page, or a Page without one", async () => {
    vi.stubGlobal("fetch", graphStub({ me: me({ id: "104", instagram_business_account: { id: "1784" } }) }));
    await expect(prepareMetaIntegration("instagram", { ...input, ig_account_id: "1785" })).rejects.toMatchObject({
      code: "instagram_mismatch"
    });
    vi.stubGlobal("fetch", graphStub({ me: me({ id: "104" }) }));
    await expect(prepareMetaIntegration("instagram", input)).rejects.toMatchObject({ code: "instagram_not_linked" });
  });

  it("a failed subscribed_apps call does not block the connect", async () => {
    vi.stubGlobal(
      "fetch",
      graphStub({
        me: me({ id: "104" }),
        subscribe: { status: 403, body: { error: { message: "(#200) Requires pages_manage_metadata permission", code: 200 } } }
      })
    );
    const out = await prepareMetaIntegration("meta", input);
    expect(out.config).toMatchObject({
      subscribed: false,
      subscribed_fields: [],
      subscribe_error: "(#200) Requires pages_manage_metadata permission"
    });
  });
});
