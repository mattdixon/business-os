-- @business-os/module-example / 0001_init
-- Minimal notes table — proves the module-owned schema path works.

CREATE TABLE example_notes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title       text NOT NULL,
  body        text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX example_notes_created_idx ON example_notes (created_at DESC);
