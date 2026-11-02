# Tasks

- [x] Add the kit-independent regression `tests/setupTimerTeardown.test.tsx` (red before the setup change).
- [x] Settle fake timers and clear pending real timers after `cleanup()` in `tests/setup.ts`.
- [ ] In PR CI, confirm `pnpm --filter @in-falcone/web-console-next test` reports `Errors 0` in 20 consecutive runs and record the run IDs in the PR.
- [ ] In PR CI, confirm `tests/consolePlanCreate.test.tsx` alone reports `Errors 0` in 20 runs.
- [ ] Record the suite duration before and after in the PR.
