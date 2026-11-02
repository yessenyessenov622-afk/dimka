#!/usr/bin/env bash
set -euo pipefail

BOT_TOKEN_VALUE="$(aws secretsmanager get-secret-value \
  --secret-id "$BOT_TOKEN_SECRET_ARN" \
  --query SecretString \
  --output text \
  --region "$AWS_REGION")"
if [[ -z "$BOT_TOKEN_VALUE" || "$BOT_TOKEN_VALUE" == "REPLACE_WITH_BOTFATHER_TOKEN" ]]; then
  echo "Telegram token secret has not been configured." >&2
  exit 78
fi

APP_DB_SECRET_JSON="$(aws secretsmanager get-secret-value \
  --secret-id "$APP_DATABASE_SECRET_ARN" \
  --query SecretString \
  --output text \
  --region "$AWS_REGION")"
export BOT_TOKEN_VALUE APP_DB_SECRET_JSON
export BOT_TOKEN="$BOT_TOKEN_VALUE"
export OWNER_TELEGRAM_ID TIMEZONE
export DATABASE_URL
DATABASE_URL="$(node -e '
const secret = JSON.parse(process.env.APP_DB_SECRET_JSON);
const user = encodeURIComponent(secret.username);
const password = encodeURIComponent(secret.password);
const url = new URL("postgresql://" + user + ":" + password + "@" +
  process.env.DB_HOST + ":" + process.env.DB_PORT + "/" + process.env.DB_NAME);
url.searchParams.set("schema", "public");
url.searchParams.set("sslmode", "verify-full");
url.searchParams.set("sslrootcert", process.env.RDS_CA_FILE);
process.stdout.write(url.toString());
')"
unset BOT_TOKEN_VALUE APP_DB_SECRET_JSON
exec "$@"
