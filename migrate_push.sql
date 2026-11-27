-- ManteniPro Push: migration for the existing D1 database.
-- Run once in the D1 SQL Console.
ALTER TABLE reminders ADD COLUMN repeat_rule TEXT NOT NULL DEFAULT 'none';

CREATE TABLE IF NOT EXISTS registration_rate_limits (
  ip_hash TEXT PRIMARY KEY,
  window_started_at INTEGER NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_registration_rate_limits_updated
ON registration_rate_limits(updated_at);
