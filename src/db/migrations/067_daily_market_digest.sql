-- Daily Market Notification (sec. 20.4): a personalised digest for brokers,
-- by the localities each one selects - new properties, new buyer
-- requirements, urgent deals and market alerts. Compiled and sent inside the
-- windows in posting_windows (no hardcoded times), WhatsApp first plus push.

-- The areas a broker follows. areas = [{ "city": "Pune", "locality": "Baner" }, ...];
-- an entry without a locality follows the whole city.
CREATE TABLE IF NOT EXISTS market_digest_subscriptions (
    user_id    UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    enabled    BOOLEAN NOT NULL DEFAULT true,
    areas      JSONB NOT NULL DEFAULT '[]'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One digest per person per day, kept so it can be opened again in the app.
CREATE TABLE IF NOT EXISTS market_digests (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    digest_date DATE NOT NULL,
    areas       JSONB NOT NULL DEFAULT '[]'::jsonb,
    content     JSONB NOT NULL DEFAULT '{}'::jsonb,
    item_count  INTEGER NOT NULL DEFAULT 0,
    sent_at     TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, digest_date)
);
CREATE INDEX IF NOT EXISTS idx_market_digests_unsent ON market_digests (digest_date) WHERE sent_at IS NULL;

INSERT INTO posting_windows (content_type, time_start, time_end, priority, notes)
SELECT v.content_type, v.time_start::time, v.time_end::time, 0, v.notes
FROM (VALUES
  ('market_digest_aggregate', '08:30', '09:00', 'Daily market digest is compiled'),
  ('market_digest', '09:00', '10:30', 'Daily market digest is sent to brokers')
) AS v(content_type, time_start, time_end, notes)
WHERE NOT EXISTS (SELECT 1 FROM posting_windows p WHERE p.content_type = v.content_type);

INSERT INTO app_config (config_key, value, category, description) VALUES
  ('market_digest.enabled', 'true', 'notifications', 'Send the daily market digest to brokers'),
  ('market_digest.roles', '["broker", "agency_admin", "builder"]', 'notifications', 'Roles that receive the daily market digest'),
  ('market_digest.max_items', '5', 'notifications', 'Most entries in each part of the daily market digest'),
  ('market_digest.lookback_hours', '24', 'notifications', 'How far back the daily market digest looks for new listings and requirements'),
  ('market_digest.price_move_percent', '2', 'notifications', 'A locality price change of at least this much (up or down) is a market alert')
ON CONFLICT (config_key) DO NOTHING;
