-- ════════════════════════════════════════════════════════════════════════════
-- COROC · Migración 0002 · Fase 1 (núcleo)
-- Ingreso por empresa, segundo factor, recuperación de contraseña, idempotencia,
-- estado derivado por préstamo (ADR-021) y alcance por cobrador en la base (ADR-022).
-- ════════════════════════════════════════════════════════════════════════════
SET search_path = coroc, public;

-- ─────────── Empresas ───────────
ALTER TABLE tenants ADD COLUMN slug citext;
ALTER TABLE tenants ADD COLUMN active boolean NOT NULL DEFAULT true;
ALTER TABLE tenants ADD COLUMN version integer NOT NULL DEFAULT 1;
UPDATE tenants SET slug = 'empresa-' || left(replace(id::text, '-', ''), 12) WHERE slug IS NULL;
ALTER TABLE tenants ALTER COLUMN slug SET NOT NULL;
ALTER TABLE tenants ADD CONSTRAINT tenants_slug_uq UNIQUE (slug);
ALTER TABLE tenants ADD CONSTRAINT tenants_slug_chk CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$');

-- El ingreso conoce el identificador corto de la empresa, no su uuid. Esta política solo revela
-- la fila cuyo identificador el cliente ya envió (la API fija app.lookup_slug en esa transacción).
CREATE POLICY tenant_lookup ON tenants FOR SELECT
  USING (slug = nullif(current_setting('app.lookup_slug', true), '')::citext AND active);

-- ─────────── Usuarios y sesiones ───────────
ALTER TABLE users ADD COLUMN email citext;
ALTER TABLE users ADD COLUMN theme text NOT NULL DEFAULT 'system' CHECK (theme IN ('system', 'light', 'dark'));
ALTER TABLE users ADD COLUMN totp_pending_enc bytea;          -- secreto en proceso de activación
ALTER TABLE users ADD COLUMN totp_last_counter bigint;        -- evita reutilizar un mismo código TOTP
ALTER TABLE users ADD COLUMN lockouts smallint NOT NULL DEFAULT 0;   -- bloqueo progresivo
ALTER TABLE users ADD COLUMN password_changed_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE users ADD COLUMN auto_lock_minutes smallint NOT NULL DEFAULT 5 CHECK (auto_lock_minutes BETWEEN 1 AND 60);
ALTER TABLE users ADD COLUMN version integer NOT NULL DEFAULT 1;
ALTER TABLE users ADD CONSTRAINT users_username_chk CHECK (username ~ '^[a-z0-9._-]{3,32}$');

ALTER TABLE sessions ADD COLUMN device_name text;
ALTER TABLE sessions ADD COLUMN last_used_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE sessions ADD COLUMN previous_hash bytea;          -- detecta la reutilización de un token ya rotado
ALTER TABLE sessions ADD COLUMN mfa_level text NOT NULL DEFAULT 'none' CHECK (mfa_level IN ('none', 'totp', 'enroll_required'));
CREATE INDEX sessions_device_idx ON sessions (tenant_id, user_id, device_id) WHERE revoked_at IS NULL;

CREATE TABLE mfa_challenges (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id),
  user_id      uuid NOT NULL REFERENCES users(id),
  device_id    text NOT NULL,
  device_name  text,
  expires_at   timestamptz NOT NULL,
  attempts     smallint NOT NULL DEFAULT 0,
  used_at      timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE password_resets (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id),
  user_id      uuid NOT NULL REFERENCES users(id),
  token_hash   bytea NOT NULL UNIQUE,
  expires_at   timestamptz NOT NULL,
  used_at      timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ─────────── Idempotencia de operaciones contables ───────────
CREATE TABLE idempotency_keys (
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  key           text NOT NULL CHECK (length(key) BETWEEN 8 AND 128),
  user_id       uuid NOT NULL REFERENCES users(id),
  request_hash  char(64) NOT NULL,
  status_code   integer,
  response      jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, key)
);

-- ─────────── Libro y recibos ───────────
ALTER TABLE ledger_entries ADD COLUMN note text;
ALTER TABLE receipts ADD COLUMN loan_id uuid REFERENCES loans(id);
ALTER TABLE receipts ADD COLUMN lang lang_code NOT NULL DEFAULT 'es';
ALTER TABLE receipts ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE receipts ALTER COLUMN document_id DROP NOT NULL;   -- el PDF se genera en la Fase 2
UPDATE receipts r SET loan_id = e.loan_id FROM ledger_entries e WHERE e.id = r.entry_id AND r.loan_id IS NULL;
ALTER TABLE receipts ALTER COLUMN loan_id SET NOT NULL;
CREATE INDEX receipts_loan_idx ON receipts (tenant_id, loan_id);

-- ─────────── Estado derivado por préstamo (ADR-021) ───────────
-- Caché de lectura reconstruida desde el libro con @coroc/core en la misma transacción de cada
-- movimiento y cada madrugada. Nadie la edita a mano; los saldos siguen derivándose del libro.
CREATE TABLE loan_state (
  loan_id                 uuid PRIMARY KEY REFERENCES loans(id),
  tenant_id               uuid NOT NULL REFERENCES tenants(id),
  client_id               uuid NOT NULL REFERENCES clients(id),
  currency                char(3) NOT NULL,
  as_of                   date NOT NULL,
  total_payable           bigint NOT NULL,
  paid_total              bigint NOT NULL,
  balance                 bigint NOT NULL,
  late_fees_outstanding   bigint NOT NULL,
  surplus                 bigint NOT NULL,
  paid_installments       integer NOT NULL,
  remaining_installments  integer NOT NULL,
  overdue_count           integer NOT NULL,
  overdue_amount          bigint NOT NULL,
  days_past_due           integer NOT NULL,
  due_today_amount        bigint NOT NULL,
  next_number             integer,
  next_due_date           date,
  next_outstanding        bigint,
  bucket                  text NOT NULL CHECK (bucket IN ('current', 'd1_7', 'd8_30', 'd30p', 'closed')),
  updated_at              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX loan_state_bucket_idx ON loan_state (tenant_id, currency, bucket);
CREATE INDEX loan_state_asof_idx ON loan_state (tenant_id, as_of) WHERE bucket <> 'closed';
CREATE INDEX loan_state_client_idx ON loan_state (tenant_id, client_id);

-- ─────────── RLS de las tablas nuevas ───────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['mfa_challenges', 'password_resets', 'idempotency_keys', 'loan_state']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_tenant()) WITH CHECK (tenant_id = current_tenant())', t);
  END LOOP;
END $$;

-- ─────────── Alcance del Cobrador en la base (ADR-022, CA-16) ───────────
-- La API abre las transacciones del Cobrador con SET LOCAL ROLE coroc_collector. Las políticas RESTRICTIVE de ese rol
-- se suman al aislamiento por empresa: solo ve sus clientes asignados y lo que cuelga de ellos, aunque la API tuviera
-- un error. Los demás roles no evalúan estas políticas, así que no pagan su costo en consultas grandes (§21).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'coroc_collector') THEN
    CREATE ROLE coroc_collector NOLOGIN NOBYPASSRLS;
  END IF;
END $$;
GRANT coroc_app TO coroc_collector;

CREATE FUNCTION app_user() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;
-- La función de consecutivos de la migración 0001 queda independiente del search_path de la conexión.
ALTER FUNCTION next_number(uuid, text) SET search_path = coroc, public;

CREATE POLICY collector_scope ON clients AS RESTRICTIVE TO coroc_collector
  USING (collector_id = coroc.app_user()) WITH CHECK (collector_id = coroc.app_user());
CREATE POLICY collector_scope ON co_debtors AS RESTRICTIVE TO coroc_collector
  USING (EXISTS (SELECT 1 FROM coroc.clients c WHERE c.id = client_id));
CREATE POLICY collector_scope ON consents AS RESTRICTIVE TO coroc_collector
  USING (EXISTS (SELECT 1 FROM coroc.clients c WHERE c.id = client_id));
CREATE POLICY collector_scope ON loans AS RESTRICTIVE TO coroc_collector
  USING (EXISTS (SELECT 1 FROM coroc.clients c WHERE c.id = client_id));
CREATE POLICY collector_scope ON loan_state AS RESTRICTIVE TO coroc_collector
  USING (EXISTS (SELECT 1 FROM coroc.clients c WHERE c.id = client_id));
CREATE POLICY collector_scope ON installments AS RESTRICTIVE TO coroc_collector
  USING (EXISTS (SELECT 1 FROM coroc.loans l WHERE l.id = loan_id));
CREATE POLICY collector_scope ON ledger_entries AS RESTRICTIVE TO coroc_collector
  USING (EXISTS (SELECT 1 FROM coroc.loans l WHERE l.id = loan_id));
CREATE POLICY collector_scope ON receipts AS RESTRICTIVE TO coroc_collector
  USING (EXISTS (SELECT 1 FROM coroc.loans l WHERE l.id = loan_id));
CREATE POLICY collector_scope ON payment_allocations AS RESTRICTIVE TO coroc_collector
  USING (EXISTS (SELECT 1 FROM coroc.ledger_entries e WHERE e.id = entry_id));

-- Distingue «no existe» de «existe pero no es suyo» para registrar el acceso denegado (CA-16).
-- Solo responde dentro de la empresa de la sesión y no revela ningún dato del cliente.
CREATE FUNCTION client_collector(p_client uuid) RETURNS TABLE (found boolean, collector_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = coroc, public AS
$$ SELECT true, c.collector_id FROM clients c WHERE c.id = p_client AND c.tenant_id = current_tenant() $$;
REVOKE ALL ON FUNCTION client_collector(uuid) FROM PUBLIC;
CREATE FUNCTION loan_collector(p_loan uuid) RETURNS TABLE (found boolean, collector_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = coroc, public AS
$$ SELECT true, c.collector_id FROM loans l JOIN clients c ON c.id = l.client_id WHERE l.id = p_loan AND l.tenant_id = current_tenant() $$;
REVOKE ALL ON FUNCTION loan_collector(uuid) FROM PUBLIC;

-- ─────────── Rendimiento con 100.000 clientes (§21) ───────────
-- Búsqueda sin tildes por nombre y código con índice de trigramas; orden alfabético paginado por índice.
ALTER TABLE clients ADD COLUMN search_text text GENERATED ALWAYS AS (
  lower(translate(first_name || ' ' || last_name || ' ' || code,
    'áàäâãéèëêíìïîóòöôõúùüûñçÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ', 'aaaaaeeeeiiiiooooouuuuncAAAAAEEEEIIIIOOOOOUUUUNC'))) STORED;
ALTER TABLE clients ADD COLUMN sort_name text GENERATED ALWAYS AS (lower(first_name || ' ' || last_name)) STORED;
CREATE INDEX clients_search_trgm ON clients USING gin (search_text gin_trgm_ops);
CREATE INDEX clients_phone_trgm ON clients USING gin (phone_e164 gin_trgm_ops);
CREATE INDEX clients_sort_idx ON clients (tenant_id, sort_name, id);
CREATE INDEX loans_contract_trgm ON loans USING gin (lower(contract) gin_trgm_ops);
CREATE INDEX loan_state_due_idx ON loan_state (tenant_id, next_due_date) WHERE bucket <> 'closed';

-- Capital en el estado derivado: el dashboard suma sin volver a leer los préstamos.
ALTER TABLE loan_state ADD COLUMN principal bigint NOT NULL DEFAULT 0;

-- Recaudo por día y moneda (tendencia de 30 días del dashboard, §17). Se actualiza en la misma transacción de cada
-- pago y de cada reverso; es una suma derivada del libro, que sigue siendo la fuente de verdad.
CREATE TABLE daily_collections (
  tenant_id  uuid NOT NULL REFERENCES tenants(id),
  currency   char(3) NOT NULL,
  day        date NOT NULL,
  amount     bigint NOT NULL DEFAULT 0,
  payments   integer NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, currency, day)
);
ALTER TABLE daily_collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_collections FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON daily_collections USING (tenant_id = current_tenant()) WITH CHECK (tenant_id = current_tenant());
-- El Cobrador no lee el total de la empresa: su tendencia se calcula sobre sus propios pagos.
CREATE POLICY collector_scope ON daily_collections AS RESTRICTIVE FOR SELECT TO coroc_collector USING (false);
GRANT SELECT ON daily_collections TO coroc_app;
-- Suma o resta en el día del pago; la usan también los pagos que registra el Cobrador, que no puede leer la tabla.
CREATE FUNCTION bump_daily_collection(p_currency char(3), p_day date, p_amount bigint, p_count integer) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = coroc, public AS
$$ INSERT INTO daily_collections (tenant_id, currency, day, amount, payments) VALUES (current_tenant(), p_currency, p_day, p_amount, p_count)
   ON CONFLICT (tenant_id, currency, day) DO UPDATE
   SET amount = daily_collections.amount + EXCLUDED.amount, payments = daily_collections.payments + EXCLUDED.payments $$;
REVOKE ALL ON FUNCTION bump_daily_collection(char, date, bigint, integer) FROM PUBLIC;

-- ─────────── Permisos del rol de la aplicación ───────────
GRANT SELECT, INSERT, UPDATE ON mfa_challenges, password_resets, idempotency_keys, loan_state TO coroc_app;
GRANT DELETE ON idempotency_keys, mfa_challenges TO coroc_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA coroc TO coroc_app;

-- Trabajos de mantenimiento (recalcular el estado diario de cada préstamo): solo expone los identificadores
-- de las empresas activas; los datos de cada una se leen después con su propio contexto de RLS.
CREATE FUNCTION active_tenant_ids() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = coroc, public AS
$$ SELECT id FROM tenants WHERE active $$;
REVOKE ALL ON FUNCTION active_tenant_ids() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION active_tenant_ids(), client_collector(uuid), loan_collector(uuid), bump_daily_collection(char, date, bigint, integer) TO coroc_app;
