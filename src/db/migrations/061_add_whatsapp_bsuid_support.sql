-- =====================================================================
-- Migration: 016_add_whatsapp_bsuid_support.sql
-- Project  : PropertySerch.com
-- Purpose  : WhatsApp Business-Scoped User IDs (BSUID). Meta's Cloud API
--            puts a `user_id` (BSUID) on every inbound contact/message,
--            always - unlike the phone number, which is omitted whenever
--            the customer has hidden it behind a WhatsApp username. BSUID
--            is therefore the only identity Meta guarantees; phone number
--            becomes optional enrichment, not the primary key.
-- DB       : PostgreSQL
-- =====================================================================

-- A customer reached only by username (no phone, no email shared) has to
-- be creatable at all - relax the old email-or-mobile requirement.
ALTER TABLE customers
  DROP CONSTRAINT chk_customers_email_or_mobile,
  ADD COLUMN wa_user_id VARCHAR(140),
  ADD CONSTRAINT chk_customers_contact CHECK (
    email IS NOT NULL OR mobile IS NOT NULL OR wa_user_id IS NOT NULL
  );

CREATE UNIQUE INDEX idx_customers_wa_user_id ON customers(wa_user_id) WHERE wa_user_id IS NOT NULL;

-- Conversation log: phone is no longer guaranteed, BSUID always is.
ALTER TABLE whatsapp_conversations
  ALTER COLUMN phone_number DROP NOT NULL,
  ADD COLUMN wa_user_id VARCHAR(140);

CREATE INDEX idx_whatsapp_conversations_wa_user_id ON whatsapp_conversations(wa_user_id);

-- Bot session: same relaxation. phone_number keeps its existing UNIQUE
-- constraint (harmless - Postgres never treats two NULLs as a conflict),
-- but the real lookup key going forward is wa_user_id.
ALTER TABLE whatsapp_bot_sessions
  ALTER COLUMN phone_number DROP NOT NULL,
  ADD COLUMN wa_user_id VARCHAR(140);

CREATE UNIQUE INDEX idx_whatsapp_bot_sessions_wa_user_id ON whatsapp_bot_sessions(wa_user_id) WHERE wa_user_id IS NOT NULL;
