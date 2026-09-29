#!/usr/bin/env bash
# Preparación de producción en Fly.io de una sola vez, sin terminal ni flyctl en el equipo de nadie (P-1, ADR-060).
# La ejecuta el flujo «Preparar producción» (.github/workflows/setup-production.yml). Hace, en orden, lo de
# docs/06_EJECUCION_Y_DESPLIEGUE.md §6 pasos 2 a 6 y se puede repetir: cada paso ya hecho se salta.
#
#   1. Comprueba los secretos, el acceso a Fly.io y los dos depósitos de R2.
#   2. Crea la app de la API y el clúster de PostgreSQL en São Paulo (gru).
#   3. Crea la base «coroc», los roles y aplica las migraciones (services/api/scripts/prepare-db.mjs).
#   4. Genera las claves y carga todos los secretos en Fly.io. La clave de los archivos (COROC_DATA_KEY) queda además
#      cifrada con BACKUP_PASSPHRASE en R2: sin ella los documentos no se pueden leer (ADR-031).
#   5. Despliega y comprueba que la API responde.
#   6. Si se pidió, crea la primera empresa y su Propietario.
#
# Ninguna clave se escribe en los registros: todas se enmascaran y los archivos temporales se borran al salir.
set -euo pipefail

: "${FLY_API_TOKEN:?}" "${R2_ENDPOINT:?}" "${R2_ACCESS_KEY_ID:?}" "${R2_SECRET_ACCESS_KEY:?}" "${BACKUP_PASSPHRASE:?}"
APP="${FLY_APP:-coroc-api}"
DB_APP="${FLY_DB_APP:-coroc-db}"
ORG="${FLY_ORG:-personal}"
REGION="${FLY_REGION:-gru}"
OBJECTS="${R2_BUCKET:-coroc-objects}"
BACKUPS="${R2_BACKUP_BUCKET:-coroc-db-backups}"
PUBLIC_URL="${COROC_PUBLIC_URL:-https://$APP.fly.dev}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TMP="$(mktemp -d)"
PROXY_PID=""
cleanup() {
  if [ -n "$PROXY_PID" ]; then kill "$PROXY_PID" 2>/dev/null || true; fi
  rm -rf "$TMP"
}
trap cleanup EXIT

mask() { if [ -n "$1" ]; then echo "::add-mask::$1"; fi; }
step() { echo; echo "::group::$1"; }
done_step() { echo "::endgroup::"; }
fail() { echo "::error::$1"; exit 1; }
export AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" AWS_DEFAULT_REGION=auto
mask "$BACKUP_PASSPHRASE"
mask "${COROC_OWNER_PASSWORD:-}"

step "1. Comprobaciones"
[ "${#BACKUP_PASSPHRASE}" -ge 20 ] || fail "BACKUP_PASSPHRASE debe tener al menos 20 caracteres."
case "$R2_ENDPOINT" in https://*.r2.cloudflarestorage.com*) ;; *) fail "R2_ENDPOINT debe verse así: https://<id-de-cuenta>.r2.cloudflarestorage.com" ;; esac
R2_ENDPOINT="${R2_ENDPOINT%/}"
flyctl auth whoami >/dev/null 2>&1 || fail "FLY_API_TOKEN no sirve: cree uno nuevo en Fly.io (Tokens) y reemplácelo en GitHub."
echo "✔ Acceso a Fly.io (organización «$ORG»)"
for b in "$OBJECTS" "$BACKUPS"; do
  aws s3api head-bucket --bucket "$b" --endpoint-url "$R2_ENDPOINT" >/dev/null 2>&1 \
    || fail "No encuentro el depósito «$b» en R2, o el token de R2 no tiene acceso a él. Créelo en Cloudflare › R2 y revise el token."
  echo "✔ Depósito R2 «$b»"
done
done_step

step "2. App y base de datos en Fly.io ($REGION)"
if flyctl status --app "$APP" >/dev/null 2>&1; then
  echo "· La app $APP ya existe"
else
  flyctl apps create "$APP" --org "$ORG"
fi
if flyctl status --app "$DB_APP" >/dev/null 2>&1; then
  echo "· La base $DB_APP ya existe"
else
  PG_PASSWORD="$(openssl rand -hex 24)"
  mask "$PG_PASSWORD"
  flyctl postgres create --name "$DB_APP" --org "$ORG" --region "$REGION" --initial-cluster-size 2 \
    --vm-size shared-cpu-1x --volume-size 20 --password "$PG_PASSWORD" >/dev/null
  echo "✔ Base $DB_APP creada (2 máquinas, 20 GB)"
fi
done_step

SECRETS="$(flyctl secrets list --app "$APP" --json | jq -r '.[] | (.name // .Name)')"
has_secret() { grep -qx "$1" <<<"$SECRETS"; }

step "3. Roles y migraciones"
if has_secret DATABASE_URL && has_secret DATABASE_ADMIN_URL; then
  echo "· La base ya estaba preparada"
else
  if [ -z "${PG_PASSWORD:-}" ]; then
    PG_PASSWORD="$(flyctl ssh console --app "$DB_APP" --quiet -C 'printenv SU_PASSWORD' | tr -d '\r\n')"
    mask "$PG_PASSWORD"
    [ -n "$PG_PASSWORD" ] || fail "No pude leer la clave del superusuario de $DB_APP."
  fi
  flyctl proxy 15432:5432 --app "$DB_APP" >/dev/null 2>&1 &
  PROXY_PID=$!
  for _ in $(seq 1 45); do pg_isready -h 127.0.0.1 -p 15432 -q && break; sleep 2; done
  pg_isready -h 127.0.0.1 -p 15432 -q || fail "No pude conectarme a $DB_APP por el túnel de flyctl."
  SUPER="postgres://postgres:$PG_PASSWORD@127.0.0.1:15432"
  if [ -z "$(psql "$SUPER/postgres" -tAc "SELECT 1 FROM pg_database WHERE datname = 'coroc'")" ]; then
    psql "$SUPER/postgres" -qc 'CREATE DATABASE coroc'
    echo "✔ Base «coroc» creada"
  fi
  (cd "$ROOT/services/api" && DATABASE_SUPERUSER_URL="$SUPER/coroc" COROC_DB_HOST="$DB_APP.flycast:5432" \
    node scripts/prepare-db.mjs --write-env "$TMP/db.env")
  grep -q '^DATABASE_URL=' "$TMP/db.env" && grep -q '^DATABASE_ADMIN_URL=' "$TMP/db.env" \
    || fail "Los roles ya existían pero Fly.io no tiene sus claves. Pida ayuda: hay que cambiar las contraseñas de coroc_api y coroc_owner."
  while IFS='=' read -r _ v; do mask "$v"; done <"$TMP/db.env"
fi
done_step

step "4. Claves y secretos de la API"
{
  [ -f "$TMP/db.env" ] && cat "$TMP/db.env"
  has_secret COROC_JWT_SECRET || echo "COROC_JWT_SECRET=$(openssl rand -base64 48 | tr -d '\n')"
  echo "COROC_S3_ENDPOINT=$R2_ENDPOINT"
  echo "COROC_S3_BUCKET=$OBJECTS"
  echo "AWS_ACCESS_KEY_ID=$R2_ACCESS_KEY_ID"
  echo "AWS_SECRET_ACCESS_KEY=$R2_SECRET_ACCESS_KEY"
  echo "COROC_API_PUBLIC_URL=$PUBLIC_URL"
  echo "COROC_PUBLIC_URL=$PUBLIC_URL"
} >"$TMP/app.env"
if ! has_secret COROC_DATA_KEY; then
  DATA_KEY="$(openssl rand -base64 32 | tr -d '\n')"
  mask "$DATA_KEY"
  echo "COROC_DATA_KEY=$DATA_KEY" >>"$TMP/app.env"
  # Copia de la clave de los archivos, cifrada con la frase de las copias: es lo único que hay que guardar aparte.
  printf '%s' "$DATA_KEY" | openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -salt -pass env:BACKUP_PASSPHRASE -out "$TMP/data-key.enc"
  aws s3 cp "$TMP/data-key.enc" "s3://$BACKUPS/claves/COROC_DATA_KEY.enc" --endpoint-url "$R2_ENDPOINT" --only-show-errors
  echo "✔ Clave de los archivos generada y guardada cifrada en R2: $BACKUPS/claves/COROC_DATA_KEY.enc"
fi
grep -v '^$' "$TMP/app.env" | flyctl secrets import --app "$APP" --stage >/dev/null
echo "✔ Secretos cargados en $APP: $(cut -d= -f1 "$TMP/app.env" | tr '\n' ' ')"
done_step

step "5. Despliegue"
(cd "$ROOT" && flyctl deploy --remote-only --config fly.toml --app "$APP")
curl -fsS --retry 10 --retry-delay 6 --retry-all-errors "$PUBLIC_URL/health" >/dev/null
echo "✔ La API responde en $PUBLIC_URL"
done_step

if [ -n "${TENANT_SLUG:-}" ]; then
  step "6. Primera empresa"
  : "${TENANT_NAME:?}" "${OWNER_USERNAME:?}" "${OWNER_NAME:?}"
  [ -n "${COROC_OWNER_PASSWORD:-}" ] || fail "Falta el secreto COROC_OWNER_PASSWORD (contraseña inicial del Propietario)."
  if [ -f "$TMP/db.env" ]; then
    ADMIN_URL="$(sed -n 's/^DATABASE_ADMIN_URL=//p' "$TMP/db.env")"
  else
    ADMIN_URL="$(flyctl ssh console --app "$APP" --quiet -C 'printenv DATABASE_ADMIN_URL' | tr -d '\r\n')"
    mask "$ADMIN_URL"
  fi
  if [ -z "$PROXY_PID" ]; then
    flyctl proxy 15432:5432 --app "$DB_APP" >/dev/null 2>&1 &
    PROXY_PID=$!
    for _ in $(seq 1 45); do pg_isready -h 127.0.0.1 -p 15432 -q && break; sleep 2; done
  fi
  ADMIN_URL="$(node -e 'const u = new URL(process.argv[1]); u.host = "127.0.0.1:15432"; console.log(u.toString())' "$ADMIN_URL")"
  mask "$ADMIN_URL"
  (cd "$ROOT/services/api" && ADMIN_URL="$ADMIN_URL" node --input-type=module -e '
    import { createTenant } from "./dist/cli/tenant-create.js";
    const e = process.env;
    try {
      const r = await createTenant(e.ADMIN_URL, { slug: e.TENANT_SLUG, name: e.TENANT_NAME, country: e.TENANT_COUNTRY || "CO",
        owner: e.OWNER_USERNAME, ownerName: e.OWNER_NAME, email: e.OWNER_EMAIL || undefined, password: e.COROC_OWNER_PASSWORD });
      console.log(`✔ Empresa «${e.TENANT_NAME}» creada (${e.TENANT_SLUG}). Entre con el usuario «${e.OWNER_USERNAME}».`);
    } catch (err) {
      if (err.code === "23505") console.log(`· La empresa «${e.TENANT_SLUG}» ya existía`);
      else { console.error(`::error::${err.message}`); process.exit(1); }
    }')
  done_step
fi

cat >>"${GITHUB_STEP_SUMMARY:-/dev/null}" <<EOF
## COROC en producción ✔

- Dirección de la API: **$PUBLIC_URL**
- Base de datos: \`$DB_APP\` (São Paulo, 2 máquinas)
- Documentos cifrados: R2 \`$OBJECTS\`; copias semanales: R2 \`$BACKUPS\`
- La clave de los archivos está cifrada en R2 (\`$BACKUPS/claves/COROC_DATA_KEY.enc\`) con su **BACKUP_PASSPHRASE**.
  Guarde esa frase en un lugar seguro: sin ella no se pueden recuperar los documentos si se pierde la cuenta de Fly.io.

Desde ahora cada cambio que llegue a \`main\` con la CI en verde se despliega solo.
EOF
echo "✔ Listo: $PUBLIC_URL"
