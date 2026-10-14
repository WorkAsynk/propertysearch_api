-- Sec. 14 White-Label Franchise Model.
--   - A franchisee is an organisation (a tenant) with a permanent code
--     (FR-[SLUG] / ORG-[SERIAL]), a Franchisee Admin login and its own brokers.
--   - Territory is granted at pincode level (exclusive / open / reserved);
--     a territory step runs before the Sec. 34 assignment cascade.
--   - Commission on a franchisee-territory deal is one pool (buyer + seller
--     professional fee) split by role (sec. 14.6), released only after
--     A R Buildwel has collected the client invoices.
--   - Dues from the franchisee to A R Buildwel are tracked per invoice with
--     the automatic 3-level suspension (sec. 14.7).
--   - Branding (logo, colours, texts, domain) is a configuration layer; every
--     domain stays owned by A R Buildwel (sec. 14.8).
--   - A Franchisee Admin never sees leads or contacts (sec. 14.9) - the role
--     has no access to the lead / customer / deal routes at all.

INSERT INTO roles (name, description)
SELECT 'franchisee_admin', 'Franchisee Admin - own broker network, commission, branding, support (sec. 14). Never sees leads or contacts.'
WHERE NOT EXISTS (SELECT 1 FROM roles WHERE name = 'franchisee_admin');

CREATE SEQUENCE franchisee_org_seq;
CREATE SEQUENCE franchisee_invoice_seq;
CREATE SEQUENCE franchisee_ticket_seq;

CREATE TABLE franchisees (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id             UUID NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE RESTRICT,
    -- FR-[ORG_SLUG]: invoicing, commission, suspension, branding, reporting. Never commission-bearing.
    org_code              VARCHAR(60) NOT NULL UNIQUE,
    org_serial            VARCHAR(20) NOT NULL UNIQUE,
    -- Registered firm name: internal only (GST invoicing and settlement), never shown to a client.
    legal_name            VARCHAR(200) NOT NULL,
    gstin                 VARCHAR(20),
    pan                   VARCHAR(12),
    contact_name          VARCHAR(150),
    contact_email         VARCHAR(150),
    contact_mobile        VARCHAR(20),
    address               TEXT,
    admin_user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
    -- Franchisee Manager (FM): the A R Buildwel employee a missed inquiry escalates to.
    manager_user_id       UUID REFERENCES users(id) ON DELETE SET NULL,
    status                VARCHAR(15) NOT NULL DEFAULT 'active' CHECK (status IN ('pending', 'active', 'terminated')),
    -- Presenting as A R Buildwel is the condition for territory-routed leads.
    branding_compliant    BOOLEAN NOT NULL DEFAULT true,
    deployment_tier       VARCHAR(12) NOT NULL DEFAULT 'shared' CHECK (deployment_tier IN ('shared', 'dedicated', 'hybrid')),
    agreement_start       DATE,
    agreement_end         DATE,
    suspension_status     VARCHAR(10) NOT NULL DEFAULT 'active' CHECK (suspension_status IN ('active', 'level_1', 'level_2', 'level_3')),
    suspension_start_date TIMESTAMPTZ,
    total_outstanding     NUMERIC(14,2) NOT NULL DEFAULT 0,
    last_payment_date     TIMESTAMPTZ,
    -- Reach used for territory sizing: brokers, SLA compliance, closure rate (recalculated by the sweep).
    reach                 JSONB NOT NULL DEFAULT '{}'::jsonb,
    reach_computed_at     TIMESTAMPTZ,
    notes                 TEXT,
    created_by            UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_franchisees_suspension ON franchisees (suspension_status);
CREATE TRIGGER trg_franchisees_updated_at BEFORE UPDATE ON franchisees
    FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- Branding engine (sec. 14.2). `draft` is what the franchisee is editing;
-- the columns are what is live. A R Buildwel creates the domain mapping.
CREATE TABLE franchisee_branding (
    franchisee_id   UUID PRIMARY KEY REFERENCES franchisees(id) ON DELETE CASCADE,
    -- arb_representative: presents as A R Buildwel, firm name small (Phase 1 public identity).
    -- white_label: own brand on a domain A R Buildwel owns.
    brand_mode      VARCHAR(20) NOT NULL DEFAULT 'arb_representative' CHECK (brand_mode IN ('arb_representative', 'white_label')),
    brand_name      VARCHAR(120),
    logo_url        TEXT,
    favicon_url     TEXT,
    primary_color   VARCHAR(9),
    secondary_color VARCHAR(9),
    font_family     VARCHAR(80),
    header_text     VARCHAR(200),
    footer_text     TEXT,
    email_from_name VARCHAR(120),
    legal_pages     JSONB NOT NULL DEFAULT '{}'::jsonb,
    draft           JSONB NOT NULL DEFAULT '{}'::jsonb,
    published_at    TIMESTAMPTZ,
    -- Model 1: subdomain of an A R Buildwel domain. Model 2: a separate domain A R Buildwel holds.
    domain_model    VARCHAR(12) CHECK (domain_model IS NULL OR domain_model IN ('subdomain', 'own_domain')),
    host            VARCHAR(150) UNIQUE,
    domain_active   BOOLEAN NOT NULL DEFAULT false,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE franchisee_territories (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- NULL while a territory is reserved for expansion and not yet granted.
    franchisee_id     UUID REFERENCES franchisees(id) ON DELETE CASCADE,
    name              VARCHAR(150) NOT NULL,
    grant_type        VARCHAR(12) NOT NULL CHECK (grant_type IN ('exclusive', 'open', 'reserved')),
    pincodes          TEXT[] NOT NULL DEFAULT '{}',
    status            VARCHAR(10) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'withdrawn')),
    -- Reserved-for-expansion: the franchisee with right of first refusal.
    first_refusal_franchisee_id UUID REFERENCES franchisees(id) ON DELETE SET NULL,
    granted_on        DATE NOT NULL DEFAULT CURRENT_DATE,
    review_on         DATE,
    notes             TEXT,
    created_by        UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_franchisee_territories_pincodes ON franchisee_territories USING gin (pincodes);
CREATE INDEX idx_franchisee_territories_franchisee ON franchisee_territories (franchisee_id);
CREATE TRIGGER trg_franchisee_territories_updated_at BEFORE UPDATE ON franchisee_territories
    FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- Territory Conflict Check: flag and route to Super Admin, never hard-block.
CREATE TABLE territory_conflicts (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kind                  VARCHAR(30) NOT NULL CHECK (kind IN ('cross_territory_listing', 'cross_territory_lead', 'overlapping_grant', 'boundary')),
    pincode               VARCHAR(10),
    property_id           UUID REFERENCES properties(id) ON DELETE SET NULL,
    lead_id               UUID REFERENCES leads(id) ON DELETE SET NULL,
    owner_franchisee_id   UUID REFERENCES franchisees(id) ON DELETE CASCADE,
    other_franchisee_id   UUID REFERENCES franchisees(id) ON DELETE CASCADE,
    actor_user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
    detail                TEXT,
    status                VARCHAR(10) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
    resolution            TEXT,
    resolved_by           UUID REFERENCES users(id) ON DELETE SET NULL,
    resolved_at           TIMESTAMPTZ,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_territory_conflicts_status ON territory_conflicts (status, created_at);

-- Commission calculation for one franchisee-territory deal (sec. 14.6).
CREATE TABLE franchisee_commissions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    franchisee_id   UUID NOT NULL REFERENCES franchisees(id) ON DELETE CASCADE,
    deal_id         UUID NOT NULL UNIQUE REFERENCES deals(id) ON DELETE CASCADE,
    -- Registered / cheque consideration only.
    deal_value      NUMERIC(16,2) NOT NULL,
    buyer_fee       NUMERIC(14,2) NOT NULL DEFAULT 0,
    seller_fee      NUMERIC(14,2) NOT NULL DEFAULT 0,
    pool_amount     NUMERIC(14,2) NOT NULL,
    scenario        VARCHAR(20) NOT NULL CHECK (scenario IN ('no_broker', 'with_broker', 'own_business')),
    -- [{ party, userId, name, roles, fraction, base, gstRegistered, gst, total }]
    shares          JSONB NOT NULL,
    franchisee_base NUMERIC(14,2) NOT NULL DEFAULT 0,
    arb_base        NUMERIC(14,2) NOT NULL DEFAULT 0,
    -- calculated -> releasable (client invoices collected) -> released
    status          VARCHAR(12) NOT NULL DEFAULT 'calculated' CHECK (status IN ('calculated', 'releasable', 'released')),
    collected_at    TIMESTAMPTZ,
    released_at     TIMESTAMPTZ,
    released_by     UUID REFERENCES users(id) ON DELETE SET NULL,
    payout_reference VARCHAR(120),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_franchisee_commissions_franchisee ON franchisee_commissions (franchisee_id, created_at DESC);

-- Dues from the franchisee to A R Buildwel (sec. 14.7 / 14.10).
CREATE TABLE franchisee_payment_tracking (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    franchisee_id         UUID NOT NULL REFERENCES franchisees(id) ON DELETE CASCADE,
    deal_id               UUID REFERENCES deals(id) ON DELETE SET NULL,
    invoice_number        VARCHAR(30) NOT NULL UNIQUE,
    kind                  VARCHAR(15) NOT NULL DEFAULT 'commission' CHECK (kind IN ('commission', 'setup_fee', 'annual_fee', 'domain', 'other')),
    description           VARCHAR(250),
    base_amount           NUMERIC(14,2) NOT NULL CHECK (base_amount > 0),
    gst_amount            NUMERIC(14,2) NOT NULL DEFAULT 0,
    invoice_amount        NUMERIC(14,2) NOT NULL,
    late_fee              NUMERIC(14,2) NOT NULL DEFAULT 0,
    payment_status        VARCHAR(12) NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending', 'paid', 'overdue', 'written_off')),
    invoice_date          TIMESTAMPTZ NOT NULL DEFAULT now(),
    payment_due_date      TIMESTAMPTZ NOT NULL,
    payment_received_date TIMESTAMPTZ,
    suspension_status     VARCHAR(10) NOT NULL DEFAULT 'active' CHECK (suspension_status IN ('active', 'level_1', 'level_2', 'level_3')),
    suspension_start_date TIMESTAMPTZ,
    last_reminder_sent    TIMESTAMPTZ,
    -- Which step of the Day 6 / 8 / 10 / 15 / 30 ladder has been acted on.
    ladder_step           VARCHAR(12) NOT NULL DEFAULT 'issued',
    payment_reference     VARCHAR(120),
    payment_claimed_at    TIMESTAMPTZ,
    gateway               VARCHAR(20),
    gateway_order_id      VARCHAR(80),
    gateway_payment_id    VARCHAR(80),
    recorded_by           UUID REFERENCES users(id) ON DELETE SET NULL,
    created_by            UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_fpt_franchisee ON franchisee_payment_tracking (franchisee_id);
CREATE INDEX idx_fpt_payment_status ON franchisee_payment_tracking (payment_status);
CREATE INDEX idx_fpt_suspension_status ON franchisee_payment_tracking (suspension_status);

CREATE TABLE franchisee_tickets (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_number VARCHAR(20) NOT NULL UNIQUE,
    franchisee_id UUID NOT NULL REFERENCES franchisees(id) ON DELETE CASCADE,
    raised_by     UUID REFERENCES users(id) ON DELETE SET NULL,
    category      VARCHAR(20) NOT NULL DEFAULT 'general' CHECK (category IN ('general', 'billing', 'territory', 'branding', 'brokers', 'technical')),
    subject       VARCHAR(200) NOT NULL,
    status        VARCHAR(12) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE franchisee_ticket_messages (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id  UUID NOT NULL REFERENCES franchisee_tickets(id) ON DELETE CASCADE,
    author_id  UUID REFERENCES users(id) ON DELETE SET NULL,
    from_staff BOOLEAN NOT NULL DEFAULT false,
    body       TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_franchisee_tickets_franchisee ON franchisee_tickets (franchisee_id, status);

-- Territory on the inquiry (sec. 14.10): the lead always belongs to
-- A R Buildwel; the franchisee is only the org it was routed through.
ALTER TABLE leads
    ADD COLUMN franchisee_id UUID REFERENCES franchisees(id) ON DELETE SET NULL,
    ADD COLUMN territory_id UUID REFERENCES franchisee_territories(id) ON DELETE SET NULL,
    ADD COLUMN can_broker_see BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN reassigned_to_arb_on TIMESTAMPTZ;
CREATE INDEX idx_leads_franchisee ON leads (franchisee_id, can_broker_see) WHERE franchisee_id IS NOT NULL;

ALTER TABLE deals ADD COLUMN franchisee_id UUID REFERENCES franchisees(id) ON DELETE SET NULL;
CREATE INDEX idx_deals_franchisee ON deals (franchisee_id) WHERE franchisee_id IS NOT NULL;

-- Territory is granted by pincode, so a listing can carry its own.
ALTER TABLE properties ADD COLUMN IF NOT EXISTS pincode VARCHAR(10);
ALTER TABLE requirements ADD COLUMN IF NOT EXISTS pincode VARCHAR(10);

-- Franchisee Manager designation for A R Buildwel staff.
ALTER TABLE arb_representatives DROP CONSTRAINT arb_representatives_designation_check;
ALTER TABLE arb_representatives ADD CONSTRAINT arb_representatives_designation_check
    CHECK (designation IN ('rm', 'dm', 'tl', 'tc', 'fm'));

INSERT INTO app_config (config_key, value, category, description) VALUES
  ('franchise.suspension_ladder', '{"grace_days": 5, "reminder_day": 6, "notice_day": 8, "level_1_day": 10, "level_2_day": 15, "level_3_day": 30}', 'franchise', 'Days after the invoice date for each step of the franchisee payment ladder (sec. 14.7)'),
  ('franchise.late_fee', '{"level_2_percent": 2, "level_3_percent": 5}', 'franchise', 'Late fee added to an unpaid franchisee invoice at Level 2 and Level 3, as a percent of the invoice amount'),
  ('franchise.payment_terms_days', '10', 'franchise', 'Days from the invoice date to the due date printed on a franchisee invoice'),
  ('franchise.commission_split', '{"no_broker_franchisee": 0.5, "broker_side": 0.3333333333, "representative": 0.1666666667}', 'franchise', 'Shares of the commission pool: franchisee with no broker; each broker side; the franchisee as territory representative (sec. 14.6)'),
  ('franchise.gst_percent', '18', 'franchise', 'GST added to a share or a franchisee invoice when the recipient / A R Buildwel is GST-registered'),
  ('franchise.exempt_tracks', '["institutional", "auction", "special_situation", "nri", "hni"]', 'franchise', 'Deal tracks handled centrally - never routed by territory'),
  ('franchise.auto_invoice_on_close', 'false', 'franchise', 'Raise an invoice to the franchisee for A R Buildwel''s share when a territory deal closes (use only where the franchisee, not A R Buildwel, collected the fee)'),
  ('franchise.root_domains', '["propertyserch.com", "arbuildwel.in"]', 'franchise', 'A R Buildwel-owned root domains a franchisee subdomain may sit under')
ON CONFLICT (config_key) DO NOTHING;
