#!/usr/bin/env bash
# End-to-end smoke test against a RUNNING stack (docker compose or dev-lite). Exits non-zero on the first failure.
#
#   ./infra/smoke.sh                       # API :4000, web :3000
#   API=http://localhost:4000 WEB=http://localhost:3100 ./infra/smoke.sh
#
# What it proves: the API is up and seeded (Postgres + Redis for the e-mail queue), the AI service answers (risk score on seeded
# applications), documents round-trip through storage (MinIO in compose), PDFs generate, regions and EVC data exist, and the web app serves.
set -euo pipefail
API="${API:-http://localhost:4000}"
WEB="${WEB:-http://localhost:3000}"
PASS=demo1234

say() { printf '  \033[32m✓\033[0m %s\n' "$1"; }
fail() { printf '  \033[31m✕ %s\033[0m\n' "$1" >&2; exit 1; }
json() { python3 -c "import sys,json; d=json.load(sys.stdin); print($1)"; }
login() { curl -fsS -X POST "$API/auth/login" -H 'content-type: application/json' -d "{\"email\":\"$1@trackwise.demo\",\"password\":\"$PASS\"}" | json "d['token']"; }
get() { curl -fsS "$API$2" -H "authorization: Bearer $1"; }

echo "Smoke test: API=$API WEB=$WEB"
for i in $(seq 1 90); do curl -fsS "$API/health" >/dev/null 2>&1 && break; [ "$i" = 90 ] && fail "API did not become healthy"; sleep 2; done
n=$(curl -fsS "$API/health" | json "d['applications']"); [ "$n" -ge 15 ] || fail "expected a seeded database, found $n applications"
say "API healthy and seeded ($n applications)"

ADMIN=$(login admin); OFFICER=$(login officer1); INST=$(login inst01); REGIONAL=$(login regional4)
say "sign-in works for admin, officer, institution and regional officer"

scored=$(get "$ADMIN" "/applications?scope=all" | json "sum(1 for a in d if a['risk_score'] is not None)")
[ "$scored" -ge 10 ] || fail "AI risk scores missing ($scored scored): is the AI service reachable?"
say "AI service reachable ($scored applications risk-scored)"

regions=$(get "$ADMIN" "/analytics/summary" | json "len(d['byRegion'])")
[ "$regions" = 5 ] || fail "expected 5 regions, got $regions"
evc=$(get "$REGIONAL" "/evc/visits" | json "len(d)"); [ "$evc" -ge 1 ] || fail "regional officer sees no EVC visits"
say "regions and expert visits present ($evc visit(s) in the Western region)"

docs=$(get "$ADMIN" "/validity" | json "len(set(x['status'] for x in d))"); [ "$docs" -ge 3 ] || fail "document validity register looks empty"
say "document validity register populated"

app=$(curl -fsS -X POST "$API/applications" -H "authorization: Bearer $INST" -H 'content-type: application/json' \
  -d '{"type":"new_course","title":"Smoke test course","details":{"courseName":"Smoke","level":"UG","intake":30}}' | json "d['id']")
tmp=$(mktemp); printf 'smoke-%s' "$RANDOM" > "$tmp"
curl -fsS -X POST "$API/applications/$app/documents" -H "authorization: Bearer $INST" -F docType=curriculum -F "file=@$tmp;type=application/pdf;filename=smoke.pdf" >/dev/null
doc=$(get "$INST" "/applications/$app" | json "d['documents'][0]['id']")
back=$(curl -fsS "$API/applications/$app/documents/$doc/file" -H "authorization: Bearer $INST")
[ "$back" = "$(cat "$tmp")" ] || fail "document did not round-trip through storage"
say "document upload and download round-trip through storage"

curl -fsS "$API/applications/$app/case-summary.pdf" -H "authorization: Bearer $OFFICER" | head -c 5 | grep -q '%PDF-' || fail "case summary PDF not generated"
say "case summary PDF generated"

code=$(curl -s -o /dev/null -w '%{http_code}' "$WEB/login"); [ "$code" = 200 ] || fail "web returned $code for /login"
say "web app serving /login"
echo "SMOKE OK"
