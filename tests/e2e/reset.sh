#!/usr/bin/env bash
set -e
P="psql -h /tmp -p 5433 -U postgres -q"
$P -d dyas_e2e -c "truncate companies, auth.users, auth.passwords, memberships, time_entry_history cascade" >/dev/null
