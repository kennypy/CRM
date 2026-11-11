#!/bin/sh
# Render the Alertmanager config from env (busybox sed; no envsubst in the image).
set -eu
: "${ALERT_WEBHOOK_URL:=http://127.0.0.1:9/disabled}"
esc=$(printf '%s' "$ALERT_WEBHOOK_URL" | sed 's/[&|]/\\&/g')
sed "s|\${ALERT_WEBHOOK_URL}|${esc}|g" /etc/alertmanager/alertmanager.tmpl.yml > /tmp/alertmanager.yml
exec /bin/alertmanager --config.file=/tmp/alertmanager.yml --storage.path=/alertmanager
