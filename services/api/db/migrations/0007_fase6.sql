-- COROC · Fase 6 «Puesta en producción»
SET search_path = coroc, public;

-- ─────────── Préstamos por encima del tope legal (P-6, ADR-061) ───────────
-- Por defecto COROC no deja crear un préstamo por encima del tope de tasa (ADR-026). El Propietario puede cambiar la
-- política de la empresa a «solo advertir» asumiendo la responsabilidad; aun así cada préstamo por encima del tope se
-- confirma uno por uno y queda marcado aquí y en la bitácora de auditoría.
ALTER TABLE loans ADD COLUMN rate_cap_override boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN loans.rate_cap_override IS 'Creado por encima del tope de tasa (o sin tope en Colombia) con la confirmación del usuario (ADR-061)';
