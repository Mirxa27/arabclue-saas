import { describe, it, expect, vi, afterEach } from "vitest";
import { sendMetaDirectMessage } from "@/lib/employees/channels/meta";

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
