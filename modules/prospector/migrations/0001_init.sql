-- @business-os/module-prospector / 0001_init
-- Per-user thumbs feedback on bids surfaced by the bid-watcher agent.
-- The bids themselves live in bid_watcher_seen, owned by the agent. The
-- module owns the feedback signal: one row per (user, bid), latest rating
-- wins via UNIQUE.

CREATE TABLE prospector_bid_feedback (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source       text NOT NULL,
  external_id  text NOT NULL,
  rating       smallint NOT NULL CHECK (rating IN (-1, 1)),
  reason       text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, source, external_id)
);

CREATE INDEX prospector_bid_feedback_bid_idx
  ON prospector_bid_feedback (source, external_id);
