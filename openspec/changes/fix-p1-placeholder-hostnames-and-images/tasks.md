## 1. Failing tests

- [ ] 1.1 [test] Add a `helm template charts/in-falcone -f values/prod.yaml`
      smoke in CI that asserts the rendered output contains zero matches for
      `example\.com`, `ghcr\.io/example`, and `:latest`; today the test
      fails on all three matches.
- [ ] 1.2 [test] Add a render test asserting the validator rejects a
      `values.yaml` whose `platform.network.publicSurface.bindings[].hostname`
      ends in `.example.com`.

## 2. Implementation

- [ ] 2.1 [fix] Edit `charts/in-falcone/values/prod.yaml:6-9, :66-69` to
      remove every `*.example.com` literal; replace with sentinel values
      operators must override.
- [ ] 2.2 [fix] Edit `charts/in-falcone/values.yaml:2062, :2146` to clear
      `controlPlane.image.repository` and `webConsole.image.repository`;
      `validate.yaml` already enforces presence per `:6-8`.
- [ ] 2.3 [fix] Edit `charts/realtime-gateway/values.yaml:3` to pin a real
      tag and `:13, :17-19` to require operator-supplied OIDC discovery URL.
- [ ] 2.4 [fix] Extend `charts/in-falcone/templates/validate.yaml` to fail
      render when any `publicSurface.bindings[].hostname` matches
      `.*\.example\..*` or any image repository starts with `ghcr.io/example`.
- [ ] 2.5 [migration] Delete `helm/provisioning-orchestrator/values.yaml`
      (B14) and note in the PR description that the keys (`timeoutSweep`,
      `orphanSweep`, `env`) belong to no chart in this repo.

## 3. Validation

- [ ] 3.1 [docs] Document the new validator rules and the required
      operator-supplied overrides in `charts/in-falcone/README.md`.
- [ ] 3.2 [test] Run `helm template charts/in-falcone -f values/prod.yaml
      --set platform.network.publicSurface.bindings[0].hostname=api.example.org
      ...` to confirm render succeeds with real hostnames; run `openspec
      validate fix-p1-placeholder-hostnames-and-images --strict`; both green.
