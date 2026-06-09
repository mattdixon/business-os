-- Per-user theme preference.
-- 'system' (default) follows the OS / browser prefers-color-scheme.
-- 'light' and 'dark' are explicit overrides.
ALTER TABLE users
  ADD COLUMN theme text NOT NULL DEFAULT 'system'
  CHECK (theme IN ('light', 'dark', 'system'));
