# arabclue — project state

**Status:** active development  
**Milestone:** production polish — dashboard UX, admin-managed secrets, Agentic OS harness  
**Primary deploy:** Hostinger (`arabclue.com`) + Vercel option in docs

## Current focus

- [x] Admin-managed integration secrets (`/admin/config`, encrypted `platform_settings`)
- [x] Landing page clarity (EN/AR, `HomeLanding`)
- [x] Dashboard glass shell: persistent sidebar (lg+), mobile bottom nav, wider grids
- [x] Agentic OS: `CLAUDE.md`, `agents/`, `.claude/commands/`, `data/`
- [x] Align agents panel + social/integrations dashboard surfaces with paper/ink tokens
- [ ] Redeploy latest UI + admin secrets to Hostinger after verification
- [ ] Production secrets filled via admin UI; Moyasar/OpenAI configured

## Architecture notes

- **Product agents** (`lib/agents/`, dashboard personas) ≠ **Agentic OS agents** (`agents/*.md` for coding sessions).
- Env hydration: `instrumentation.ts` → `lib/platform/env.ts`.
- Cron: social scheduler + employees tick (`scripts/hostinger-cron.sh`).

## Verification commands

```bash
npm run typecheck
npm test
npm run build
```

## Links

- `docs/DEPLOYMENT.md` — Hostinger/Vercel
- `docs/OPERATIONS.md` — go-to-market playbook
