-- =====================================================================
-- Migration: 010_add_user_signup_source.sql
-- Project  : PropertySerch.com
-- Purpose  : Track how a user account was created - self password/OTP
--            registration, Google sign-in, or created by staff (admin/
--            agency_admin registering someone else via /auth/register
--            with a bearer token) - so the CRM can show this on a
--            customer/user record instead of only guessing from
--            password_hash IS NULL.
-- DB       : PostgreSQL
-- =====================================================================

CREATE TYPE signup_source AS ENUM ('self_registration', 'google', 'admin_created');

ALTER TABLE users ADD COLUMN signup_source signup_source NOT NULL DEFAULT 'self_registration';
