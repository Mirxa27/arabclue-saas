/**
 * UI-035: /maroof renders arabclue's real CR number and Maroof link from runtime config
 * (COMPANY_CR_NUMBER / MAROOF_URL, registered for /admin/config hydration), shows a neutral
 * fallback while unset, and no longer shows the developer note.
 *
 * The suite has no JSX transform (tsconfig "jsx": "preserve"), so the page itself is checked
 * statically; the logic it renders from is tested directly.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { parseCrNumber, parseMaroofUrl, readCompanyRegistration } from "@/lib/company/registration";
import { getSecretField, MANAGED_SECRET_KEYS } from "@/lib/admin/secret-registry";

const page = readFileSync(join(process.cwd(), "app", "maroof", "page.tsx"), "utf8");

describe("company registration config", () => {
  it("accepts a 10-digit CR (Arabic-Indic digits, spaces, dashes) and https Maroof URLs only", () => {
    expect(parseCrNumber("١٠١٠ ١٢٣٤-٥٦")).toBe("1010123456");
    expect(parseCrNumber("12345")).toBeNull();
    expect(parseCrNumber("not-a-cr")).toBeNull();
    expect(parseCrNumber(undefined)).toBeNull();
    expect(parseMaroofUrl("https://maroof.sa/businesses/details/12345")).toBe("https://maroof.sa/businesses/details/12345");
    expect(parseMaroofUrl("http://maroof.sa/x")).toBeNull();
    expect(parseMaroofUrl("javascript:alert(1)")).toBeNull();
    expect(parseMaroofUrl("https://user:pw@maroof.sa/")).toBeNull();
  });

  it("reads both values from the runtime environment", () => {
    expect(readCompanyRegistration({})).toEqual({ crNumber: null, maroofUrl: null });
    expect(readCompanyRegistration({ COMPANY_CR_NUMBER: "1010123456", MAROOF_URL: "https://maroof.sa/b/1" })).toEqual({
      crNumber: "1010123456",
      maroofUrl: "https://maroof.sa/b/1"
    });
  });

  it("is managed from /admin/config and hydrated at runtime (not a build-time NEXT_PUBLIC_ key)", () => {
    expect(MANAGED_SECRET_KEYS).toEqual(expect.arrayContaining(["COMPANY_CR_NUMBER", "MAROOF_URL"]));
    expect(getSecretField("COMPANY_CR_NUMBER")?.bootstrap).toBeFalsy();
    expect(getSecretField("MAROOF_URL")?.type).toBe("url");
  });
});

describe("app/maroof/page.tsx", () => {
  it("renders per request from the config, with a fallback, and without the developer note", () => {
    expect(page).toMatch(/export const dynamic = "force-dynamic"/);
    expect(page).toContain("readCompanyRegistration()");
    expect(page).toMatch(/will be listed here soon/);
    expect(page).not.toMatch(/satisfies footer links|Update with your CR number|prior to public launch/);
    expect(page).not.toMatch(/NEXT_PUBLIC_/);
  });
});
