import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platform/env", () => ({ hydratePlatformEnvFromDatabase: vi.fn(async () => undefined) }));

import { testConnection } from "@/lib/admin/connection-tests";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function stubFetch(status: number) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("admin Anthropic connection test", () => {
  it("validates the key with GET /v1/models — no model id, no token spend", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
    const fetchMock = stubFetch(200);
    const result = await testConnection("anthropic");
    expect(result.ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.anthropic.com/v1/models?limit=1");
    expect(init.method ?? "GET").toBe("GET");
    const headers = init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("sk-ant-test");
    expect(headers["anthropic-version"]).toBeTruthy();
  });

  it("reports an invalid key (401) and other errors — including 400 — as failures", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-bad");
    stubFetch(401);
    expect((await testConnection("anthropic")).ok).toBe(false);
    stubFetch(400);
    expect((await testConnection("anthropic")).ok).toBe(false);
    stubFetch(529);
    expect((await testConnection("anthropic")).ok).toBe(false);
  });

  it("reports a missing key without calling the API", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const fetchMock = stubFetch(200);
    expect((await testConnection("anthropic")).ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
