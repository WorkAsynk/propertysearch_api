-- Engine 8 / Section 33.2: scheme coupons.
-- COU-[CATEGORY]-[CAMPAIGN] codes created only by an admin, each with a
-- validity window, per-person and total caps, the service it applies to and a
-- stack / no-stack flag. A person *applies* a coupon (their referral code is
-- separate and permanent). Coupons are deactivated, never deleted. No coupon
-- ever creates a commission entry.

CREATE TABLE IF NOT EXISTS coupons (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code                VARCHAR(20) NOT NULL UNIQUE CHECK (code ~ '^COU-(BU|SE|OW|TE|BR|BD|NR|HN|IB|IS|PE|CO|LN|LG|FR|PG|WF|ST|ALL)-[A-Z0-9]{3,6}$'),
    category            VARCHAR(3) NOT NULL,
    name                VARCHAR(120) NOT NULL,
    description         TEXT,
    -- professional_fee: off a deal invoice (never below the 1% floor);
    -- advertising: off a campaign invoice; crm_workspace: Full CRM workspace
    -- for a number of days; manual: a benefit staff deliver by hand.
    service             VARCHAR(20) NOT NULL CHECK (service IN ('professional_fee', 'advertising', 'crm_workspace', 'manual')),
    benefit_type        VARCHAR(10) NOT NULL CHECK (benefit_type IN ('percent', 'flat', 'days', 'manual')),
    benefit_value       NUMERIC(14, 2),
    max_discount        NUMERIC(14, 2),
    min_amount          NUMERIC(14, 2),
    valid_from          TIMESTAMPTZ NOT NULL DEFAULT now(),
    valid_until         TIMESTAMPTZ NOT NULL,
    per_user_limit      INTEGER NOT NULL DEFAULT 1 CHECK (per_user_limit >= 1),
    total_limit         INTEGER CHECK (total_limit IS NULL OR total_limit >= 1),
    stackable           BOOLEAN NOT NULL DEFAULT false,
    is_active           BOOLEAN NOT NULL DEFAULT true,
    deactivated_at      TIMESTAMPTZ,
    deactivated_reason  TEXT,
    created_by          UUID REFERENCES users(id),
    updated_by          UUID REFERENCES users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (valid_until > valid_from),
    CHECK (category = split_part(code, '-', 2))
);

-- Never deleted (audit trail); the code, its category and its service never change.
CREATE OR REPLACE FUNCTION coupons_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Coupons are deactivated, never deleted';
  END IF;
  NEW.code := OLD.code;
  NEW.category := OLD.category;
  NEW.service := OLD.service;
  NEW.created_at := OLD.created_at;
  NEW.created_by := OLD.created_by;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_coupons_guard ON coupons;
CREATE TRIGGER trg_coupons_guard BEFORE UPDATE OR DELETE ON coupons FOR EACH ROW EXECUTE FUNCTION coupons_guard();

-- Each use of a coupon. role_at_issue is the person's category when they applied it.
CREATE TABLE IF NOT EXISTS user_coupons (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    coupon_id       UUID NOT NULL REFERENCES coupons(id),
    user_id         UUID NOT NULL REFERENCES users(id),
    role_at_issue   VARCHAR(3),
    service         VARCHAR(20) NOT NULL,
    entity_type     VARCHAR(20),
    entity_id       UUID,
    -- reserved: waiting for the invoice it will reduce; applied: benefit given;
    -- pending: a manual benefit waiting for staff; fulfilled: staff delivered it;
    -- reversed: taken back (does not count against the caps).
    status          VARCHAR(12) NOT NULL CHECK (status IN ('reserved', 'applied', 'pending', 'fulfilled', 'reversed')),
    amount_before   NUMERIC(14, 2),
    discount_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
    days_granted    INTEGER,
    invoice_id      UUID,
    note            TEXT,
    applied_by      UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    applied_at      TIMESTAMPTZ,
    fulfilled_by    UUID REFERENCES users(id),
    fulfilled_at    TIMESTAMPTZ,
    reversed_by     UUID REFERENCES users(id),
    reversed_at     TIMESTAMPTZ,
    reversal_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_user_coupons_coupon ON user_coupons (coupon_id) WHERE status <> 'reversed';
CREATE INDEX IF NOT EXISTS idx_user_coupons_user ON user_coupons (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_coupons_entity ON user_coupons (entity_type, entity_id) WHERE status <> 'reversed';
-- One coupon once per record.
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_coupons_once ON user_coupons (coupon_id, entity_type, entity_id) WHERE status <> 'reversed' AND entity_id IS NOT NULL;

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS fee_before_discount NUMERIC(14, 2),
  ADD COLUMN IF NOT EXISTS discount_amount     NUMERIC(14, 2) NOT NULL DEFAULT 0;
ALTER TABLE ad_invoices
  ADD COLUMN IF NOT EXISTS amount_before_discount NUMERIC(14, 2),
  ADD COLUMN IF NOT EXISTS discount_amount        NUMERIC(14, 2) NOT NULL DEFAULT 0;
-- Full CRM workspace granted by a coupon, until this time.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS full_crm_until TIMESTAMPTZ;
