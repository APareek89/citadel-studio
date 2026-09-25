# AWS readiness

Verified 25 September 2026. **Local setup is ready; nothing has been deployed or provisioned for this project.** Phase 1 uses the local project and event store and needs no AWS database. Account identifiers, principal names, credential values, resource names and credit balances are intentionally omitted from this document.

## Verified local setup

- AWS CLI **2.37.3** was installed for the current user through the official AWS installer. Its macOS package signature verified successfully. Binary: `~/.local/share/citadel-tools/bin/aws`. No sudo or shell-profile change was used. [AWS installation instructions](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html)
- The dedicated profile is **`citadel-workbench`**, defaulting to **`ap-south-1`** with JSON output. Existing profile values were preserved.
- `~/.aws/credentials` and `~/.aws/config` have mode **0600**. The supplied credential CSV was read programmatically and left byte-for-byte unchanged. Its values were never printed or passed as literal command arguments.
- STS `GetCallerIdentity` succeeded for an IAM user. This verifies authentication; it does not mean every deployment operation will succeed.

Use the explicit binary and profile so the user's existing default account configuration remains unchanged:

```bash
~/.local/share/citadel-tools/bin/aws freetier get-account-plan-state \
  --profile citadel-workbench --region us-east-1 \
  --query '{type:accountPlanType,status:accountPlanStatus}'
```

## Account and inventory checks

The Free Tier API returned **FREE / ACTIVE**, positive remaining credits, and a finite plan expiration date. This is an account-specific observation, not a permanent zero-cost guarantee. AWS's free account plan expires after six months or credit exhaustion, whichever comes first. Recheck plan state immediately before deployment; no paid-plan upgrade was performed. [Account-plan API](https://docs.aws.amazon.com/cli/latest/reference/freetier/get-account-plan-state.html), [AWS Free Tier program](https://aws.amazon.com/blogs/aws/aws-free-tier-update-new-customers-can-get-started-and-explore-aws-with-up-to-200-in-credits/)

Read-only inventory succeeded for DynamoDB, Lambda, S3, CloudFront, Cognito, API Gateway, CloudFormation and AWS Budgets. The selected region contains existing DynamoDB tables; the account also has existing S3 buckets and a cost budget. These resources were not changed. No Lambda functions, Cognito user pools, HTTP/WebSocket APIs or completed/rolled-back CloudFormation stacks were found in the queried region; no standard CloudFront distributions were found globally. This is a targeted inventory, not a whole-account audit across all regions or service variants.

DynamoDB currently reports six provisioned read units and six write units across the inspected tables, plus separate on-demand tables. Existing provisioned use is below the published provisioned allowance, but on-demand request charges are not made free by that allowance. Storage and capacity offers are shared with other workloads; do not treat them as a dedicated Citadel allocation. [DynamoDB pricing](https://aws.amazon.com/dynamodb/pricing/)

Free Tier usage was read successfully, and a cost budget exists. Notification delivery and budget actions were not tested. Cost Explorer was not called. No model inference, billable workload, infrastructure creation or deployment was used for this readiness check.

## Permissions: no observed blocker, deployment unproven

Read-only IAM principal-policy simulation returned `allowed` for representative actions covering CloudFormation stack creation, IAM role creation/pass-role, S3 bucket/object creation, CloudFront distribution creation, Lambda creation/function URLs/resource policies, DynamoDB table creation, Cognito user-pool creation and CloudWatch log-group creation.

This is indicative policy evaluation against wildcard resources, not a deployment test. A real stack also depends on exact resource policies, trust policies, service quotas, account-plan restrictions, region support and any missing deployment actions. No write permission was tested by creating a resource. Revalidate the final infrastructure change set before deployment and grant only the runtime permissions its components require.

## Recommended later hosting route

Keep phase 1 local. For phase 3, use **private S3 + ordinary CloudFront for the UI, Lambda for bounded API/orchestration work, provisioned DynamoDB for project/run metadata, and Cognito Lite or Essentials for user authentication**. Store large artifacts separately in S3. Use a CloudFront-provided hostname initially. Do not introduce a continuously running database, NAT gateway or server simply to host project metadata.

This is a candidate architecture, not created infrastructure. Free-eligible parts and limits must be evaluated together:

- Lambda publishes one million requests and 400,000 GB-seconds monthly; provisioned concurrency does not receive that free tier. Use on-demand functions with conservative concurrency and execution limits. [Lambda pricing](https://aws.amazon.com/lambda/pricing/)
- DynamoDB's Standard/provisioned free tier includes 25 read units, 25 write units and 25 GB, with account/payer and regional conditions. Start small after checking remaining capacity; do not assume on-demand writes consume the provisioned offer. [DynamoDB pricing](https://aws.amazon.com/dynamodb/pricing/)
- Cognito Lite/Essentials include an eligible direct/social sign-in allowance; its Plus tier and machine-to-machine token requests have different pricing. [Cognito pricing](https://aws.amazon.com/cognito/pricing/)
- **Do not select CloudFront's $0 flat-rate plan for this account on the assumption that “Free” means eligible.** Current documentation excludes accounts using AWS Free Tier from flat-rate pricing plans. Ordinary CloudFront has separate pay-as-you-go free allowances; S3 requests/storage and any uncovered service use still require an account-specific estimate. No plan subscription or account upgrade was attempted. [CloudFront plan restrictions](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/flat-rate-pricing-plan.html#flat-rate-pricing-plan-unsupported-features), [CloudFront pricing FAQ](https://aws.amazon.com/cloudfront/faqs/)

A Lambda function URL avoids a separate endpoint fee, but CORS is not authentication. The hosted API must authenticate and authorize every protected request before invoking a model/tool or accessing tenant data. Choose its final IAM/JWT boundary during phase-3 implementation. [Function URL pricing and alternatives](https://docs.aws.amazon.com/lambda/latest/dg/apig-http-invoke-decision.html), [function URL access control](https://docs.aws.amazon.com/lambda/latest/dg/urls-auth.html)

## Hosting does not automatically include the local execution environment

The approved MVP accesses selected local repositories and uses Docker workers for controlled code execution. A hosted Lambda cannot simply inherit that filesystem, Docker daemon or persistent local event store. Standard Lambda functions have bounded invocations and ephemeral filesystem storage. [Lambda execution model](https://docs.aws.amazon.com/lambda/latest/dg/lambda-functions-chapter.html), [ephemeral storage](https://docs.aws.amazon.com/lambda/latest/dg/configuration-ephemeral-storage.html)

The recommended first hosted scope is the UI, accounts, persisted project metadata and bounded provider orchestration. Keep repository/code execution in an authenticated local runner until a separate hosted sandbox is designed, tested and costed. This runner bridge does not exist yet. Do not advertise full hosted feature parity or permanently free sandbox execution.

Before launch, verify the exact service allowances and credit expiry again; review a deployment-specific cost estimate; confirm budget notifications; cap concurrency, log retention, model calls and stored artifacts; and run the application's tenancy, credential and cancellation checks against the hosted design. AWS credits do not pay for unrelated external model-provider API usage. Budget alerts should not be described as a hard spending cap.

**Current outcome:** dedicated CLI/profile configured and authenticated; Free Tier status and representative access verified; existing cloud resources untouched; phase-3 route documented; no cloud resources provisioned.
