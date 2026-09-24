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
-- Lo mismo, con verificación previa y contraseñas aleatorias, lo hace `node scripts/prepare-db.mjs` (ADR-060).
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE ROLE coroc_owner LOGIN BYPASSRLS PASSWORD :'owner_password';
CREATE ROLE coroc_api LOGIN NOBYPASSRLS PASSWORD :'api_password';
-- El dueño no tiene CREATEROLE: los roles de permisos se crean aquí y él los administra sin heredarlos.
CREATE ROLE coroc_app NOLOGIN NOBYPASSRLS;
CREATE ROLE coroc_collector NOLOGIN NOBYPASSRLS;
GRANT coroc_app TO coroc_owner WITH ADMIN TRUE, INHERIT FALSE, SET FALSE;
GRANT coroc_collector TO coroc_owner WITH ADMIN TRUE, INHERIT FALSE, SET FALSE;
GRANT CREATE ON DATABASE coroc TO coroc_owner;
-- Desde PostgreSQL 15, public no admite objetos de cualquiera: ahí vive la tabla de migraciones.
GRANT USAGE, CREATE ON SCHEMA public TO coroc_owner;
GRANT coroc_app TO coroc_api;
GRANT coroc_collector TO coroc_api WITH INHERIT FALSE, SET TRUE;
-- Después: DATABASE_ADMIN_URL=postgres://coroc_owner:…@…/coroc node dist/db/migrate.js
