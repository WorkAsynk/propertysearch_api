-- =====================================================================
-- Migration: 013_clean_legacy_price_decimals.sql
-- Project  : PropertySerch.com
-- Purpose  : Migration 012 converted `properties.price` from NUMERIC(14,2)
--            to TEXT via `price::text`, which preserves the column's
--            fixed 2-decimal-place scale literally - every price that
--            existed before that migration now reads like
--            "5000000000.00" instead of a clean number. Free-text prices
--            entered since (e.g. "2.1 Cr") are untouched, since they
--            never match the pattern below.
-- DB       : PostgreSQL
-- =====================================================================

UPDATE properties
SET price = regexp_replace(price, '\.00$', '')
WHERE price ~ '^\d+\.00$';
