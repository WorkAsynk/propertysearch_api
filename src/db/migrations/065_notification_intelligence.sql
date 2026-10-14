-- Module 43: Notification Intelligence (sec. 20.3 / 20.4 and the Notification
-- Centre specification).
--   - every notification carries a category (Match / Deal / Mandate / Invoice /
--     System / Market), a priority and, for the two red alerts, a persistent
--     flag that stays until the mandate or invoice itself is settled;
--   - preferences per category: mute, frequency (instant / daily / weekly) and
--     channel (push, WhatsApp, email, SMS), plus quiet hours;
--   - deliveries outside the app are queued, retried and dead-lettered;
--   - low-priority and over-the-cap items are batched into a digest sent in the
--     posting window, which is data (posting_windows), not code.

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS category    VARCHAR(12),
  ADD COLUMN IF NOT EXISTS priority    VARCHAR(10) NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS persistent  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS read_at     TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications (user_id, created_at DESC);
-- Read-rate figures on the admin screen look at recent rows across everyone.
CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications (created_at DESC) WHERE category IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_persistent ON notifications (user_id) WHERE persistent AND resolved_at IS NULL;

-- { "match": { "muted": false, "frequency": "instant", "channels": { "push": true, "whatsapp": true, "email": true, "sms": false } }, ... }
ALTER TABLE notification_preferences
  ADD COLUMN IF NOT EXISTS category_prefs JSONB NOT NULL DEFAULT '{}'::jsonb;

-- One row per attempt to reach a person outside the app. notification_id has
-- no foreign key on purpose: a notification raised inside a transaction is not
-- visible to the dispatcher until it commits.
CREATE TABLE IF NOT EXISTS notification_deliveries (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    notification_id UUID,
    digest_id       UUID,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel         VARCHAR(12) NOT NULL CHECK (channel IN ('push', 'whatsapp', 'email', 'sms')),
    type            VARCHAR(50),
    priority        VARCHAR(10) NOT NULL DEFAULT 'normal',
    title           VARCHAR(200) NOT NULL,
    body            TEXT,
    status          VARCHAR(10) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'held', 'sent', 'failed', 'dead', 'skipped')),
    reason          VARCHAR(40),
    attempts        SMALLINT NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_error      TEXT,
    batch_id        UUID,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    sent_at         TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_notif_deliveries_due ON notification_deliveries (next_attempt_at) WHERE status IN ('queued', 'held', 'failed');
CREATE INDEX IF NOT EXISTS idx_notif_deliveries_user ON notification_deliveries (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notif_deliveries_status ON notification_deliveries (status, created_at DESC);

CREATE TABLE IF NOT EXISTS notification_digests (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    frequency   VARCHAR(8) NOT NULL CHECK (frequency IN ('daily', 'weekly')),
    digest_date DATE NOT NULL,
    item_count  INTEGER NOT NULL,
    summary     JSONB NOT NULL DEFAULT '{}'::jsonb,
    channels    JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, frequency, digest_date)
);

-- Notifications waiting for the next digest.
CREATE TABLE IF NOT EXISTS notification_digest_items (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    notification_id UUID NOT NULL,
    frequency       VARCHAR(8) NOT NULL CHECK (frequency IN ('daily', 'weekly')),
    reason          VARCHAR(40) NOT NULL,
    digest_id       UUID REFERENCES notification_digests(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notif_digest_items_pending ON notification_digest_items (frequency, user_id) WHERE digest_id IS NULL;

-- When scheduled content goes out (sec. 20.4: "reads from posting_windows -
-- no hardcoded times"). city NULL = every city; day_of_week NULL = every day
-- (0 = Sunday). Times are India time. The highest priority matching row wins.
CREATE TABLE IF NOT EXISTS posting_windows (
    window_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    city         VARCHAR(120),
    content_type VARCHAR(40) NOT NULL,
    day_of_week  SMALLINT CHECK (day_of_week BETWEEN 0 AND 6),
    time_start   TIME NOT NULL,
    time_end     TIME NOT NULL,
    priority     INTEGER NOT NULL DEFAULT 0,
    notes        TEXT,
    is_active    BOOLEAN NOT NULL DEFAULT true,
    updated_by   UUID REFERENCES users(id),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (time_end > time_start)
);
CREATE INDEX IF NOT EXISTS idx_posting_windows_type ON posting_windows (content_type) WHERE is_active;

INSERT INTO posting_windows (content_type, time_start, time_end, priority, notes)
SELECT v.content_type, v.time_start::time, v.time_end::time, 0, v.notes
FROM (VALUES
  ('notification_digest', '09:30', '10:30', 'Daily and weekly notification digest - broker engagement window'),
  ('match_digest', '09:00', '10:30', 'Daily digest of warm matches')
) AS v(content_type, time_start, time_end, notes)
WHERE NOT EXISTS (SELECT 1 FROM posting_windows p WHERE p.content_type = v.content_type);

INSERT INTO app_config (config_key, value, category, description) VALUES
  ('notifications.routing', '{"critical": ["whatsapp", "push", "sms"], "high": ["push", "whatsapp"], "normal": ["push"], "low": [], "digest": ["whatsapp", "email", "push"]}', 'notifications', 'Channels tried for each priority. A channel is used only when the person has it switched on. Low priority goes to the digest.'),
  ('notifications.default_prefs', '{"frequency": {"market": "daily"}, "channels": {"push": true, "whatsapp": true, "email": true, "sms": false}}', 'notifications', 'Preferences for people who have not chosen their own'),
  ('notifications.quiet_default', '{"start": "22:00", "end": "08:00"}', 'notifications', 'Quiet hours for people who have not set their own (India time)'),
  ('notifications.fatigue_daily_cap', '8', 'notifications', 'Instant messages a person gets outside the app in a day before the rest wait for the digest (critical ones are never held)'),
  ('notifications.burst_minutes', '10', 'notifications', 'Several alerts of the same kind inside this many minutes are sent as one message'),
  ('notifications.low_engagement_count', '10', 'notifications', 'When a person has left this many alerts of one category unread in a row, that category moves to the digest (0 = off)'),
  ('notifications.retry_seconds', '[10, 60, 300]', 'notifications', 'Wait before each retry of a failed delivery; after the last one it is dead-lettered'),
  ('notifications.weekly_day', '1', 'notifications', 'Day the weekly summary goes out (0 = Sunday)'),
  ('notifications.whatsapp_template', '"ps_notification"', 'notifications', 'Approved WhatsApp template with two body variables: title and message')
ON CONFLICT (config_key) DO NOTHING;
