# Single-user AWS deployment

Use one Linux EC2 instance with encrypted EBS and Caddy as the TLS/authentication proxy. The Node service binds only `127.0.0.1:3001`; the security group exposes HTTPS 443 and HTTP 80 for certificate issuance. Use Systems Manager for administration; the provisioned security group has no SSH ingress. Do not expose port 3001. AWS account credits/free-tier eligibility, public IPv4, disk and data-transfer charges must be checked before provisioning; these assets do not claim deployment is free.

This is a private, single-user preview. It shares one local workspace; it is not hosted multi-tenant authentication or an authorization model for several users. Linux source mapping, built graphs, source review and remote trace ingestion work within their existing capability gates. The pinned Learning Studio executor requires macOS and remains unavailable on this host. No Docker daemon is installed; custom-code nodes remain unavailable. Local-machine paths and automatic secrets-file import are disabled in hosted mode. Add model keys through the authenticated app; they remain in memory and must be re-added after restart. Deployment does not copy laptop keys, local projects or traces.

## Build a release

From the repository on a development machine with Node 22+:

```sh
npm ci
npm run release
npm run test:release
```

The release is `output/agent-workbench-release.tar.gz`. It contains the hashed frontend, compiled Node ESM server, SDK clients, lockfile, deployment templates and the five source files needed by code export. `node_modules`, `.git`, `.local`, user checkouts, secrets and QA artifacts are excluded by an explicit allowlist. The build needs development dependencies; the instance installs `npm ci --omit=dev`. TypeScript is a production dependency because source mapping uses its parser. Esbuild is a production dependency because the imported adapter module imports it, even where execution is unavailable.

`npm start` remains the local TypeScript entry. The deployed unit uses `node build-server/index.mjs` without `tsx`, Vite or TypeScript transpilation. The build directory must stay directly below the release root because the imported adapter resolves files relative to its module location.

## Prepare the instance

Install Node 22+ at `/usr/bin/node`, npm, Git, and Caddy 2.8+. Use an official distribution package or verify the downloaded release checksum. Install the reviewed systemd service in `infra/caddy.service`. Do not install model keys or AWS IAM user keys on the instance. An AWS instance role, if used, should have only the permissions actually needed for management; the app itself requires no AWS SDK or cloud API permissions.

Point a DNS hostname at the instance. A temporary IP-based hostname may be used for a preview, but it changes if the public IP changes. Configure an exact `https://hostname` origin; do not use a wildcard or untrusted forwarded-host value.

Create `/etc/agent-workbench` with mode 700, and create `app.env` and `caddy.env` from the templates with root ownership and mode 600. Set the same public origin and a newly generated random proxy token of at least 32 characters in both. Generate the browser password hash with `caddy hash-password` using stdin; keep the plaintext password outside the repo and shell history. Set the username and hash in `caddy.env`. Never source untrusted environment files as shell scripts. Keep the finite model spend cap unless the owner explicitly chooses another budget.

Caddy preserves the public Host and original Origin, overwrites `X-Workbench-Proxy-Token` with its private token, and strips Basic Authorization before ordinary requests reach Node. All browser/API routes require Basic Auth over TLS. Only `POST /api/telemetry/<project-id>/spans` bypasses browser Basic Auth; the app still requires that project's scoped Bearer token. GET and other telemetry routes remain protected. This permits the SDK to send traces without sharing the browser password.

Upload the release and execute the installer as root:

```sh
sudo deployment/install-release.sh /absolute/path/agent-workbench-release.tar.gz
```

The installer writes a versioned release below `/opt/agent-workbench/releases`, installs only production dependencies, atomically moves the `current` symlink, and restarts the two services. It normalizes root-owned release files for the unprivileged user and requires authenticated backend health before reporting success. Persistent state is `/var/lib/agent-workbench` and is not part of a release. The app runs as unprivileged `workbench`, with a private temp directory and a read-only system/home view. The service has a 768 MiB memory limit and 512 MiB V8 heap; a small instance may still need lower input/concurrency limits if load grows. No load balancer, managed database, NAT gateway or extra AWS service is needed for this preview.

## Verify and recover

Before handing out the URL, verify a valid HTTPS certificate, 401 without browser credentials, successful authenticated UI/health, rejection of forged Host/Origin/proxy tokens, and rejection of native ingestion without its scoped token. Ensure raw port 3001 is unreachable publicly. Inspect `systemctl status agent-workbench caddy` and bounded `journalctl -u agent-workbench` output; never print environment files. Public basic-auth passwords and trace tokens serve different purposes.

The unit restart reopens saved work but clears in-memory credentials. Interrupted runs retain partial evidence and are not replayed. Snapshot or copy the state directory before destructive maintenance. For rollback, stop `agent-workbench`, repoint `/opt/agent-workbench/current` to the previous release printed by the installer, and start the service. Retain the same state directory and environment files. Rollback does not reverse state migrations; this release has no new state migration.

The local packaged-server smoke test proves production dependency loading, health/bootstrap, source-map import and code export without provider calls. Actual instance networking, TLS, authentication and service startup must be verified after deployment; a local test does not establish those properties.

References: [Caddy Basic Authentication](https://caddyserver.com/docs/caddyfile/directives/basic_auth), [Caddy reverse proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy), [Caddy systemd operation](https://caddyserver.com/docs/running#linux-service).
