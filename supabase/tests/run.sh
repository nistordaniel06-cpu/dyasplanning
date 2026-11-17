#!/usr/bin/env bash
# Rulează testele bazei de date pe un PostgreSQL local (port 5433, socket /tmp).
set -euo pipefail
cd "$(dirname "$0")/../.."
P="psql -h ${PGHOST:-/tmp} -p ${PGPORT:-5433} -U postgres -v ON_ERROR_STOP=1 -q -t"
$P -c "drop database if exists dyas_test" -c "create database dyas_test" >/dev/null
$P -d dyas_test -f supabase/tests/supabase_stub.sql >/dev/null 2>&1
$P -d dyas_test -f supabase/schema.sql >/dev/null 2>&1
$P -d dyas_test -f supabase/tests/flow_test.sql 2>&1 | grep -E "NOTICE|ERROR|TOATE" | sed 's/^.*NOTICE:  //'
