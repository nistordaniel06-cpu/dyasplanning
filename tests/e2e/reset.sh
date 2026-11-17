#!/usr/bin/env bash
set -e
P="psql -h /tmp -p 5433 -U postgres -q"
$P -d dyas_e2e -c "truncate companies, auth.users, memberships, time_entry_history, push_subscriptions, notifications, login_events, platform_owners, owner_activity, announcements cascade" >/dev/null
