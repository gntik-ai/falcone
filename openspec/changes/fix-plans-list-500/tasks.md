# Tasks — fix-plans-list-500

## Investigation
- [ ] Examine provisioning-orchestrator logs when `GET /v1/plans` is called.
- [ ] Identify the `plan-list` action source in `services/provisioning-orchestrator/`.
- [ ] Determine error: missing migration / bad query / permission issue.

## Implementation
- [ ] Fix the root cause (add migration / fix query / grant permission).
- [ ] Ensure the fix is idempotent (safe to apply on existing deployments).

## Verification
- [ ] `GET /v1/plans` → 200 with plan catalog JSON.
- [ ] Run `bash tests/blackbox/run.sh`.
- [ ] Run `/opsx:verify fix-plans-list-500`.

## Archive
- [ ] `/opsx:archive fix-plans-list-500`
