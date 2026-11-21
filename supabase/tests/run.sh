#!/usr/bin/env bash
# Rulează testele bazei de date pe un PostgreSQL local (port 5433, socket /tmp).
set -euo pipefail
cd "$(dirname "$0")/../.."
P="psql -h ${PGHOST:-/tmp} -p ${PGPORT:-5433} -U postgres -v ON_ERROR_STOP=1 -q -t"
$P -c "drop database if exists dyas_test" -c "create database dyas_test" >/dev/null
$P -d dyas_test -f supabase/tests/supabase_stub.sql >/dev/null 2>&1
$P -d dyas_test -f supabase/schema.sql >/dev/null 2>&1
for m in supabase/migrations/*.sql; do $P -d dyas_test -f "$m" >/dev/null 2>&1; done
( cat supabase/tests/flow_test.sql; echo; cat supabase/tests/km_test.sql; echo; cat supabase/tests/v3_test.sql; echo; cat supabase/tests/owner_test.sql; echo; cat supabase/tests/alerts_test.sql; echo; cat supabase/tests/activity_test.sql; echo; cat supabase/tests/details_test.sql; echo; cat supabase/tests/jurnal_test.sql; echo; cat supabase/tests/usage_test.sql; echo; cat supabase/tests/remove_test.sql; echo; cat supabase/tests/schedule_test.sql; echo; cat supabase/tests/teren_test.sql; echo; cat supabase/tests/firmanoua_test.sql; echo; cat supabase/tests/kmzi_test.sql; echo; cat supabase/tests/backup_test.sql; echo; cat supabase/tests/comunicare_test.sql; echo; cat supabase/tests/kmextra_test.sql; echo; cat supabase/tests/curse_test.sql; echo; cat supabase/tests/validare_test.sql; echo; cat supabase/tests/absente_combustibil_test.sql; echo; cat supabase/tests/delete_test.sql ) | $P -d dyas_test 2>&1 | grep -E "NOTICE|ERROR|TOATE|KM_|V3_|OWNER_|ALERTE_|ACTIVITATE_|DETALII_|UTILIZARE_|ELIMINARE_|PROGRAM_|TEREN_|FIRMANOUA_|KMZI_|BACKUP_|COMUNICARE_|STERGERE_|KMEXTRA_|CURSE_|VALIDARE_|COMBUSTIBIL_|JURNAL028_" | sed 's/^.*NOTICE:  //'
