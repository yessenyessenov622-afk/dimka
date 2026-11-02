#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="/opt/karas-telegram-bot"
DATA_ROOT="/var/lib/karas-telegram-bot"
CONFIG_ROOT="/etc/karas-telegram-bot"
SCRIPT_ROOT="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_ROOT/../.." && pwd)"

if [[ "$EUID" -ne 0 ]]; then
  echo "Run this bootstrap as root." >&2
  exit 1
fi

dnf install -y nodejs22 nodejs22-npm git
if ! command -v aws >/dev/null 2>&1; then
  dnf install -y awscli-2
fi

if ! getent group karasbot >/dev/null; then
  groupadd --system karasbot
fi
if ! id -u karasbot >/dev/null 2>&1; then
  useradd --system --gid karasbot --no-create-home --home-dir "$DATA_ROOT" --shell /sbin/nologin karasbot
fi

install -d -o root -g root -m 0755 "$APP_ROOT" "$APP_ROOT/releases"
install -d -o karasbot -g karasbot -m 0700 "$DATA_ROOT"
install -d -o root -g root -m 0700 "$CONFIG_ROOT"

cat > "$CONFIG_ROOT/environment" <<'ENVIRONMENT'
AWS_REGION=eu-north-1
BOT_TOKEN_PARAMETER=/karas-telegram-bot/prod/BOT_TOKEN
OWNER_TELEGRAM_ID_PARAMETER=/karas-telegram-bot/prod/OWNER_TELEGRAM_ID
DATABASE_URL=file:/var/lib/karas-telegram-bot/bot.db
TIMEZONE=Asia/Almaty
NODE_ENV=production
ENVIRONMENT
chown root:root "$CONFIG_ROOT/environment"
chmod 0600 "$CONFIG_ROOT/environment"

install -o root -g root -m 0755 "$SCRIPT_ROOT/provision-secrets.sh" /usr/local/sbin/karas-telegram-bot-provision-secrets
install -o root -g root -m 0755 "$SCRIPT_ROOT/deploy-release.sh" /usr/local/sbin/karas-telegram-bot-deploy-release
install -o root -g root -m 0755 "$SCRIPT_ROOT/deploy-commit.sh" /usr/local/sbin/karas-telegram-bot-deploy
install -o root -g root -m 0644 "$REPO_ROOT/infra/systemd/karas-telegram-bot.service" /etc/systemd/system/karas-telegram-bot.service

systemctl daemon-reload
systemctl enable karas-telegram-bot.service

node --version
npm --version
aws --version
echo "Bootstrap complete. The bot service is enabled and will start after the first release is deployed."
