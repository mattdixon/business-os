# Business OS

A framework and a library of pluggable agents that we install **once per client** as a custom operating system. Each client gets their own deployment, their own database, their own infra. This is a high-ticket professional services build, not a SaaS.

**First client:** CNN Construction (concrete).

## What this repo is

This is the framework monorepo. Two artifacts ship out of here:

1. **Versioned `@business-os/*` npm packages** — the framework primitives, SDKs, and a library of shared agents + connectors. Each client install pins versions and upgrades via `pnpm up`.
2. **A starter template** — `templates/client-starter/`, the thin per-client repo every install gets via the scaffolder.

You scaffold a client install from the framework, then deploy that install on the client's infrastructure. The framework code lives in versioned packages, not in their tree.

---

## Run it locally

Two paths. The first is what you want for a demo or for local development. The second is what a real client install looks like once `@business-os/*` is published to a private registry.

### Path A — Workspace mode (recommended while there's no private registry)

Scaffolds a client shell **inside this monorepo** under `clients/`, registers it in `pnpm-workspace.yaml`, and consumes the `@business-os/*` deps via `workspace:^`. No registry needed.

```sh
# From the monorepo root
pnpm install
pnpm -r build                          # one-time, so workspace packages resolve via dist/

pnpm --filter @business-os/create-client start cnn-construction \
  --name "CNN Construction" \
  --dir ./clients/cnn-construction-os \
  --workspace-mode

# Workspace gets re-resolved; install the new package's transitive deps:
pnpm install

# Bring up Postgres for the install (uses the per-client docker-compose.yml).
cd clients/cnn-construction-os
docker compose up -d postgres
cp .env.example .env                   # fresh SECRETS_KEY is already baked in
pnpm dev                               # runs migrations + Fastify + worker
```

Then in a second terminal:

```sh
cd clients/cnn-construction-os
pnpm seed:dev                          # admin@localhost / change-me-now-please + sample settings
```

Open `http://localhost:4673` in a browser. Sign in. From there:

1. **Connectors** → add an Anthropic or OpenAI instance → paste your API key → click **Set active**.
2. **Agents** → **Lead Generation** → tweak the ICP in the auto-rendered form → **Save** → **Run now**.
3. Click the new row under **Recent runs** to see drafts + audit trail. **Download CSV / Markdown** at the top.

The `email-stub` and `crm-stub` connectors are already active after `seed:dev`, so the **Prospecting** agent can run end-to-end (it'll "send" via the stub — visible in the audit log).

### Path B — Standalone shell (post-registry)

Once `@business-os/*` are published to a private registry, the same scaffolder builds a repo outside the monorepo:

```sh
pnpm create business-os-client cnn-construction \
  --name "CNN Construction" \
  --dir ~/code/cnn-construction-os

cd ~/code/cnn-construction-os
cp .env.example .env
pnpm install
docker compose up -d postgres
pnpm dev
pnpm seed:dev                          # in a second terminal
```

Pick this path when the registry is decided.

### Develop the framework itself

While editing framework code with a scaffolded client running:

```sh
pnpm install
pnpm -r build                          # rebuild dist/ across packages
pnpm -r typecheck                      # whole-workspace typecheck
pnpm -r test                           # whole-workspace tests

pnpm --filter @business-os/ui dev      # UI dev server on http://localhost:4937
                                       # (proxies /api, /auth to API_PORT)
```

Most workspace tests run pure unit-style. The integration tests against real Postgres auto-skip when it's unreachable; bring it up via `docker compose up -d postgres` (uses the docker-compose.yml at the monorepo root).

### Local prereqs

- Node.js 20+
- pnpm 9+ (this repo uses corepack: `corepack enable && corepack prepare pnpm@9.12.0 --activate`)
- Docker Desktop with WSL integration enabled (if developing inside WSL), or Postgres available on `localhost:5432`

---

## What's in the box

```
business-os/
├── packages/
│   ├── core/                 @business-os/core           Fastify server, auth, audit, secrets, admin API, boot, Sentry
│   ├── runtime/              @business-os/runtime        Registry, scheduler, ctx, connector resolver, pg-boss jobs
│   ├── agent-sdk/            @business-os/agent-sdk      The interface every agent implements + LlmPicker helper
│   ├── connector-sdk/        @business-os/connector-sdk  The interface every connector implements + capability types
│   ├── db/                   @business-os/db             Drizzle base schema + forward-only migration runner
│   ├── ui/                   @business-os/ui             Operator UI (Vite + React + Tailwind)
│   └── api-contract/         @business-os/api-contract   Zod request/response schemas
├── agents/
│   ├── leadgen/              @business-os/agent-leadgen    Prospect drafting via the llm capability
│   └── prospecting/          @business-os/agent-prospecting Per-company research + outreach
├── connectors/
│   ├── anthropic/            @business-os/connector-anthropic   LLM provider (Claude)
│   ├── openai/               @business-os/connector-openai      LLM provider (GPT)
│   ├── email-stub/           @business-os/connector-email-stub  Dev/demo email provider
│   └── crm-stub/             @business-os/connector-crm-stub    Dev/demo CRM provider (own migration)
├── tools/
│   └── create-client/        @business-os/create-client    pnpm create CLI (--workspace-mode supported)
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

## Documentation

- [docs/prd/](./docs/prd/) — product requirements
- [docs/specs/](./docs/specs/) — technical design
- [CLAUDE.md](./CLAUDE.md) — locked decisions and conventions

## License

UNLICENSED — proprietary to the project owners. Do not redistribute.
