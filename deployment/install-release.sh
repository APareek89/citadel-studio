#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID} -ne 0 || $# -ne 1 ]]; then
  echo "Usage: sudo deployment/install-release.sh /absolute/path/agent-workbench-release.tar.gz" >&2
  exit 1
fi
release_archive=$(realpath "$1")
test -f "$release_archive"
for command in node npm caddy tar systemctl; do command -v "$command" >/dev/null; done
test -x /usr/bin/node
node -e 'if(Number(process.versions.node.split(".")[0])<22) process.exit(1)'
test -s /etc/agent-workbench/app.env
test -s /etc/agent-workbench/caddy.env
chmod 600 /etc/agent-workbench/app.env /etc/agent-workbench/caddy.env
if ! id workbench >/dev/null 2>&1; then
  useradd --system --home-dir /var/lib/agent-workbench --shell /usr/sbin/nologin workbench
fi
install -d -m 0755 /opt/agent-workbench/releases
install -d -m 0700 -o workbench -g workbench /var/lib/agent-workbench
release_dir=$(mktemp -d /opt/agent-workbench/releases/release-XXXXXXXX)
tar --no-same-owner -xzf "$release_archive" -C "$release_dir"
test -f "$release_dir/release.json"
test -f "$release_dir/build-server/index.mjs"
node "$release_dir/deployment/validate-environment.mjs"
(cd "$release_dir" && npm ci --omit=dev --no-audit --no-fund)
chown -R root:root "$release_dir"
chmod -R go-w "$release_dir"
# mktemp creates mode700; the unprivileged service needs read/search access.
chmod 0755 "$release_dir"
# Validate prospective proxy configuration before changing the active release.
systemd-run --quiet --wait --pipe --property=EnvironmentFile=/etc/agent-workbench/caddy.env \
  caddy validate --config "$release_dir/deployment/Caddyfile" --adapter caddyfile
previous_release=$(readlink -f /opt/agent-workbench/current 2>/dev/null || true)
ln -s "$release_dir" /opt/agent-workbench/current.next
mv -Tf /opt/agent-workbench/current.next /opt/agent-workbench/current
install -m 0644 "$release_dir/deployment/agent-workbench.service" /etc/systemd/system/agent-workbench.service
install -d -m 0755 /etc/systemd/system/caddy.service.d
install -m 0644 "$release_dir/deployment/caddy-environment.conf" /etc/systemd/system/caddy.service.d/agent-workbench.conf
install -m 0644 "$release_dir/deployment/Caddyfile" /etc/caddy/Caddyfile
systemctl daemon-reload
systemctl enable agent-workbench caddy >/dev/null
systemctl restart agent-workbench
# Caddy reads its environment through systemd; no secret values are CLI args.
systemctl restart caddy
if ! systemctl is-active --quiet agent-workbench || ! systemctl is-active --quiet caddy; then
  echo "A service failed to start. Previous release: ${previous_release:-none}. Inspect systemctl status; no secrets are printed by this installer." >&2
  exit 1
fi
echo "Release installed at $release_dir"
echo "Previous release: ${previous_release:-none}"
echo "Verify authenticated HTTPS and rejection of unauthenticated requests before handoff. Port3001 must remain closed in the security group."
