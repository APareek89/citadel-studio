# AWS deployment

Updated 25 September 2026. The owner requested a GitHub push and AWS deployment, paused after infrastructure creation started, then explicitly resumed. This supersedes the earlier local-only readiness snapshot. Remote acceptance is recorded separately in QA-REPORT.md.

## Provisioned preview

- Dedicated CloudFormation stack `agent-workbench-preview` in `ap-south-1`, using the explicit CLI profile `citadel-workbench`. The existing Demo Studio instance and other workloads are unchanged.
- One `t3.micro` with standard CPU credits, IMDSv2, an 8 GB encrypted root disk and a separate 8 GB encrypted retained workspace volume. The workspace mounts by UUID at `/var/lib/agent-workbench`; the service requires that mount.
- Stable public IP through an Elastic IP. The security group permits 80/443 only. Administration uses Systems Manager; ports 22 and 3001 have no public ingress.
- Caddy 2.11.4 verified against the official SHA512 manifest. HTTPS and owner Basic Auth protect the workspace; Node binds `127.0.0.1:3001`. Exact public Host/Origin and a proxy secret guard the backend. The sole browser-auth exception is native trace POST, which requires a project-specific Bearer token.
- Private encrypted S3 release bucket with public access blocked, TLS-only access and 14-day package expiration. The EC2 role can read only its release prefix, plus standard SSM management permissions. No IAM user keys live on the server. Temporary auth bootstrap objects are deleted after verified delivery.
- The owner login password is in a mode-600 ignored local access file. Server environment files contain a bcrypt login hash and proxy secret, owned by root with mode 600. Deployment copies no laptop model keys, workspace, checkouts or traces.

## Cost and limits

Before provisioning, the account reported FREE/ACTIVE with positive credits and a finite expiry; no paid upgrade was made. Mumbai pricing API quotes were US$0.0112/hour for t3.micro and US$0.0912/GB-month for gp3. Public IPv4 is US$0.005/hour. At 730 hours and 16 GB, the baseline is about US$13.3/month before credits, data transfer and small S3 usage. Credits are shared with other workloads; this is not a permanently free deployment. [EC2 pricing](https://aws.amazon.com/ec2/pricing/on-demand/), [EBS pricing](https://aws.amazon.com/ebs/pricing/), [VPC public IPv4 pricing](https://aws.amazon.com/vpc/pricing/).

The hosted model ledger cap is US$2.80, leaving room for the prior US$0.1715557 conservative local QA usage within the owner's US$3 build-wide authorization. No model calls are needed to verify this deployment. Model keys and native ingestion tokens remain session-only and need re-entry or regeneration after restart. AWS credits do not pay model providers.

## Scope

This is a private single-owner preview with encrypted filesystem persistence, not a multi-tenant authentication/database launch. Source connection, mapping, built graphs, source review and incoming traces follow their capability gates. The pinned Learning Studio runtime requires macOS sandboxing and is unavailable on this Linux host. Docker is not installed; arbitrary code execution remains gated. An uploaded source map does not enable behavioral execution.

The earlier S3/CloudFront/Lambda/DynamoDB/Cognito option was a Phase 3 candidate. The current deployment uses a small EC2 host because existing long-running jobs, event streaming and filesystem storage can run intact. Serverless migration and per-user authorization remain future work. Operational installation and recovery: DEPLOYMENT.md. Implementation: `infra/ec2.yaml` and `deployment/`.
