# Backups

The `backup` service in `docker-compose.prod.yaml` dumps the application
database every night, checks each dump, removes old ones, and can copy them to
a bucket at another provider. `restore.sh` lists, tests and restores them.

It takes a list of databases, not one, so adding a second is a setting rather
than a change ([the settings](#settings)).

## What happens every night

At `BACKUP_SCHEDULE` (default `0 3 * * *`, 03:00 UTC), for each database in
`BACKUP_DATABASES` (default: `DB_NAME`):

1. **Dump** with `pg_dump --format=custom` to the `backups` volume, as
   `<database>/<UTC time>.dump`.
2. **Read it back** in full. A truncated or corrupt dump fails the backup
   instead of being kept.
3. **Remove old dumps**, keeping:
   - the newest dump of each of the last `BACKUP_KEEP_DAILY` (7) days that have one
   - the newest of each of the last `BACKUP_KEEP_WEEKLY` (4) weeks
   - the newest `BACKUP_KEEP_LABELLED` (5) labelled dumps, such as the pre-deploy ones below

   Days are counted by the dumps that exist, not the calendar: if backups stop
   working for two weeks, the last good dumps are not deleted.
4. **Upload** it, if `BACKUP_S3_BUCKET` is set.

When a bucket is set and the uploads volume holds files — which is the case
with `STORAGE_TYPE=local`; with S3 they are in a bucket already —
uploaded files changed since the last copy are copied to it too (all of them
the first time, and after the bucket or prefix changes). Copied, never
mirrored: a file deleted on the server stays in the bucket.

**Before migrations.** `./deploy.sh` also takes a backup, labelled
`pre-deploy-<release>`, right before applying migrations. It does this only when
the release adds migrations, or when it can't tell (first deploy). If the dump
fails, the deploy stops with nothing changed; `--skip-backup` deploys without
it. If only its upload to the bucket fails, the deploy goes on: the dump it
needs is on the server.

The service logs to its container output (`docker logs backup-hexagonal-auth-prod`,
and Loki). A failed backup exits with an error and leaves the previous dumps alone.

## Keep a copy somewhere else

Dumps on the server's own disk are lost with the server. Set a bucket at a
**different provider** from the one hosting the server:

```
BACKUP_S3_BUCKET=myapp-backups
BACKUP_S3_ENDPOINT=https://<account id>.r2.cloudflarestorage.com   # unset for AWS
BACKUP_S3_REGION=auto                                              # AWS: the bucket's region
BACKUP_S3_ACCESS_KEY_ID=...
BACKUP_S3_SECRET_ACCESS_KEY=...
BACKUP_S3_PREFIX=myapp/
```

Any S3-compatible storage works: AWS S3, Cloudflare R2, Backblaze B2, RustFS.
Dumps land at `<bucket>/<prefix><database>/`, uploaded files at `<bucket>/<prefix>uploads/`.

**Protect them from the server itself.** Anyone who takes over the server has its
bucket key. If that key can delete, the attacker can delete the backups too. The
safer setup:

1. Give the server a key that can only **write** objects (no delete, no overwrite
   if the provider supports it).
2. Set `BACKUP_S3_KEEP_DAYS=0`, so the script never tries to delete.
3. Expire old dumps with a **lifecycle rule** on the bucket (e.g. delete after 30 days).

With a key that may delete, `BACKUP_S3_KEEP_DAYS` (default 30) removes uploaded
dumps older than that. With a write-only key and the default, each backup just
logs a warning that pruning failed.

**Restoring from the bucket needs a different key**: one that may list and
read. A write-only key gets "Could not list … Restoring from the bucket needs a
key that may list and read". Keep a read key off the server (in a password
manager, with the other secrets you'd need after losing it), and pass it only
when restoring:

```
docker compose --env-file .env.production -f docker-compose.prod.yaml run --rm \
    -e BACKUP_S3_ACCESS_KEY_ID=<read key id> -e BACKUP_S3_SECRET_ACCESS_KEY=<read key secret> \
    backup restore.sh list --remote
```

Dumps are not encrypted by the script. Use a private bucket, and the provider's
encryption at rest.

## Monitoring

Each backup writes metrics that node-exporter serves (`backup_*`, one series per
database):

| Metric | |
|---|---|
| `backup_last_success_timestamp_seconds` | Last dump that was taken and read back |
| `backup_last_attempt_failed` | 1 if the last attempt failed |
| `backup_last_size_bytes`, `backup_last_duration_seconds` | Of the last successful dump |
| `backup_last_upload_success_timestamp_seconds`, `backup_last_upload_failed` | The bucket copy |
| `backup_last_verify_success_timestamp_seconds` | Last successful `restore.sh verify` |

Series exist only for what is backed up now: a database removed from
`BACKUP_DATABASES`, or a bucket no longer set, stops being reported when the
service restarts.

Alerts on these are already set up: `BackupFailed`, `BackupTooOld` (no good
backup for over 26 hours, which also catches backups that silently stop
running), `BackupNeverRan`, and two for the bucket copy. See
[alerts.md](./alerts.md#postgres-redis-backups); change the 26 hours there if
you change `BACKUP_SCHEDULE`.

## Restoring

Every command runs inside the backup container:

```
docker compose --env-file .env.production -f docker-compose.prod.yaml exec backup restore.sh <command>
```

(Shortened to `restore.sh` below.)

### See what there is

```
restore.sh list                     # dumps on this server, per database
restore.sh list myapp --remote      # dumps of one database in the bucket
```

### Test a dump (do this regularly)

```
restore.sh verify myapp             # the latest dump
restore.sh verify myapp 20260914T030000Z.dump --remote
```

This restores into a scratch database, prints its table count, an estimate of
its rows and its latest migration, then drops it. A backup you have never
restored is only a hope. Run it after setting up, then monthly.

Whatever a restore command started is cleaned up when it stops, successfully or
not: the scratch or staged database is dropped and a downloaded dump deleted.

### Replace a database

```
restore.sh restore myapp --yes                              # latest dump
restore.sh restore myapp 20260914T030000Z.dump --yes
restore.sh restore myapp 20260914T030000Z.dump --remote --yes
```

1. The dump is restored into a new database next to the live one. Meanwhile the
   app keeps working on the live one.
2. Connections to the live database are closed, and the two databases swap
   names in one transaction. If the swap can't happen (a session that won't
   close), nothing changes and the staged copy is dropped.
3. The replaced database is kept as `<database>_before_restore_<time>`.

`BACKUP_MAINTENANCE_DB` itself can't be replaced this way, since the script
works through it; restore it with `--into`. Database names can be at most 31
characters, leaving room for the temporary names.

Then:

- **Restart what uses it, and clear the session cache.** Restarting the app
  clears only its in-memory cache:
  `docker compose --env-file .env.production -f docker-compose.prod.yaml restart app`.
  The session check's copies in Redis (`auth:session:*`, `auth:user:*`) survive
  a restart and still describe the database you replaced, for up to five
  minutes. Wait that long, or delete them:
  `docker compose --env-file .env.production -f docker-compose.prod.yaml exec redis sh -c "redis-cli --scan --pattern 'auth:*' | xargs -r redis-cli del"`.
  That also drops Google sign-ins in progress; those people simply start
  again.
- **Decide about sessions.** See [What a restore brings back](#what-a-restore-brings-back).
- **If the dump is older than the running release's migrations**, apply them:
  `docker compose --env-file .env.production -f docker-compose.prod.yaml run --rm app ./node_modules/.bin/prisma migrate deploy`
- **When everything looks right**, drop the old database: `restore.sh drop <database>_before_restore_<time>`.
  `drop` refuses anything that isn't left over from a restore.

To undo a restore, drop the restored database with psql and rename the kept one back.

Everything written after the dump was taken is lost from the restored database.
It is still in the kept one, if something needs to be copied across.

### What a restore brings back

The database holds the sign-in state too, so restoring an older dump turns back
the clock on security changes as well as on data. Everything that happened
after the dump is undone:

- **Sessions and refresh tokens come back to life.** A session that was signed
  out, or ended by a password change, after the dump is live again, and its
  refresh cookie works.
- **Password changes and resets are undone**: the old password works again.
- **Deleted accounts are back**, and accounts created since are gone.

If any of that matters (a restore after a breach, or a dump more than a few
hours old), end every session once the restore is done, so everyone signs in
again with what the restored database says:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yaml exec db \
    psql -U <DB_USERNAME> -d <DB_NAME> -c \
    "UPDATE \"Session\" SET \"revokedAt\" = now(), \"revokedReason\" = 'logout-all' WHERE \"revokedAt\" IS NULL"
```

Then clear the session cache as above, so the change applies at once. People
whose password was changed after the dump should be told to change it again.

### Restore next to the live database

```
restore.sh restore myapp --into myapp_copy
```

Useful for fishing out a few deleted rows without replacing everything, or for
loading a backup into a new server.

### Uploaded files

```
docker compose --env-file .env.production -f docker-compose.prod.yaml run --rm --user 1001:1001 backup restore.sh uploads --yes
```

This copies every uploaded file in the bucket back to the `app-uploads` volume, as
the app's user. Files already there with the same name are overwritten.

### Moving to a new server, or after losing one

This brings existing data onto a server that has none. It is **not** part of a
first deployment: there, `./deploy.sh` starts with empty databases and the
migrations create the schema.

1. Set up the server and `.env.production` as usual, including the `BACKUP_S3_*` settings.
2. Start only the database, and wait for it: `docker compose ... up -d --wait db`.
   Its first start creates the application database, empty.
3. Replace it with the latest dump from the bucket, using a read key (see
   [Keep a copy somewhere else](#keep-a-copy-somewhere-else)):
   `docker compose ... run --rm -e BACKUP_S3_ACCESS_KEY_ID=… -e BACKUP_S3_SECRET_ACCESS_KEY=… backup restore.sh restore myapp --remote --yes`.
4. Drop the database the restore replaced. The restore ends by naming it:
   `restore.sh drop <name>`, run in the backup container as above
   (`docker compose ... run --rm backup restore.sh drop <name>`).
5. Restore uploaded files (above), then `./deploy.sh`.

## When the database is not on this server

When Postgres moves to a managed service, keep this backup pointed at it.
Provider backups disappear with the account, and only reach back as far as
their retention:

```
BACKUP_DB_HOST=db-postgresql-fra1-12345.db.ondigitalocean.com
BACKUP_DB_PORT=25060
BACKUP_DB_USER=doadmin
BACKUP_DB_PASSWORD=...
BACKUP_DB_SSLMODE=require
BACKUP_MAINTENANCE_DB=defaultdb      # a database that always exists there
BACKUP_POSTGRES_IMAGE=postgres:17-alpine   # at least the server's major version
```

`restore.sh` needs a user that may create, rename and drop databases, and close
the app's connections: on managed services, the admin user it was created with.

Restored tables belong to the user running the restore. When the app connects
as a different user, make them the app's with `--role`, or the app gets
"permission denied" after the swap (the restoring user must be a member of that
role):

```
restore.sh restore myapp --yes --role myapp_user
```

## What is not backed up

- **Redis**: queued jobs, locks, rate-limit counters and caches. It persists to
  its own volume (AOF), and the queues' jobs can be re-triggered. It is not
  worth a backup.
- **Uploads stored in S3** (`STORAGE_TYPE=s3`): the bucket is already off the
  server. Turn on versioning there if deleted files must be recoverable.
- **Monitoring data**: Prometheus and Loki keep 30 and 14 days of their own.
- **`.env.production`**: keep a copy in a password manager. A restore works
  with a new `JWT_SECRET`, at a small cost: every access token is refused
  until the web app refreshes it (sessions carry on), and codes already
  emailed stop working.

## Settings

All in `.env.production`, all optional; see `.env.example`.

| Setting | Default | |
|---|---|---|
| `BACKUP_SCHEDULE` | `0 3 * * *` | Cron schedule, UTC |
| `BACKUP_DATABASES` | `DB_NAME` | Space-separated; add more to back them up too |
| `BACKUP_KEEP_DAILY` | `7` | Days with a dump to keep, 1 or more |
| `BACKUP_KEEP_WEEKLY` | `4` | Weeks to keep one dump from |
| `BACKUP_KEEP_LABELLED` | `5` | Labelled (pre-deploy) dumps to keep, 1 or more |
| `BACKUP_DB_HOST`, `_PORT`, `_USER`, `_PASSWORD` | the db service, `DB_USERNAME`, `DB_PASSWORD` | The server to dump |
| `BACKUP_DB_SSLMODE` | `prefer` | `require` for most managed servers |
| `BACKUP_MAINTENANCE_DB` | `postgres` | A database that always exists, for creating and renaming others |
| `BACKUP_POSTGRES_IMAGE` | the `db` service's image (Postgres 16) | Tools version; at least the server's major version |
| `BACKUP_S3_BUCKET` | (none) | Enables the bucket copy |
| `BACKUP_S3_ENDPOINT`, `_REGION` | (AWS) | For S3-compatible providers |
| `BACKUP_S3_ACCESS_KEY_ID`, `_SECRET_ACCESS_KEY` | | Required with a bucket |
| `BACKUP_S3_PREFIX` | (none) | Folder in the bucket |
| `BACKUP_S3_KEEP_DAYS` | `30` | Delete uploaded dumps older than this; `0` never deletes |

Changes take effect when the service is recreated: at the next `./deploy.sh`, or
`docker compose ... up -d backup`.
