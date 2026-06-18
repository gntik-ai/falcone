# Tasks — fix-scheduling-handler-dockerfile

## Reproduce (test-first)
- [x] `tests/blackbox/scheduling-handler-dockerfile.test.mjs` — fails on old code: the route map references `services/scheduling-engine` but the Dockerfile does not COPY it, and there is no build-time resolution check.

## Implement (kind runtime AND shippable product as applicable)
- [x] `deploy/kind/control-plane/Dockerfile`: `COPY services/scheduling-engine /repo/services/scheduling-engine`.
- [x] `deploy/kind/control-plane/Dockerfile`: build-time `RUN node -e` check that every route-map handler module resolves (fails the build on a missing COPY).

## Verify
- [x] `node --test tests/blackbox/scheduling-handler-dockerfile.test.mjs` green; the build-check JS is valid.
- [x] Acceptance: `/v1/scheduling/*` resolves its handler (no `ERR_MODULE_NOT_FOUND`); a missing handler now fails the build.

## Archive
- [ ] `openspec validate fix-scheduling-handler-dockerfile --strict`; `/opsx:archive fix-scheduling-handler-dockerfile` after merge.
