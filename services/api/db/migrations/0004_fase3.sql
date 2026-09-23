-- COROC · Fase 3 «Recepción y lectura» (§12, §13, §14)
-- Portal del deudor con enlace de carga, correo y WhatsApp entrantes, «Compartir con COROC», carpeta vigilada,
-- lectura (capa de texto, OCR e IA), validaciones y Bandeja de validación.
SET search_path = coroc, public;

-- ─────────── Tareas: la lectura de un comprobante también va por la bandeja de salida (ADR-032) ───────────
ALTER TABLE document_tasks DROP CONSTRAINT document_tasks_kind_check;
ALTER TABLE document_tasks ADD CONSTRAINT document_tasks_kind_check
  CHECK (kind IN ('schedule', 'receipt', 'receipt_void', 'statement', 'payoff', 'report', 'backup', 'intake'));

-- ─────────── Enlace personal de carga (§12.3) ───────────
-- El token se guarda cifrado para poder mostrarlo otra vez (y en los mensajes de la Fase 4); se busca por su hash.
ALTER TABLE upload_links ADD COLUMN token_enc bytea;
ALTER TABLE upload_links ADD COLUMN created_by uuid REFERENCES users(id);
ALTER TABLE upload_links ADD COLUMN last_used_at timestamptz;
ALTER TABLE upload_links ADD COLUMN uses integer NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX upload_links_active_uq ON upload_links (tenant_id, loan_id) WHERE revoked_at IS NULL;
CREATE POLICY collector_scope ON upload_links AS RESTRICTIVE TO coroc_collector
  USING (EXISTS (SELECT 1 FROM coroc.loans l WHERE l.id = loan_id)) WITH CHECK (EXISTS (SELECT 1 FROM coroc.loans l WHERE l.id = loan_id));

-- El portal público resuelve el enlace sin sesión: solo revela a qué empresa y préstamo pertenece un token válido.
CREATE FUNCTION resolve_upload_link(p_hash bytea) RETURNS TABLE (link_id uuid, tenant_id uuid, loan_id uuid, expires_at timestamptz, revoked boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = coroc, public AS
$$ SELECT u.id, u.tenant_id, u.loan_id, u.expires_at, u.revoked_at IS NOT NULL FROM upload_links u WHERE u.token_hash = p_hash $$;
REVOKE ALL ON FUNCTION resolve_upload_link(bytea) FROM PUBLIC;

-- ─────────── Recepción (§12) y lectura (§13) ───────────
ALTER TYPE intake_status ADD VALUE IF NOT EXISTS 'failed';
ALTER TABLE intake_events ADD COLUMN file_name text;
ALTER TABLE intake_events ADD COLUMN mime text;
ALTER TABLE intake_events ADD COLUMN message_text text;                 -- texto que acompañó al archivo
ALTER TABLE intake_events ADD COLUMN hint_client_id uuid REFERENCES clients(id);   -- carpeta del cliente o elección en la app
ALTER TABLE intake_events ADD COLUMN hint_loan_id uuid REFERENCES loans(id);
ALTER TABLE intake_events ADD COLUMN reading jsonb;                     -- método (texto/OCR), páginas, regiones
ALTER TABLE intake_events ADD COLUMN flags jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE intake_events ADD COLUMN reason text;                       -- motivo del rechazo o de la reversión
ALTER TABLE intake_events ADD COLUMN revertible_until timestamptz;
ALTER TABLE intake_events ADD COLUMN error text;
ALTER TABLE intake_events ADD COLUMN created_by uuid REFERENCES users(id);
ALTER TABLE intake_events ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
CREATE TRIGGER intake_touch BEFORE UPDATE ON intake_events FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE INDEX intake_client_idx ON intake_events (tenant_id, client_id) WHERE client_id IS NOT NULL;
-- Antiduplicado también contra lo que espera revisión (ADR-020).
CREATE INDEX intake_file_idx ON intake_events (tenant_id, file_sha256);
CREATE INDEX intake_logical_idx ON intake_events (tenant_id, logical_key) WHERE logical_key IS NOT NULL;

-- El Cobrador ve en la Bandeja solo lo de sus clientes; lo que no tiene cliente («Sin asignar») no lo ve.
CREATE POLICY collector_scope ON intake_events AS RESTRICTIVE TO coroc_collector
  USING (client_id IS NOT NULL AND EXISTS (SELECT 1 FROM coroc.clients c WHERE c.id = client_id))
  WITH CHECK (client_id IS NOT NULL AND EXISTS (SELECT 1 FROM coroc.clients c WHERE c.id = client_id));

-- Cada corrección humana queda como ejemplo para mejorar la lectura de esa empresa (§13.6). Nunca se mezclan empresas.
CREATE TABLE extraction_corrections (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id),
  intake_id    uuid NOT NULL REFERENCES intake_events(id),
  entity       text,
  field        text NOT NULL,
  extracted    text,
  corrected    text,
  created_by   uuid REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX extraction_corrections_idx ON extraction_corrections (tenant_id, entity, created_at DESC);
ALTER TABLE extraction_corrections ENABLE ROW LEVEL SECURITY;
ALTER TABLE extraction_corrections FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON extraction_corrections USING (tenant_id = current_tenant()) WITH CHECK (tenant_id = current_tenant());
CREATE POLICY collector_scope ON extraction_corrections AS RESTRICTIVE TO coroc_collector USING (false) WITH CHECK (true);

-- ─────────── WhatsApp Cloud API entrante (§12.1) ───────────
-- Número de WhatsApp Business de cada empresa. El token de acceso se guarda cifrado con la clave de datos.
CREATE TABLE whatsapp_accounts (
  tenant_id        uuid PRIMARY KEY REFERENCES tenants(id),
  phone_number_id  text NOT NULL UNIQUE,
  display_number   text,
  token_enc        bytea NOT NULL,
  active           boolean NOT NULL DEFAULT true,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       uuid REFERENCES users(id)
);
ALTER TABLE whatsapp_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_accounts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON whatsapp_accounts USING (tenant_id = current_tenant()) WITH CHECK (tenant_id = current_tenant());
CREATE POLICY collector_scope ON whatsapp_accounts AS RESTRICTIVE TO coroc_collector USING (false) WITH CHECK (false);

-- El webhook llega sin sesión: se resuelve la empresa por el número que recibió el mensaje.
CREATE FUNCTION whatsapp_tenant(p_phone_number_id text) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = coroc, public AS
$$ SELECT w.tenant_id FROM whatsapp_accounts w JOIN tenants t ON t.id = w.tenant_id WHERE w.phone_number_id = p_phone_number_id AND w.active AND t.active $$;
REVOKE ALL ON FUNCTION whatsapp_tenant(text) FROM PUBLIC;

-- ─────────── Restauración: las tablas nuevas también se vacían (ADR-034) ───────────
CREATE OR REPLACE FUNCTION purge_tenant_data(p_tenant uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = coroc, public AS $$
BEGIN
  IF p_tenant IS NULL OR p_tenant IS DISTINCT FROM current_tenant() THEN
    RAISE EXCEPTION 'Solo se puede reemplazar la empresa de la sesión' USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM set_config('coroc.purging_tenant', p_tenant::text, true);
  UPDATE backups SET task_id = NULL WHERE tenant_id = p_tenant;
  DELETE FROM document_tasks WHERE tenant_id = p_tenant;
  DELETE FROM messages WHERE tenant_id = p_tenant;
  DELETE FROM message_templates WHERE tenant_id = p_tenant;
  DELETE FROM extraction_corrections WHERE tenant_id = p_tenant;
  DELETE FROM intake_events WHERE tenant_id = p_tenant;
  DELETE FROM upload_links WHERE tenant_id = p_tenant;
  DELETE FROM receipts WHERE tenant_id = p_tenant;
  DELETE FROM payment_allocations WHERE tenant_id = p_tenant;
  DELETE FROM ledger_entries WHERE tenant_id = p_tenant AND reverses_id IS NOT NULL;
  DELETE FROM ledger_entries WHERE tenant_id = p_tenant;
  DELETE FROM loan_state WHERE tenant_id = p_tenant;
  DELETE FROM installments WHERE tenant_id = p_tenant;
  DELETE FROM idempotency_keys WHERE tenant_id = p_tenant;
  DELETE FROM loans WHERE tenant_id = p_tenant;
  UPDATE consents SET evidence_document_id = NULL WHERE tenant_id = p_tenant;
  DELETE FROM documents WHERE tenant_id = p_tenant;
  DELETE FROM consents WHERE tenant_id = p_tenant;
  DELETE FROM co_debtors WHERE tenant_id = p_tenant;
  DELETE FROM clients WHERE tenant_id = p_tenant;
  DELETE FROM daily_collections WHERE tenant_id = p_tenant;
  DELETE FROM rate_caps WHERE tenant_id = p_tenant;
  DELETE FROM contact_rule_sets WHERE tenant_id = p_tenant;
  DELETE FROM receiving_accounts WHERE tenant_id = p_tenant;
  DELETE FROM whatsapp_accounts WHERE tenant_id = p_tenant;
  DELETE FROM audit_log WHERE tenant_id = p_tenant;
  PERFORM set_config('coroc.purging_tenant', '', true);
END $$;

GRANT SELECT, INSERT, UPDATE ON extraction_corrections, whatsapp_accounts TO coroc_app;
GRANT DELETE ON whatsapp_accounts TO coroc_app;
GRANT EXECUTE ON FUNCTION resolve_upload_link(bytea), whatsapp_tenant(text) TO coroc_app;
