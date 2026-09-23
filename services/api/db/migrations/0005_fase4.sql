-- COROC · Fase 4 «Mensajería y cumplimiento» (§11, §20.1)
-- Plantillas por evento e idioma, correo saliente, WhatsApp asistido y Cloud API, motor de reglas de contacto por
-- empresa, exclusión (opt-out), rebotes y suspensión de la cuenta de WhatsApp con paso al modo asistido (CA-20).
SET search_path = coroc, public;

-- ─────────── Mensajes (§11.3) ───────────
-- El mensaje se registra en la misma transacción del hecho que lo origina (préstamo nuevo, pago, paz y salvo) y un
-- despachador lo envía cuando llega su hora. Si lleva un PDF (recibo, paz y salvo, estado de cuenta), espera a que la
-- tarea que lo genera termine (`document_task_id`).
ALTER TABLE messages ADD COLUMN entry_id uuid REFERENCES ledger_entries(id);
ALTER TABLE messages ADD COLUMN document_task_id uuid REFERENCES document_tasks(id) ON DELETE SET NULL;
ALTER TABLE messages ADD COLUMN subject text;
ALTER TABLE messages ADD COLUMN vars jsonb;                                -- valores de las variables: parámetros de la plantilla de Meta
ALTER TABLE messages ADD COLUMN address text;                              -- número o correo al que se envió
ALTER TABLE messages ADD COLUMN via text CHECK (via IN ('cloud_api', 'assisted', 'email'));
ALTER TABLE messages ADD COLUMN error text;                                -- técnico, sin datos personales
ALTER TABLE messages ADD COLUMN attempts integer NOT NULL DEFAULT 0;
ALTER TABLE messages ADD COLUMN locked_until timestamptz;
ALTER TABLE messages ADD COLUMN delivered_at timestamptz;
ALTER TABLE messages ADD COLUMN read_at timestamptz;
ALTER TABLE messages ADD COLUMN failed_at timestamptz;
ALTER TABLE messages ADD COLUMN created_by uuid REFERENCES users(id);
ALTER TABLE messages ADD COLUMN sent_by uuid REFERENCES users(id);        -- modo asistido: quién tocó «Enviar»
ALTER TABLE messages ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX messages_client_idx ON messages (tenant_id, client_id, created_at DESC);
CREATE INDEX messages_provider_idx ON messages (provider_message_id) WHERE provider_message_id IS NOT NULL;
CREATE INDEX messages_ready_idx ON messages (tenant_id, created_at) WHERE status = 'ready';
CREATE POLICY collector_scope ON messages AS RESTRICTIVE TO coroc_collector
  USING (EXISTS (SELECT 1 FROM coroc.clients c WHERE c.id = client_id)) WITH CHECK (EXISTS (SELECT 1 FROM coroc.clients c WHERE c.id = client_id));

CREATE FUNCTION touch_message() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
CREATE TRIGGER messages_touch BEFORE UPDATE ON messages FOR EACH ROW EXECUTE FUNCTION touch_message();

-- El despachador toma los mensajes vencidos de todas las empresas sin chocar con otras instancias. La hora de envío se
-- compara con el reloj de la aplicación (`p_now`); el arriendo, con el de la base.
CREATE FUNCTION claim_due_messages(p_limit integer, p_lease_seconds integer, p_now timestamptz) RETURNS TABLE (id uuid, tenant_id uuid)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = coroc, public AS $$
  UPDATE messages m SET locked_until = now() + make_interval(secs => p_lease_seconds)
   WHERE m.id IN (
     SELECT x.id FROM messages x JOIN tenants t ON t.id = x.tenant_id AND t.active
      WHERE x.status = 'scheduled' AND x.scheduled_at <= p_now AND (x.locked_until IS NULL OR x.locked_until < now())
      ORDER BY x.scheduled_at
      LIMIT p_limit
      FOR UPDATE OF x SKIP LOCKED)
  RETURNING m.id, m.tenant_id
$$;
REVOKE ALL ON FUNCTION claim_due_messages(integer, integer, timestamptz) FROM PUBLIC;

-- Estados de entrega y rebotes llegan con el id del proveedor; solo revela a qué empresa pertenece.
CREATE FUNCTION message_tenant(p_provider_id text) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = coroc, public AS
$$ SELECT m.tenant_id FROM messages m WHERE m.provider_message_id = p_provider_id LIMIT 1 $$;
REVOKE ALL ON FUNCTION message_tenant(text) FROM PUBLIC;

ALTER TABLE message_templates ADD COLUMN subject text;
ALTER TABLE message_templates ADD COLUMN meta_template_lang text;          -- código de idioma de la plantilla en Meta
ALTER TABLE message_templates ADD COLUMN updated_by uuid REFERENCES users(id);

-- ─────────── Deudor: zona horaria, correo inválido, ventana de WhatsApp y excepción horaria (§11.2, §11.4) ───────────
ALTER TABLE clients ADD COLUMN timezone text;                              -- vacío: la de la empresa
ALTER TABLE clients ADD COLUMN email_status text CHECK (email_status IN ('bounced', 'complained'));
ALTER TABLE clients ADD COLUMN email_status_at timestamptz;
ALTER TABLE clients ADD COLUMN wa_last_inbound_at timestamptz;             -- abre la ventana de 24 h de WhatsApp
ALTER TABLE clients ADD COLUMN authorized_windows_document_id uuid;         -- evidencia (sin FK: el respaldo restaura clientes antes que documentos)
ALTER TABLE clients ADD COLUMN authorized_windows_at timestamptz;

-- ─────────── Reglas de contacto por empresa (§11.4) ───────────
ALTER TABLE contact_rule_sets ADD COLUMN reviewed_by uuid REFERENCES users(id);
ALTER TABLE contact_rule_sets ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
CREATE UNIQUE INDEX contact_rule_sets_active_uq ON contact_rule_sets (tenant_id) WHERE active;
CREATE POLICY collector_scope ON contact_rule_sets AS RESTRICTIVE TO coroc_collector USING (true) WITH CHECK (false);

-- ─────────── WhatsApp Cloud API: estado, lista de verificación y suspensión (§11.1, CA-20) ───────────
ALTER TABLE whatsapp_accounts ADD COLUMN waba_id text;
ALTER TABLE whatsapp_accounts ADD COLUMN status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended'));
ALTER TABLE whatsapp_accounts ADD COLUMN suspended_at timestamptz;
ALTER TABLE whatsapp_accounts ADD COLUMN suspension_reason text;
ALTER TABLE whatsapp_accounts ADD COLUMN checklist jsonb NOT NULL DEFAULT '{}'::jsonb;
CREATE UNIQUE INDEX whatsapp_accounts_waba_uq ON whatsapp_accounts (waba_id) WHERE waba_id IS NOT NULL;

-- Los avisos de la cuenta (`account_update`) llegan con el id de la cuenta de WhatsApp Business, no del número.
CREATE FUNCTION whatsapp_tenant_by_waba(p_waba_id text) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = coroc, public AS
$$ SELECT w.tenant_id FROM whatsapp_accounts w JOIN tenants t ON t.id = w.tenant_id WHERE w.waba_id = p_waba_id AND t.active $$;
REVOKE ALL ON FUNCTION whatsapp_tenant_by_waba(text) FROM PUBLIC;

-- ─────────── Correo saliente de la empresa (§11.2) ───────────
-- Remitente propio con su dominio. Mientras SPF, DKIM y DMARC no estén verificados, el correo sale desde la dirección
-- de COROC con el nombre de la empresa y «Responder a» la de la empresa.
CREATE TABLE email_senders (
  tenant_id     uuid PRIMARY KEY REFERENCES tenants(id),
  from_email    citext NOT NULL,
  from_name     text,
  dkim_selector text,
  spf_ok        boolean NOT NULL DEFAULT false,
  dkim_ok       boolean NOT NULL DEFAULT false,
  dmarc_ok      boolean NOT NULL DEFAULT false,
  checked_at    timestamptz,
  verified_at   timestamptz,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    uuid REFERENCES users(id)
);
ALTER TABLE email_senders ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_senders FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON email_senders USING (tenant_id = current_tenant()) WITH CHECK (tenant_id = current_tenant());
CREATE POLICY collector_scope ON email_senders AS RESTRICTIVE TO coroc_collector USING (false) WITH CHECK (false);

-- ─────────── Restauración: las tablas nuevas también se vacían (ADR-034) ───────────
CREATE OR REPLACE FUNCTION purge_tenant_data(p_tenant uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = coroc, public AS $$
BEGIN
  IF p_tenant IS NULL OR p_tenant IS DISTINCT FROM current_tenant() THEN
    RAISE EXCEPTION 'Solo se puede reemplazar la empresa de la sesión' USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM set_config('coroc.purging_tenant', p_tenant::text, true);
  UPDATE backups SET task_id = NULL WHERE tenant_id = p_tenant;
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

GRANT SELECT, INSERT, UPDATE ON email_senders TO coroc_app;
GRANT DELETE ON email_senders TO coroc_app;
GRANT EXECUTE ON FUNCTION claim_due_messages(integer, integer, timestamptz), message_tenant(text), whatsapp_tenant_by_waba(text), touch_message() TO coroc_app;
