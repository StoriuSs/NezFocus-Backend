#!/bin/sh
# Start command of the dev container (docker-compose.dev.yaml).
#
#   sh scripts/dev-start.sh           install if needed, migrate, start with hot reload
#   sh scripts/dev-start.sh --record  note that node_modules matches the current files (Dockerfile)
#
# node_modules is a volume, filled from the image when it is created and kept
# across restarts. `pnpm install` runs only when package.json, the lockfile or
# pnpm's settings changed since the last install. Running it on every start was
# never a no-op: pnpm fetched a few packages each time, and on a slow network
# that took a minute.
set -e

STAMP=node_modules/.install-inputs

inputs() {
	cat package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc | md5sum
}

if [ "${1:-}" = "--record" ]; then
	inputs > "$STAMP"
	exit 0
fi

if [ "$(inputs)" != "$(cat "$STAMP" 2>/dev/null)" ]; then
	echo "Dependencies changed since the last install: pnpm install"
	pnpm install --prefer-offline
	inputs > "$STAMP"
fi

pnpm exec prisma generate
# Pending migrations, as the production image applies them at start. Without
# this a fresh database had no tables. Creating a migration is still
# `pnpm prisma:migrate` on the host.
pnpm exec prisma migrate deploy
exec pnpm run dev
