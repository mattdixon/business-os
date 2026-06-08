# @business-os/create-client

Scaffolds a thin per-client Business OS install repo from `templates/client-starter`.

## Use

```sh
pnpm create business-os-client c-and-m-construction \
  --name "C&M Construction" \
  --dir ~/code/c-and-m-construction-os
```

Positional argument is the kebab-case slug; flags:

- `--name` — display name (defaults to title-cased slug)
- `--dir` — target directory (defaults to `./<slug>-os`)

What it does:

- Reads `templates/client-starter/manifest.json` to know which files need placeholder substitution vs. verbatim copy.
- Substitutes `{{CLIENT_SLUG}}`, `{{CLIENT_NAME}}`, and `{{GENERATED_SECRETS_KEY}}` (32 random bytes, base64).
- Validates the slug shape (`/^[a-z][a-z0-9-]*[a-z0-9]$/`, 2-50 chars).
- Refuses to overwrite a non-empty target.
- Prints the next-step commands.

## After scaffolding

```sh
cd <dir>
cp .env.example .env       # fill in DATABASE_URL etc.
pnpm install
docker compose up -d postgres
pnpm dev
```
