#!/usr/bin/env bash
set -euo pipefail

RELEASE_DIR="$1"
REVISION="$2"
cd "$RELEASE_DIR"

# Load only non-secret identifiers. Credentials are fetched from Secrets Manager below.
set -a
. /etc/dimka-bot/environment
set +a

npm ci --include=dev
npm run build

MASTER_SECRET_JSON="$(aws secretsmanager get-secret-value \
  --secret-id "$DB_MASTER_SECRET_ARN" \
  --query SecretString \
  --output text \
  --region "$AWS_REGION")"
APP_SECRET_JSON="$(aws secretsmanager get-secret-value \
  --secret-id "$APP_DATABASE_SECRET_ARN" \
  --query SecretString \
  --output text \
  --region "$AWS_REGION")"
MASTER_USERNAME="$(jq -r '.username' <<<"$MASTER_SECRET_JSON")"
MASTER_PASSWORD="$(jq -r '.password' <<<"$MASTER_SECRET_JSON")"
APP_USERNAME="$(jq -r '.username' <<<"$APP_SECRET_JSON")"
APP_PASSWORD="$(jq -r '.password' <<<"$APP_SECRET_JSON")"

# The generated app password is alphanumeric, so it is safe in this unlogged SQL input.
export PGPASSWORD="$MASTER_PASSWORD"
export PGSSLMODE=verify-full
export PGSSLROOTCERT="$RDS_CA_FILE"
psql --no-password \
  --host "$DB_HOST" \
  --port "$DB_PORT" \
  --username "$MASTER_USERNAME" \
  --dbname "$DB_NAME" \
  --set=ON_ERROR_STOP=1 <<SQL
DO \$role\$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '$APP_USERNAME') THEN
    ALTER ROLE $APP_USERNAME WITH LOGIN PASSWORD '$APP_PASSWORD';
  ELSE
    CREATE ROLE $APP_USERNAME LOGIN PASSWORD '$APP_PASSWORD';
  END IF;
END
\$role\$;
GRANT CONNECT ON DATABASE $DB_NAME TO $APP_USERNAME;
GRANT CREATE ON DATABASE $DB_NAME TO $APP_USERNAME;
GRANT USAGE, CREATE ON SCHEMA public TO $APP_USERNAME;
ALTER SCHEMA public OWNER TO $APP_USERNAME;
SQL
unset PGPASSWORD MASTER_SECRET_JSON APP_SECRET_JSON MASTER_USERNAME MASTER_PASSWORD APP_USERNAME APP_PASSWORD

install -o root -g root -m 0755 infra/scripts/with-secrets.sh /usr/local/sbin/dimka-with-secrets.new
mv -f /usr/local/sbin/dimka-with-secrets.new /usr/local/sbin/dimka-with-secrets
chown -R root:dimka "$RELEASE_DIR"
chmod -R g+rX,o-rwx "$RELEASE_DIR"
rm -f /opt/dimka/current.next
ln -s "$RELEASE_DIR" /opt/dimka/current.next
mv -Tf /opt/dimka/current.next /opt/dimka/current
systemctl restart dimka-bot.service

# Keep the active release and the five newest previous releases for rollback.
mapfile -t OLD_RELEASES < <(ls -1dt /opt/dimka/releases/* 2>/dev/null | tail -n +7)
if (( ${#OLD_RELEASES[@]} > 0 )); then
  rm -rf -- "${OLD_RELEASES[@]}"
fi
echo "Deployed $REVISION."
