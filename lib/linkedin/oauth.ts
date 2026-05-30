import { z } from "zod";
import { oauthCallbackUri } from "@/lib/oauth/redirect-uri";

const TokenSchema = z.object({
  access_token: z.string(),
  expires_in: z.number().optional(),
  refresh_token: z.string().optional()
});

export function linkedInRedirectUri(): string {
  return process.env.LINKEDIN_REDIRECT_URI ?? oauthCallbackUri("/api/oauth/linkedin/callback");
}

export function buildLinkedInAuthorizeURL(opts: { clientId: string; state: string }): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: opts.clientId,
    redirect_uri: linkedInRedirectUri(),
    state: opts.state,
    scope: "openid profile w_organization_social rw_organization_admin"
  });
  return `https://www.linkedin.com/oauth/v2/authorization?${params}`;
}

export async function exchangeLinkedInCode(code: string): Promise<z.infer<typeof TokenSchema>> {
  const res = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: process.env.LINKEDIN_CLIENT_ID!,
      client_secret: process.env.LINKEDIN_CLIENT_SECRET!,
      redirect_uri: linkedInRedirectUri()
    })
  });
  if (!res.ok) throw new Error(`LinkedIn token exchange failed: ${res.status}`);
  return TokenSchema.parse(await res.json());
}

export async function resolveLinkedInActorUrn(accessToken: string): Promise<string> {
  const res = await fetch(
    "https://api.linkedin.com/rest/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED",
    {
      headers: {
        authorization: `Bearer ${accessToken}`,
        "LinkedIn-Version": "202410",
        "X-Restli-Protocol-Version": "2.0.0"
      }
    }
  );
  if (!res.ok) throw new Error(`LinkedIn org lookup failed: ${res.status}`);
  const data = z
    .object({
      elements: z.array(z.object({ organization: z.string() }))
    })
    .parse(await res.json());
  const org = data.elements[0]?.organization;
  if (!org) throw new Error("No LinkedIn organization admin access found");
  return org.startsWith("urn:") ? org : `urn:li:organization:${org}`;
}
