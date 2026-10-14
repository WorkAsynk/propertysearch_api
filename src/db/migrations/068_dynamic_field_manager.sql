-- Section 5: Dynamic Field Manager (no-code).
-- metadata_fields describes fields a Super Admin adds to a form without a
-- deployment: 17 field types, validation, options, show/hide rules, and the
-- states / cities / roles each field applies to. The values people enter are
-- kept per record in custom_field_values.

CREATE TABLE IF NOT EXISTS metadata_fields (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type         VARCHAR(30) NOT NULL CHECK (entity_type IN ('property', 'requirement', 'user_profile', 'crm_lead', 'institution', 'kyc', 'due_diligence', 'agreement', 'dashboard_widget')),
    section             VARCHAR(80) NOT NULL DEFAULT 'Additional details',
    module              VARCHAR(40),
    field_name          VARCHAR(60) NOT NULL,
    field_label         VARCHAR(150) NOT NULL,
    -- Not an enum on purpose: a new type is a new renderer + validator in code
    -- (type 18, "JSONB-extensible"), never a schema change.
    field_type          VARCHAR(20) NOT NULL,
    help_text           VARCHAR(300),
    placeholder         VARCHAR(150),
    validation_rules    JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_required         BOOLEAN NOT NULL DEFAULT false,
    display_order       INTEGER NOT NULL DEFAULT 0,
    default_value       JSONB,
    options_json        JSONB NOT NULL DEFAULT '[]'::jsonb,
    conditional_logic   JSONB,
    applicable_states   VARCHAR(10)[] NOT NULL DEFAULT '{}',
    applicable_cities   VARCHAR(120)[] NOT NULL DEFAULT '{}',
    applicable_roles    VARCHAR(40)[] NOT NULL DEFAULT '{}',
    is_visible_publicly BOOLEAN NOT NULL DEFAULT false,
    is_searchable       BOOLEAN NOT NULL DEFAULT false,
    -- Hidden fields keep their stored values; they simply stop appearing.
    is_active           BOOLEAN NOT NULL DEFAULT true,
    created_by          UUID REFERENCES users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by          UUID REFERENCES users(id),
    UNIQUE (entity_type, field_name)
);
CREATE INDEX IF NOT EXISTS idx_metadata_fields_entity ON metadata_fields (entity_type, display_order) WHERE is_active;

-- created_at never changes (sec. 5.1.2).
CREATE OR REPLACE FUNCTION metadata_fields_guard() RETURNS trigger AS $$
BEGIN
  NEW.created_at := OLD.created_at;
  NEW.created_by := OLD.created_by;
  NEW.entity_type := OLD.entity_type;
  NEW.field_name := OLD.field_name;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_metadata_fields_guard ON metadata_fields;
CREATE TRIGGER trg_metadata_fields_guard BEFORE UPDATE ON metadata_fields FOR EACH ROW EXECUTE FUNCTION metadata_fields_guard();

-- { "<field_name>": value, ... } for one record.
CREATE TABLE IF NOT EXISTS custom_field_values (
    entity_type VARCHAR(30) NOT NULL,
    entity_id   UUID NOT NULL,
    field_values JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_by  UUID REFERENCES users(id),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (entity_type, entity_id)
);
CREATE INDEX IF NOT EXISTS idx_custom_field_values_gin ON custom_field_values USING gin (field_values jsonb_path_ops);
