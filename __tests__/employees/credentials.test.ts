import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  decryptIntegrationCredentials,
  encryptIntegrationCredentials,
  redactIntegrationRow
} from "@/lib/employees/credentials";

describe("employee integration credentials", () => {
  const prev = process.env.TOKEN_ENCRYPTION_KEY;

  beforeEach(() => {
    process.env.TOKEN_ENCRYPTION_KEY = "test-encryption-key-32-chars-min!!";
  });

  afterEach(() => {
    if (prev === undefined) delete process.env.TOKEN_ENCRYPTION_KEY;
    else process.env.TOKEN_ENCRYPTION_KEY = prev;
  });

  it("round-trips encrypted credential blobs", () => {
    const plain = { bot_token: "xoxb-secret", verify_token: "vt-123" };
    const stored = encryptIntegrationCredentials(plain);
    expect(stored._enc).toBeTruthy();
    expect(decryptIntegrationCredentials(stored)).toEqual(plain);
  });

  it("redacts credentials from API rows", () => {
    const row = {
      id: "1",
      employee_id: "e1",
      kind: "telegram" as const,
      external_id: null,
      credentials: encryptIntegrationCredentials({ bot_token: "abc" }),
      config: {},
      status: "connected" as const,
      last_event_at: null,
      created_at: new Date().toISOString()
    };
    const redacted = redactIntegrationRow(row);
    expect(redacted).not.toHaveProperty("credentials");
    expect(redacted.credentials_configured).toContain("bot_token");
  });
});
