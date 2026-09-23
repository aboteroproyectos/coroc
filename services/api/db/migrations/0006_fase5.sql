-- COROC · Fase 5 «Endurecimiento y publicación» (§21)
SET search_path = coroc, public;

-- ─────────── Búsqueda de clientes con índices de trigramas bajo RLS (§21: < 300 ms con 100.000 clientes) ───────────
-- Con RLS, PostgreSQL no puede usar un índice con un operador que no es LEAKPROOF (como LIKE) antes de aplicar la
-- política, así que la búsqueda recorría la empresa entera. Esta función encuentra los candidatos con los índices,
-- limitada explícitamente a la empresa de la sesión; la consulta que la usa sigue pasando por RLS (el Cobrador solo ve
-- a sus clientes). Solo devuelve identificadores.
CREATE INDEX clients_phone2_trgm ON clients USING gin (phone2_e164 gin_trgm_ops) WHERE phone2_e164 IS NOT NULL;
CREATE INDEX clients_iddoc_digits_trgm ON clients USING gin ((regexp_replace(coalesce(id_doc_number, ''), '\D', '', 'g')) gin_trgm_ops)
  WHERE id_doc_number IS NOT NULL;

CREATE FUNCTION search_client_ids(p_like text, p_digits text) RETURNS TABLE (id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = coroc, public AS $$
  SELECT c.id FROM clients c WHERE c.tenant_id = current_tenant() AND c.search_text LIKE p_like
  UNION
  SELECT l.client_id FROM loans l WHERE l.tenant_id = current_tenant() AND lower(l.contract) LIKE p_like
  UNION
  SELECT c.id FROM clients c WHERE p_digits IS NOT NULL AND c.tenant_id = current_tenant() AND c.phone_e164 LIKE p_digits
  UNION
  SELECT c.id FROM clients c WHERE p_digits IS NOT NULL AND c.tenant_id = current_tenant() AND c.phone2_e164 LIKE p_digits
  UNION
  SELECT c.id FROM clients c WHERE p_digits IS NOT NULL AND c.tenant_id = current_tenant() AND c.id_doc_number IS NOT NULL
     AND regexp_replace(coalesce(c.id_doc_number, ''), '\D', '', 'g') LIKE p_digits
$$;
REVOKE ALL ON FUNCTION search_client_ids(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION search_client_ids(text, text) TO coroc_app;

-- Eliminación de cuentas (ADR-056): el usuario se anonimiza y la empresa queda cerrada con plazo de gracia.
ALTER TABLE users ADD COLUMN deleted_at timestamptz;
ALTER TABLE tenants ADD COLUMN closure_requested_at timestamptz;
