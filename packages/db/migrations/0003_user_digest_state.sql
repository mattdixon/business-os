-- Tracks when each user last received their daily digest, so the digest
-- agent's `since` cursor is correct and re-runs don't double-send.
-- Inserted lazily on first digest send per user.

CREATE TABLE user_digest_state (
  user_id        uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  last_sent_at   timestamptz NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
