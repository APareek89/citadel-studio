# Free workflow FMEA — 2 October 2026

The reviewed runtime is deployed; see the root release verification below. The native213-test suite and normal Auth.js/two-owner PostgreSQL HTTP checks passed with external network denied. The Build journey now includes a session-authored support brief and customer question through the real alignment/approval/run/export path with explicit synthetic model outputs.

One reproduced runtime fix: remove every case-insensitive SSL-prefixed database URL option before applying the verified CA configuration. Actual `pg.Client` construction confirms URL options cannot disable verification. No schema migration, cloud change or provider call was performed.

See `docs/qa/2026-10-02/REPORT.md`, `fmea.json`, and `validation.json`. The112 scenarios are not112 discovered bugs. Source-only import, Docker capability boundaries, live provider quality and multi-instance operation retain their stated limitations.

Scores prioritize review (Severity × Occurrence × Detection); they are judgments, not measured production failure rates. Each row records its own evidence level. Local fixture passes do not imply provider quality, deployed behavior, or screenshot acceptance. Existing live receipts remain unchanged.

## Root release and browser verification

Root activated image `81888b624f87` with authentication enabled, mock mode disabled and environment/mounts/runtime bounds preserved. Other applications were unchanged; zero provider calls were made by the operator. See `aws-release.json`. Before release, root checked the normal-auth prepared source and cached workflow: all four scheduler nodes completed with zero tokens, and mobile390 controls wrapped correctly (`browser-qa.json`). These are scoped auth/UI/scheduler and deployment checks, not new paid inference-quality proof. Native tests above were retained, not rerun for this documentation-only update.
