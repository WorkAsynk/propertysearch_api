-- Modules 25 (Loan / Financing) and 26 (Insurance) - referral only.
--   The platform never disburses a loan or issues a policy. It collects what
--   the client needs, shows indicative eligibility and the empanelled
--   lenders / insurers that fit, hands the case to the partner's officer and
--   tracks it: application -> sanction -> disbursement; request -> policy.
--   Partner officers carry an LO / IO code, issued only after the
--   empanelment / IRDAI licence check, never commission-bearing (sec. 33.8).

CREATE SEQUENCE loan_application_seq;
CREATE SEQUENCE insurance_request_seq;

-- Banks, NBFCs, housing finance companies and insurers on the panel.
CREATE TABLE partner_institutions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kind                VARCHAR(10) NOT NULL CHECK (kind IN ('bank', 'nbfc', 'hfc', 'insurer')),
    name                VARCHAR(200) NOT NULL,
    -- Empanelment letter / DSA agreement reference; IRDAI registration for an insurer.
    empanelment_ref     VARCHAR(120),
    irdai_registration  VARCHAR(60),
    status              VARCHAR(12) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'empanelled', 'suspended')),
    loan_products       TEXT[] NOT NULL DEFAULT '{}',
    insurance_products  TEXT[] NOT NULL DEFAULT '{}',
    -- Indicative lending terms used for the eligibility guide (never an offer).
    min_loan_amount     NUMERIC(14,2),
    max_loan_amount     NUMERIC(14,2),
    rate_from_percent   NUMERIC(5,2),
    rate_to_percent     NUMERIC(5,2),
    max_ltv_percent     NUMERIC(5,2),
    max_foir_percent    NUMERIC(5,2),
    max_tenure_years    SMALLINT,
    serves_nri          BOOLEAN NOT NULL DEFAULT false,
    -- Empty = everywhere.
    cities              TEXT[] NOT NULL DEFAULT '{}',
    states              TEXT[] NOT NULL DEFAULT '{}',
    notes               TEXT,
    verified_by         UUID REFERENCES users(id) ON DELETE SET NULL,
    verified_at         TIMESTAMPTZ,
    verification_note   TEXT,
    created_by          UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (kind, name)
);
CREATE TRIGGER trg_partner_institutions_updated_at BEFORE UPDATE ON partner_institutions
    FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- Loan Officers (LO) and Insurance Officers (IO): the partner's own staff.
CREATE TABLE partner_officers (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    institution_id    UUID NOT NULL REFERENCES partner_institutions(id) ON DELETE CASCADE,
    -- ^(LO|IO)-[A-HJ-KM-NP-Z2-9]{5}$ - issued on verification; attribution only.
    code              VARCHAR(8) UNIQUE,
    role              VARCHAR(2) NOT NULL CHECK (role IN ('LO', 'IO')),
    full_name         VARCHAR(150) NOT NULL,
    designation       VARCHAR(120),
    -- IRDAI licence number for an IO; the employee / DSA code for an LO.
    licence_number    VARCHAR(60),
    email             VARCHAR(150),
    mobile            VARCHAR(20),
    cities            TEXT[] NOT NULL DEFAULT '{}',
    status            VARCHAR(12) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'suspended')),
    verified_by       UUID REFERENCES users(id) ON DELETE SET NULL,
    verified_at       TIMESTAMPTZ,
    verification_note TEXT,
    created_by        UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_partner_officers_institution ON partner_officers (institution_id);
CREATE TRIGGER trg_partner_officers_updated_at BEFORE UPDATE ON partner_officers
    FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TABLE loan_applications (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    application_number    VARCHAR(20) NOT NULL UNIQUE,
    requested_by          UUID REFERENCES users(id) ON DELETE SET NULL,
    customer_id           UUID REFERENCES customers(id) ON DELETE SET NULL,
    deal_id               UUID REFERENCES deals(id) ON DELETE SET NULL,
    property_id           UUID REFERENCES properties(id) ON DELETE SET NULL,
    lead_id               UUID REFERENCES leads(id) ON DELETE SET NULL,
    loan_type             VARCHAR(30) NOT NULL CHECK (loan_type IN ('home_loan', 'commercial_property_loan', 'construction_finance', 'lap', 'nri_mortgage', 'builder_project_loan')),
    employment_type       VARCHAR(20) CHECK (employment_type IS NULL OR employment_type IN ('salaried', 'self_employed', 'business', 'professional', 'other')),
    monthly_income        NUMERIC(14,2),
    existing_emi          NUMERIC(14,2) NOT NULL DEFAULT 0,
    property_value        NUMERIC(16,2),
    loan_amount_requested NUMERIC(16,2),
    tenure_years          SMALLINT,
    city                  VARCHAR(100),
    is_nri                BOOLEAN NOT NULL DEFAULT false,
    -- Indicative eligibility worked out at the time (inputs, caps, result).
    eligibility           JSONB,
    -- started -> submitted (client) -> referred (handed to the loan officer)
    -- -> sanctioned -> disbursed; or rejected / withdrawn.
    status                VARCHAR(12) NOT NULL DEFAULT 'started'
                          CHECK (status IN ('started', 'submitted', 'referred', 'sanctioned', 'disbursed', 'rejected', 'withdrawn')),
    institution_id        UUID REFERENCES partner_institutions(id) ON DELETE SET NULL,
    officer_id            UUID REFERENCES partner_officers(id) ON DELETE SET NULL,
    submitted_at          TIMESTAMPTZ,
    referred_at           TIMESTAMPTZ,
    referred_by           UUID REFERENCES users(id) ON DELETE SET NULL,
    lender_reference      VARCHAR(80),
    sanctioned_amount     NUMERIC(16,2),
    sanctioned_rate       NUMERIC(5,2),
    sanctioned_on         DATE,
    -- [{ dueOn, amount, note, paidOn }]
    disbursement_schedule JSONB NOT NULL DEFAULT '[]'::jsonb,
    source                VARCHAR(12) NOT NULL DEFAULT 'customer' CHECK (source IN ('customer', 'staff', 'enquiry')),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_loan_applications_status ON loan_applications (status, created_at DESC);
CREATE INDEX idx_loan_applications_customer ON loan_applications (customer_id);
CREATE INDEX idx_loan_applications_deal ON loan_applications (deal_id);
CREATE INDEX idx_loan_applications_institution ON loan_applications (institution_id);
CREATE TRIGGER trg_loan_applications_updated_at BEFORE UPDATE ON loan_applications
    FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TABLE insurance_requests (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_number    VARCHAR(20) NOT NULL UNIQUE,
    requested_by      UUID REFERENCES users(id) ON DELETE SET NULL,
    customer_id       UUID REFERENCES customers(id) ON DELETE SET NULL,
    deal_id           UUID REFERENCES deals(id) ON DELETE SET NULL,
    property_id       UUID REFERENCES properties(id) ON DELETE SET NULL,
    lead_id           UUID REFERENCES leads(id) ON DELETE SET NULL,
    loan_application_id UUID REFERENCES loan_applications(id) ON DELETE SET NULL,
    cover_type        VARCHAR(20) NOT NULL CHECK (cover_type IN ('home_structure', 'home_contents', 'home_package', 'loan_protection', 'commercial_property')),
    -- Property details pre-filled from the listing / deal at the time.
    property_details  JSONB NOT NULL DEFAULT '{}'::jsonb,
    sum_insured       NUMERIC(16,2),
    -- requested -> option_selected (client picked an insurer) -> referred
    -- (handed to the insurance officer) -> issued; or declined / cancelled.
    status            VARCHAR(16) NOT NULL DEFAULT 'requested'
                      CHECK (status IN ('requested', 'option_selected', 'referred', 'issued', 'declined', 'cancelled')),
    institution_id    UUID REFERENCES partner_institutions(id) ON DELETE SET NULL,
    officer_id        UUID REFERENCES partner_officers(id) ON DELETE SET NULL,
    selected_at       TIMESTAMPTZ,
    referred_at       TIMESTAMPTZ,
    referred_by       UUID REFERENCES users(id) ON DELETE SET NULL,
    policy_number     VARCHAR(80),
    policy_start      DATE,
    policy_end        DATE,
    -- Recorded for the client's reference only - the premium is paid to the insurer, never through the platform.
    premium_amount    NUMERIC(14,2),
    confirmed_at      TIMESTAMPTZ,
    source            VARCHAR(12) NOT NULL DEFAULT 'customer' CHECK (source IN ('customer', 'staff', 'enquiry')),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_insurance_requests_status ON insurance_requests (status, created_at DESC);
CREATE INDEX idx_insurance_requests_customer ON insurance_requests (customer_id);
CREATE INDEX idx_insurance_requests_deal ON insurance_requests (deal_id);
CREATE TRIGGER trg_insurance_requests_updated_at BEFORE UPDATE ON insurance_requests
    FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TABLE finance_case_documents (
    subject_type VARCHAR(10) NOT NULL CHECK (subject_type IN ('loan', 'insurance')),
    subject_id   UUID NOT NULL,
    document_id  UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    auto_linked  BOOLEAN NOT NULL DEFAULT true,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (subject_type, subject_id, document_id)
);

-- Status history for both kinds: append-only.
CREATE TABLE finance_case_events (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subject_type   VARCHAR(10) NOT NULL CHECK (subject_type IN ('loan', 'insurance')),
    subject_id     UUID NOT NULL,
    kind           VARCHAR(25) NOT NULL,
    note           TEXT,
    client_visible BOOLEAN NOT NULL DEFAULT true,
    actor_id       UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_finance_case_events_subject ON finance_case_events (subject_type, subject_id, created_at);
CREATE OR REPLACE FUNCTION finance_case_events_append_only() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'finance_case_events is append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_finance_case_events_append_only BEFORE UPDATE ON finance_case_events
    FOR EACH ROW EXECUTE FUNCTION finance_case_events_append_only();

-- Internal facilitation desks (sec. 33.9): Loan Desk and Insurance Desk
-- Coordinators - A R Buildwel employees, never the licensed officer.
ALTER TABLE arb_representatives DROP CONSTRAINT arb_representatives_designation_check;
ALTER TABLE arb_representatives ADD CONSTRAINT arb_representatives_designation_check
    CHECK (designation IN ('rm', 'dm', 'tl', 'tc', 'fm', 'ld', 'id'));

INSERT INTO app_config (config_key, value, category, description) VALUES
  ('loan.eligibility', '{"foir_percent": 50, "rate_percent": 8.75, "tenure_years": 20, "ltv_slabs": [{"up_to": 3000000, "percent": 90}, {"up_to": 7500000, "percent": 80}, {"up_to": null, "percent": 75}]}', 'loan', 'Defaults for the indicative eligibility guide: share of income available for EMIs, interest rate, tenure, and loan-to-value by property value'),
  ('loan.disclaimer', '"Loan eligibility subject to lender assessment and applicable T&Cs. This is an indicative guide, not a loan offer. A R Buildwel refers you to the lender and coordinates; it does not lend, sanction or disburse."', 'loan', 'Shown wherever loan eligibility or lender options appear'),
  ('insurance.disclaimer', '"Insurance is issued by the insurer, subject to its own terms and underwriting. A R Buildwel refers you to the insurer and coordinates; it does not issue policies, collect premiums or receive commission."', 'insurance', 'Shown wherever insurance options appear'),
  ('insurance.cover_labels', '{"home_structure": "Home structure cover", "home_contents": "Home contents cover", "home_package": "Home package (structure + contents)", "loan_protection": "Home loan protection cover", "commercial_property": "Commercial property cover"}', 'insurance', 'Names of the cover types offered for referral')
ON CONFLICT (config_key) DO NOTHING;
