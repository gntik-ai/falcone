- [x] Test next HTML, assets, missing assets, traversal and absent-bundle behavior at the HTTP
  request/response seam before the corresponding source changes.
- [x] Serve the isolated next bundle using the existing security headers and compression.
- [x] Cover preserved legacy fallback, health and gateway request method/path/headers/body.
- [x] Mirror next SPA and immutable-asset serving in nginx.
- [x] Test and add validated version/SHA injection and the next shell About entry.
- [x] Test and extend the credential-free image builder and runtime copies for both bundles.
- [x] Test and extend host release builds, both published HTML checks and digest evidence.
- [x] Keep next-console PR CI aligned with the added release build command.
- [ ] Run chart unit, contract and blackbox readiness suites in CI's sibling checkout layout;
  this lease has no checkout at the suites' required `../falcone-charts` path.
- [ ] Run listening-socket and Chromium CSP suites in CI; the sandbox rejects listening with EPERM.
- [ ] Run the complete source-build contract suite in CI; its service-catalog subprocess cannot
  execute Git here (`spawnSync git EPERM`). The isolated Dockerfile contract checks pass.
- [ ] Build and inspect the image, including read-only UID 1000 serving, `.npmrc` absence and
  credential-free history; the sandbox denies access to the Docker socket.
- [ ] Verify kind/staging headers, About SHA versus image SHA tag, and adapter-deployed digest
  under authorized release orchestration.
