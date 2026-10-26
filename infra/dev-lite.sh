#!/usr/bin/env bash
# Run TrackWise WITHOUT Docker, using in-memory stand-ins for MinIO and Redis/BullMQ.
# You still need a Postgres database and Python 3 / Node 20+.
#
#   DATABASE_URL=postgres://user@127.0.0.1:5432/trackwise ./infra/dev-lite.sh
#
# Documents are kept in memory (lost on restart) and alert scans are manual ("Run alert scan now" as admin).
set -euo pipefail
cd "$(dirname "$0")/.."
: "${DATABASE_URL:?set DATABASE_URL to an empty Postgres database}"

[ -d ai/.venv ] || { python3 -m venv ai/.venv && ai/.venv/bin/pip install -q -r ai/requirements.txt; }
[ -d api/node_modules ] || (cd api && npm ci)
[ -d web/node_modules ] || (cd web && npm ci)

trap 'kill $(jobs -p) 2>/dev/null' EXIT
(cd ai && .venv/bin/uvicorn app.main:app --port 8000) &
(cd api && AI_URL=http://localhost:8000 npm run dev:lite) &
(cd web && NEXT_PUBLIC_API_URL=http://localhost:4000 npm run dev) &
wait
