-- COROC · Fase 10 «COROC Escritorio para Windows»
SET search_path = coroc, public;

-- ─────────── Instalación de Escritorio (ADR-062) ───────────
-- En Escritorio hay una sola empresa por PC. El asistente de primer uso necesita saber si ya existe, pero la API no
-- puede leer empresas ajenas (RLS): esta función solo revela cuántas hay y, si hay exactamente una, su id y si está
-- activa (una empresa inactiva es la provisional de una restauración que no terminó).
CREATE FUNCTION installation_tenant(OUT tenants integer, OUT tenant_id uuid, OUT active boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = coroc, public AS
$$ SELECT count(*)::int, CASE WHEN count(*) = 1 THEN (array_agg(t.id))[1] END, CASE WHEN count(*) = 1 THEN bool_and(t.active) END FROM tenants t $$;
REVOKE ALL ON FUNCTION installation_tenant() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION installation_tenant() TO coroc_app;

-- ─────────── Gmail de la empresa (ADR-065) ───────────
-- La empresa conecta su Gmail con una contraseña de aplicación (no su contraseña de Google): COROC lee por IMAP los
-- correos que llegan de la dirección de un cliente y envía por SMTP recibos, recordatorios, estados de cuenta y paz y
-- salvo. La contraseña de aplicación va cifrada con la clave de datos; `last_uid` evita volver a leer un correo.
CREATE TABLE gmail_accounts (
  tenant_id      uuid PRIMARY KEY REFERENCES tenants(id),
  address        citext NOT NULL,
  password_enc   bytea NOT NULL,
  status         text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'error')),
  last_error     text,
  last_check_at  timestamptz,
  uid_validity   bigint,
  last_uid       bigint NOT NULL DEFAULT 0,
  daily_limit    integer NOT NULL DEFAULT 400 CHECK (daily_limit BETWEEN 1 AND 2000),
  sent_day       date,
  sent_count     integer NOT NULL DEFAULT 0,
  created_by     uuid REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE gmail_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE gmail_accounts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON gmail_accounts USING (tenant_id = current_tenant()) WITH CHECK (tenant_id = current_tenant());
CREATE POLICY collector_scope ON gmail_accounts AS RESTRICTIVE TO coroc_collector USING (false) WITH CHECK (false);

-- Hilo de correo de cada cliente (lo que llegó y lo que COROC envió), visible en su ficha.
CREATE TABLE email_messages (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  client_id     uuid REFERENCES clients(id),
  direction     text NOT NULL CHECK (direction IN ('in', 'out')),
  message_id    text NOT NULL,
  in_reply_to   text,
  subject       text,
  snippet       text,
  from_address  citext,
  to_address    citext,
  attachments   jsonb NOT NULL DEFAULT '[]'::jsonb,
  outbound_id   uuid REFERENCES messages(id),
  at            timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX email_messages_uq ON email_messages (tenant_id, direction, message_id);
CREATE INDEX email_messages_client_idx ON email_messages (tenant_id, client_id, at DESC);
ALTER TABLE email_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_messages FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON email_messages USING (tenant_id = current_tenant()) WITH CHECK (tenant_id = current_tenant());
-- El Cobrador solo ve el hilo de sus clientes (las políticas de clients ya lo limitan, ADR-022).
CREATE POLICY collector_scope ON email_messages AS RESTRICTIVE TO coroc_collector
  USING (EXISTS (SELECT 1 FROM coroc.clients c WHERE c.id = client_id)) WITH CHECK (EXISTS (SELECT 1 FROM coroc.clients c WHERE c.id = client_id));

-- Empresas con Gmail conectado, para el lector de correo (solo identificadores; los datos se leen con RLS).
CREATE FUNCTION gmail_tenant_ids() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = coroc, public AS
$$ SELECT g.tenant_id FROM gmail_accounts g JOIN tenants t ON t.id = g.tenant_id WHERE t.active AND g.status = 'active' $$;
REVOKE ALL ON FUNCTION gmail_tenant_ids() FROM PUBLIC;

GRANT SELECT, INSERT, UPDATE ON gmail_accounts, email_messages TO coroc_app;
GRANT DELETE ON gmail_accounts TO coroc_app;
GRANT EXECUTE ON FUNCTION gmail_tenant_ids() TO coroc_app;

-- Al restaurar una copia se reemplaza también el hilo de correo (viene en la copia). La conexión con Gmail no: es de
-- esta instalación y la copia no la lleva.
CREATE OR REPLACE FUNCTION purge_tenant_data(p_tenant uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = coroc, public AS $$
BEGIN
  IF p_tenant IS NULL OR p_tenant IS DISTINCT FROM current_tenant() THEN
    RAISE EXCEPTION 'Solo se puede reemplazar la empresa de la sesión' USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM set_config('coroc.purging_tenant', p_tenant::text, true);
  UPDATE backups SET task_id = NULL WHERE tenant_id = p_tenant;
  DELETE FROM email_messages WHERE tenant_id = p_tenant;
  DELETE FROM messages WHERE tenant_id = p_tenant;
  DELETE FROM document_tasks WHERE tenant_id = p_tenant;
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
  DELETE FROM email_senders WHERE tenant_id = p_tenant;
  DELETE FROM audit_log WHERE tenant_id = p_tenant;
  PERFORM set_config('coroc.purging_tenant', '', true);
END $$;

-- ─────────── Copias automáticas diarias (ADR-066) ───────────
-- En Escritorio, COROC hace cada día una copia `.coroc` cifrada y la guarda en la carpeta que el usuario eligió en este
-- PC (OneDrive, Google Drive para escritorio o una USB). La contraseña de las copias se guarda cifrada con la clave de
-- datos, porque la copia se hace sola; sin ella nadie abre la copia en otro PC.
CREATE TABLE auto_backups (
  tenant_id       uuid PRIMARY KEY REFERENCES tenants(id),
  enabled         boolean NOT NULL DEFAULT true,
  folder          text NOT NULL,
  password_enc    bytea NOT NULL,
  keep            smallint NOT NULL DEFAULT 14 CHECK (keep BETWEEN 1 AND 90),
  last_run_at     timestamptz,
  last_success_at timestamptz,
  last_file       text,
  last_size       bigint,
  last_error      text,
  updated_by      uuid REFERENCES users(id),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE auto_backups ENABLE ROW LEVEL SECURITY;
ALTER TABLE auto_backups FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON auto_backups USING (tenant_id = current_tenant()) WITH CHECK (tenant_id = current_tenant());
CREATE POLICY collector_scope ON auto_backups AS RESTRICTIVE TO coroc_collector USING (false) WITH CHECK (false);
GRANT SELECT, INSERT, UPDATE ON auto_backups TO coroc_app;

-- Las copias automáticas se reconocen para no llenar el disco: en el PC queda solo la última (las demás están en la carpeta).
ALTER TABLE backups ADD COLUMN auto boolean NOT NULL DEFAULT false;
