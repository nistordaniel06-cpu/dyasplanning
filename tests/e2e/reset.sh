#!/usr/bin/env bash
set -e
P="psql -h /tmp -p 5433 -U postgres -q"
$P -d dyas_e2e -c "truncate companies, auth.users, memberships, time_entry_history, push_subscriptions, notifications, login_events, platform_owners, owner_activity, announcements, storage.objects, app_news, app_news_seen, support_requests, owner_messages cascade; delete from platform_settings where key = 'maintenance'" >/dev/null
