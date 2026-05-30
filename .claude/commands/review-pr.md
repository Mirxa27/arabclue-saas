# /review-pr

Pre-merge review for arabclue (AI-first focus):

1. Run `npm run typecheck` and `npm test`; report failures with file paths.
2. Identify touched domains: auth, billing, ZATCA, webhooks, admin, RLS, AI agents.
3. For each domain, verify tests exist or flag gaps.
4. Security pass (@security checklist): merchant isolation, secrets, cron auth, webhook verification.
5. Rollout: migrations reversible? New env vars documented in `.env.example`?
6. Output: **Ship / Ship with notes / Block** with prioritized findings.
