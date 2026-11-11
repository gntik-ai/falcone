# Implementation and validation

- [x] Verify the assigned clean branch and dependency-resolution commit `ce13a280`.
- [x] Pin all four direct kit packages together, with no new dependency keys.
- [x] Accept the platform-regenerated lockfile; audit other importers and retained snapshots for unrelated churn.
- [x] Observe the old-pin CLI regression fail, then update the gate and fixture versions while preserving negative cases and the tarball-host check.
- [x] Run the pin suite and gate, console typecheck, colour/i18n checks, translation/dist validation fixtures and parity structure tooling.
- [x] Document each named release change and keep the single kit stylesheet import.
- [ ] Finish the normal console unit suite and release builds; record final results in the implementation output.
- [ ] Clean-room frozen install and per-package npm integrity comparison: require network and Docker outside this sandbox.
- [ ] Chromium parity shards, negative probes, axe, viewport, shell and CSP checks: PR CI runs them.
- [ ] Review changed parity screenshots and obtain operator visual approval; list any regenerated screenshots individually with reasons in the PR.
- [ ] Shared legacy/next Docker image build: Docker socket permission denied in this sandbox; PR CI runs it.
