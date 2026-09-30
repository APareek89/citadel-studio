# Handoff

## Portfolio launch — 30 September 2026 (live verified; source release gate)

Fresh clone under `portfolio/citadel-studio`, branch `codex/launch-2026-09-30`, base `79cae3d`. Original checkout, port 3001 and the earlier AWS preview documented in the archive remain untouched. Root accepted the isolated baseline: 189/189 free tests, production build and Codex browser source-map/source-review journey. The initial over-parallelized startup timeout is retained outside the repository; bounded test concurrency resolves it without a runtime patch.

Current integration adds PostgreSQL/Auth.js email/password accounts, owner-scoped state/source/provider/telemetry services, private S3 source bundles, and the shared Inter/Roboto Mono/Lucide light/dark interface. The free example deliberately separates a read-only source repository from a cached manifest that runs through the real scheduler. Google sign-in and email password reset are not configured; generic imported execution and Agentlane integration remain out of scope. No image/media pipeline is needed.

Frontend/package typecheck and build pass. Root’s authenticated local browser passed signup, source viewer, cached scheduler and normal Run, output, signout/signin, desktop themes and corrected 390px mobile controls without errors. Final source fixture CUA also passes: 6 visible nodes, 5 relationships, 4 hidden and linked Python declarations. Targeted 45 checks, real Auth.js/PG HTTP and the full 209/209 offline suite pass. Local gates are complete. Final code review then found and fixed a client-only delayed401/account-switch race;3 deterministic fence regressions plus the mutation contract pass4/4, and the final build and guarded current-tree/history scans pass. Corrected image `05fc03d692a19813` is live; root verified the served asset hash, example/cached execution, both themes and no console errors. Ten live free HTTP gate groups plus exact-version S3 cold hydration pass, including A/B denial and session/SSE revocation. Root alone operates the Codex browser and the one controlled live provider proof. All development uses mock providers and isolated state. The single live paid proof passed with one Gemini 3.5 Flash Lite dispatch/HTTP 200, 1,299 input/569 output/zero thinking tokens and estimated US$0.0018122. Four of four source candidates mapped; eight citations checked, source and S3 hashes unchanged. Ordinary live runtime and final UI passed with the proof guard removed; the free rerun stayed at zero tokens/cost and the persisted source map retained source-only labels. Commit/push approval remains pending. The older US$3 test allowance in the archive is historical and does not authorize new calls.


## Decisions and next gates

- 30 September: use user-approved shared EC2/Docker + PostgreSQL accounts and private S3 source bundles. The unavailable RDS/AppRunner path is not required for this release.
- Keep source inspection and a cached scheduler example separate; reject any implication that an uploaded repository executed. Preserve hidden nodes, graph controls and source/observed labels.
- Original single-owner deployment evidence remains in [the 25 September handoff](docs/archive/handoff-2026-09-25.md); it is not acceptance evidence for this new multi-user release.
- Local and live free tests and authenticated browser QA are complete. The one controlled live source-mapping proof also passes. Final ordinary-runtime/UI confirmation also passes. Next: final exact staged scans and reviewed commits/push. No outside browser or unapproved provider call.

**Session efficiency:** approximately 65% feature, 25% verification/environment and 10% integration correction. The baseline startup timeout was concurrency contention; restricting test concurrency retained every test.
