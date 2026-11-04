#!/usr/bin/env bash
# Without arguments: checks the settings and runs backup.sh on BACKUP_SCHEDULE.
# With arguments: runs them instead (docker compose run --rm backup restore.sh list).
set -euo pipefail
# shellcheck source=backup-common.sh
source "$(dirname "$0")/backup-common.sh"

validate_settings

if (( $# > 0 )); then
	exec "$@"
fi

SCHEDULE="${BACKUP_SCHEDULE:-0 3 * * *}"
printf '%s backup.sh\n' "$SCHEDULE" > /tmp/crontab
supercronic -test /tmp/crontab > /dev/null 2>&1 \
	|| die "BACKUP_SCHEDULE is not a valid cron schedule: '$SCHEDULE'"

# Metrics for what was backed up before this start, so a restarted container
# doesn't make the last backup look missing; and none for what no longer is.
reconcile_metrics

log "Backing up ${BACKUP_DATABASES} from ${PGHOST:-localhost}:${PGPORT:-5432} on '$SCHEDULE' (UTC)$(s3_enabled && echo ", copying to $(s3_path '')")"
exec supercronic -quiet /tmp/crontab
