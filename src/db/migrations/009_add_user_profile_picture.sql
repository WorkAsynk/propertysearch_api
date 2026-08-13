-- =====================================================================
-- Migration: 009_add_user_profile_picture.sql
-- Project  : PropertySerch.com
-- Purpose  : Store the GCS object URL for a user's profile picture
--            (uploaded to users/<user-id>/profile/... in Cloud Storage)
-- DB       : PostgreSQL
-- =====================================================================

ALTER TABLE users ADD COLUMN profile_picture_url VARCHAR(500);
