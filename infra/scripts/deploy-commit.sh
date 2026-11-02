#!/usr/bin/env bash
set -euo pipefail

REVISION="${1:-}"
APP_ROOT="/opt/karas-telegram-bot"
BARE_REPO="$APP_ROOT/repo.git"

if [[ ! "$REVISION" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Expected a full 40-character commit SHA." >&2
  exit 2
fi

git --git-dir="$BARE_REPO" fetch --quiet origin +refs/heads/main:refs/remotes/origin/main
if ! git --git-dir="$BARE_REPO" merge-base --is-ancestor "$REVISION" refs/remotes/origin/main; then
  echo "The requested commit is not on the main branch." >&2
  exit 2
fi

RELEASE_DIR="$APP_ROOT/releases/$REVISION"
if [[ ! -d "$RELEASE_DIR" ]]; then
  mkdir -p "$RELEASE_DIR"
  git --git-dir="$BARE_REPO" archive "$REVISION" | tar -x -C "$RELEASE_DIR"
fi

install -o root -g root -m 0755 "$RELEASE_DIR/infra/scripts/provision-secrets.sh" /usr/local/sbin/karas-telegram-bot-provision-secrets.new
mv -f /usr/local/sbin/karas-telegram-bot-provision-secrets.new /usr/local/sbin/karas-telegram-bot-provision-secrets
install -o root -g root -m 0755 "$RELEASE_DIR/infra/scripts/deploy-release.sh" /usr/local/sbin/karas-telegram-bot-deploy-release.new
mv -f /usr/local/sbin/karas-telegram-bot-deploy-release.new /usr/local/sbin/karas-telegram-bot-deploy-release
install -o root -g root -m 0755 "$RELEASE_DIR/infra/scripts/deploy-commit.sh" /usr/local/sbin/karas-telegram-bot-deploy.new
mv -f /usr/local/sbin/karas-telegram-bot-deploy.new /usr/local/sbin/karas-telegram-bot-deploy
install -o root -g root -m 0644 "$RELEASE_DIR/infra/systemd/karas-telegram-bot.service" /etc/systemd/system/karas-telegram-bot.service
systemctl daemon-reload

exec /usr/local/sbin/karas-telegram-bot-deploy-release "$REVISION"
