/**
 * Provider request/response handling of the publishers (SW-12, SW-28, SW-29, SW-49).
 * fetch is stubbed at the test boundary; the connectors are the real ones.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  instagramConnector,
  linkedInConnector,
  snapchatConnector,
  tikTokConnector,
  whatsappConnector,
  xConnector
} from "@/lib/social/connectors";
import { PublishError } from "@/lib/social/publish-error";
import { LINKEDIN_API_VERSION } from "@/lib/linkedin/api";
import type { Copy, PublishPayload } from "@/lib/social/types";

const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const copy = (caption: string): Copy => ({ caption, altText: "", cta: "", hashtags: [] });
const payload = (caption: string, extra: Partial<PublishPayload> = {}): PublishPayload => ({ copy: copy(caption), images: [], ...extra });
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const call = (i: number) => {
  const [url, init] = fetchMock.mock.calls[i];
  return { url: String(url), init: init as RequestInit, body: init?.body ? JSON.parse(String(init.body)) : undefined };
};
const rejection = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => e as PublishError);

describe("LinkedIn (versioned Posts API)", () => {
  const li = () => linkedInConnector({ actorUrn: "urn:li:organization:42", accessToken: "li-token" });

  it("treats the documented 201 + x-restli-id (empty body) as the published post id", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 201, headers: { "x-restli-id": "urn:li:share:6844785523593134080" } }));
    await expect(li().publish(payload("Hello (Riyadh) #عطور #oud_lovers"))).resolves.toEqual({
      remoteId: "urn:li:share:6844785523593134080"
    });
    const { url, init, body } = call(0);
    expect(url).toBe("https://api.linkedin.com/rest/posts");
    const headers = init.headers as Record<string, string>;
    expect(headers["Linkedin-Version"]).toBe(LINKEDIN_API_VERSION);
    expect(headers["X-Restli-Protocol-Version"]).toBe("2.0.0");
    expect(headers.authorization).toBe("Bearer li-token");
    // little text: reserved characters escaped, hashtags kept as hashtags
    expect(body).toMatchObject({
      author: "urn:li:organization:42",
      commentary: "Hello \\(Riyadh\\) #عطور #oud\\_lovers",
      visibility: "PUBLIC",
      lifecycleState: "PUBLISHED",
      distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] }
    });
  });

  it("never reports success without a post id, and explains a sunset version", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 201 }));
    expect(await rejection(li().publish(payload("hi")))).toMatchObject({ code: "outcome_unknown", outcome: "unknown" });

    fetchMock.mockResolvedValueOnce(json({ status: 426, code: "NONEXISTENT_VERSION", message: "Requested version 202410 is not active" }, 426));
    const err = await rejection(li().publish(payload("hi")));
    expect(err).toMatchObject({ code: "rejected", outcome: "failed", status: 426 });
    expect(err?.message).toContain(LINKEDIN_API_VERSION);
  });

  it("maps 401 to an unauthorized failure (refresh/reconnect) and 422 duplicates to duplicate", async () => {
    fetchMock.mockResolvedValueOnce(json({ message: "Invalid access token" }, 401));
    expect(await rejection(li().publish(payload("hi")))).toMatchObject({ code: "auth_failed", unauthorized: true });
    fetchMock.mockResolvedValueOnce(json({ message: "Content is a duplicate of urn:li:share:1" }, 422));
    expect(await rejection(li().publish(payload("hi")))).toMatchObject({ code: "duplicate" });
  });
});

describe("X (weighted length, no silent slicing)", () => {
  const x = () => xConnector({ bearer: "x-token" });

  it("posts the caption as written and returns the tweet id", async () => {
    fetchMock.mockResolvedValueOnce(json({ data: { id: "1790", text: "…" } }, 201));
    const caption = `${"ع".repeat(250)} https://salla.sa/oud-store/oud-al-layl-premium-collection-2026?ref=social`;
    await expect(x().publish(payload(caption))).resolves.toEqual({ remoteId: "1790" });
    expect(call(0).url).toBe("https://api.x.com/2/tweets");
    expect(call(0).body).toEqual({ text: caption }); // 274 weighted: sent intact, URL not cut
  });

  it("refuses a caption over 280 weighted characters without calling X", async () => {
    const err = await rejection(x().publish(payload(`${"ع".repeat(270)}${"✨".repeat(10)}`)));
    expect(err).toMatchObject({ code: "caption_too_long", outcome: "skipped" });
    expect(err?.message).toContain("290/280");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("classifies duplicate content, expired tokens and lost responses", async () => {
    fetchMock.mockResolvedValueOnce(json({ detail: "You are not allowed to create a Tweet with duplicate content.", status: 403 }, 403));
    expect(await rejection(x().publish(payload("same")))).toMatchObject({ code: "duplicate", outcome: "failed" });
    fetchMock.mockResolvedValueOnce(json({ title: "Unauthorized" }, 401));
    expect(await rejection(x().publish(payload("hi")))).toMatchObject({ code: "auth_failed", unauthorized: true });
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    expect(await rejection(x().publish(payload("hi")))).toMatchObject({ code: "outcome_unknown", outcome: "unknown" });
  });
});

describe("Instagram (catalog images only)", () => {
  const ig = () => instagramConnector({ igUserId: "17841", accessToken: "ig-token" });
  const image = { url: "https://cdn.salla.sa/store/oud.jpg", productId: "p1" };

  it("publishes a single-image post with the post's catalog image", async () => {
    fetchMock.mockResolvedValueOnce(json({ id: "container-1" })).mockResolvedValueOnce(json({ id: "media-1" }));
    await expect(ig().publish(payload("عود فاخر", { images: [image] }))).resolves.toEqual({ remoteId: "media-1" });
    expect(call(0).url).toMatch(/^https:\/\/graph\.facebook\.com\/v\d+\.\d+\/17841\/media$/);
    expect(call(0).body).toEqual({ image_url: image.url, caption: "عود فاخر" });
    expect((call(0).init.headers as Record<string, string>).authorization).toBe("Bearer ig-token");
    expect(call(1).url).toMatch(/\/17841\/media_publish$/);
    expect(call(1).body).toEqual({ creation_id: "container-1" });
  });

  it("builds a carousel only from catalog images (never from the visual brief)", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ id: "c1" }))
      .mockResolvedValueOnce(json({ id: "c2" }))
      .mockResolvedValueOnce(json({ id: "carousel" }))
      .mockResolvedValueOnce(json({ id: "media-2" }));
    const brief = { layout: "carousel" as const, slides: [{ kind: "hero" as const, headline: "a" }, { kind: "cta" as const, headline: "b" }], paletteCue: "sand" };
    await ig().publish(
      payload("cap", { visualBrief: brief, images: [image, { url: "https://cdn.salla.sa/store/oud-2.jpg" }] })
    );
    expect(call(0).body).toEqual({ image_url: image.url, is_carousel_item: true });
    expect(call(2).body).toEqual({ media_type: "CAROUSEL", children: "c1,c2", caption: "cap" });
  });

  it("skips (sends nothing) when the post has no catalog image", async () => {
    const err = await rejection(ig().publish(payload("cap", { images: [{ url: "http://insecure.example/x.jpg" }] })));
    expect(err).toMatchObject({ code: "no_image", outcome: "skipped" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("distinguishes a failed container (nothing posted) from a lost publish response (unknown)", async () => {
    fetchMock.mockResolvedValueOnce(json({ error: { message: "Only photo or video can be accepted as media type.", code: 9004 } }, 400));
    expect(await rejection(ig().publish(payload("cap", { images: [image] })))).toMatchObject({ code: "rejected", outcome: "failed" });

    fetchMock.mockResolvedValueOnce(json({ id: "container-2" })).mockRejectedValueOnce(new Error("socket hang up"));
    expect(await rejection(ig().publish(payload("cap", { images: [image] })))).toMatchObject({ code: "outcome_unknown", outcome: "unknown" });

    fetchMock.mockResolvedValueOnce(json({ error: { message: "Error validating access token", code: 190 } }, 400));
    expect(await rejection(ig().publish(payload("cap", { images: [image] })))).toMatchObject({ code: "reconnect_required", unauthorized: true });
  });
});

describe("platforms arabclue cannot publish to", () => {
  it.each([
    ["tiktok", tikTokConnector],
    ["whatsapp", whatsappConnector],
    ["snapchat", snapchatConnector]
  ])("%s refuses honestly without sending a request", async (_name, factory) => {
    const err = await rejection(factory().publish(payload("cap")));
    expect(err).toBeInstanceOf(PublishError);
    expect(err).toMatchObject({ code: "unsupported", outcome: "skipped" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
