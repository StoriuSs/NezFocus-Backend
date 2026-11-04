#!/usr/bin/env bash
# Shared by backup.sh, restore.sh and entrypoint.sh. Sourced, not run.
#
# The database connection comes from the standard libpq variables (PGHOST,
# PGPORT, PGUSER, PGPASSWORD, PGSSLMODE), which compose sets from the BACKUP_DB_*
# settings.
#
# shellcheck disable=SC2034 # the settings below are used by the scripts that source this

BACKUP_DIR=${BACKUP_DIR:-/backups}
METRICS_DIR=${BACKUP_METRICS_DIR:-/metrics}
UPLOADS_DIR=${BACKUP_UPLOADS_DIR:-/uploads}
STATE_DIR="$BACKUP_DIR/.state"
DOWNLOAD_DIR="$BACKUP_DIR/.download"
MAINTENANCE_DB=${BACKUP_MAINTENANCE_DB:-postgres}

KEEP_DAILY=${BACKUP_KEEP_DAILY:-7}
KEEP_WEEKLY=${BACKUP_KEEP_WEEKLY:-4}
KEEP_LABELLED=${BACKUP_KEEP_LABELLED:-5}
S3_KEEP_DAYS=${BACKUP_S3_KEEP_DAYS:-30}

# A dump is <database>/<UTC time>.dump, or <UTC time>-<label>.dump when taken
# with a label (deploy.sh takes pre-deploy-<release> ones).
SCHEDULED_DUMP='^[0-9]{8}T[0-9]{6}Z\.dump$'
LABELLED_DUMP='^[0-9]{8}T[0-9]{6}Z-[A-Za-z0-9._-]+\.dump$'

# Postgres names are at most 63 bytes, and a restore adds up to
# "_before_restore_20260101T000000Z" (32).
MAX_DATABASE_NAME=31

log()  { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
warn() { log "WARNING: $*" >&2; }
die()  { log "ERROR: $*" >&2; exit 1; }

is_count() { [[ "$1" =~ ^[0-9]+$ ]]; }

# Names of the dumps in a directory matching a pattern, newest first.
list_dumps() { # directory pattern
	local path name
	for path in "$1"/*.dump; do
		name=${path##*/}
		if [[ -f "$path" && "$name" =~ $2 ]]; then printf '%s\n' "$name"; fi
	done | sort -r
}

# A database these scripts back up or restore: short enough for a restore's
# temporary names. (--into and temporary names only need to fit Postgres' 63.)
valid_database_name() { # name [max-length]
	local max="${2:-$MAX_DATABASE_NAME}"
	[[ "$1" =~ ^[A-Za-z_][A-Za-z0-9_-]*$ ]] || die "Not a database name these scripts handle: '$1'"
	if (( ${#1} > max )); then
		(( max == MAX_DATABASE_NAME )) \
			&& die "Database name '$1' is longer than $max characters; a restore couldn't name its temporary databases"
		die "Database name '$1' is longer than Postgres allows ($max)"
	fi
}

is_backed_up() { # database
	[[ " $BACKUP_DATABASES " == *" $1 "* ]]
}

# Stops with a clear message on settings that would fail later, at 3 a.m.
validate_settings() {
	[[ -n "${BACKUP_DATABASES// /}" ]] || die "BACKUP_DATABASES is empty"
	local db
	for db in $BACKUP_DATABASES; do valid_database_name "$db"; done
	if ! is_count "$KEEP_DAILY" || (( KEEP_DAILY < 1 )); then
		die "BACKUP_KEEP_DAILY must be 1 or more"
	fi
	if ! is_count "$KEEP_LABELLED" || (( KEEP_LABELLED < 1 )); then
		die "BACKUP_KEEP_LABELLED must be 1 or more (0 would delete the pre-deploy dump right after taking it)"
	fi
	is_count "$KEEP_WEEKLY"  || die "BACKUP_KEEP_WEEKLY must be a number"
	is_count "$S3_KEEP_DAYS" || die "BACKUP_S3_KEEP_DAYS must be a number of days (0 keeps everything)"
	if [[ -n "${BACKUP_S3_BUCKET:-}" ]]; then
		[[ -n "${BACKUP_S3_ACCESS_KEY_ID:-}" && -n "${BACKUP_S3_SECRET_ACCESS_KEY:-}" ]] \
			|| die "BACKUP_S3_BUCKET is set, so BACKUP_S3_ACCESS_KEY_ID and BACKUP_S3_SECRET_ACCESS_KEY are needed too"
	fi
}

s3_enabled() { [[ -n "${BACKUP_S3_BUCKET:-}" ]]; }

# rclone reads a remote named "offsite" from these variables; no config file.
s3_configure() {
	export RCLONE_CONFIG_OFFSITE_TYPE=s3
	export RCLONE_CONFIG_OFFSITE_ACCESS_KEY_ID="$BACKUP_S3_ACCESS_KEY_ID"
	export RCLONE_CONFIG_OFFSITE_SECRET_ACCESS_KEY="$BACKUP_S3_SECRET_ACCESS_KEY"
	if [[ -n "${BACKUP_S3_ENDPOINT:-}" ]]; then
		export RCLONE_CONFIG_OFFSITE_PROVIDER=Other
		export RCLONE_CONFIG_OFFSITE_ENDPOINT="$BACKUP_S3_ENDPOINT"
	else
		export RCLONE_CONFIG_OFFSITE_PROVIDER=AWS
	fi
	[[ -z "${BACKUP_S3_REGION:-}" ]] || export RCLONE_CONFIG_OFFSITE_REGION="$BACKUP_S3_REGION"
	# A key that may only write can't check that the bucket exists.
	export RCLONE_S3_NO_CHECK_BUCKET=true
	# rclone looks for a config file it doesn't need and says so on every call.
	export RCLONE_CONFIG=/dev/null
}

# offsite:<bucket>/<prefix><path>
s3_path() {
	local prefix=${BACKUP_S3_PREFIX:-}
	[[ -z "$prefix" || "$prefix" == */ ]] || prefix="$prefix/"
	printf 'offsite:%s/%s%s' "$BACKUP_S3_BUCKET" "$prefix" "$1"
}

# Identifies where uploads go, so a change of bucket starts a full copy.
s3_destination() { printf '%s %s' "${BACKUP_S3_ENDPOINT:-aws}" "$(s3_path '')"; }

# ─── State and metrics ──────────────────────────────────────────────────────
# One small key=value file per database, rendered as a Prometheus textfile
# that node-exporter serves.

state_get() { # database key
	[[ -f "$STATE_DIR/$1" ]] || return 0
	sed -n "s/^$2=//p" "$STATE_DIR/$1" | tail -n 1
}

state_set() { # database key=value...
	local db="$1" pair key file="$STATE_DIR/$1"
	shift
	mkdir -p "$STATE_DIR"
	touch "$file"
	for pair in "$@"; do
		key=${pair%%=*}
		grep -v "^$key=" "$file" > "$file.tmp" || true
		printf '%s\n' "$pair" >> "$file.tmp"
		mv "$file.tmp" "$file"
	done
	write_metrics "$db"
}

state_unset() { # database key...
	local db="$1" key file="$STATE_DIR/$1"
	shift
	[[ -f "$file" ]] || return 0
	for key in "$@"; do
		grep -v "^$key=" "$file" > "$file.tmp" || true
		mv "$file.tmp" "$file"
	done
	write_metrics "$db"
}

metrics_file() { printf '%s/backup_%s.prom' "$METRICS_DIR" "${1//[^A-Za-z0-9_]/_}"; }

write_metrics() { # database
	local db="$1" tmp out key value metric help
	[[ -d "$METRICS_DIR" && -w "$METRICS_DIR" ]] || return 0
	# Only what this service backs up: a verify of some other database would
	# otherwise leave a series nothing ever updates.
	if [[ "$db" == uploads ]]; then s3_enabled || return 0; else is_backed_up "$db" || return 0; fi
	out=$(metrics_file "$db")
	tmp="$out.tmp.$$"
	{
		for metric in \
			"last_success_timestamp_seconds|last_success|Time of the last backup that was dumped and verified." \
			"last_attempt_timestamp_seconds|last_attempt|Time of the last backup attempt." \
			"last_attempt_failed|last_failed|1 if the last backup attempt failed." \
			"last_size_bytes|last_size|Size of the last successful dump." \
			"last_duration_seconds|last_duration|Duration of the last successful dump." \
			"last_upload_success_timestamp_seconds|last_upload_success|Time of the last successful upload to the bucket." \
			"last_upload_failed|last_upload_failed|1 if the last upload to the bucket failed." \
			"last_verify_success_timestamp_seconds|last_verify_success|Time of the last successful test restore."
		do
			IFS='|' read -r metric key help <<< "$metric"
			value=$(state_get "$db" "$key")
			[[ -n "$value" ]] || continue
			printf '# HELP backup_%s %s\n# TYPE backup_%s gauge\nbackup_%s{database="%s"} %s\n' \
				"$metric" "$help" "$metric" "$metric" "$db" "$value"
		done
	} > "$tmp"
	mv "$tmp" "$out"
}

# On start: metrics match the current settings. A database no longer backed
# up, or a bucket no longer set, must not leave series behind that look stale
# or failed forever.
reconcile_metrics() {
	local file db
	[[ -d "$METRICS_DIR" && -w "$METRICS_DIR" ]] || return 0
	for file in "$METRICS_DIR"/backup_*.prom; do
		[[ -f "$file" ]] || continue
		rm -f "$file"
	done
	if [[ -d "$STATE_DIR" ]] && ! s3_enabled; then
		for file in "$STATE_DIR"/*; do
			[[ -f "$file" ]] || continue
			state_unset "${file##*/}" last_upload_success last_upload_failed last_upload_destination
		done
	fi
	for db in $BACKUP_DATABASES uploads; do write_metrics "$db"; done
}

# ─── Postgres ────────────────────────────────────────────────────────────────
psql_admin() { psql -X -q -v ON_ERROR_STOP=1 --dbname "$MAINTENANCE_DB" "$@"; }

# True or false; stops when the server can't be asked at all, instead of
# reporting a missing database.
database_exists() {
	local found
	found=$(psql_admin -tA -v name="$1" <<< "SELECT 1 FROM pg_database WHERE datname = :'name'" 2>&1) \
		|| die "Could not connect to ${PGHOST:-localhost}:${PGPORT:-5432} ($MAINTENANCE_DB): $found"
	[[ "$found" == 1 ]]
}
