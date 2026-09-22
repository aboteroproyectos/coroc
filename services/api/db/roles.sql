-- ════════════════════════════════════════════════════════════════════════════
-- COROC · Roles de base de datos en producción (se ejecuta una vez, como superusuario del servidor gestionado)
--
--   coroc_owner      dueño del esquema; aplica las migraciones; BYPASSRLS para las funciones SECURITY DEFINER
--                    (consecutivos del recibo diario, alcance del cobrador, lista de empresas para el trabajo nocturno).
--   coroc_app        permisos de la aplicación (lo crean las migraciones): SELECT/INSERT/UPDATE, sin DELETE contable.
--   coroc_collector  rol restringido que la API asume con SET LOCAL ROLE en las transacciones del Cobrador (ADR-022).
--   coroc_api        usuario con el que se conecta la API: miembro de coroc_app; puede asumir coroc_collector pero
--                    NO hereda sus políticas (INHERIT FALSE). Nunca superusuario, nunca BYPASSRLS.
-- Reemplace las contraseñas por secretos del gestor de secretos de la nube.
-- ════════════════════════════════════════════════════════════════════════════
CREATE ROLE coroc_owner LOGIN BYPASSRLS PASSWORD :'owner_password';
CREATE ROLE coroc_api LOGIN NOBYPASSRLS PASSWORD :'api_password';
GRANT CREATE ON DATABASE coroc TO coroc_owner;
-- Después de la primera migración (que crea coroc_app y coroc_collector):
--   GRANT coroc_app TO coroc_api;
--   GRANT coroc_collector TO coroc_api WITH INHERIT FALSE, SET TRUE;
