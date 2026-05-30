# /deploy-check

Pre-deploy checklist for arabclue:

1. `npm run typecheck && npm test && npm run build` — all green.
2. Review pending `supabase/migrations/` — applied on target project?
3. `.env.example` matches any new required vars; bootstrap vars set on host (see `docs/DEPLOYMENT.md`).
4. Admin secrets: `TOKEN_ENCRYPTION_KEY` present; integration keys configured via `/admin/config` if not in env.
5. Post-deploy: `GET /api/health`, smoke `/` and `/login`; cron `CRON_SECRET` wired for `hostinger-cron.sh` or Vercel cron.
6. Log decision in `data/decisions/` if deploy changes infra or env contract.
