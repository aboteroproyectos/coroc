# COROC · Ejecución local y despliegue (Fase 1)

## Requisitos

| Pieza | Versión |
|---|---|
| Node.js | 22 LTS (`.nvmrc`) |
| PostgreSQL | 16 |
| Redis | 7 (opcional con una sola instancia: sin `REDIS_URL`, los eventos en vivo y el trabajo horario corren en memoria dentro de la API) |
| Flutter | estable 3.32 o posterior (Dart 3.8) |
| Docker | 24 o posterior, con Compose v2.24 o posterior (para `infra/`) |

## 1. Servidor en desarrollo

```bash
npm ci
npm run build                      # @coroc/core y @coroc/api

# Base de datos: migraciones con el rol dueño y usuario de la API sin BYPASSRLS
export DATABASE_ADMIN_URL=postgres://postgres:postgres@127.0.0.1:5432/coroc
export COROC_API_DB_PASSWORD=una-clave-local
node services/api/dist/db/migrate.js
node services/api/dist/db/setup-roles.js

# Primera empresa y su Propietario (pide la contraseña sin mostrarla)
node services/api/dist/cli/tenant-create.js --slug mi-empresa --name "Mi Empresa S.A.S." \
  --country CO --owner admin --owner-name "Nombre Apellido" --email admin@ejemplo.com

# API
export DATABASE_URL=postgres://coroc_api:una-clave-local@127.0.0.1:5432/coroc
export COROC_JWT_SECRET=$(openssl rand -base64 48)
export COROC_DATA_KEY=$(openssl rand -base64 32)
export COROC_MFA_OWNER=optional        # solo en desarrollo
npm start -w @coroc/api                # http://localhost:3000/v1 · salud en /health
```

Pruebas:

```bash
TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/postgres npm test   # crea y borra una base temporal
npm run lint:i18n                                                                  # textos del servidor en 3 idiomas
```

## 2. Todo con Docker

```bash
cp infra/.env.example infra/.env       # complete secretos y contraseñas
docker compose -f infra/docker-compose.yml up -d --build
docker compose -f infra/docker-compose.yml run --rm migrate node dist/cli/tenant-create.js \
  --slug mi-empresa --name "Mi Empresa S.A.S." --country CO --owner admin --owner-name "Nombre Apellido"
```

Con dominio propio y HTTPS automático: en `infra/.env` ponga `COROC_DOMAIN=api.miempresa.com` (con el DNS apuntando al servidor) y agregue `--profile https` al comando `up`.

## 3. App Flutter

```bash
cd apps/coroc_app
flutter create --platforms=android,ios,macos,windows --org co.coroc --project-name coroc .
rm -f test/widget_test.dart
python3 tool/patch_platforms.py        # ajustes de COROC en las carpetas nativas (ADR-029)
flutter pub get
dart run build_runner build --delete-conflicting-outputs
flutter gen-l10n
dart run flutter_launcher_icons

flutter run --dart-define=COROC_API=http://10.0.2.2:3000/v1   # emulador Android contra la API local
flutter test
```

- La dirección de la API se fija al compilar con `--dart-define=COROC_API=https://api.miempresa.com/v1`.
- Desde el emulador de Android, `localhost` del computador es `10.0.2.2`. En iOS, Windows y macOS sirve `http://localhost:3000/v1`.
- Compilaciones de entrega: `flutter build apk --release`, `flutter build appbundle`, `flutter build ios --release`, `flutter build macos --release` y `flutter build windows --release`. iOS y macOS se compilan en un Mac.

## 4. Integración continua

`.github/workflows/ci.yml` se ejecuta en cada push a `main` o `fase-*` y en cada pull request:

| Trabajo | Qué hace |
|---|---|
| Núcleo y API | `npm ci`, compilación, tipos, textos en 3 idiomas, Redocly y todas las pruebas con PostgreSQL 16 |
| Imagen Docker | Construye `services/api/Dockerfile` |
| App · análisis y pruebas | Genera las carpetas nativas y el código, verifica los 377 textos en 3 idiomas, `flutter analyze` y `flutter test` |
| App · Android | APK y App Bundle (artefacto `coroc-android`) |
| App · Windows | Ejecutable (artefacto `coroc-windows`) |
| App · macOS e iOS | En `main`, etiquetas `v*` o a pedido: `.app` de macOS e iOS sin firma |

Los instaladores quedan como artefactos de cada ejecución, en la pestaña Actions del repositorio.

## 5. Producción

1. **Base de datos gestionada (PostgreSQL 16).** Ejecute `services/api/db/roles.sql` como administrador: crea `coroc_owner` (dueño del esquema) y `coroc_api` (sin BYPASSRLS). Migre con `DATABASE_ADMIN_URL` apuntando a `coroc_owner`. Luego ejecute los dos `GRANT` indicados al final de `roles.sql`.
2. **Secretos** en el gestor de la nube, nunca en el repositorio:
   - `COROC_JWT_SECRET` (48 bytes aleatorios);
   - `COROC_DATA_KEY` (32 bytes, cifra los secretos TOTP; si se pierde, los usuarios deben volver a activar el segundo factor);
   - `DATABASE_URL` con el usuario `coroc_api`.
3. **Variables:**
   - `COROC_PUBLIC_URL` (enlaces de recuperación);
   - `COROC_MFA_OWNER=required`;
   - `COROC_BREACHED_CHECK=hibp`;
   - `REDIS_URL` (necesario con más de una instancia: eventos en vivo y trabajo horario);
   - `COROC_CORS_ORIGINS` solo si habrá clientes web.
4. **Contenedor:** la imagen de `services/api/Dockerfile` corre sin root y expone `/health`. Detrás de HTTPS con TLS 1.2 o superior (Caddy, balanceador de la nube o similar). Para los eventos en vivo, desactive el búfer del proxy en `/v1/events`.
5. **Respaldo de la base:** respaldo automático diario del proveedor con retención de 30 días, más `pg_dump` semanal cifrado fuera de la nube principal. El respaldo `.coroc` por empresa llega en la Fase 2.

Queda pendiente decidir la nube, la región y el dominio (pregunta P-1).
