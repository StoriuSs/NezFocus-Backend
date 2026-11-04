#!/usr/bin/env bash
# ============================================================================
# Nest Starter — One-time Nginx Bootstrap
# ============================================================================
# Runs on a fresh VPS (Ubuntu/Debian assumed). Installs Nginx + Certbot,
# renders the site config from the template, validates, reloads.
#
# Run ONCE per VPS, not on every deploy.
#
# Usage:
#   sudo ./bootstrap-nginx.sh \
#       --api-domain      api.example.com \
#       --api-port        3000 \
#       --email           admin@example.com    # the Let's Encrypt account's contact (it no longer sends expiry warnings: renewal is automatic)
#       --site-name       my-app               # filename under sites-available
#
# After it succeeds:
#   - Nginx is serving HTTP on the domain
#   - Certbot has obtained certs and switched everything to HTTPS
#   - Auto-renewal is configured via systemd timer
# ============================================================================

set -euo pipefail

# ─── Defaults ────────────────────────────────────────────────────────────────
API_PORT="3000"
API_DOMAIN=""
EMAIL=""
# Distinct per starter. Both the backend and the frontend ship this script,
# and a shared default of "app" means installing the second one silently
# overwrites the first one's vhost in /etc/nginx/sites-available. Override with
# --site-name when running more than one project on a host.
SITE_NAME="nest-api"
SKIP_CERTBOT=false
TEMPLATE="$(dirname "$0")/app.conf.template"

# ─── Parse args ──────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
	case "$1" in
		--api-domain)      API_DOMAIN="$2";      shift 2 ;;
		--api-port)        API_PORT="$2";        shift 2 ;;
		--email)           EMAIL="$2";           shift 2 ;;
		--site-name)       SITE_NAME="$2";       shift 2 ;;
		--skip-certbot)    SKIP_CERTBOT=true;    shift ;;
		-h|--help)
			grep -E '^# ' "$0" | sed -E 's/^# ?//'
			exit 0
			;;
		*)
			echo "Unknown flag: $1" >&2
			echo "Run with --help for usage." >&2
			exit 2
			;;
	esac
done

# ─── Logging helpers ─────────────────────────────────────────────────────────
log()  { printf '\033[36m▶\033[0m %s\n' "$*"; }
ok()   { printf '\033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '\033[33m⚠\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[31m✗\033[0m %s\n' "$*" >&2; exit 1; }

# ─── Preflight ───────────────────────────────────────────────────────────────
[[ $EUID -eq 0 ]] || die "Must run as root (use sudo)"

[[ -n "$API_DOMAIN" ]]      || die "--api-domain is required"
if [[ "$SKIP_CERTBOT" == "false" ]]; then
	[[ -n "$EMAIL" ]] || die "--email is required (or pass --skip-certbot to defer)"
fi
[[ -f "$TEMPLATE" ]] || die "Template not found: $TEMPLATE"

# ─── Install Nginx + Certbot ─────────────────────────────────────────────────
log "Installing Nginx and Certbot…"
apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nginx certbot python3-certbot-nginx
ok "Nginx + Certbot installed"

# ─── UFW (if enabled, open HTTP/HTTPS) ───────────────────────────────────────
if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
	log "Configuring UFW to allow HTTP/HTTPS…"
	ufw allow "Nginx Full" >/dev/null
	ok "UFW updated"
fi

# ─── Render template ─────────────────────────────────────────────────────────
log "Rendering Nginx config for ${API_DOMAIN}…"

TARGET="/etc/nginx/sites-available/${SITE_NAME}"
sed \
	-e "s|API_DOMAIN|${API_DOMAIN}|g" \
	-e "s|API_PORT|${API_PORT}|g" \
	"$TEMPLATE" > "$TARGET"

ln -sf "$TARGET" "/etc/nginx/sites-enabled/${SITE_NAME}"

# Remove default site to avoid name collisions on bare server_name "_"
[[ -L /etc/nginx/sites-enabled/default ]] && rm /etc/nginx/sites-enabled/default

ok "Config written to $TARGET"

# ─── Validate + reload ───────────────────────────────────────────────────────
log "Validating Nginx config…"
nginx -t || die "nginx -t failed — fix $TARGET"
ok "Config valid"

log "Reloading Nginx…"
systemctl reload nginx
systemctl enable --now nginx >/dev/null
ok "Nginx reloaded and enabled at boot"

# ─── Certbot (HTTPS) ─────────────────────────────────────────────────────────
# Three possible paths:
#   1. --skip-certbot     → skip entirely, warn user to run later
#   2. Certs already exist → reinstall (no new cert issuance, just rewires
#                            Nginx config — needed because re-running this
#                            script rewrites Nginx from the template and
#                            loses certbot's previously-injected 443 blocks)
#   3. Fresh deploy       → certonly + install, full first-time setup
CERT_DIR="/etc/letsencrypt/live/${API_DOMAIN}"

if [[ "$SKIP_CERTBOT" == "true" ]]; then
	warn "Skipping certbot (--skip-certbot)"
	warn "Run manually when DNS resolves:"
	warn "  sudo certbot --nginx -d ${API_DOMAIN} --email ${EMAIL:-YOUR_EMAIL} --agree-tos --redirect --non-interactive"
elif [[ -d "$CERT_DIR" ]]; then
	log "Certificates already exist at ${CERT_DIR} — reinstalling (no new cert issuance)…"
	# certbot install rewires the Nginx config to use the existing certs.
	# --cert-name targets the existing certificate lineage by name (the
	# first domain it was issued for). --non-interactive skips prompts that
	# newer certbot versions show.
	certbot install --nginx \
		--cert-name "$API_DOMAIN" \
		--redirect \
		--non-interactive \
		|| die "Certbot install failed — try 'sudo certbot --nginx -d ${API_DOMAIN} --redirect' manually"
	ok "Certificates rewired; HTTP→HTTPS redirect re-applied"
else
	log "Obtaining Let's Encrypt certificates (certbot)…"
	certbot --nginx \
		-d "$API_DOMAIN" \
		--email "$EMAIL" \
		--agree-tos \
		--redirect \
		--non-interactive \
		|| die "Certbot failed — check that the DNS A-record for the domain points to this VPS"
	ok "Certificates installed; HTTP→HTTPS redirect configured"
fi

# Confirm renewal timer is active (regardless of which path above ran)
if [[ "$SKIP_CERTBOT" != "true" ]]; then
	if systemctl is-active --quiet certbot.timer; then
		ok "certbot.timer is active (auto-renewal enabled)"
	else
		warn "certbot.timer is not active — enabling it"
		systemctl enable --now certbot.timer
	fi
fi

# ─── Summary ─────────────────────────────────────────────────────────────────
printf '\n'
ok "Nginx bootstrap complete"
printf '   API:       https://%s  →  127.0.0.1:%s\n' "$API_DOMAIN"  "$API_PORT"
printf '\n'
printf '   Validate: curl -I https://%s/api/v1/health/live\n' "$API_DOMAIN"
printf '   Renew:    sudo certbot renew --dry-run\n'
printf '   Reload:   sudo systemctl reload nginx\n'
