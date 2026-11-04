#!/usr/bin/env bash
# Lists, tests and restores backups. See docs/backups.md.
#
#   restore.sh list [database] [--remote]
#       dumps on this server, or in the bucket
#   restore.sh verify <database> [dump] [--remote]
#       restores into a scratch database, checks it, drops it again
#   restore.sh restore <database> [dump] [--remote] [--role <role>] --yes
#       replaces the database with the dump; the current one is kept as
#       <database>_before_restore_<time>
#   restore.sh restore <database> [dump] [--remote] [--role <role>] --into <new database>
#       restores into a new database and leaves the current one alone
#   restore.sh uploads --yes
#       copies the uploaded files in the bucket back to the uploads volume
#   restore.sh drop <database>
#       drops a database left by a restore (*_before_restore_*, *_restore_*,
#       *_verify_*); nothing else
#
# [dump] is "latest" (the default), a file name from `list`, or a path.
# --role makes the restored objects belong to that role (the app's database
# user) instead of the user running the restore; see docs/backups.md.
set -euo pipefail
# shellcheck source=backup-common.sh
source "$(dirname "$0")/backup-common.sh"

usage() { sed -n '2,23p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }

COMMAND="${1:-}"
[[ -n "$COMMAND" ]] || usage 1
shift
POSITIONAL=()
REMOTE=false
YES=false
INTO=""
ROLE=""
while (( $# > 0 )); do
	case "$1" in
		--remote) REMOTE=true ;;
		--yes)    YES=true ;;
		--into)   INTO="${2:-}"; [[ -n "$INTO" ]] || die "--into needs a database name"; shift ;;
		--role)   ROLE="${2:-}"; [[ -n "$ROLE" ]] || die "--role needs a role name"; shift ;;
		-h|--help) usage ;;
		-*)       die "Unknown option: $1" ;;
		*)        POSITIONAL+=("$1") ;;
	esac
	shift
done

if [[ "$REMOTE" == true ]]; then
	s3_enabled || die "--remote needs BACKUP_S3_BUCKET and its credentials"
	s3_configure
fi

# Whatever a command leaves half done is undone on exit, success or not.
CLEANUP_DATABASE=""      # a scratch or staged database to drop
CLEANUP_DOWNLOAD=""      # a downloaded dump to delete
REOPEN_DATABASE=""       # a database whose connections were closed for the swap
on_exit() {
	local status=$?
	if [[ -n "$REOPEN_DATABASE" ]]; then
		allow_connections "$REOPEN_DATABASE" true 2>/dev/null \
			|| warn "could not let connections into $REOPEN_DATABASE again: ALTER DATABASE \"$REOPEN_DATABASE\" WITH ALLOW_CONNECTIONS true"
	fi
	if [[ -n "$CLEANUP_DATABASE" ]]; then
		if drop_database "$CLEANUP_DATABASE" 2>/dev/null; then
			log "Dropped $CLEANUP_DATABASE"
		else
			warn "could not drop $CLEANUP_DATABASE; remove it with: restore.sh drop $CLEANUP_DATABASE"
		fi
	fi
	[[ -z "$CLEANUP_DOWNLOAD" ]] || rm -f "$CLEANUP_DOWNLOAD"
	exit "$status"
}
trap on_exit EXIT

stamp() { date -u +%Y%m%dT%H%M%SZ; }

# Dump file names for a database, newest first.
dump_names() { # database
	local listing
	if [[ "$REMOTE" == true ]]; then
		# Not silenced: a key that may only write can't list, and "no dumps"
		# would be the wrong thing to tell someone in the middle of an outage.
		listing=$(rclone lsf "$(s3_path "$1/")" --files-only 2>&1) \
			|| die "Could not list $(s3_path "$1/"). Restoring from the bucket needs a key that may list and read (see docs/backups.md): $listing"
		grep -E "$SCHEDULED_DUMP|$LABELLED_DUMP" <<< "$listing" | sort -r || true
	else
		list_dumps "$BACKUP_DIR/$1" "$SCHEDULED_DUMP|$LABELLED_DUMP"
	fi
}

# Sets DUMP to a local path of the requested dump, downloading it with --remote.
DUMP=""
resolve_dump() { # database dump
	local db="$1" wanted="${2:-latest}" name names
	if [[ "$REMOTE" == false && "$wanted" == */* ]]; then
		[[ -f "$wanted" ]] || die "No such file: $wanted"
		DUMP="$wanted"
		return
	fi
	# Read into a variable first: a failure inside a pipeline or $(…) only ends
	# that subshell.
	names=$(dump_names "$db") || exit 1
	if [[ "$wanted" == latest ]]; then
		name=$(awk 'NR == 1' <<< "$names")
		[[ -n "$name" ]] || die "No dumps of $db$([[ "$REMOTE" == true ]] && echo " in the bucket")"
	else
		name="$wanted"
		grep -qxF "$name" <<< "$names" \
			|| die "No dump $name of $db (see: restore.sh list $db$([[ "$REMOTE" == true ]] && echo " --remote"))"
	fi
	if [[ "$REMOTE" == true ]]; then
		mkdir -p "$DOWNLOAD_DIR"
		DUMP="$DOWNLOAD_DIR/$name"
		CLEANUP_DOWNLOAD="$DUMP"
		log "Downloading $name from $(s3_path "$db/")"
		rclone copyto "$(s3_path "$db/$name")" "$DUMP" --stats 0 || die "Could not download $name"
	else
		DUMP="$BACKUP_DIR/$db/$name"
	fi
}

create_database() {
	psql_admin -v name="$1" <<< "SELECT format('CREATE DATABASE %I TEMPLATE template0', :'name') \gexec"
}

drop_database() {
	psql_admin -v name="$1" <<< "SELECT format('DROP DATABASE IF EXISTS %I WITH (FORCE)', :'name') \gexec"
}

allow_connections() { # database true|false
	psql_admin -v name="$1" -v allow="$2" <<< "SELECT format('ALTER DATABASE %I WITH ALLOW_CONNECTIONS %s', :'name', :'allow') \gexec"
}

# Restores a dump into a new, empty database, which is dropped again if the
# restore fails or is interrupted (until the caller claims it). Owners and
# grants in the dump are not restored: objects belong to --role, or else to
# the connecting user, so a dump restores on a server with different roles.
restore_into() { # dump database
	local dump="$1" target="$2" role_args=()
	valid_database_name "$target" 63
	if database_exists "$target"; then die "Database $target already exists"; fi
	log "Restoring $(basename "$dump") into $target…"
	if [[ -n "$ROLE" ]]; then
		# Owned by the role: since Postgres 15 only the database's owner may
		# create tables in its public schema.
		role_args=(--role "$ROLE")
		psql_admin -v name="$target" -v role="$ROLE" <<< "SELECT format('CREATE DATABASE %I TEMPLATE template0 OWNER %I', :'name', :'role') \gexec"
	else
		create_database "$target"
	fi
	CLEANUP_DATABASE="$target"
	pg_restore --no-owner --no-acl --exit-on-error "${role_args[@]}" --dbname "$target" "$dump" \
		|| die "Restore of $(basename "$dump") failed"
	# Without --role, the connecting user owns the tables it restored. If that
	# is not the user the app connects as, the app gets "permission denied".
}

# What a restored database contains, for a person to sanity-check. Row counts
# are Postgres' estimates after ANALYZE: exact counts would read every table.
describe() { # database
	local summary
	summary=$(psql -X -q -tA -v ON_ERROR_STOP=1 --dbname "$1" <<-'SQL'
		ANALYZE;
		SELECT format('%s tables, about %s rows', count(*), coalesce(sum(greatest(c.reltuples, 0)), 0)::bigint)
		  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
		 WHERE c.relkind IN ('r', 'p') AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast');
	SQL
	) || die "Could not read the restored database $1"
	log "  $summary"
	if [[ "$(psql -X -tA --dbname "$1" <<< "SELECT to_regclass('public._prisma_migrations') IS NOT NULL")" == t ]]; then
		log "  $(psql -X -tA --dbname "$1" <<< "SELECT format('%s migrations applied, the latest %s', count(*), max(migration_name)) FROM _prisma_migrations WHERE finished_at IS NOT NULL")"
	fi
}

cmd_list() {
	local db dbs=("${POSITIONAL[@]}") name names
	(( ${#dbs[@]} > 0 )) || read -r -a dbs <<< "$BACKUP_DATABASES"
	for db in "${dbs[@]}"; do
		names=$(dump_names "$db") || exit 1
		printf '%s (%s):\n' "$db" "$([[ "$REMOTE" == true ]] && s3_path "$db/" || echo "$BACKUP_DIR/$db")"
		while read -r name; do
			[[ -n "$name" ]] || continue
			if [[ "$REMOTE" == true ]]; then
				printf '  %s\n' "$name"
			else
				printf '  %-48s %8s KiB\n' "$name" "$(( ($(stat -c %s "$BACKUP_DIR/$db/$name") + 1023) / 1024 ))"
			fi
		done <<< "$names"
	done
}

cmd_verify() {
	local db="${POSITIONAL[0]:-}" scratch
	[[ -n "$db" ]] || die "Usage: restore.sh verify <database> [dump] [--remote]"
	valid_database_name "$db"
	resolve_dump "$db" "${POSITIONAL[1]:-latest}"
	scratch="${db}_verify_$(stamp)"
	restore_into "$DUMP" "$scratch"
	describe "$scratch"
	state_set "$db" last_verify_success="$(date +%s)"
	log "$(basename "$DUMP") restores cleanly; dropping the scratch database"
}

cmd_restore() {
	local db="${POSITIONAL[0]:-}" staged old active=""
	[[ -n "$db" ]] || die "Usage: restore.sh restore <database> [dump] [--remote] (--yes | --into <new database>)"
	valid_database_name "$db"

	if [[ -z "$INTO" ]]; then
		[[ "$db" != "$MAINTENANCE_DB" ]] \
			|| die "$db is BACKUP_MAINTENANCE_DB, the database this script connects through; it can't be swapped out. Restore it with --into <new name>, or set BACKUP_MAINTENANCE_DB to another database that always exists."
		if [[ "$YES" != true ]]; then
			[[ -t 0 ]] || die "Replacing $db needs --yes (or --into <new database> to restore next to it)"
			read -r -p "Replace database $db with the dump? Type the database name to confirm: " answer
			[[ "$answer" == "$db" ]] || die "Aborted"
		fi
		database_exists "$db" || die "Database $db does not exist; restore it with --into $db"
	fi

	resolve_dump "$db" "${POSITIONAL[1]:-latest}"

	if [[ -n "$INTO" ]]; then
		restore_into "$DUMP" "$INTO"
		describe "$INTO"
		CLEANUP_DATABASE=""
		log "Restored into $INTO; $db was not touched"
		return
	fi

	# Restore next to the live database first: while that runs, which can take
	# a while, the app keeps working. Then swap the two in a moment.
	staged="${db}_restore_$(stamp)"
	old="${db}_before_restore_$(stamp)"
	restore_into "$DUMP" "$staged"
	describe "$staged"

	log "Swapping $staged in for $db…"
	allow_connections "$db" false
	REOPEN_DATABASE="$db"
	for _ in $(seq 1 20); do
		active=$(psql_admin -tA -v name="$db" <<-'SQL'
			SELECT count(pg_terminate_backend(pid)) FROM pg_stat_activity
			 WHERE datname = :'name' AND pid <> pg_backend_pid();
		SQL
		)
		[[ "$active" == 0 ]] && break
		sleep 0.5
	done
	# One transaction: both renames or neither. psql documents -1 for -c and
	# -f; a script on stdin behaves the same today, -f - makes it promised.
	psql_admin -1 -f - -v live="$db" -v old="$old" -v staged="$staged" <<-'SQL' \
		|| die "Could not swap the databases: sessions on $db did not close (a superuser's or another tool's?). Nothing was changed; the staged copy is dropped."
		SELECT format('ALTER DATABASE %I RENAME TO %I', :'live', :'old') \gexec
		SELECT format('ALTER DATABASE %I RENAME TO %I', :'staged', :'live') \gexec
	SQL
	# Swapped: the restored database is live, the replaced one is kept.
	CLEANUP_DATABASE=""
	REOPEN_DATABASE="$old"

	log "Restored $db from $(basename "$DUMP"). The previous database is kept as $old."
	log "Next:"
	log "  - Restart what uses it, so no cache holds the old data: docker compose ... restart app"
	log "  - If the dump is older than the running release's migrations, apply them: docker compose ... run --rm app ./node_modules/.bin/prisma migrate deploy"
	log "  - Once everything looks right: restore.sh drop $old"
}

cmd_uploads() {
	s3_enabled || die "Restoring uploads needs BACKUP_S3_BUCKET and its credentials"
	s3_configure
	[[ "$YES" == true ]] || die "Copies the bucket's uploaded files into $UPLOADS_DIR, overwriting files with the same name. Pass --yes."
	[[ -w "$UPLOADS_DIR" ]] || die "$UPLOADS_DIR is not writable by uid $(id -u); run as the app's user: docker compose ... run --rm --user 1001:1001 backup restore.sh uploads --yes"
	log "Copying $(s3_path uploads/) to $UPLOADS_DIR…"
	rclone copy "$(s3_path uploads/)" "$UPLOADS_DIR" --stats 0 \
		|| die "Copy failed (restoring needs a key that may list and read the bucket)"
	log "Uploaded files restored"
}

cmd_drop() {
	local name="${POSITIONAL[0]:-}"
	[[ "$name" =~ _(before_restore|restore|verify)_[0-9]{8}T[0-9]{6}Z$ ]] \
		|| die "drop only removes databases a restore left behind (*_before_restore_*, *_restore_*, *_verify_*)"
	database_exists "$name" || die "No database $name"
	drop_database "$name"
	log "Dropped $name"
}

case "$COMMAND" in
	list)    cmd_list ;;
	verify)  cmd_verify ;;
	restore) cmd_restore ;;
	uploads) cmd_uploads ;;
	drop)    cmd_drop ;;
	-h|--help|help) usage ;;
	*) die "Unknown command: $COMMAND (see --help)" ;;
esac
