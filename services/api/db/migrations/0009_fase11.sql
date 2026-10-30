-- COROC · Fase 11 «Nuevo COROC»
SET search_path = coroc, public;

-- ─────────── Movimientos recientes (Inicio) ───────────
-- Los últimos pagos de la cartera, del más reciente al más antiguo, sin recorrer todo el libro de movimientos.
CREATE INDEX ledger_recent_payments_idx ON ledger_entries (tenant_id, recorded_at DESC) WHERE type = 'payment';
