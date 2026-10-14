-- Module 47 (WFH Citizen-Sourcing): the remaining anti-fraud layers and teams.
--   - location track: the phone reports its position for 10 minutes at the
--     property; the pattern of movement is analysed at submission;
--   - photo fingerprints: a photo reused from another task is refused, and an
--     image found on the internet (reverse image search) is refused;
--   - family: numbers a field partner declares for their household can never
--     be submitted as a buyer or an owner (with an Aadhaar cross-check);
--   - a fraud risk score on every submission; a high score always goes to a
--     person before anything is paid;
--   - teams of field partners.

ALTER TABLE wfh_task_assignments
  ADD COLUMN IF NOT EXISTS risk_score    SMALLINT,
  ADD COLUMN IF NOT EXISTS risk_band     VARCHAR(8),
  ADD COLUMN IF NOT EXISTS risk_reasons  JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS ai_assessment JSONB,
  ADD COLUMN IF NOT EXISTS track_summary JSONB;
CREATE INDEX IF NOT EXISTS idx_wfh_assignments_risk ON wfh_task_assignments (risk_band) WHERE risk_band = 'high';

ALTER TABLE wfh_workers
  ADD COLUMN IF NOT EXISTS family_declared_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS bank_hash          CHAR(64),
  ADD COLUMN IF NOT EXISTS risk_score         SMALLINT;
CREATE INDEX IF NOT EXISTS idx_wfh_workers_bank_hash ON wfh_workers (bank_hash) WHERE bank_hash IS NOT NULL;

-- One track per accepted task. Each sample: { lat, lng, acc, t (phone time),
-- r (time the server received it), mock }.
CREATE TABLE IF NOT EXISTS wfh_location_tracks (
    assignment_id UUID PRIMARY KEY REFERENCES wfh_task_assignments(id) ON DELETE CASCADE,
    worker_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    sample_count  INTEGER NOT NULL DEFAULT 0,
    samples       JSONB NOT NULL DEFAULT '[]'::jsonb
);

CREATE TABLE IF NOT EXISTS wfh_photo_hashes (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    assignment_id UUID NOT NULL REFERENCES wfh_task_assignments(id) ON DELETE CASCADE,
    worker_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    phash         BIGINT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wfh_photo_hashes_phash ON wfh_photo_hashes (phash);
CREATE INDEX IF NOT EXISTS idx_wfh_photo_hashes_recent ON wfh_photo_hashes (created_at DESC);

-- Household members declared by the field partner. Numbers are kept as a
-- hash and the last four digits only.
CREATE TABLE IF NOT EXISTS wfh_worker_family (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    worker_id    UUID NOT NULL REFERENCES wfh_workers(user_id) ON DELETE CASCADE,
    relation     VARCHAR(20) NOT NULL,
    name         VARCHAR(120),
    phone_hash   CHAR(64) NOT NULL,
    phone_last4  CHAR(4) NOT NULL,
    aadhaar_hash CHAR(64),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (worker_id, phone_hash)
);
CREATE INDEX IF NOT EXISTS idx_wfh_family_phone ON wfh_worker_family (phone_hash);
CREATE INDEX IF NOT EXISTS idx_wfh_family_aadhaar ON wfh_worker_family (aadhaar_hash) WHERE aadhaar_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS wfh_teams (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name       VARCHAR(80) NOT NULL,
    code       VARCHAR(12) NOT NULL UNIQUE,
    leader_id  UUID NOT NULL REFERENCES wfh_workers(user_id) ON DELETE CASCADE,
    city       VARCHAR(120),
    status     VARCHAR(12) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disbanded')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_wfh_teams_name ON wfh_teams (lower(name)) WHERE status = 'active';

-- A field partner is in one team at a time.
CREATE TABLE IF NOT EXISTS wfh_team_members (
    worker_id UUID PRIMARY KEY REFERENCES wfh_workers(user_id) ON DELETE CASCADE,
    team_id   UUID NOT NULL REFERENCES wfh_teams(id) ON DELETE CASCADE,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wfh_team_members_team ON wfh_team_members (team_id);

INSERT INTO wfh_task_config (config_key, value, description) VALUES
  ('track_minutes', '10', 'Minutes the phone must report its position at the property for a visit task'),
  ('track_min_samples', '8', 'Fewest position reports that make a usable location track'),
  ('track_enforced', 'false', 'Refuse a visit task whose location track fails (off = the failure is flagged and raises the risk score)'),
  ('photo_near_duplicate_bits', '4', 'Two photos whose fingerprints differ by this many bits or fewer count as the same picture'),
  ('reverse_search_enabled', 'true', 'Check submitted photos against the internet (needs GOOGLE_VISION_API_KEY and / or ANTHROPIC_API_KEY)'),
  ('family_declaration_required', 'true', 'Field partners must declare their household''s mobile numbers before taking tasks'),
  ('risk_review_score', '60', 'Fraud risk score (0-100) from which a submission is held for a person to decide'),
  ('risk_watch_score', '30', 'Fraud risk score from which a submission is marked for attention'),
  ('ai_fraud_review', 'true', 'Ask the AI for a second opinion on a submission''s fraud signals (needs ANTHROPIC_API_KEY)'),
  ('team_max_size', '10', 'Most field partners in one team')
ON CONFLICT (config_key) DO NOTHING;
