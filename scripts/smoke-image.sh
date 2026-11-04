#!/usr/bin/env bash
# Starts a production image the way a server does, against throwaway Postgres
# and Redis, and waits until it answers /health/ready: the migrations ran, and
# the app reached the database and Redis. CI runs it on every image before
# publishing it.
#
#   scripts/smoke-image.sh <image>
#
# The settings are .env.example's, in production mode, with only what
# production refuses replaced (template placeholders, weak passwords) and the
# hosts pointed at the throwaway services. A setting added to .env.example is
# therefore in the test without changes here.
set -euo pipefail

IMAGE=${1:?usage: scripts/smoke-image.sh <image>}
NAME=smoke-$$
NET=$NAME
TIMEOUT=${SMOKE_TIMEOUT:-120}
DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE=$(mktemp)

cleanup() {
	docker rm -f "$NAME-app" "$NAME-db" "$NAME-redis" >/dev/null 2>&1 || true
	docker network rm "$NET" >/dev/null 2>&1 || true
	rm -f "$ENV_FILE"
}
trap cleanup EXIT

# docker's --env-file takes lines literally: drop comments, blank lines and
# trailing "  # ..." comments (compose and dotenv drop those themselves).
tr -d '\r' < "$DIR/.env.example" | grep -vE '^[[:space:]]*(#|$)' | sed -E 's/[[:space:]]+#.*$//' > "$ENV_FILE"

docker network create "$NET" >/dev/null
docker run -d --name "$NAME-db" --network "$NET" --network-alias db \
	-e POSTGRES_USER=smoke -e POSTGRES_PASSWORD=smoke-db-password -e POSTGRES_DB=app \
	postgres:16.2-alpine >/dev/null
docker run -d --name "$NAME-redis" --network "$NET" --network-alias redis \
	redis:7.2.4-alpine redis-server --requirepass smoke-redis-password >/dev/null
# Over TCP: while Postgres initialises it listens on its socket only, and a
# socket check passed before the server the app connects to was up.
for ((waited = 0; ; waited++)); do
	docker exec "$NAME-db" pg_isready -h 127.0.0.1 -U smoke -d app -q 2>/dev/null && break
	if ((waited >= TIMEOUT)); then
		echo "✗ Postgres did not start within ${TIMEOUT}s:" >&2
		docker logs "$NAME-db" 2>&1 | tail -20 >&2
		exit 1
	fi
	sleep 1
done

docker run -d --name "$NAME-app" --network "$NET" --env-file "$ENV_FILE" \
	-e NODE_ENV=production \
	-e DATABASE_URL=postgresql://smoke:smoke-db-password@db:5432/app \
	-e DB_NAME=app -e DB_USERNAME=smoke -e DB_PASSWORD=smoke-db-password \
	-e REDIS_HOST=redis -e REDIS_PORT=6379 -e REDIS_PASSWORD=smoke-redis-password \
	-e BULL_BOARD_PASSWORD=smoke-bull-board-password \
	-e JWT_SECRET="$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')" \
	-e AUTH_ENCRYPTION_KEY="$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')" \
	-e ALERT_WEBHOOK_URL=https://discord.com/api/webhooks/0/smoke \
	"$IMAGE" >/dev/null

# Either may be missing from .env.example (the app has defaults); grep then
# fails, which must not end the script here.
port=$(grep -E '^PORT=' "$ENV_FILE" | cut -d= -f2 || true)
prefix=$(grep -E '^API_PREFIX=' "$ENV_FILE" | cut -d= -f2 || true)
api="http://127.0.0.1:${port:-3000}/${prefix:-api}/v1"
url="$api/health/ready"

# Signing in hashes the password with argon2, a native module built per
# platform: a sign-in for an unknown address must be refused (401), not fail
# (500) because the image has the wrong binary.
login_status() {
	docker exec "$NAME-app" sh -c "wget -S -qO- --header 'Content-Type: application/json' \
		--post-data '{\"email\":\"smoke@example.test\",\"password\":\"Smoke-Test-Password-1\"}' \
		$api/auth/login 2>&1 | awk '/^  HTTP\\//{print \$2}' | tail -1"
}

for ((waited = 0; waited < TIMEOUT; waited += 2)); do
	if [ "$(docker inspect -f '{{.State.Running}}' "$NAME-app")" != true ]; then
		echo "✗ The app exited:" >&2
		docker logs "$NAME-app" 2>&1 | tail -40 >&2
		exit 1
	fi
	if docker exec "$NAME-app" wget -qO- "$url" >/dev/null 2>&1; then
		echo "✓ $IMAGE is ready after ${waited}s ($url)"
		status=$(login_status)
		if [ "$status" != 401 ]; then
			echo "✗ A sign-in answered ${status:-nothing}, expected 401:" >&2
			docker logs "$NAME-app" 2>&1 | tail -40 >&2
			exit 1
		fi
		echo "✓ Signing in hashes passwords (argon2): an unknown address is refused with 401"
		exit 0
	fi
	sleep 2
done
echo "✗ $IMAGE did not answer $url within ${TIMEOUT}s:" >&2
docker logs "$NAME-app" 2>&1 | tail -40 >&2
exit 1
