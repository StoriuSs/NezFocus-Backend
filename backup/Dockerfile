# Backups of the app's databases (and uploads); see docs/backups.md.
#
# pg_dump must be at least the server's major version, so this builds on the
# same Postgres image as the db service. When the database runs elsewhere on a
# newer version, set BACKUP_POSTGRES_IMAGE (e.g. postgres:17-alpine).
ARG POSTGRES_IMAGE=postgres:16.2-alpine
FROM ${POSTGRES_IMAGE}

# rclone uploads to any S3-compatible bucket; supercronic is a cron made for
# containers: it runs as a normal user, passes the environment to jobs and
# logs to stdout.
#
# /uploads is owned by the app's user (1001), not this one: Docker gives an
# empty named volume the owner of the directory it is first mounted on, and
# the app must stay able to write its uploads even if this service mounts the
# volume first. This service only reads there.
RUN apk add --no-cache rclone supercronic \
	&& mkdir -p /backups /metrics /uploads \
	&& chown postgres:postgres /backups /metrics \
	&& chown 1001:1001 /uploads

COPY --chmod=755 backup-common.sh backup.sh restore.sh entrypoint.sh /usr/local/bin/

USER postgres
WORKDIR /backups
ENTRYPOINT ["entrypoint.sh"]
