-- ════════════════════════════════════════════════════════════════════════════
-- COROC · Migración 0003 · Fase 2 (documentos)
-- Repositorio con versiones y etiquetas, carpeta COROC (manifiesto), tareas de documentos en bandeja de salida
-- transaccional (ADR-032), respaldo y restauración (§19), verificación pública de recibos (§15).
-- ════════════════════════════════════════════════════════════════════════════
SET search_path = coroc, public;

-- ─────────── Repositorio documental (§16.1) ───────────
ALTER TYPE doc_kind ADD VALUE IF NOT EXISTS 'report';

ALTER TABLE documents ADD COLUMN file_name text;                         -- nombre en la carpeta COROC (§16.3)
ALTER TABLE documents ADD COLUMN lang lang_code;                         -- idioma del documento generado (§6)
ALTER TABLE documents ADD COLUMN tags text[] NOT NULL DEFAULT '{}';
ALTER TABLE documents ADD COLUMN meta jsonb NOT NULL DEFAULT '{}'::jsonb; -- número de recibo, tipo de informe, filtros…
ALTER TABLE documents ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
UPDATE documents SET file_name = name WHERE file_name IS NULL;
ALTER TABLE documents ALTER COLUMN file_name SET NOT NULL;
ALTER TABLE documents ADD CONSTRAINT documents_tags_chk CHECK (cardinality(tags) <= 20);

-- Los documentos nunca se sobrescriben: una versión nueva marca la anterior como reemplazada y nada más cambia.
CREATE FUNCTION documents_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.storage_key <> OLD.storage_key OR NEW.sha256 <> OLD.sha256 OR NEW.size_bytes <> OLD.size_bytes OR NEW.tenant_id <> OLD.tenant_id
     OR NEW.version <> OLD.version OR NEW.version_key IS DISTINCT FROM OLD.version_key OR (OLD.superseded AND NOT NEW.superseded) THEN
    RAISE EXCEPTION 'Un documento no se sobrescribe: guarde una versión nueva' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER documents_guard BEFORE UPDATE ON documents FOR EACH ROW EXECUTE FUNCTION documents_guard();

CREATE INDEX documents_updated_idx ON documents (tenant_id, updated_at, id);
CREATE INDEX documents_loan_idx ON documents (tenant_id, loan_id) WHERE loan_id IS NOT NULL;
CREATE INDEX documents_tags_idx ON documents USING gin (tags);
-- Búsqueda por el texto leído y por el nombre, sin tildes (§16.1).
CREATE INDEX documents_text_trgm ON documents USING gin (lower(translate(name || ' ' || coalesce(ocr_text, ''),
  'áàäâãéèëêíìïîóòöôõúùüûñçÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ', 'aaaaaeeeeiiiiooooouuuuncAAAAAEEEEIIIIOOOOOUUUUNC')) gin_trgm_ops);

-- La carpeta COROC se actualiza por cambios: los clientes también llevan su marca de tiempo.
ALTER TABLE clients ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
CREATE FUNCTION touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
CREATE TRIGGER clients_touch BEFORE UPDATE ON clients FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE INDEX clients_updated_idx ON clients (tenant_id, updated_at, id);
CREATE INDEX loans_created_idx ON loans (tenant_id, created_at, id);

-- El Cobrador solo ve los documentos de sus clientes; los que no tienen cliente (sin asignar, informes) no los ve.
CREATE POLICY collector_scope ON documents AS RESTRICTIVE TO coroc_collector
  USING (client_id IS NOT NULL AND EXISTS (SELECT 1 FROM coroc.clients c WHERE c.id = client_id))
  WITH CHECK (client_id IS NOT NULL AND EXISTS (SELECT 1 FROM coroc.clients c WHERE c.id = client_id));

-- Distingue «no existe» de «es de un cliente ajeno» para registrar el acceso denegado (CA-16), sin revelar el documento.
CREATE FUNCTION document_owner(p_doc uuid) RETURNS TABLE (client_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = coroc, public AS
$$ SELECT d.client_id FROM documents d WHERE d.id = p_doc AND d.tenant_id = current_tenant() $$;
REVOKE ALL ON FUNCTION document_owner(uuid) FROM PUBLIC;

-- ─────────── Recibos: PDF vinculado y verificación pública (§15) ───────────
CREATE INDEX receipts_verification_idx ON receipts (verification_hash);

-- El código QR del recibo abre la confirmación de autenticidad. Solo revela lo que ya está impreso en el recibo
-- que la persona tiene en la mano (empresa, número, fecha, valor y si fue anulado), nunca el nombre del deudor.
CREATE FUNCTION verify_receipt(p_code text) RETURNS TABLE (company text, number text, payment_date date, amount bigint, currency char(3), issued_at text, voided boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = coroc, public AS
$$ SELECT t.name, r.number, (r.data->'payment'->>'date')::date, (r.data->'payment'->>'amount')::bigint, (r.data->>'currency')::char(3),
          r.data->>'issuedAt', r.voided_at IS NOT NULL
     FROM receipts r JOIN tenants t ON t.id = r.tenant_id
    WHERE r.verification_hash = upper(p_code) AND length(p_code) = 16 $$;
REVOKE ALL ON FUNCTION verify_receipt(text) FROM PUBLIC;

-- ─────────── Tareas de documentos: bandeja de salida transaccional (ADR-032) ───────────
-- Se insertan en la misma transacción que el pago, el reverso o el préstamo; un trabajador las toma después del commit.
-- Si el proceso cae, la tarea sigue ahí y se reintenta: ningún recibo se pierde.
CREATE TYPE task_status AS ENUM ('pending', 'running', 'done', 'failed', 'cancelled');
CREATE TABLE document_tasks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  kind          text NOT NULL CHECK (kind IN ('schedule', 'receipt', 'receipt_void', 'statement', 'payoff', 'report', 'backup')),
  loan_id       uuid REFERENCES loans(id),
  entry_id      uuid REFERENCES ledger_entries(id),
  params        jsonb NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key    text,
  status        task_status NOT NULL DEFAULT 'pending',
  attempts      smallint NOT NULL DEFAULT 0,
  run_after     timestamptz NOT NULL DEFAULT now(),
  locked_until  timestamptz,
  progress      smallint NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  error         text,
  document_id   uuid REFERENCES documents(id),
  created_by    uuid REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz
);
-- Varias actualizaciones seguidas del mismo plan de pagos se funden en una sola tarea pendiente.
CREATE UNIQUE INDEX document_tasks_dedupe_uq ON document_tasks (tenant_id, dedupe_key) WHERE status = 'pending' AND dedupe_key IS NOT NULL;
CREATE INDEX document_tasks_due_idx ON document_tasks (run_after) WHERE status IN ('pending', 'running');
CREATE INDEX document_tasks_tenant_idx ON document_tasks (tenant_id, created_at DESC);

CREATE POLICY collector_scope ON document_tasks AS RESTRICTIVE TO coroc_collector
  USING (loan_id IS NOT NULL AND EXISTS (SELECT 1 FROM coroc.loans l WHERE l.id = loan_id))
  WITH CHECK (loan_id IS NOT NULL AND EXISTS (SELECT 1 FROM coroc.loans l WHERE l.id = loan_id));

-- Toma tareas vencidas de todas las empresas (o las que quedaron bloqueadas por un proceso que cayó). Solo devuelve
-- identificadores: cada tarea se ejecuta después con el contexto de RLS de su empresa.
CREATE FUNCTION claim_document_tasks(p_limit integer, p_lease_seconds integer) RETURNS TABLE (id uuid, tenant_id uuid)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = coroc, public AS
$$ UPDATE document_tasks d SET status = 'running', attempts = d.attempts + 1, locked_until = now() + make_interval(secs => p_lease_seconds)
    WHERE d.id IN (SELECT x.id FROM document_tasks x
                    WHERE (x.status = 'pending' AND x.run_after <= now()) OR (x.status = 'running' AND x.locked_until < now())
                    ORDER BY x.run_after LIMIT p_limit FOR UPDATE SKIP LOCKED)
   RETURNING d.id, d.tenant_id $$;
REVOKE ALL ON FUNCTION claim_document_tasks(integer, integer) FROM PUBLIC;

-- Préstamos activos de todas las empresas que necesitan su estado de cuenta mensual (§16.4).
CREATE FUNCTION tenants_with_active_loans() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = coroc, public AS
$$ SELECT DISTINCT l.tenant_id FROM loans l JOIN tenants t ON t.id = l.tenant_id WHERE l.status = 'active' AND t.active $$;
REVOKE ALL ON FUNCTION tenants_with_active_loans() FROM PUBLIC;

-- ─────────── Respaldo y restauración (§19) ───────────
ALTER TABLE backups ALTER COLUMN storage_key DROP NOT NULL;
ALTER TABLE backups ALTER COLUMN manifest SET DEFAULT '{}'::jsonb;
ALTER TABLE backups ADD COLUMN status task_status NOT NULL DEFAULT 'pending';
ALTER TABLE backups ADD COLUMN progress smallint NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100);
ALTER TABLE backups ADD COLUMN file_name text;
ALTER TABLE backups ADD COLUMN size_bytes bigint;
ALTER TABLE backups ADD COLUMN sha256 char(64);
ALTER TABLE backups ADD COLUMN task_id uuid REFERENCES document_tasks(id);
ALTER TABLE backups ADD COLUMN error text;
ALTER TABLE backups ADD COLUMN finished_at timestamptz;
CREATE INDEX backups_tenant_idx ON backups (tenant_id, created_at DESC);

CREATE TABLE restores (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id),
  status       text NOT NULL DEFAULT 'uploading' CHECK (status IN ('uploading', 'uploaded', 'verified', 'applied', 'failed')),
  storage_key  text NOT NULL,
  size_bytes   bigint,
  header       jsonb,
  summary      jsonb,
  error        text,
  created_by   uuid REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  applied_at   timestamptz
);
ALTER TABLE restores ENABLE ROW LEVEL SECURITY;
ALTER TABLE restores FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON restores USING (tenant_id = current_tenant()) WITH CHECK (tenant_id = current_tenant());

ALTER TABLE document_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_tasks FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON document_tasks USING (tenant_id = current_tenant()) WITH CHECK (tenant_id = current_tenant());

-- El Cobrador no crea ni ve respaldos (§7.2), tampoco a nivel de base.
CREATE POLICY collector_scope ON backups AS RESTRICTIVE TO coroc_collector USING (false) WITH CHECK (false);
CREATE POLICY collector_scope ON restores AS RESTRICTIVE TO coroc_collector USING (false) WITH CHECK (false);

-- La restauración reemplaza todos los datos de la empresa en una sola transacción. El libro y la bitácora son inmutables:
-- solo esta función (dueña del esquema) puede retirar sus filas, y solo las de la empresa de la sesión.
CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('coroc.purging_tenant', true) = OLD.tenant_id::text THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'La tabla % es inmutable: registre un reverso o ajuste con motivo', TG_TABLE_NAME
    USING ERRCODE = 'integrity_constraint_violation';
END $$;

CREATE FUNCTION purge_tenant_data(p_tenant uuid) RETURNS void
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
  DELETE FROM audit_log WHERE tenant_id = p_tenant;
  PERFORM set_config('coroc.purging_tenant', '', true);
END $$;
REVOKE ALL ON FUNCTION purge_tenant_data(uuid) FROM PUBLIC;

-- ─────────── Permisos del rol de la aplicación ───────────
GRANT SELECT, INSERT, UPDATE ON document_tasks, restores TO coroc_app;
GRANT EXECUTE ON FUNCTION document_owner(uuid), verify_receipt(text), claim_document_tasks(integer, integer), tenants_with_active_loans(), purge_tenant_data(uuid) TO coroc_app;
