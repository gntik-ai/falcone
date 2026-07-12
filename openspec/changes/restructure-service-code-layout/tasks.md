# Tasks — restructure-service-code-layout

Commands: `/migrate-assess` (survey + mapping) and `/test-slice` + `/test-frontend` (baselines).
Agents: migration-surveyor → migration-mapper → fixer (maker) → verifier + migration-reviewer.

## 1. Service map (migration-surveyor)
- [x] Produce a catalog of services: which exist, language, dependencies, and inter-service calls.

## 2. Target layout (migration-mapper)
- [x] Propose `apps/<service>` (+ co-located Dockerfile) and `packages/<shared>`, with old→new mapping.
- [x] Note the light-refactor opportunities (standardize layout, extract obvious shared modules).

## 3. Execute (behavior-preserving)
- [x] Capture feasible local baseline/result evidence; live kind deployment is blocked in this
  environment because the designated kind cluster is unavailable.
- [x] Move in separate restructure commits; apply the light refactor; fix imports, pnpm/Turbo and CI.

## 4. Verify
- [x] Add and run service-catalog/repository-layout validation for the exact issue #900 acceptance
  scenario.
- [x] Run focused local validation/build checks that can execute without a live cluster.
- [x] Independent verifier + migration-reviewer review after the maker commit.

Feeds change 4: the service catalog becomes the backbone of the devops/developer docs.
