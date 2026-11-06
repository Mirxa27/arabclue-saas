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

function graphStub(routes: { me: StubReply; subscribe?: StubReply; debugToken?: StubReply | Error }) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (url.includes("/me?")) return new Response(JSON.stringify(routes.me.body), { status: routes.me.status });
    if (url.includes("/subscribed_apps")) {
      expect(init?.method).toBe("POST");
      const s = routes.subscribe ?? { status: 200, body: { success: true } };
      return new Response(JSON.stringify(s.body), { status: s.status });
    }
    if (url.includes("/debug_token?") && routes.debugToken) {
      if (routes.debugToken instanceof Error) throw routes.debugToken;
      return new Response(JSON.stringify(routes.debugToken.body), { status: routes.debugToken.status });
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

  describe("RB-W1: which app signs the webhooks", () => {
    const PLATFORM = { appId: "900000000000001", appSecret: "platform-app-secret-0123456789" };
    const noSecret = { page_id: "104", page_access_token: PAGE_TOKEN, verify_token: "verify-token-0123456789" };
    const issuedTo = (appId: string, extra: Record<string, unknown> = {}): StubReply => ({
      status: 200,
      body: { data: { app_id: appId, type: "PAGE", application: "App", is_valid: true, profile_id: "104", ...extra } }
    });
    const subscribed = (fetchMock: ReturnType<typeof graphStub>) =>
      fetchMock.mock.calls.some(([u]) => String(u).includes("/subscribed_apps"));

    it("without app_secret and without a platform app: refused before the Page is subscribed", async () => {
      const fetchMock = graphStub({ me: me({ id: "104" }) });
      vi.stubGlobal("fetch", fetchMock);
      await expect(prepareMetaIntegration("meta", noSecret)).rejects.toMatchObject({ code: "app_secret_required", status: 400 });
      expect(subscribed(fetchMock)).toBe(false);
    });

    it("a Page token issued to the platform app connects without app_secret, as connected_via 'platform'", async () => {
      const fetchMock = graphStub({ me: me({ id: "104", name: "Store" }), debugToken: issuedTo(PLATFORM.appId) });
      vi.stubGlobal("fetch", fetchMock);
      const out = await prepareMetaIntegration("meta", noSecret, { platformApp: PLATFORM });
      expect(out.config).toEqual({ connected_via: "platform", page_name: "Store", subscribed: true, subscribed_fields: ["messages"] });
      expect(out.credentials).toEqual({ page_id: "104", page_access_token: PAGE_TOKEN, verify_token: "verify-token-0123456789" });

      // Documented inspection call: the Page token as input_token, the platform app token as the caller.
      const call = fetchMock.mock.calls.find(([u]) => String(u).includes("/debug_token?")) as FetchCall;
      expect(new URL(String(call[0])).searchParams.get("input_token")).toBe(PAGE_TOKEN);
      expect((call[1]?.headers as Record<string, string>).authorization).toBe(`Bearer ${PLATFORM.appId}|${PLATFORM.appSecret}`);
      expect(String(call[0])).not.toContain(PLATFORM.appSecret); // never in a URL
    });

    it.each([
      ["another app's token (Meta refuses to inspect it)", { status: 400, body: { error: { message: "(#100) The App_id in the input_token did not match the Viewing App", code: 100 } } }],
      ["a token of a different app id", issuedTo("123456789")],
      ["an invalid token", issuedTo(PLATFORM.appId, { is_valid: false })],
      ["a token for another Page", issuedTo(PLATFORM.appId, { profile_id: "999" })]
    ])("without app_secret, %s: app_secret_required, nothing subscribed", async (_l, debugToken) => {
      const fetchMock = graphStub({ me: me({ id: "104" }), debugToken });
      vi.stubGlobal("fetch", fetchMock);
      const err = await prepareMetaIntegration("meta", noSecret, { platformApp: PLATFORM }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(MetaConnectError);
      expect(err).toMatchObject({ code: "app_secret_required", status: 400 });
      expect((err as Error).message).toMatch(/app_secret/);
      expect(subscribed(fetchMock)).toBe(false);
    });

    it.each([
      ["a network error", new TypeError("fetch failed")],
      ["a 5xx", { status: 503, body: {} }],
      ["Meta throttling", { status: 400, body: { error: { message: "(#4) Application request limit reached", code: 4 } } }]
    ])("%s while asking Meta: meta_unavailable (502), nothing subscribed", async (_l, debugToken) => {
      const fetchMock = graphStub({ me: me({ id: "104" }), debugToken });
      vi.stubGlobal("fetch", fetchMock);
      await expect(prepareMetaIntegration("meta", noSecret, { platformApp: PLATFORM })).rejects.toMatchObject({
        code: "meta_unavailable",
        status: 502
      });
      expect(subscribed(fetchMock)).toBe(false);
    });

    it("with the merchant's own app_secret the platform app is never consulted", async () => {
      const fetchMock = graphStub({ me: me({ id: "104" }) }); // a /debug_token call would throw
      vi.stubGlobal("fetch", fetchMock);
      const out = await prepareMetaIntegration("meta", input, { platformApp: PLATFORM });
      expect(out.config.connected_via).toBe("manual");
      expect(out.credentials.app_secret).toBe(input.app_secret);
    });
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
