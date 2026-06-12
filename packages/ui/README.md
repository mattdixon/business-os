# @frontrangesystems/business-os-ui

Operator console. Vite + React + Tailwind.

## What's here

- **Login** (with TOTP step-up handled inline).
- **Agents list + detail.** Auto-rendered settings form derived from the manifest's Zod schema via `zodToFieldSchema`. Manual run button, recent runs table, required-connector pills.
- **Connectors page.** Capability → registered providers → operator-configured instances. Add instance (provider picker + display name), set encrypted credentials, expand inline settings form, activate/deactivate with capability-exclusive semantics, cascade delete.
- **Audit log.** Filterable by action / agent / time bucket.
- **Settings.** TOTP enroll / disable, account.

## Run

```sh
pnpm dev      # Vite dev server on http://localhost:4937
pnpm build    # Vite production build → dist/ (served by @frontrangesystems/business-os-core)
```

Dev server proxies `/api`, `/auth`, `/healthz`, `/readyz` to the running Fastify on `API_PORT`.

## Built artifacts

The built `dist/` directory is what `@frontrangesystems/business-os-core` serves at `/` in production via `@fastify/static`. SPA fallback to `index.html` for any path that isn't an API route.
