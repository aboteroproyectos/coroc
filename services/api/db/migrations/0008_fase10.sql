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
