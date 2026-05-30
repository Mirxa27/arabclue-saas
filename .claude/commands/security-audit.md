# /security-audit

Quick security audit (load `agents/security.md`):

1. Scan recent diff or stated paths for auth bypass, missing RLS, raw SQL, exposed service role on client.
2. Verify webhook routes verify signatures and use idempotency where applicable.
3. Confirm admin routes and `/api/admin/*` require platform admin.
4. Check `lib/platform/env` and admin secrets: no plaintext secrets in git.
5. Output findings as Critical / High / Medium / Low with file references and fix suggestions.
