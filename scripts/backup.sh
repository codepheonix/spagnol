#!/usr/bin/env bash
# Dumps the database to backups/<timestamp>.sql.gz using DATABASE_URL (or DIRECT_URL).
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] && set -a && . ./.env && set +a
URL="${DIRECT_URL:-${DATABASE_URL:?DATABASE_URL not set}}"
mkdir -p backups
OUT="backups/$(date -u +%Y%m%dT%H%M%SZ).sql.gz"
pg_dump --no-owner --no-privileges "$URL" | gzip > "$OUT"
echo "Backup written to $OUT ($(du -h "$OUT" | cut -f1))"
