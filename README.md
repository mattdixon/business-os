# Business OS

A framework and a library of pluggable agents that we install **once per client** as a custom operating system. Each client gets their own deployment, their own database, their own infra. This is a high-ticket professional services build, not a SaaS.

**First client:** CNN Construction (concrete).

## What this repo is

This is the framework monorepo. Two artifacts ship out of here:

1. **Versioned `@business-os/*` npm packages** — the framework primitives, SDKs, and a library of shared agents + connectors. Each client install pins versions and upgrades via `pnpm up`.
2. **A starter template** — `templates/client-starter/`, the thin per-client repo every install gets via the scaffolder.

You scaffold a client install from the framework, then deploy that install on the client's infrastructure. The framework code lives in versioned packages, not in their tree.

## Quick start (scaffold a client)

```sh
# Inside this monorepo
pnpm install
pnpm --filter @business-os/create-client start cnn-construction \
  --name "CNN Construction" \
  --dir ~/code/cnn-construction-os

# Then in the new dir
cd ~/code/cnn-construction-os
cp .env.example .env       # fill in DATABASE_URL etc.
pnpm install
docker compose up -d postgres
pnpm dev
```

The shell boots Fastify + worker on `API_PORT` (default 4673) and the operator UI at `/`. The framework runs migrations on first boot; from there, everything else — connector credentials, per-agent settings, schedules — lives in the DB and is managed via the operator UI.

## What's in the box

```
business-os/
├── packages/
│   ├── core/                 @business-os/core           Fastify server, auth, audit, secrets, settings, boot
│   ├── runtime/              @business-os/runtime        Registry, scheduler, ctx, connector resolver, jobs
│   ├── agent-sdk/            @business-os/agent-sdk      The interface every agent implements + helpers
│   ├── connector-sdk/        @business-os/connector-sdk  The interface every connector implements
│   ├── db/                   @business-os/db             Drizzle base schema + migration runner
│   ├── ui/                   @business-os/ui             Operator UI (Vite + React + Tailwind)
│   └── api-contract/         @business-os/api-contract   Zod request/response schemas
├── agents/
│   └── leadgen/              @business-os/agent-leadgen  First shared agent — prospect drafting
├── connectors/
│   ├── anthropic/            @business-os/connector-anthropic   LLM provider (Claude)
│   └── openai/               @business-os/connector-openai      LLM provider (GPT)
├── tools/
│   └── create-client/        @business-os/create-client  pnpm create CLI
├── templates/
│   └── client-starter/       The per-client shell scaffold (NOT a workspace package)
└── docs/
    ├── prd/                  Product requirements
    ├── specs/                Technical design
    └── archive/              Superseded designs
```

## Locked architectural decisions

- **Single-tenant per install.** No multi-tenant routing, no control-plane DB, no tenant registry. Each client = one deployment + one DB.
- **Hybrid distribution.** Thin starter shell per client (scaffolded once) + versioned `@business-os/*` packages for the framework and shared agents/connectors.
- **Connectors expose capabilities, not providers.** Agents ask `ctx.connector('email')`; operators pick the provider in the UI. Multiple providers per capability are allowed; per-agent provider+model selection is supported via the `LlmPicker` convention.
- **All credentials, schedules, on/off, per-agent settings live in the DB.** Files declare what is installed, never secrets or runtime values.
- **Forward-only migrations.** Each owner (framework core, every agent, every connector) ships its own migration directory with sha256 drift detection.
- **Server-side sessions + httpOnly cookies.** Argon2id passwords. Optional TOTP MFA. Users live in the client's own DB.

See [CLAUDE.md](./CLAUDE.md) for the full list.

## Develop the framework

```sh
pnpm install
pnpm -r build              # build all packages (TS → dist)
pnpm -r typecheck          # whole-workspace typecheck
pnpm -r test               # whole-workspace tests
pnpm --filter @business-os/ui dev    # operator UI dev server (port 4937)
```

Tests requiring Postgres auto-skip when it's unreachable. Bring it up via:

```sh
docker compose up -d postgres
```

## Documentation

- [docs/prd/](./docs/prd/) — product requirements
- [docs/specs/](./docs/specs/) — technical design
- [CLAUDE.md](./CLAUDE.md) — locked decisions and conventions

## License

UNLICENSED — proprietary to the project owners. Do not redistribute.
