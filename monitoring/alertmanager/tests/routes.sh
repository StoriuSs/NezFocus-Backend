#!/bin/sh
# Which receiver alertmanager.yml picks for an alert. Run inside the
# Alertmanager image by `pnpm alerts:test`.
set -u
config=/etc/alertmanager/alertmanager.yml
failures=0

expect() { # receiver label=value...
	receiver=$1
	shift
	if amtool config routes test --config.file="$config" --verify.receivers="$receiver" "$@" >/dev/null 2>&1; then
		echo "  ok    $* -> $receiver"
	else
		echo "  FAIL  $* -> expected $receiver, got $(amtool config routes test --config.file="$config" "$@" 2>&1)"
		failures=$((failures + 1))
	fi
}

echo "Routes in $config"
expect notify alertname=AppDown severity=critical project=shop-prod environment=production
expect notify alertname=AppRestarting severity=warning environment=production
# Loki's alerts have no environment label.
expect notify alertname=AppErrorLogs severity=warning project=shop-prod
expect heartbeat alertname=Watchdog severity=none environment=production
# A development stack posting to a test channel.
expect notify alertname=PostgresDown severity=critical environment=development
expect none alertname=Watchdog severity=none environment=development
expect none alertname=AppRestarting severity=warning environment=development
expect none alertname=BackupNeverRan severity=warning environment=development

[ "$failures" -eq 0 ] || { echo "$failures routing test(s) failed"; exit 1; }
echo "  SUCCESS"
