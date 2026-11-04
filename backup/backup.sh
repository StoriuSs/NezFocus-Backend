#!/usr/bin/env bash
# Backs up every database in BACKUP_DATABASES. See docs/backups.md.
#
#   backup.sh                       what the schedule runs
#   backup.sh --label <label>       a labelled dump, kept apart from the
#                                   scheduled ones (deploy.sh: pre-deploy-<release>)
#
# For each database: pg_dump to <database>/<UTC time>.dump in BACKUP_DIR, read
# the whole dump back to prove it is complete, remove old dumps, and upload it
# when BACKUP_S3_BUCKET is set. Then, when a bucket is set and uploads are
# stored locally, copy new uploaded files to the bucket.
#
# Exits 1 if a dump failed, or (for scheduled runs) an upload failed; the other
# databases are still backed up. A labelled run whose upload fails still exits 0:
# its purpose, a dump taken right before migrating, is on disk.
set -euo pipefail
# shellcheck source=backup-common.sh
source "$(dirname "$0")/backup-common.sh"

LABEL=""
while (( $# > 0 )); do
	case "$1" in
		--label)
			LABEL="${2:-}"
			[[ "$LABEL" =~ ^[A-Za-z0-9._-]+$ ]] || die "--label takes letters, digits, '.', '_' or '-'"
			shift ;;
		*) die "Unknown option: $1" ;;
	esac
	shift
done

validate_settings
mkdir -p "$BACKUP_DIR"

# One backup at a time: a pre-deploy backup waits for a scheduled one to end.
exec 9> "$BACKUP_DIR/.lock"
waited=0
until flock -n 9; do  # BusyBox flock has no wait timeout
	(( waited == 0 )) && log "Waiting for the backup that is already running…"
	(( waited < 1800 )) || die "Another backup has been running for 30 minutes"
	sleep 5
	waited=$((waited + 5))
done

s3_enabled && s3_configure

# Downloads left by a restore that was interrupted.
find "$DOWNLOAD_DIR" -type f -mtime +0 -exec rm -f {} + 2>/dev/null || true

# Keeps the newest dump of each of the last KEEP_DAILY days that have one, and
# of each of the last KEEP_WEEKLY weeks; and the newest KEEP_LABELLED labelled
# dumps. Counting days that have a dump, not calendar days, means a backup
# outage never deletes the last good dumps. The dump just taken is never
# removed, even if older files carry later timestamps (a clock that was wrong).
prune() { # directory just-taken
	local dir="$1" fresh="$2" name day week days=0 weeks=0
	local -A keep=() seen_day=() seen_week=()

	while read -r name; do
		[[ -n "$name" ]] || continue
		day=${name:0:8}
		week=$(date -u -d "${day:0:4}-${day:4:2}-${day:6:2}" +%G-%V)
		if [[ -z "${seen_day[$day]:-}" ]] && (( days < KEEP_DAILY )); then
			seen_day[$day]=1; days=$((days + 1)); keep[$name]=1
		fi
		if [[ -z "${seen_week[$week]:-}" ]] && (( weeks < KEEP_WEEKLY )); then
			seen_week[$week]=1; weeks=$((weeks + 1)); keep[$name]=1
		fi
		[[ -n "${keep[$name]:-}" || "$name" == "$fresh" ]] || { rm -f "$dir/$name"; log "  removed old dump $name"; }
	done < <(list_dumps "$dir" "$SCHEDULED_DUMP")

	while read -r name; do
		[[ -n "$name" && "$name" != "$fresh" ]] || continue
		rm -f "$dir/$name"
		log "  removed old dump $name"
	done < <(list_dumps "$dir" "$LABELLED_DUMP" | tail -n +$((KEEP_LABELLED + 1)))

	# Dumps interrupted more than a day ago (a restart mid-dump).
	find "$dir" -maxdepth 1 -name '.*.partial' -mtime +0 -exec rm -f {} + 2>/dev/null || true
}

upload() { # database file
	local db="$1" file="$2" remote
	remote=$(s3_path "$db/")
	log "  uploading to $remote"
	# A plain PUT: no check whether it's already there and no HEAD afterwards,
	# which a key that may only write can't do. The upload's checksum is still
	# verified.
	if ! rclone copyto "$file" "$remote$(basename "$file")" --no-check-dest --s3-no-head \
		--retries 3 --low-level-retries 10 --stats 0; then
		state_set "$db" last_upload_failed=1
		return 1
	fi
	state_set "$db" last_upload_success="$(date +%s)" last_upload_failed=0
	if (( S3_KEEP_DAYS > 0 )); then
		rclone delete --min-age "${S3_KEEP_DAYS}d" --include '*.dump' "$remote" --stats 0 --retries 1 2>/dev/null \
			|| warn "could not remove dumps older than ${S3_KEEP_DAYS} days from $remote (a key without delete permission?)"
	fi
}

backup_database() { # database
	local db="$1" dir="$BACKUP_DIR/$1" name partial started size
	name="$(date -u +%Y%m%dT%H%M%SZ)${LABEL:+-$LABEL}.dump"
	partial="$dir/.$name.partial"
	mkdir -p "$dir" || { warn "cannot create $dir"; return 1; }
	started=$(date +%s)
	state_set "$db" last_attempt="$started"
	log "Backing up $db${LABEL:+ ($LABEL)} from ${PGHOST:-localhost}:${PGPORT:-5432}"

	if ! pg_dump --format=custom --dbname "$db" --file "$partial"; then
		rm -f "$partial"
		state_set "$db" last_failed=1
		warn "pg_dump of $db failed"
		return 1
	fi
	# Reading every table's data back catches a truncated or corrupt dump,
	# without needing a database to restore into.
	if ! pg_restore --list "$partial" > /dev/null || ! pg_restore --file /dev/null "$partial"; then
		rm -f "$partial"
		state_set "$db" last_failed=1
		warn "the dump of $db could not be read back"
		return 1
	fi
	mv "$partial" "$dir/$name"
	size=$(stat -c %s "$dir/$name")
	state_set "$db" last_success="$(date +%s)" last_failed=0 last_size="$size" \
		last_duration="$(( $(date +%s) - started ))"
	log "  $db/$name ($(( (size + 1023) / 1024 )) KiB, $(( $(date +%s) - started ))s)"

	prune "$dir" "$name"
	if s3_enabled && ! upload "$db" "$dir/$name"; then
		if [[ -n "$LABEL" ]]; then
			warn "upload of $db/$name failed; the dump is on this server, so this backup still counts"
		else
			warn "upload of $db/$name failed; it is kept on this server"
			return 1
		fi
	fi
}

# Uploaded files (avatars) when STORAGE_TYPE=local. Copied, never synced:
# a file deleted or overwritten on the server stays in the bucket.
#
# Only files changed since the last successful copy to this same bucket (plus
# an hour) are sent, without listing the bucket first: a key that may only
# write can't list. A new bucket or prefix gets everything.
backup_uploads() {
	local since destination window=()
	s3_enabled || return 0
	[[ -d "$UPLOADS_DIR" && -n "$(ls -A "$UPLOADS_DIR" 2>/dev/null)" ]] || return 0
	destination=$(s3_destination)
	since=$(state_get uploads last_upload_success)
	[[ "$(state_get uploads last_upload_destination)" == "$destination" ]] || since=""
	[[ -z "$since" ]] || window=(--max-age "$(( $(date +%s) - since + 3600 ))s")
	log "Copying $([[ -n "$since" ]] && echo "files changed since the last copy" || echo "all uploaded files") to $(s3_path uploads/)"
	if rclone copy "$UPLOADS_DIR" "$(s3_path uploads/)" "${window[@]}" --no-check-dest --s3-no-head --retries 3 --stats 0; then
		state_set uploads last_upload_success="$(date +%s)" last_upload_failed=0 last_upload_destination="$destination"
	else
		state_set uploads last_upload_failed=1
		warn "copying uploaded files failed"
		return 1
	fi
}

failed=0
for db in $BACKUP_DATABASES; do
	backup_database "$db" || failed=1
done
[[ -n "$LABEL" ]] || backup_uploads || failed=1

if (( failed )); then
	die "Backup finished with errors"
fi
log "Backup finished"
