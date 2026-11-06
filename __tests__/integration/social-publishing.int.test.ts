/**
 * Social publishing against a real Supabase stack (PostgREST + Postgres + GoTrue): the claim
 * function, the hold function and the claim-conditional writes under real concurrency (SW-9),
 * the plan gate for an owner's direct Data API insert (SW-13), and token refresh (SW-27).
 *
 * Runs only when SUPABASE_IT_URL, SUPABASE_IT_SERVICE_KEY and SUPABASE_IT_ANON_KEY are set:
 *   SUPABASE_IT_URL=http://127.0.0.1:54321 SUPABASE_IT_SERVICE_KEY=… SUPABASE_IT_ANON_KEY=… \
 *     npx vitest run __tests__/integration/social-publishing.int.test.ts
 * Provider APIs (X, LinkedIn, Graph) are intercepted at the fetch boundary; Supabase calls pass through.
 * The scheduler is global, so the test fails (instead of touching them) when other merchants have due posts.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";
import { encryptSecret, decryptSecret } from "@/lib/crypto/secrets";
import { runSocialPublishing } from "@/lib/social/cron";

const URL_ = process.env.SUPABASE_IT_URL;
const KEY = process.env.SUPABASE_IT_SERVICE_KEY;
const ANON = process.env.SUPABASE_IT_ANON_KEY;

type ProviderCall = { url: string; body: string; auth: string | null };

describe.skipIf(!URL_ || !KEY || !ANON)("social publishing on a real stack", () => {
  let sb: SupabaseClient;
  const realFetch = globalThis.fetch;
  const providerCalls: ProviderCall[] = [];
  const users: string[] = [];
  const plus = randomUUID();
  const lite = randomUUID();
  const posts = { a: randomUUID(), b: randomUUID(), c: randomUUID(), draft: randomUUID(), future: randomUUID() };
  let litePostId = "";
  let othersDue = 0;

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", "integration-token-encryption-key-32+");
    vi.stubEnv("X_CLIENT_ID", "it-x-client");
    vi.stubEnv("X_CLIENT_SECRET", "it-x-secret");
    let seq = 0;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      if (!["api.x.com", "api.twitter.com", "api.linkedin.com", "graph.facebook.com"].includes(url.hostname)) {
        return realFetch(input, init);
      }
      const headers = new Headers(init?.headers);
      providerCalls.push({ url: url.href, body: String(init?.body ?? ""), auth: headers.get("authorization") });
      await new Promise((r) => setTimeout(r, 150)); // a slow provider widens the race window
      if (url.pathname === "/2/oauth2/token") {
        return new Response(JSON.stringify({ access_token: "refreshed-x-access", refresh_token: "rotated-x-refresh", expires_in: 7200 }), { status: 200 });
      }
      if (url.pathname === "/2/tweets") return new Response(JSON.stringify({ data: { id: `tw-${++seq}`, text: "" } }), { status: 201 });
      if (url.pathname === "/rest/posts") return new Response(null, { status: 201, headers: { "x-restli-id": `urn:li:share:${++seq}` } });
      return new Response(JSON.stringify({ error: "unexpected provider call" }), { status: 500 });
    });

    sb = createClient(URL_!, KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
    const ins = async (table: string, rows: unknown) => {
      const { error } = await sb.from(table).insert(rows as never);
      if (error) throw new Error(`${table}: ${error.message}`);
    };

    const mkUser = async (label: string) => {
      const email = `social-it-${label}-${randomUUID()}@example.test`;
      const { data, error } = await sb.auth.admin.createUser({ email, password: "Social-IT-pass-1!", email_confirm: true });
      if (error) throw error;
      users.push(data.user!.id);
      return { id: data.user!.id, email };
    };
    const plusUser = await mkUser("plus");
    const liteUser = await mkUser("lite");

    await ins("merchants", [
      { id: plus, owner_user_id: plusUser.id, seller_name: "Social IT Plus", plan: "plus", subscription_status: "active" },
      { id: lite, owner_user_id: liteUser.id, seller_name: "Social IT Lite", plan: "lite", subscription_status: "active" }
    ]);
    await ins("agent_settings", [
      { merchant_id: plus, persona_role: "social", enabled: true, status: "active" },
      { merchant_id: lite, persona_role: "social", enabled: true, status: "active" }
    ]);
    await ins("social_channels", [
      // X token expired an hour ago: the run must refresh it once (single-use refresh token)
      {
        merchant_id: plus,
        platform: "x",
        external_id: `it-x-${plus}`,
        access_token_encrypted: encryptSecret("expired-x-access"),
        refresh_token_encrypted: encryptSecret("it-x-refresh"),
        token_expires_at: new Date(Date.now() - 3600_000).toISOString()
      },
      {
        merchant_id: plus,
        platform: "linkedin",
        external_id: `urn:li:organization:${plus.slice(0, 8)}`,
        access_token_encrypted: encryptSecret("li-access")
      },
      { merchant_id: lite, platform: "x", external_id: `it-x-${lite}`, access_token_encrypted: encryptSecret("lite-x-access") }
    ]);
    const due = new Date(Date.now() - 5 * 60_000).toISOString();
    const copy = (t: string) => ({ x: { caption: `x ${t}` }, linkedin: { caption: `li (${t})` } });
    await ins("social_posts", [
      { id: posts.a, merchant_id: plus, scheduled_for: due, platforms: ["x", "linkedin"], copies: copy("a"), status: "scheduled" },
      { id: posts.b, merchant_id: plus, scheduled_for: due, platforms: ["x", "linkedin"], copies: copy("b"), status: "scheduled" },
      { id: posts.c, merchant_id: plus, scheduled_for: due, platforms: ["x", "instagram"], copies: copy("c"), status: "scheduled" },
      { id: posts.draft, merchant_id: plus, scheduled_for: due, platforms: ["x"], copies: copy("draft"), status: "draft" },
      { id: posts.future, merchant_id: plus, scheduled_for: new Date(Date.now() + 86_400_000).toISOString(), platforms: ["x"], copies: copy("f"), status: "scheduled" }
    ]);

    // The Lite owner writes a "scheduled" post themselves, through the Data API with their own JWT.
    const owner = createClient(URL_!, ANON!, { auth: { persistSession: false, autoRefreshToken: false } });
    const signIn = await owner.auth.signInWithPassword({ email: liteUser.email, password: "Social-IT-pass-1!" });
    if (signIn.error) throw signIn.error;
    const direct = await owner
      .from("social_posts")
      .insert({ merchant_id: lite, scheduled_for: due, platforms: ["x"], copies: { x: { caption: "free publishing?" } }, status: "scheduled" })
      .select("id")
      .single();
    if (direct.error) throw new Error(`owner insert: ${direct.error.message}`);
    litePostId = direct.data.id;

    // The scheduler is global: never touch another stream's data on a shared stack.
    const { count } = await sb
      .from("social_posts")
      .select("id", { count: "exact", head: true })
      .in("status", ["scheduled", "publishing"])
      .lte("scheduled_for", new Date().toISOString())
      .not("merchant_id", "in", `(${plus},${lite})`);
    othersDue = count ?? 0;
  }, 60_000);

  afterAll(async () => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    if (!sb) return;
    await sb.from("merchants").delete().in("id", [plus, lite]);
    for (const id of users) await sb.auth.admin.deleteUser(id);
  });

  it("two concurrent runs publish each post exactly once per platform; the Lite insert is never published", async () => {
    // Fail loudly rather than pass silently: the run would also touch other merchants' due posts.
    expect(othersDue, "other merchants have due social posts on this shared stack").toBe(0);
    const [one, two] = await Promise.all([runSocialPublishing({ client: sb }), runSocialPublishing({ client: sb })]);

    // 3 claimable posts in total, split between the runs; the draft and the future post untouched
    expect(one.claimed + two.claimed).toBe(3);
    const tweets = providerCalls.filter((c) => c.url === "https://api.x.com/2/tweets");
    const linkedin = providerCalls.filter((c) => c.url === "https://api.linkedin.com/rest/posts");
    expect(tweets.map((c) => JSON.parse(c.body).text).sort()).toEqual(["x a", "x b", "x c"]);
    expect(linkedin).toHaveLength(2);
    expect(tweets.every((c) => c.auth === "Bearer refreshed-x-access")).toBe(true);
    // the single-use refresh token was spent exactly once, and the rotated pair stored
    expect(providerCalls.filter((c) => c.url.endsWith("/2/oauth2/token"))).toHaveLength(1);
    const { data: xChannel } = await sb.from("social_channels").select("access_token_encrypted, refresh_token_encrypted").eq("merchant_id", plus).eq("platform", "x").single();
    expect(decryptSecret(xChannel!.access_token_encrypted)).toBe("refreshed-x-access");
    expect(decryptSecret(xChannel!.refresh_token_encrypted)).toBe("rotated-x-refresh");

    const { data: rows } = await sb.from("social_posts").select("id, status, error_code, remote_ids, publish_results, claim_id").in("id", Object.values(posts));
    const byId = new Map((rows ?? []).map((r) => [r.id, r]));
    expect(byId.get(posts.a)).toMatchObject({ status: "published", error_code: null, claim_id: null });
    expect(Object.keys(byId.get(posts.a)!.remote_ids).sort()).toEqual(["linkedin", "x"]);
    expect(byId.get(posts.c)).toMatchObject({ status: "published", error_code: "partial" });
    expect(byId.get(posts.c)!.publish_results.instagram).toMatchObject({ status: "skipped", code: "not_connected" });
    expect(byId.get(posts.draft)!.status).toBe("draft");
    expect(byId.get(posts.future)!.status).toBe("scheduled");

    const { data: litePost } = await sb.from("social_posts").select("status, error_code").eq("id", litePostId).single();
    expect(litePost).toEqual({ status: "failed", error_code: "plan_required" });
    expect(providerCalls.some((c) => c.body.includes("free publishing?"))).toBe(false);

    // A third run finds nothing to do and sends nothing.
    const before = providerCalls.length;
    const three = await runSocialPublishing({ client: sb });
    expect(three.claimed).toBe(0);
    expect(providerCalls.length).toBe(before);
  }, 60_000);

  it("claims are disjoint under real concurrency (claim_due_social_posts with SKIP LOCKED)", async () => {
    expect(othersDue, "other merchants have due social posts on this shared stack").toBe(0);
    const ids = Array.from({ length: 12 }, () => randomUUID());
    const due = new Date(Date.now() - 60_000).toISOString();
    const { error } = await sb.from("social_posts").insert(
      ids.map((id) => ({ id, merchant_id: plus, scheduled_for: due, platforms: ["x"], copies: { x: { caption: id } }, status: "scheduled" }))
    );
    expect(error).toBeNull();
    const claim = () =>
      sb.rpc("claim_due_social_posts", { p_limit: 4, p_plans: ["plus"], p_subscription_statuses: ["active"], p_max_lateness_seconds: 21600 });
    const results = await Promise.all(Array.from({ length: 6 }, claim));
    const claimed = results.flatMap((r) => (r.data ?? []) as Array<{ id: string; claim_id: string }>);
    expect(results.every((r) => r.error === null)).toBe(true);
    expect(claimed).toHaveLength(12);
    expect(new Set(claimed.map((r) => r.id)).size).toBe(12); // no post claimed twice
    await sb.from("social_posts").delete().in("id", ids);
  }, 30_000);
});
