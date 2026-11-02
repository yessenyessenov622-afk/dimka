#!/usr/bin/env bash
set -euo pipefail
umask 077

CONFIG_ROOT="/etc/karas-telegram-bot"
set -a
. "$CONFIG_ROOT/environment"
set +a

AWS_BIN="$(command -v aws)"
if ! BOT_TOKEN_VALUE="$("$AWS_BIN" ssm get-parameter \
  --name "$BOT_TOKEN_PARAMETER" \
  --with-decryption \
  --query 'Parameter.Value' \
  --output text \
  --region "$AWS_REGION" 2>/dev/null)"; then
  echo "Unable to load the Telegram bot token from Parameter Store." >&2
  exit 78
fi
if ! OWNER_ID_VALUE="$("$AWS_BIN" ssm get-parameter \
  --name "$OWNER_TELEGRAM_ID_PARAMETER" \
  --query 'Parameter.Value' \
  --output text \
  --region "$AWS_REGION" 2>/dev/null)"; then
  echo "Unable to load the bot owner ID from Parameter Store." >&2
  exit 78
fi

if [[ -z "$BOT_TOKEN_VALUE" || ! "$OWNER_ID_VALUE" =~ ^[0-9]+$ ]]; then
  echo "Telegram bot configuration is missing or invalid." >&2
  exit 78
fi

TEMP_FILE="$(mktemp "$CONFIG_ROOT/secrets.XXXXXX")"
trap 'rm -f -- "$TEMP_FILE"; unset BOT_TOKEN_VALUE OWNER_ID_VALUE' EXIT
printf 'BOT_TOKEN=%s\nOWNER_TELEGRAM_ID=%s\n' "$BOT_TOKEN_VALUE" "$OWNER_ID_VALUE" > "$TEMP_FILE"
chown root:root "$TEMP_FILE"
chmod 0600 "$TEMP_FILE"
mv -f "$TEMP_FILE" "$CONFIG_ROOT/secrets"
trap - EXIT
unset BOT_TOKEN_VALUE OWNER_ID_VALUE
echo "Stored bot credentials in the root-only system configuration file."
