# Implementation and validation

- [x] Verify the assigned clean branch and dependency-resolution commit `ce13a280`.
- [x] Pin all four direct kit packages together, with no new dependency keys.
- [x] Accept the platform-regenerated lockfile; audit other importers and retained snapshots for unrelated churn.
- [x] Observe the old-pin CLI regression fail, then update the gate and fixture versions while preserving negative cases and the tarball-host check.
- [x] Run the pin suite and gate, console typecheck, colour/i18n checks, translation/dist validation fixtures and parity structure tooling.
- [x] Document each named release change and keep the single kit stylesheet import.
- [x] Run the normal console unit suite; record its final result in the implementation output. Preserve every scenario and assert exact status tones after the kit's token-backed badge markup change.
- [x] Build the next console at `/` and `/next/`, validate dist and translation chunks, check release fixture exclusion and asset base paths, and build the legacy release SPA.
- [x] Use the supplied CI runtime background-class failures as red evidence; remove the unnecessary StatusTag background override and assert exact semantic tones in parity and all six added regression cases.
- [x] Use shard 7's six overview responsive CI failures as red evidence; preserve the four-column desktop inventory layout and strip dividers at the KpiRow call site, leaving all parity tests unchanged.
- [ ] Clean-room frozen install and per-package npm integrity comparison: require network and Docker outside this sandbox.
- [ ] Chromium parity shards, negative probes, axe, viewport, shell and CSP checks: PR CI runs them.
- [ ] Review changed parity screenshots and obtain operator visual approval; list any regenerated screenshots individually with reasons in the PR.
- [ ] Shared legacy/next Docker image build: Docker configuration directory is read-only (the earlier attempt also lacked socket permission); PR CI runs it.
