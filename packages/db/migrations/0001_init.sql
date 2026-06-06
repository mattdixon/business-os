-- @business-os/db / 0001_init
-- Core single-tenant schema. Forward-only: never edit; write a follow-up.

CREATE TABLE users (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email                   text NOT NULL,
  password_hash           text NOT NULL,
  display_name            text,
  totp_secret_encrypted   text,
  is_active               boolean NOT NULL DEFAULT true,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_uniq ON users (email);

CREATE TABLE sessions (
  id              text PRIMARY KEY,
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,
  revoked_at      timestamptz,
  ip              text,
  user_agent      text
);
CREATE INDEX sessions_user_idx ON sessions (user_id);
CREATE INDEX sessions_expires_idx ON sessions (expires_at);

CREATE TABLE password_reset_tokens (
  id          text PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz
);
CREATE INDEX password_reset_user_idx ON password_reset_tokens (user_id);

CREATE TABLE secrets (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope       text NOT NULL,
  key         text NOT NULL,
  ciphertext  text NOT NULL,
  nonce       text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX secrets_scope_key_uniq ON secrets (scope, key);

CREATE TABLE settings (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope       text NOT NULL,
  value       jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid REFERENCES users(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX settings_scope_uniq ON settings (scope);

CREATE TABLE connector_instances (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  capability      text NOT NULL,
  provider_slug   text NOT NULL,
  display_name    text NOT NULL,
  is_active       boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX connector_instances_capability_idx ON connector_instances (capability);

CREATE TABLE audit_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  at          timestamptz NOT NULL DEFAULT now(),
  action      text NOT NULL,
  user_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  agent_slug  text,
  request_id  text,
  meta        jsonb
);
CREATE INDEX audit_log_at_idx ON audit_log (at);
CREATE INDEX audit_log_action_idx ON audit_log (action);
CREATE INDEX audit_log_user_idx ON audit_log (user_id);

CREATE TABLE agent_runs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_slug    text NOT NULL,
  started_at    timestamptz NOT NULL DEFAULT now(),
  ended_at      timestamptz,
  ok            boolean,
  summary       text,
  details       jsonb,
  trigger       text NOT NULL,
  triggered_by  uuid REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX agent_runs_agent_idx ON agent_runs (agent_slug);
CREATE INDEX agent_runs_started_idx ON agent_runs (started_at);
