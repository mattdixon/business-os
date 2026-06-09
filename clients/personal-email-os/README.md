# Personal Email — Business OS instance

Matt's personal-email install. Owns three inbox-triage agents that work
against Office 365 (Outlook), Gmail, or any IMAP mailbox:

- **inbox-cleanup** — bulk-sender triage. Identifies senders blasting your
  inbox and archives or trashes them. Defaults to dry-run so you can
  preview before flipping to destructive actions.
- **inbox-categorize** — labels unread into your category vocabulary
  (Newsletter / Receipt / Notification / Personal / Work / Action-Needed
  by default).
- **inbox-surface** — produces a daily digest of "needs a human response"
  with one-line rationales per message.

All three pull the LLM and inbox provider from operator settings — you
can run cleanup against Outlook and surface against Gmail in the same
install.

**Most of the work lives in the framework packages, not here.** Look in
`business-os.config.ts` to see what's installed; configure schedules,
credentials, and per-agent settings via the operator UI, NOT by editing
files in this repo.

## Local development — one command

```sh
pnpm install
pnpm dev:all
```

`pnpm dev:all` runs identically in WSL bash and Windows PowerShell. It:

1. starts Postgres via `docker compose up -d postgres`,
2. waits for it to accept connections,
3. runs `pnpm migrate` (forward-only, idempotent),
4. runs `pnpm seed:dev` (idempotent — re-runs are no-ops),
5. boots the API and the Vite UI dev server in parallel with prefixed logs.

API: `http://localhost:4674` · UI: `http://localhost:4939`. Ctrl+C stops
the dev processes; Postgres keeps running (`docker compose down` to stop).

Seed creates `admin@localhost` (password from `.env`) and pre-populates
sensible defaults for the three inbox-triage agents. Sign in, then:

1. Under **Connectors**, paste an Anthropic or OpenAI key.
2. Under **Connectors**, hit **Connect Outlook** / **Connect Gmail**, or
   add an IMAP instance with host + user + password.
3. Bind each agent to a provider (which mailbox should cleanup operate
   on? which should surface watch?).
4. **Inbox-cleanup defaults to dry-run.** Run it, review the per-sender
   plan in the run detail page, then flip the action to `archive` (or
   `trash`) in Settings once you trust it.

`pnpm seed:dev` aborts in production (NODE_ENV=production).

### Manual / piecewise

Useful when debugging a specific step:

```sh
docker compose up -d postgres   # Postgres only
pnpm migrate                    # apply migrations
pnpm seed:dev                   # seed admin + sample settings
pnpm dev                        # API + worker, foreground
pnpm dev:ui                     # Vite UI dev server, foreground
```

## Add a connector, agent, or module

1. Add the package to `dependencies` in `package.json`.
2. Import + register it in `business-os.config.ts`.
3. For a **module that ships UI pages**, also import its `./ui` entry in
   `src/ui/main.tsx` and add it to `createOperatorApp({ modules: [...] })`.
4. Run `pnpm build:ui` (or `pnpm dev:ui` for live reload) to rebuild
   the operator UI with the new pages.
5. Restart the server. The UI now exposes the new agent/connector/module.

## Operator UI

The operator UI is built from `src/ui/main.tsx` into `dist-ui/`. The Fastify
server serves that bundle at `/` when it exists, falling back to
`@business-os/ui`'s default bundle when it doesn't.

```sh
pnpm build:ui              # production bundle into dist-ui/
pnpm dev:ui                # Vite dev server on port 4938 (proxies API calls to 4673)
```

## Deploy

See `deploy/`. A Dockerfile is included as a starting point; swap in your
hosting provider's deploy pipeline.

## Secrets

`SECRETS_KEY` in `.env` is the libsodium key that encrypts every
operator-configured credential at rest. Rotating it requires re-keying
all stored secrets — don't lose it.
