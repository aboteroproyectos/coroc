-- ════════════════════════════════════════════════════════════════════════════
-- COROC · Esquema de base de datos (PostgreSQL 16)
-- Fase 0 · Modelo entidad-relación con índices y políticas RLS (§8.4, §7.3, §24.1-2)
--
-- Principios:
--   · Multiempresa con Row Level Security: toda fila lleva tenant_id y solo es visible
--     cuando current_setting('app.tenant_id') coincide (la API lo fija por transacción).
--   · Dinero en BIGINT = unidades mínimas de la moneda (COP pesos, BRL/USD centavos). Nunca float.
--   · Libro de movimientos y bitácora inmutables: triggers impiden UPDATE y DELETE.
--   · Antiduplicado a nivel de base: índice único parcial sobre la huella lógica del comprobante.
-- ════════════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pg_trgm;    -- búsqueda por nombre
CREATE EXTENSION IF NOT EXISTS btree_gist; -- exclusión de vigencias solapadas
CREATE EXTENSION IF NOT EXISTS citext;

CREATE SCHEMA IF NOT EXISTS coroc;
SET search_path = coroc, public;

-- ─────────────────────────── Tipos ───────────────────────────
CREATE TYPE user_role        AS ENUM ('owner', 'admin', 'collector', 'auditor');
CREATE TYPE lang_code        AS ENUM ('es', 'pt-BR', 'en');
CREATE TYPE loan_method      AS ENUM ('simple', 'french');
CREATE TYPE loan_frequency   AS ENUM ('daily', 'weekly', 'monthly');
CREATE TYPE loan_status      AS ENUM ('active', 'closed', 'written_off');
CREATE TYPE ledger_type      AS ENUM ('disbursement', 'payment', 'late_fee', 'waiver', 'reversal', 'adjustment', 'credit_balance');
CREATE TYPE entry_source     AS ENUM ('manual', 'cash', 'inbox', 'folder', 'whatsapp', 'email', 'upload_link', 'system');
CREATE TYPE doc_kind         AS ENUM ('plan', 'schedule', 'receipt_in', 'receipt_out', 'statement', 'payoff', 'other');
CREATE TYPE channel          AS ENUM ('whatsapp', 'email');
CREATE TYPE consent_channel  AS ENUM ('whatsapp', 'email', 'personal_data');
CREATE TYPE intake_channel   AS ENUM ('whatsapp', 'email', 'upload_link', 'share', 'folder', 'upload');
CREATE TYPE intake_status    AS ENUM ('processing', 'review', 'unassigned', 'applied_auto', 'approved', 'duplicate', 'rejected', 'archived');
CREATE TYPE message_event    AS ENUM ('welcome', 'reminder', 'overdue', 'receipt', 'statement', 'payoff', 'manual');
CREATE TYPE message_kind     AS ENUM ('collection', 'transactional');
CREATE TYPE message_status   AS ENUM ('ready', 'scheduled', 'sent', 'delivered', 'read', 'failed', 'blocked', 'cancelled');

-- ─────────────────────────── Empresas y usuarios ───────────────────────────
CREATE TABLE tenants (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  tax_id        text,
  phone         text,
  email         citext,
  address       text,
  city          text,
  country       char(2) NOT NULL CHECK (country IN ('CO', 'BR', 'US')),
  currency      char(3) NOT NULL CHECK (currency IN ('COP', 'BRL', 'USD')),
  timezone      text NOT NULL DEFAULT 'America/Bogota',
  lang          lang_code NOT NULL DEFAULT 'es',
  settings      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  username        citext NOT NULL,
  name            text NOT NULL,
  role            user_role NOT NULL,
  password_hash   text NOT NULL,                        -- Argon2id (encoded)
  totp_secret_enc bytea,                                -- cifrado con la clave de la empresa (KMS)
  failed_attempts smallint NOT NULL DEFAULT 0,
  locked_until    timestamptz,
  lang            lang_code,
  active          boolean NOT NULL DEFAULT true,
  last_login_at   timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, username)
);

CREATE TABLE sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  user_id       uuid NOT NULL REFERENCES users(id),
  device_id     text NOT NULL,
  refresh_hash  bytea NOT NULL,                         -- SHA-256 del token de renovación rotativo
  expires_at    timestamptz NOT NULL,
  revoked_at    timestamptz,
  ip            inet,
  user_agent    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_idx ON sessions (tenant_id, user_id) WHERE revoked_at IS NULL;

-- ─────────────────────────── Numeraciones ───────────────────────────
CREATE TABLE number_sequences (
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  name        text NOT NULL CHECK (name IN ('client', 'contract', 'receipt')),
  prefix      text NOT NULL,
  last_value  bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, name)
);

-- Consecutivo sin huecos y seguro ante concurrencia (bloqueo de fila).
CREATE FUNCTION next_number(p_tenant uuid, p_name text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE v bigint; p text;
BEGIN
  UPDATE number_sequences SET last_value = last_value + 1
   WHERE tenant_id = p_tenant AND name = p_name
  RETURNING last_value, prefix INTO v, p;
  IF v IS NULL THEN RAISE EXCEPTION 'Secuencia % no configurada', p_name; END IF;
  RETURN p || lpad(v::text, 6, '0');
END $$;

-- ─────────────────────────── Clientes ───────────────────────────
CREATE TABLE clients (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id),
  code             text NOT NULL,
  first_name       text NOT NULL,
  last_name        text NOT NULL,
  phone_e164       text NOT NULL CHECK (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  phone2_e164      text CHECK (phone2_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  email            citext,
  address          text,
  city             text,
  country          char(2),
  id_doc_type      text,
  id_doc_number    text,
  lang             lang_code NOT NULL DEFAULT 'es',
  collector_id     uuid REFERENCES users(id),
  notes            text,
  folder_name      text NOT NULL,
  authorized_windows jsonb,                             -- excepción horaria autorizada por el deudor (§11.4)
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid REFERENCES users(id),
  version          integer NOT NULL DEFAULT 1,          -- concurrencia optimista
  UNIQUE (tenant_id, code)
);
CREATE INDEX clients_phone_idx   ON clients (tenant_id, phone_e164);
CREATE INDEX clients_phone2_idx  ON clients (tenant_id, phone2_e164) WHERE phone2_e164 IS NOT NULL;
CREATE INDEX clients_email_idx   ON clients (tenant_id, email) WHERE email IS NOT NULL;
CREATE INDEX clients_iddoc_idx   ON clients (tenant_id, id_doc_number) WHERE id_doc_number IS NOT NULL;
CREATE INDEX clients_name_trgm   ON clients USING gin ((first_name || ' ' || last_name) gin_trgm_ops);
CREATE INDEX clients_collector   ON clients (tenant_id, collector_id);

CREATE TABLE co_debtors (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  client_id   uuid NOT NULL REFERENCES clients(id),
  name        text NOT NULL,
  phone_e164  text CHECK (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  email       citext
);
CREATE INDEX co_debtors_phone_idx ON co_debtors (tenant_id, phone_e164);

CREATE TABLE consents (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES tenants(id),
  client_id             uuid NOT NULL REFERENCES clients(id),
  channel               consent_channel NOT NULL,
  method                text NOT NULL,
  evidence_document_id  uuid,
  granted_at            timestamptz NOT NULL DEFAULT now(),
  revoked_at            timestamptz,
  recorded_by           uuid REFERENCES users(id)
);
CREATE UNIQUE INDEX consents_active_uq ON consents (tenant_id, client_id, channel) WHERE revoked_at IS NULL;

-- ─────────────────────────── Préstamos y plan de pagos ───────────────────────────
CREATE TABLE loans (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid NOT NULL REFERENCES tenants(id),
  client_id              uuid NOT NULL REFERENCES clients(id),
  contract               text NOT NULL,
  currency               char(3) NOT NULL,
  principal              bigint NOT NULL CHECK (principal > 0),
  method                 loan_method NOT NULL,
  rate                   numeric(14, 10) NOT NULL CHECK (rate >= 0),
  installments_count     integer NOT NULL CHECK (installments_count BETWEEN 1 AND 3660),
  frequency              loan_frequency NOT NULL,
  disbursement_date      date NOT NULL,
  first_due_date         date NOT NULL CHECK (first_due_date > disbursement_date),
  collection_days        smallint[] NOT NULL DEFAULT '{1,2,3,4,5,6}',
  exclude_holidays       boolean NOT NULL DEFAULT true,
  monthly_day            smallint CHECK (monthly_day BETWEEN 1 AND 31),
  rounding_unit          bigint NOT NULL DEFAULT 1 CHECK (rounding_unit >= 1),
  late_fee               jsonb,                          -- {type, value, graceDays}
  total_payable          bigint NOT NULL,
  effective_annual_rate  numeric(18, 8) NOT NULL,
  rate_cap_id            uuid,                           -- tope vigente con el que se validó (§9.6)
  expected_method        text,
  status                 loan_status NOT NULL DEFAULT 'active',
  closed_at              timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  created_by             uuid REFERENCES users(id),
  version                integer NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, contract)
);
CREATE INDEX loans_client_idx ON loans (tenant_id, client_id);
CREATE INDEX loans_status_idx ON loans (tenant_id, status);

CREATE TABLE installments (
  tenant_id      uuid NOT NULL REFERENCES tenants(id),
  loan_id        uuid NOT NULL REFERENCES loans(id),
  number         integer NOT NULL CHECK (number >= 1),
  due_date       date NOT NULL,
  amount         bigint NOT NULL CHECK (amount > 0),
  principal      bigint NOT NULL CHECK (principal >= 0),
  interest       bigint NOT NULL CHECK (interest >= 0),
  balance_after  bigint NOT NULL CHECK (balance_after >= 0),
  PRIMARY KEY (loan_id, number),
  CHECK (principal + interest = amount)
);
CREATE INDEX installments_due_idx ON installments (tenant_id, due_date);

-- ─────────────────────────── Libro de movimientos (inmutable) ───────────────────────────
CREATE TABLE ledger_entries (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  loan_id       uuid NOT NULL REFERENCES loans(id),
  type          ledger_type NOT NULL,
  entry_date    date NOT NULL,                          -- fecha contable (la del comprobante)
  recorded_at   timestamptz NOT NULL DEFAULT now(),
  amount        bigint NOT NULL,                        -- positivo; los reversos referencian el movimiento reversado
  method        text,
  reference     text,
  institution   text,
  source        entry_source NOT NULL,
  document_id   uuid,
  intake_id     uuid,
  reverses_id   uuid REFERENCES ledger_entries(id),
  reason        text,
  auto          boolean NOT NULL DEFAULT false,
  created_by    uuid REFERENCES users(id),
  CHECK (amount > 0),
  CHECK ((type = 'reversal') = (reverses_id IS NOT NULL)),
  CHECK (type <> 'reversal' OR coalesce(length(reason), 0) > 0)
);
CREATE INDEX ledger_loan_idx ON ledger_entries (tenant_id, loan_id, entry_date);
CREATE INDEX ledger_date_idx ON ledger_entries (tenant_id, entry_date) WHERE type = 'payment';
CREATE UNIQUE INDEX ledger_single_reversal_uq ON ledger_entries (reverses_id) WHERE reverses_id IS NOT NULL;

CREATE TABLE payment_allocations (
  tenant_id           uuid NOT NULL REFERENCES tenants(id),
  entry_id            uuid NOT NULL REFERENCES ledger_entries(id),
  installment_number  integer NOT NULL,
  to_late_fee         bigint NOT NULL DEFAULT 0 CHECK (to_late_fee >= 0),
  to_installment      bigint NOT NULL DEFAULT 0 CHECK (to_installment >= 0),
  PRIMARY KEY (entry_id, installment_number)
);

CREATE FUNCTION forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'La tabla % es inmutable: registre un reverso o ajuste con motivo', TG_TABLE_NAME
    USING ERRCODE = 'integrity_constraint_violation';
END $$;
CREATE TRIGGER ledger_immutable BEFORE UPDATE OR DELETE ON ledger_entries FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER allocations_immutable BEFORE UPDATE OR DELETE ON payment_allocations FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Saldo derivado del libro (nunca almacenado como dato editable, §9.7)
CREATE VIEW loan_balances WITH (security_invoker = true) AS
SELECT l.tenant_id, l.id AS loan_id, l.total_payable,
       coalesce(sum(e.amount) FILTER (WHERE e.type = 'payment' AND r.id IS NULL), 0) AS paid_total,
       l.total_payable - coalesce(sum(e.amount) FILTER (WHERE e.type = 'payment' AND r.id IS NULL), 0) AS balance
  FROM loans l
  LEFT JOIN ledger_entries e ON e.loan_id = l.id
  LEFT JOIN ledger_entries r ON r.reverses_id = e.id
 GROUP BY l.tenant_id, l.id, l.total_payable;

-- ─────────────────────────── Cumplimiento ───────────────────────────
CREATE TABLE rate_caps (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id),
  country           char(2) NOT NULL,
  effective_annual  numeric(10, 6) NOT NULL CHECK (effective_annual > 0),
  valid_from        date NOT NULL,
  valid_to          date NOT NULL CHECK (valid_to >= valid_from),
  source            text NOT NULL,                      -- p. ej. resolución de la Superintendencia Financiera
  created_by        uuid REFERENCES users(id),
  EXCLUDE USING gist (tenant_id WITH =, country WITH =, daterange(valid_from, valid_to, '[]') WITH &&)
);

CREATE TABLE contact_rule_sets (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  preset      text NOT NULL,                            -- CO_LEY_2300_2023 | BR_* | US_*
  config      jsonb NOT NULL,
  active      boolean NOT NULL DEFAULT true,
  reviewed_by_counsel_at timestamptz                   -- obligatorio para presets distintos de Colombia
);

CREATE TABLE holiday_calendars (                        -- global, versionado (§9.3)
  country       char(2) NOT NULL,
  day           date NOT NULL,
  name          text NOT NULL,
  data_version  text NOT NULL,
  PRIMARY KEY (country, day)
);

CREATE TABLE receiving_accounts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  holder_name   text NOT NULL,
  institution   text,
  last4         char(4) CHECK (last4 ~ '^[0-9]{4}$'),
  active        boolean NOT NULL DEFAULT true
);

-- ─────────────────────────── Documentos ───────────────────────────
CREATE TABLE documents (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  client_id     uuid REFERENCES clients(id),
  loan_id       uuid REFERENCES loans(id),
  kind          doc_kind NOT NULL,
  name          text NOT NULL,
  mime          text NOT NULL,
  size_bytes    bigint NOT NULL CHECK (size_bytes >= 0),
  sha256        char(64) NOT NULL,
  storage_key   text NOT NULL,                          -- objeto S3/R2 cifrado
  version_key   text,                                   -- documentos versionados (p. ej. schedule:<loan>)
  version       integer NOT NULL DEFAULT 1,
  superseded    boolean NOT NULL DEFAULT false,
  source        entry_source NOT NULL,
  ocr_text      text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid REFERENCES users(id)
);
CREATE INDEX documents_client_idx ON documents (tenant_id, client_id, created_at DESC);
CREATE INDEX documents_sha_idx    ON documents (tenant_id, sha256);
CREATE UNIQUE INDEX documents_version_uq ON documents (tenant_id, version_key, version) WHERE version_key IS NOT NULL;
CREATE INDEX documents_ocr_fts ON documents USING gin (to_tsvector('simple', coalesce(ocr_text, '')));

CREATE TABLE receipts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES tenants(id),
  number             text NOT NULL,
  entry_id           uuid NOT NULL REFERENCES ledger_entries(id),
  document_id        uuid NOT NULL REFERENCES documents(id),
  verification_hash  char(16) NOT NULL,
  data               jsonb NOT NULL,
  voided_at          timestamptz,
  void_document_id   uuid REFERENCES documents(id),
  UNIQUE (tenant_id, number),
  UNIQUE (entry_id)
);

-- ─────────────────────────── Recepción de comprobantes ───────────────────────────
CREATE TABLE upload_links (                             -- enlace personal de carga (§12.3)
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id),
  loan_id      uuid NOT NULL REFERENCES loans(id),
  token_hash   bytea NOT NULL UNIQUE,                   -- solo se guarda el hash del token
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE intake_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  channel         intake_channel NOT NULL,
  provider_msg_id text,                                 -- id del mensaje de WhatsApp o del correo (idempotencia)
  sender_phone    text,
  sender_email    citext,
  upload_link_id  uuid REFERENCES upload_links(id),
  document_id     uuid REFERENCES documents(id),
  file_sha256     char(64) NOT NULL,
  status          intake_status NOT NULL DEFAULT 'processing',
  stage           text NOT NULL DEFAULT 'RECIBIDO',
  extraction      jsonb,
  identification  jsonb,
  validation      jsonb,
  logical_key     text,
  decision        text,
  client_id       uuid REFERENCES clients(id),
  loan_id         uuid REFERENCES loans(id),
  entry_id        uuid REFERENCES ledger_entries(id),
  decided_by      uuid REFERENCES users(id),
  decided_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX intake_provider_uq ON intake_events (tenant_id, channel, provider_msg_id) WHERE provider_msg_id IS NOT NULL;
-- Antiduplicado a nivel de base (§13.4 / CA-07): un mismo comprobante no puede quedar aplicado dos veces.
CREATE UNIQUE INDEX intake_logical_applied_uq ON intake_events (tenant_id, logical_key) WHERE status IN ('applied_auto', 'approved') AND logical_key IS NOT NULL;
CREATE UNIQUE INDEX intake_file_applied_uq ON intake_events (tenant_id, file_sha256) WHERE status IN ('applied_auto', 'approved');
CREATE INDEX intake_status_idx ON intake_events (tenant_id, status, created_at DESC);

-- ─────────────────────────── Mensajería ───────────────────────────
CREATE TABLE message_templates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  event       message_event NOT NULL,
  lang        lang_code NOT NULL,
  body        text NOT NULL,
  meta_template_name text,                              -- plantilla aprobada por Meta (modo A)
  active      boolean NOT NULL DEFAULT true,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, event, lang)
);

CREATE TABLE messages (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid NOT NULL REFERENCES tenants(id),
  client_id              uuid NOT NULL REFERENCES clients(id),
  loan_id                uuid REFERENCES loans(id),
  event                  message_event NOT NULL,
  kind                   message_kind NOT NULL,
  channel                channel NOT NULL,
  lang                   lang_code NOT NULL,
  body                   text NOT NULL,
  attachment_document_id uuid REFERENCES documents(id),
  requested_at           timestamptz NOT NULL,
  scheduled_at           timestamptz,
  decision               jsonb NOT NULL,                 -- salida del motor de reglas de contacto
  status                 message_status NOT NULL,
  sent_at                timestamptz,
  provider_message_id    text,
  dedupe_key             text NOT NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, dedupe_key)
);
CREATE INDEX messages_due_idx ON messages (tenant_id, status, scheduled_at);
CREATE INDEX messages_contact_history ON messages (tenant_id, client_id, sent_at) WHERE status IN ('sent', 'delivered', 'read');

-- ─────────────────────────── Bitácora y respaldos ───────────────────────────
CREATE TABLE audit_log (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  at          timestamptz NOT NULL DEFAULT now(),
  user_id     uuid,
  device_id   text,
  ip          inet,
  action      text NOT NULL,
  entity      text NOT NULL,
  entity_id   text,
  before      jsonb,
  after       jsonb
);
CREATE INDEX audit_entity_idx ON audit_log (tenant_id, entity, entity_id, at DESC);
CREATE TRIGGER audit_immutable BEFORE UPDATE OR DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TABLE backups (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id),
  storage_key  text NOT NULL,
  manifest     jsonb NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid REFERENCES users(id)
);

-- ─────────────────────────── Row Level Security (§7.3, CA-17) ───────────────────────────
-- La API abre cada transacción con: SELECT set_config('app.tenant_id', '<uuid>', true);
CREATE FUNCTION current_tenant() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('app.tenant_id', true), '')::uuid $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['users','sessions','number_sequences','clients','co_debtors','consents','loans','installments',
    'ledger_entries','payment_allocations','rate_caps','contact_rule_sets','receiving_accounts','documents','receipts',
    'upload_links','intake_events','message_templates','messages','audit_log','backups']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_tenant()) WITH CHECK (tenant_id = current_tenant())', t);
  END LOOP;
END $$;
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_self ON tenants USING (id = current_tenant()) WITH CHECK (id = current_tenant());

-- Rol de la aplicación: sin BYPASSRLS y sin DELETE sobre tablas contables.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'coroc_app') THEN
    CREATE ROLE coroc_app NOLOGIN NOBYPASSRLS;
  END IF;
END $$;
GRANT USAGE ON SCHEMA coroc TO coroc_app;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA coroc TO coroc_app;
GRANT DELETE ON sessions, upload_links TO coroc_app;
GRANT SELECT ON holiday_calendars TO coroc_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA coroc TO coroc_app;
