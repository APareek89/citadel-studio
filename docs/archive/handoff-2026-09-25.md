# Handoff

## Current state — 25 September 2026
User resumed the authorized GitHub push/AWS deployment with “go”. Private repo: https://github.com/APareek89/citadel-studio, master. Private preview: https://65.2.235.5.sslip.io. Installed runtime source is `6e7c8b53d81f26d1ba3f6033884fcf3836aec83f`; the later documentation checkpoint records acceptance. Both services are active, and release metadata/checksum match.

Dedicated t3.micro in ap-south-1, standard CPU credits, encrypted 8 GB root plus retained 8 GB workspace volume, stable Elastic IP and public ports 80/443 only. SSM administration; existing Demo Studio untouched. Caddy HTTPS/owner Basic Auth fronts loopback Node with exact Host/Origin/proxy-token checks. Native trace POST uses project Bearer auth. State mounts by UUID and the service requires that mount. Stack: `agent-workbench-preview`; profile: `citadel-workbench`; CLI: `~/.local/share/citadel-tools/bin/aws`.

Owner login: ignored mode-600 `.local/deployment/AWS-ACCESS.txt`. Never print or commit its contents. No laptop keys or workspace were deployed. Temporary auth bootstrap object was deleted after delivery. Hosted model cap: US$2.80; prior conservative local QA usage: US$0.1715557 within US$3 total. Deployment made no new inference calls. AWS baseline is about US$13.3/month before credits/variable usage; no paid plan upgrade.

## Evidence and limits
189/189 free tests, production build, production-only package smoke and 13/13 diagrams pass. Independent review covered all 12 failure categories. Cloud: 26 endpoint checks, 17 post-restart checks and authenticated live SSE with synthetic spans pass. Fixed npm dependency permissions under restrictive umask and required authenticated health before installer success. Details: docs/QA-REPORT.md, docs/DEPLOYMENT.md and docs/AWS-READINESS.md.

Codex browser blocked the cloud URL (`ERR_BLOCKED_BY_CLIENT`): cloud UI acceptance is incomplete. No outside Chrome or warning bypass. Earlier complete local UI/live Gemini evidence remains separate. Old macOS system Python/LibreSSL failed TLS; Node HTTPS/curl passed. Remote Python helper is unverified. The local port-3001 process remains the earlier backend.

Single-owner preview, no multi-tenant isolation or off-volume backup. Linux cannot run the pinned macOS Learning Studio adapter or Docker custom code. Demo Studio behavioral execution remains unsupported; mapping/source review does not prove execution. Model keys and receiver tokens expire on restart. Clearly named synthetic AWS checks remain in the hosted workspace.

## Standing rules / next work
Automatic local checkpoints; push/deploy only on request (authorized for this deployment). Free journey loop on; standalone diagrams; Codex browser only. New model QA requires a hypothesis within the remaining budget. User adds hosted session keys through Credentials. Investigate cloud browser login compatibility if requested; do not weaken auth or bypass browser protections. Preserve hidden supporting nodes and source/observed/executable distinctions.

Effort: approximately 60% hosting, 25% verification, 15% corrections. Takeaway: actual service identity and public transport tests caught failures a package smoke could not.
