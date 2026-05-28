# Contributing

## Branch naming

- `main` — production. Protected. Only merge through PR.
- `develop` — pre-production staging.
- `feat/*` — features.
- `fix/*` — bug fixes.
- `chore/*` — non-functional changes.

## Commit messages

Follow conventional commits: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`.

## Pre-PR checklist

```bash
npm run typecheck
npm run lint
npm test
```

All three must pass. CI will reject the PR otherwise.

## Code style

- TypeScript strict mode is on. No `any` without a comment justifying it.
- Server-only modules go in `lib/*` and never import from `components/*`.
- Client components: `"use client"` directive at the top. Keep them minimal — push logic to server components / route handlers.
- File names: kebab-case for modules, PascalCase for React components.

## Architecture decisions

When making a change that affects more than one module, add a short note in `docs/ADR/` (Architecture Decision Records). Template in `docs/ADR/0001-template.md`.
