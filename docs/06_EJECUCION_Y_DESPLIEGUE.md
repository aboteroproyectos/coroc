# COROC · Ejecución local y despliegue (fases 1 a 3)

## Requisitos

| Pieza | Versión |
|---|---|
| Node.js | 22 LTS (`.nvmrc`) |
| PostgreSQL | 16 |
| Redis | 7 (opcional con una sola instancia: sin `REDIS_URL`, los eventos en vivo y el trabajo horario corren en memoria dentro de la API) |
| Flutter | estable 3.32 o posterior (Dart 3.8) |
| Chromium sin interfaz | El de `playwright-core` (`npx playwright-core install chromium-headless-shell`) o cualquier Chromium con `COROC_CHROMIUM_PATH`; genera los PDF (ADR-033) |
| Tesseract y Poppler | Tesseract 5 con `spa`, `por` y `eng`, y `pdftoppm`, para leer comprobantes (ADR-037). En Debian o Ubuntu: `apt-get install tesseract-ocr tesseract-ocr-spa tesseract-ocr-por tesseract-ocr-eng poppler-utils` |
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
export COROC_STORAGE_DIR=./data/objects   # archivos cifrados (ADR-031)
npx playwright-core install chromium-headless-shell
npm start -w @coroc/api                # http://localhost:3000/v1 · salud en /health
```

Pruebas:

```bash
TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/postgres npm test   # crea y borra una base temporal y un almacén temporal
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
| Núcleo y API | `npm ci`, compilación, tipos, textos en 3 idiomas, Redocly, Chromium sin interfaz, Tesseract y todas las pruebas con PostgreSQL 16 (incluidos los PDF, CA-07 a CA-09 y CA-19 con OCR real, y la suite de penetración). Falla si la cobertura baja de 90 % en el núcleo o de 80 % en la API |
| Rendimiento | 100.000 clientes y 2.000.000 de cuotas: dashboard, búsqueda, cobros de hoy, p95 con usuarios concurrentes y carga mixta. El informe queda como artefacto `informe-de-rendimiento` |
| Seguridad · dependencias y DAST | `npm audit --omit=dev` (falla con vulnerabilidades moderadas o mayores) y OWASP ZAP sobre el contrato con una sesión real. Falla en inyección, XSS, SSRF, XXE, recorrido de rutas o ejecución de código (`.zap/rules.tsv`). El informe queda como artefacto `informe-zap` |
| Imagen Docker | Construye `services/api/Dockerfile` |
| App · análisis y pruebas | Genera las carpetas nativas y el código, verifica los textos en 3 idiomas, `flutter analyze`, `flutter test` (incluidas accesibilidad y contrato de la app) y el piso de cobertura |
| App · Android | APK y App Bundle (artefacto `coroc-android`) |
| App · Windows | Ejecutable (artefacto `coroc-windows`) |
| App · macOS e iOS | En `main`, etiquetas `v*` o a pedido: `.app` de macOS e iOS sin firma |

Los instaladores quedan como artefactos de cada ejecución, en la pestaña Actions del repositorio.

### Publicación (`.github/workflows/release.yml`, ADR-059)

Se ejecuta con una etiqueta `v*` (por ejemplo `git tag v0.5.0 && git push origin v0.5.0`) o a mano desde Actions. En los pull requests que cambian el flujo, corre en seco.

| Plataforma | Con secretos | Sin secretos |
|---|---|---|
| Android | App Bundle y APK firmados con la clave de subida; borrador en la pista interna de Google Play | Firmados con la clave de depuración |
| iOS | IPA firmado y subido a TestFlight | Compilación sin firma |
| macOS | DMG firmado con Developer ID, notarizado y grapado | DMG sin firma |
| Windows | MSIX firmado con el certificado de la empresa | MSIX para Microsoft Store (lo firma la tienda) |

La lista de secretos está al inicio del flujo. `COROC_API_URL` es la dirección que la app usará en producción. Con una etiqueta, los instaladores quedan en una versión en borrador de GitHub.

Para crear la clave de subida de Android:
```bash
keytool -genkeypair -v -keystore upload-keystore.jks -keyalg RSA -keysize 4096 -validity 10000 -alias upload
base64 -w0 upload-keystore.jks   # → ANDROID_KEYSTORE_BASE64
```
Active «Firma de apps de Google Play» para que Google guarde la clave de firma definitiva.

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
   - `COROC_CORS_ORIGINS` solo si habrá clientes web;
   - `COROC_API_PUBLIC_URL`, la dirección pública de la API (por ejemplo `https://api.miempresa.com`). Los códigos QR de los recibos apuntan a `…/v1/public/receipts/{código}`. Con `COROC_VERIFY_URL` se puede usar otra página de verificación.
4. **Documentos (Fase 2):**
   - `COROC_STORAGE=fs` con `COROC_STORAGE_DIR` en un volumen persistente (la imagen usa `/var/lib/coroc/objects`), o bien `COROC_STORAGE=s3` con `COROC_S3_BUCKET`, `COROC_S3_REGION`, `COROC_S3_ENDPOINT` (proveedores compatibles), `COROC_S3_PATH_STYLE=true` si el proveedor lo pide, `COROC_S3_PREFIX` y `COROC_S3_SSE=AES256|aws:kms` para cifrado adicional del proveedor. Las credenciales se toman de la cadena estándar de AWS (variables `AWS_*`, perfil o rol de la instancia). S3 aún no se ha probado contra un servicio real;
   - `COROC_DATA_KEY` ahora también cifra los archivos: guárdela con respaldo en el gestor de secretos, porque sin ella no se pueden leer (ADR-031);
   - `COROC_DOCUMENT_WORKER=on` (predeterminado) procesa la bandeja de documentos en la instancia; `off` para instancias que solo atienden peticiones. Al menos una debe tenerlo en `on` (ADR-032);
   - `COROC_LINK_TTL` (segundos, de 30 a 3600; 300 por defecto): vigencia de los enlaces de descarga;
   - `COROC_RESTORE_MAX_BYTES` (20 GB por defecto): tamaño máximo de un respaldo a restaurar. El proxy debe permitir cuerpos de ese tamaño en `/v1/restores` y peticiones largas en esa ruta.
5. **Recepción de comprobantes (Fase 3):**
   - `COROC_OCR=tesseract` (predeterminado) o `none`. Opcionales: `COROC_TESSERACT_PATH`, `COROC_PDFTOPPM_PATH`, `COROC_OCR_LANGS` (`spa+por+eng`) y `COROC_OCR_MAX_PAGES` (3);
   - extracción con IA (opcional, ADR-037): `COROC_EXTRACTION=claude` y `ANTHROPIC_API_KEY` en el gestor de secretos. También `COROC_EXTRACTION_MODEL` (`claude-opus-5`) y `COROC_EXTRACTION_TIMEOUT_MS`. Requiere el acuerdo de tratamiento de datos (S-6);
   - portal del deudor: `COROC_PORTAL_URL` (por defecto `COROC_API_PUBLIC_URL` + `/v1/public/upload/`) y `COROC_UPLOAD_LINK_DAYS` (365);
   - correo entrante: `COROC_INBOUND_EMAIL_DOMAIN` (p. ej. `pagos.coroc.app`) y `COROC_INBOUND_EMAIL_SECRET`. En el proveedor (Postmark u otro que envíe el mismo JSON), apunte el webhook de entrada a `https://api…/v1/webhooks/email/inbound?token=<secreto>`. Cada empresa recibe en `pagos-<código>@<dominio>`. El proxy debe aceptar cuerpos de hasta 40 MB en esa ruta;
   - WhatsApp Cloud API: `COROC_WHATSAPP_APP_SECRET` (secreto de la app de Meta) y `COROC_WHATSAPP_VERIFY_TOKEN`. En Meta, suscriba el webhook `https://api…/v1/webhooks/whatsapp` al campo `messages`. Cada empresa conecta su número (id del número y token de acceso) en Configuración › WhatsApp Business. Opcional: `COROC_WHATSAPP_GRAPH_VERSION` (`v23.0`).
6. **Mensajería (Fase 4):**
   - correo saliente: `COROC_EMAIL_PROVIDER=postmark` con `POSTMARK_SERVER_TOKEN` (y opcionales `COROC_POSTMARK_STREAM`, `outbound`, y `COROC_POSTMARK_URL`), o `COROC_EMAIL_PROVIDER=smtp` con `COROC_SMTP_URL` (por ejemplo `smtps://usuario:clave@email-smtp.us-east-1.amazonaws.com:465` para Amazon SES). Sin proveedor, los correos quedan en «Por enviar hoy» para enviarlos desde el programa de correo (ADR-048). `COROC_EMAIL_FROM` es el remitente de COROC (`notificaciones@coroc.app`) y `COROC_EMAIL_SPF_INCLUDE` el `include` de SPF que muestra el asistente de dominio (con Postmark, `spf.mtasv.net`);
   - avisos del correo (rebotes, quejas y entregas): `COROC_EMAIL_EVENTS_SECRET`, y en Postmark los webhooks de Bounce, Spam Complaint, Delivery y Subscription Change hacia `https://api…/v1/webhooks/email/events?token=<secreto>`;
   - WhatsApp Cloud API: suscriba además los campos `account_update` y `message_template_status_update` del webhook, y registre en Configuración el id de la cuenta de WhatsApp Business: por ahí llegan los avisos de suspensión (CA-20);
   - `COROC_DELIVERY_LINK_DAYS` (30): vigencia del enlace de descarga del recibo en los mensajes;
   - `COROC_MESSAGE_WORKER=on` (predeterminado) despacha los mensajes en la instancia cada 30 segundos; `off` para instancias que solo atienden peticiones. El trabajo de cada hora programa los recordatorios y los avisos de cuota vencida.
7. **Contenedor:** la imagen de `services/api/Dockerfile` corre sin root y expone `/health`. Detrás de HTTPS con TLS 1.2 o superior (Caddy, balanceador de la nube o similar). Para los eventos en vivo, desactive el búfer del proxy en `/v1/events`.
8. **Fase 5:**
   - migración `0006_fase5.sql`: índices y función de búsqueda (ADR-051) y columnas para eliminar cuentas (ADR-056);
   - `COROC_PRIVACY_CONTACT`: correo de privacidad publicado en `/v1/public/privacy` (por defecto `privacidad@coroc.app`);
   - el balanceador puede enviar `X-Request-Id`; la API lo devuelve y lo escribe en el registro de acceso (ADR-053);
   - **cierre de empresa:** a los 30 días de `tenants.closure_requested_at`, soporte hace tres pasos:
     1. exporta lo que la ley obliga a conservar (libro y recibos);
     2. purga los datos en una transacción como `coroc_owner`: `BEGIN; SELECT set_config('app.tenant_id', '<id>', true); SELECT coroc.purge_tenant_data('<id>'); COMMIT;`;
     3. borra el prefijo de la empresa en el almacenamiento de archivos (`t/<id>/`).

     Para revertir un cierre dentro del plazo: `UPDATE coroc.tenants SET closure_requested_at = NULL WHERE id = '<id>'`.
9. **Respaldo de la base:** respaldo automático diario del proveedor con retención de 30 días, más `pg_dump` semanal cifrado fuera de la nube principal. El respaldo `.coroc` por empresa (Configuración › Respaldo) complementa esto, pero no lo reemplaza. Respalde también el volumen o el depósito de archivos.

Queda pendiente decidir la nube, la región y el dominio (pregunta P-1).
