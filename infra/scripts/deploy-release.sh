#!/usr/bin/env bash
set -euo pipefail

REVISION="$1"
APP_ROOT="/opt/karas-telegram-bot"
RELEASES="$APP_ROOT/releases"
RELEASE_DIR="$RELEASES/$REVISION"
CURRENT="$APP_ROOT/current"

if [[ ! "$REVISION" =~ ^[0-9a-f]{40}$ || ! -d "$RELEASE_DIR" ]]; then
  echo "Invalid or missing release directory." >&2
  exit 2
fi

cd "$RELEASE_DIR"
set -a
. /etc/karas-telegram-bot/environment
set +a

npm ci --include=dev --no-audit --no-fund
npm run build
npm run db:migrate
npm prune --omit=dev --no-audit --no-fund

if [[ ! -s /etc/karas-telegram-bot/secrets ]]; then
  /usr/local/sbin/karas-telegram-bot-provision-secrets
fi

chown -R root:karasbot "$RELEASE_DIR"
chmod -R g+rX,o-rwx "$RELEASE_DIR"

PREVIOUS_RELEASE=""
if [[ -L "$CURRENT" ]]; then
  PREVIOUS_RELEASE="$(readlink -f "$CURRENT" || true)"
fi
ln -s "$RELEASE_DIR" "$APP_ROOT/current.next"
mv -Tf "$APP_ROOT/current.next" "$CURRENT"

if ! systemctl restart karas-telegram-bot.service; then
  if [[ -n "$PREVIOUS_RELEASE" && -d "$PREVIOUS_RELEASE" ]]; then
    ln -s "$PREVIOUS_RELEASE" "$APP_ROOT/current.rollback"
    mv -Tf "$APP_ROOT/current.rollback" "$CURRENT"
    systemctl restart karas-telegram-bot.service || true
  fi
  echo "The bot service did not start for release $REVISION." >&2
  exit 1
fi

for attempt in {1..15}; do
  if systemctl is-active --quiet karas-telegram-bot.service; then
    break
  fi
  sleep 2
done
if ! systemctl is-active --quiet karas-telegram-bot.service; then
  echo "The bot service is not active after deployment." >&2
  exit 1
fi

mapfile -t OLD_RELEASES < <(find "$RELEASES" -mindepth 1 -maxdepth 1 -type d ! -path "$RELEASE_DIR" -printf '%T@ %p\n' | sort -rn | tail -n +2 | cut -d' ' -f2-)
if (( ${#OLD_RELEASES[@]} > 0 )); then
  rm -rf -- "${OLD_RELEASES[@]}"
fi

echo "Deployed commit $REVISION; service is active."
