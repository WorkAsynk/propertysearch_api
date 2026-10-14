-- Module 34 - Onboarding Assist (brokers, agencies and builders) and
-- Module 37 - Broker Network (co-broking workflow).
--
-- Onboarding: the Screen 2 details (areas served, firm, RERA, preferences),
-- a checklist worked out from what the partner has actually done, a named
-- A R Buildwel staff member who helps, notes of every assist, automatic
-- nudges when someone stalls, and "Join as Broker / Builder" enquiries
-- turned into accounts.
--
-- Co-broking: one broker proposes to work another broker's listing (or
-- buyer requirement) together, they agree a split, the deal is linked and
-- the split is recorded when it closes. Brokers never see each other's
-- phone or email; clients stay with the A R Buildwel representative.

CREATE SEQUENCE cobroke_agreement_seq;

CREATE TABLE partner_onboarding (
    user_id              UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    firm_name            VARCHAR(200),
    rera_number          VARCHAR(60),
    -- Area selection is mandatory for a broker (multi-select).
    cities               TEXT[] NOT NULL DEFAULT '{}',
    areas                TEXT[] NOT NULL DEFAULT '{}',
    -- { propertyTypes, dealTypes, budgetBands, languages, teamSize, experienceYears, projectTypes }
    preferences          JSONB NOT NULL DEFAULT '{}'::jsonb,
    details_completed_at TIMESTAMPTZ,
    completed_at         TIMESTAMPTZ,
    -- The A R Buildwel staff member assisting this partner.
    assisted_by          UUID REFERENCES users(id) ON DELETE SET NULL,
    bd_lead_id           UUID REFERENCES bd_leads(id) ON DELETE SET NULL,
    -- Progress tracking for the stall check.
    done_count           SMALLINT NOT NULL DEFAULT 0,
    last_progress_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    nudge_count          SMALLINT NOT NULL DEFAULT 0,
    nudged_at            TIMESTAMPTZ,
    help_requested_at    TIMESTAMPTZ,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_partner_onboarding_assisted ON partner_onboarding (assisted_by);
CREATE TRIGGER trg_partner_onboarding_updated_at BEFORE UPDATE ON partner_onboarding
    FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TABLE partner_onboarding_notes (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    author_id  UUID REFERENCES users(id) ON DELETE SET NULL,
    kind       VARCHAR(15) NOT NULL DEFAULT 'note' CHECK (kind IN ('note', 'call', 'visit', 'nudge', 'help_request', 'system')),
    body       TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_partner_onboarding_notes_user ON partner_onboarding_notes (user_id, created_at DESC);

ALTER TABLE bd_leads
    ADD COLUMN converted_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN converted_at TIMESTAMPTZ;

CREATE TABLE cobroke_agreements (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agreement_number      VARCHAR(20) NOT NULL UNIQUE,
    proposer_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    partner_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- listing: the partner holds the listing, the proposer brings the buyer.
    -- requirement: the partner holds the buyer, the proposer brings a listing.
    subject_type          VARCHAR(12) NOT NULL CHECK (subject_type IN ('listing', 'requirement')),
    property_id           UUID REFERENCES properties(id) ON DELETE SET NULL,
    requirement_id        UUID REFERENCES requirements(id) ON DELETE SET NULL,
    split_proposer_percent NUMERIC(5,2) NOT NULL CHECK (split_proposer_percent > 0 AND split_proposer_percent < 100),
    split_partner_percent  NUMERIC(5,2) NOT NULL CHECK (split_partner_percent > 0 AND split_partner_percent < 100),
    status                VARCHAR(12) NOT NULL DEFAULT 'proposed'
                          CHECK (status IN ('proposed', 'countered', 'accepted', 'declined', 'withdrawn', 'expired', 'deal_open', 'completed', 'cancelled')),
    -- Who made the offer now on the table (the other side answers it).
    last_offer_by         UUID REFERENCES users(id) ON DELETE SET NULL,
    expires_at            TIMESTAMPTZ,
    accepted_at           TIMESTAMPTZ,
    deal_id               UUID REFERENCES deals(id) ON DELETE SET NULL,
    -- Recorded when the deal closes: { basis, proposerAmount, partnerAmount }.
    settlement            JSONB,
    completed_at          TIMESTAMPTZ,
    cancel_reason         TEXT,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (proposer_id <> partner_id),
    CHECK (split_proposer_percent + split_partner_percent = 100),
    CHECK ((subject_type = 'listing' AND property_id IS NOT NULL) OR (subject_type = 'requirement' AND requirement_id IS NOT NULL))
);
CREATE INDEX idx_cobroke_proposer ON cobroke_agreements (proposer_id, status);
CREATE INDEX idx_cobroke_partner ON cobroke_agreements (partner_id, status);
CREATE INDEX idx_cobroke_property ON cobroke_agreements (property_id);
CREATE INDEX idx_cobroke_deal ON cobroke_agreements (deal_id);
CREATE TRIGGER trg_cobroke_agreements_updated_at BEFORE UPDATE ON cobroke_agreements
    FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- Every offer, answer and message: append-only, so a split dispute can be reconstructed.
CREATE TABLE cobroke_events (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agreement_id UUID NOT NULL REFERENCES cobroke_agreements(id) ON DELETE CASCADE,
    kind         VARCHAR(15) NOT NULL,
    actor_id     UUID REFERENCES users(id) ON DELETE SET NULL,
    split_proposer_percent NUMERIC(5,2),
    note         TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_cobroke_events_agreement ON cobroke_events (agreement_id, created_at);
CREATE OR REPLACE FUNCTION cobroke_events_append_only() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'cobroke_events is append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_cobroke_events_append_only BEFORE UPDATE OR DELETE ON cobroke_events
    FOR EACH ROW EXECUTE FUNCTION cobroke_events_append_only();

INSERT INTO app_config (config_key, value, category, description) VALUES
  ('onboarding.stall_days', '3', 'onboarding', 'Days without progress before a broker or builder still onboarding is nudged'),
  ('onboarding.max_nudges', '3', 'onboarding', 'Automatic nudges before the assisting staff member is asked to step in'),
  ('cobroke.default_split', '{"listing_side": 50, "buyer_side": 50}', 'cobroke', 'Suggested split of the brokers'' share between the broker holding the listing and the broker bringing the buyer'),
  ('cobroke.min_share_percent', '10', 'cobroke', 'Smallest share either broker can be offered in a co-broking agreement'),
  ('cobroke.proposal_valid_days', '7', 'cobroke', 'Days a co-broking offer stays open before it expires')
ON CONFLICT (config_key) DO NOTHING;
