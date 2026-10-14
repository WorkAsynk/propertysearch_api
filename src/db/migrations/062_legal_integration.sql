-- Module 24 - Legal Integration.
--   - Empanelled advocates and registered valuers ("legal professionals").
--     An LP code is issued only after the enrolment / empanelment check is
--     recorded. The code is for attribution only - it is never
--     commission-bearing (Bar Council of India rules on fee-sharing).
--   - Legal cases: describe the requirement -> documents auto-linked ->
--     advocate assigned -> status tracked. A R Buildwel refers and
--     coordinates; the client engages the advocate directly and may name an
--     advocate of their own choice instead.

CREATE SEQUENCE legal_case_seq;

CREATE TABLE legal_professionals (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- ^LP-[A-HJ-KM-NP-Z2-9]{5}$ - issued on verification, never before.
    lp_code           VARCHAR(8) UNIQUE,
    kind              VARCHAR(10) NOT NULL DEFAULT 'advocate' CHECK (kind IN ('advocate', 'valuer')),
    full_name         VARCHAR(150) NOT NULL,
    firm_name         VARCHAR(200),
    -- Bar Council enrolment number, or the valuer's registration number.
    enrolment_number  VARCHAR(60) NOT NULL,
    enrolment_body    VARCHAR(150),
    email             VARCHAR(150),
    mobile            VARCHAR(20),
    states            TEXT[] NOT NULL DEFAULT '{}',
    cities            TEXT[] NOT NULL DEFAULT '{}',
    specialities      TEXT[] NOT NULL DEFAULT '{}',
    status            VARCHAR(12) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'empanelled', 'suspended')),
    verified_by       UUID REFERENCES users(id) ON DELETE SET NULL,
    verified_at       TIMESTAMPTZ,
    -- What was checked (enrolment certificate, empanelment letter) - recorded against the code at issue.
    verification_note TEXT,
    notes             TEXT,
    created_by        UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (kind, enrolment_number)
);
CREATE TRIGGER trg_legal_professionals_updated_at BEFORE UPDATE ON legal_professionals
    FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TABLE legal_cases (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    case_number           VARCHAR(20) NOT NULL UNIQUE,
    requested_by          UUID REFERENCES users(id) ON DELETE SET NULL,
    customer_id           UUID REFERENCES customers(id) ON DELETE SET NULL,
    deal_id               UUID REFERENCES deals(id) ON DELETE SET NULL,
    property_id           UUID REFERENCES properties(id) ON DELETE SET NULL,
    lead_id               UUID REFERENCES leads(id) ON DELETE SET NULL,
    mandate_id            UUID REFERENCES mandates(id) ON DELETE SET NULL,
    service_type          VARCHAR(25) NOT NULL CHECK (service_type IN ('due_diligence', 'title_verification', 'agreement_drafting', 'registration_support', 'valuation', 'other')),
    requirement           TEXT NOT NULL,
    status                VARCHAR(20) NOT NULL DEFAULT 'requested'
                          CHECK (status IN ('requested', 'advocate_assigned', 'in_progress', 'report_ready', 'completed', 'cancelled')),
    professional_id       UUID REFERENCES legal_professionals(id) ON DELETE SET NULL,
    -- The client's own chosen advocate, when they do not use the panel.
    client_advocate_name  VARCHAR(150),
    assigned_by           UUID REFERENCES users(id) ON DELETE SET NULL,
    assigned_at           TIMESTAMPTZ,
    -- The representative starts the case with the panel within this time.
    initiate_by           TIMESTAMPTZ,
    due_on                DATE,
    handed_off_at         TIMESTAMPTZ,
    report_document_id    UUID REFERENCES documents(id) ON DELETE SET NULL,
    source                VARCHAR(12) NOT NULL DEFAULT 'customer' CHECK (source IN ('customer', 'staff', 'enquiry', 'mandate')),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_legal_cases_status ON legal_cases (status, created_at DESC);
CREATE INDEX idx_legal_cases_customer ON legal_cases (customer_id);
CREATE INDEX idx_legal_cases_professional ON legal_cases (professional_id);
CREATE INDEX idx_legal_cases_deal ON legal_cases (deal_id);
CREATE TRIGGER trg_legal_cases_updated_at BEFORE UPDATE ON legal_cases
    FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TABLE legal_case_documents (
    case_id     UUID NOT NULL REFERENCES legal_cases(id) ON DELETE CASCADE,
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    auto_linked BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (case_id, document_id)
);

-- Status history: append-only.
CREATE TABLE legal_case_events (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    case_id    UUID NOT NULL REFERENCES legal_cases(id) ON DELETE CASCADE,
    kind       VARCHAR(25) NOT NULL,
    note       TEXT,
    -- Shown to the client on their timeline (internal notes are not).
    client_visible BOOLEAN NOT NULL DEFAULT true,
    actor_id   UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_legal_case_events_case ON legal_case_events (case_id, created_at);
CREATE OR REPLACE FUNCTION legal_case_events_append_only() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'legal_case_events is append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_legal_case_events_append_only BEFORE UPDATE ON legal_case_events
    FOR EACH ROW EXECUTE FUNCTION legal_case_events_append_only();

INSERT INTO app_config (config_key, value, category, description) VALUES
  ('legal.working_days', '{"due_diligence": 15, "title_verification": 15, "valuation": 10, "agreement_drafting": 7, "registration_support": 7, "other": 10}', 'legal', 'Working days allowed for each kind of legal case once it is assigned'),
  ('legal.initiate_hours', '24', 'legal', 'Hours within which the representative starts a legal case with the panel'),
  ('legal.disclaimer', '"Due diligence conducted by A R Buildwel''s empanelled advocates is for the client''s guidance. It does not constitute a guarantee of clear title. Clients are advised to obtain independent legal advice. A R Buildwel facilitates and coordinates; we do not act as legal counsel."', 'legal', 'Shown wherever legal services are offered or tracked')
ON CONFLICT (config_key) DO NOTHING;
