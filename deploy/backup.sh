#!/bin/sh
# Nightly backup. Add to the host's crontab:
#
#   30 1 * * *  cd /srv/jeeva/deploy && ./backup.sh >> backup.log 2>&1
#
# TWO PLACES, ALWAYS. A dump sitting on the same VPS as the database is not a
# backup - it is a second copy of a file that dies with the machine. The local
# copy is for a fast restore after a bad migration; the offsite copy is for the
# day the box is gone.
set -eu

STAMP=$(date +%Y-%m-%d-%H%M)
OUT="/backups/hms-${STAMP}.sql.gz"
KEEP_DAYS=14

# --clean --if-exists so the dump can be restored over an existing database
# without hand-editing it at the worst possible moment.
docker compose exec -T db pg_dump \
  --username "${POSTGRES_USER:-hms}" \
  --dbname "${POSTGRES_DB:-hms}" \
  --clean --if-exists --no-owner \
  | gzip -9 > "./backups/hms-${STAMP}.sql.gz"

echo "$(date -Iseconds) wrote ./backups/hms-${STAMP}.sql.gz ($(du -h "./backups/hms-${STAMP}.sql.gz" | cut -f1))"

# VERIFY IT IS READABLE. An unreadable backup discovered during a restore is
# the same as no backup, and gzip is the cheapest possible check.
gzip -t "./backups/hms-${STAMP}.sql.gz"

# Offsite. rclone to Cloudflare R2 or Backblaze B2 - configure once with
# `rclone config`, name the remote "offsite".
if command -v rclone >/dev/null 2>&1; then
  rclone copy "./backups/hms-${STAMP}.sql.gz" offsite:jeeva-backups/ --quiet
  echo "$(date -Iseconds) copied offsite"
else
  echo "$(date -Iseconds) WARNING: rclone not installed - this backup exists only on this machine"
fi

# Prune local copies only. The offsite bucket keeps its own lifecycle policy,
# because the whole point of offsite is that this script cannot reach it to
# delete things.
find ./backups -name 'hms-*.sql.gz' -mtime "+${KEEP_DAYS}" -delete
