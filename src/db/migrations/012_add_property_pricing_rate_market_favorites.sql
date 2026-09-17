-- =====================================================================
-- Migration: 012_add_property_pricing_rate_market_favorites.sql
-- Project  : PropertySerch.com
-- Purpose  : (1) price becomes free text (loses numeric range/sort - the
--            new `rate` column below is the numeric range/sort field
--            going forward); (2) new independently-set `rate` (price per
--            sqft); (3) market-trend fields; (4) listing_category enum +
--            auction/institutional/special_situation variant fields;
--            (5) new property_favorites table (customer <-> property).
-- DB       : PostgreSQL
-- =====================================================================

-- ---------------------------------------------------------------------
-- price: NUMERIC -> TEXT
-- ---------------------------------------------------------------------

-- The old numeric range index has no value once price is free text
-- (sorting/filtering by price now happens via `rate`, see below).
DROP INDEX IF EXISTS idx_properties_price;

-- Must drop before the type change - `price >= 0` has no valid
-- text >= integer operator, so Postgres would reject the ALTER
-- COLUMN TYPE while this constraint still exists.
ALTER TABLE properties DROP CONSTRAINT IF EXISTS properties_price_check;

ALTER TABLE properties ALTER COLUMN price TYPE TEXT USING price::text;
-- NOT NULL carries over unchanged; price is still a required field,
-- just no longer numeric.

-- ---------------------------------------------------------------------
-- rate: price per sqft - independently settable, NOT derived from price
-- ---------------------------------------------------------------------
ALTER TABLE properties ADD COLUMN rate NUMERIC(12, 2)
  CHECK (rate IS NULL OR rate >= 0);

CREATE INDEX idx_properties_rate ON properties(rate);

-- ---------------------------------------------------------------------
-- Market trend fields (shown on every listing detail page)
-- ---------------------------------------------------------------------
ALTER TABLE properties ADD COLUMN annual_appreciation_percent NUMERIC(6, 2);
-- No CHECK bound - appreciation can legitimately be negative in a
-- down market, so this is intentionally unconstrained.

ALTER TABLE properties ADD COLUMN estimated_rent_monthly NUMERIC(12, 2)
  CHECK (estimated_rent_monthly IS NULL OR estimated_rent_monthly >= 0);

ALTER TABLE properties ADD COLUMN locality_rating NUMERIC(2, 1)
  CHECK (locality_rating IS NULL OR (locality_rating >= 0 AND locality_rating <= 5));

-- ---------------------------------------------------------------------
-- listing_category: residential (default) / institutional /
-- special_situation / auction - discriminates which variant fields
-- below apply to a given listing.
-- ---------------------------------------------------------------------
CREATE TYPE listing_category AS ENUM (
    'residential',
    'institutional',
    'special_situation',
    'auction'
);

ALTER TABLE properties ADD COLUMN listing_category listing_category
  NOT NULL DEFAULT 'residential';

CREATE INDEX idx_properties_listing_category ON properties(listing_category);

-- ---------------------------------------------------------------------
-- Auction variant fields
-- ---------------------------------------------------------------------
ALTER TABLE properties ADD COLUMN auction_date TIMESTAMPTZ;
ALTER TABLE properties ADD COLUMN source_bank VARCHAR(150);

-- ---------------------------------------------------------------------
-- Institutional variant field
-- ---------------------------------------------------------------------
ALTER TABLE properties ADD COLUMN occupancy_percent NUMERIC(5, 2)
  CHECK (occupancy_percent IS NULL OR (occupancy_percent >= 0 AND occupancy_percent <= 100));

-- ---------------------------------------------------------------------
-- Special-situation variant fields
-- ---------------------------------------------------------------------
ALTER TABLE properties ADD COLUMN yield_percent NUMERIC(5, 2)
  CHECK (yield_percent IS NULL OR yield_percent >= 0);
ALTER TABLE properties ADD COLUMN yield_qualifier VARCHAR(100);
-- e.g. "Post Capex" - the descriptive suffix seen in the website mock's
-- "11.4% Post Capex"; kept separate from the numeric yield_percent so
-- the number stays sortable/comparable.

-- ---------------------------------------------------------------------
-- TABLE: property_favorites
-- Customer-curated favorites (distinct from property_match_results,
-- which is AI-matching output and intentionally allows duplicates -
-- this table must dedupe, hence the genuine UNIQUE constraint).
-- ---------------------------------------------------------------------
CREATE TABLE property_favorites (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id     UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    property_id     UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT uq_property_favorites_customer_property UNIQUE (customer_id, property_id)
);

CREATE INDEX idx_property_favorites_customer_id ON property_favorites(customer_id);
CREATE INDEX idx_property_favorites_property_id ON property_favorites(property_id);
