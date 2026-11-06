/**
 * SW-28: one LinkedIn API version for every call, kept inside LinkedIn's support window, and
 * commentary in little text format.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { LINKEDIN_API_VERSION, linkedInRestHeaders, toLittleText } from "@/lib/linkedin/api";
import { resolveLinkedInActorUrn } from "@/lib/linkedin/oauth";

afterEach(() => vi.unstubAllGlobals());

describe("LinkedIn API version", () => {
  it("is a YYYYMM version LinkedIn still supports (versions live ≥ 12 months; bump before ~11)", () => {
    const match = /^(\d{4})(\d{2})$/.exec(LINKEDIN_API_VERSION);
    expect(match).not.toBeNull();
    const released = Date.UTC(Number(match![1]), Number(match![2]) - 1, 1);
    const ageMonths = (Date.now() - released) / (30.44 * 86_400_000);
    expect(ageMonths, `LINKEDIN_API_VERSION ${LINKEDIN_API_VERSION} is ${ageMonths.toFixed(1)} months old — bump lib/linkedin/api.ts`).toBeLessThan(11);
    expect(LINKEDIN_API_VERSION > "202511").toBe(true); // 202511 sunsets on 2026-11-16
  });

  it("is sent by the identity lookup too", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ elements: [{ organization: "urn:li:organization:9" }] }), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(resolveLinkedInActorUrn("tok")).resolves.toBe("urn:li:organization:9");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("https://api.linkedin.com/rest/organizationAcls");
    expect(init.headers).toEqual(linkedInRestHeaders("tok"));
    expect((init.headers as Record<string, string>)["Linkedin-Version"]).toBe(LINKEDIN_API_VERSION);
  });

  it("explains a sunset version on lookup", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ status: 426, code: "NONEXISTENT_VERSION" }), { status: 426 })));
    await expect(resolveLinkedInActorUrn("tok")).rejects.toThrow(/426 \(API version no longer supported\)/);
  });
});

describe("toLittleText", () => {
  it("escapes every reserved character", () => {
    expect(toLittleText("a|b{c}d@e[f]g(h)i<j>k\\l*m_n~o")).toBe("a\\|b\\{c\\}d\\@e\\[f\\]g\\(h\\)i\\<j\\>k\\\\l\\*m\\_n\\~o");
  });

  it("keeps hashtags (Arabic included) as hashtags and escapes a lone #", () => {
    expect(toLittleText("عطور #عود_فاخر #oud # 5")).toBe("عطور #عود\\_فاخر #oud \\# 5");
  });
});
