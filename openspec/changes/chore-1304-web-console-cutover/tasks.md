# Source tasks

- [x] Serve only next at root with relative raw-byte redirects and health.
- [x] Build root next dist only; preserve restricted runtime and release metadata.
- [x] Commit all 57 blocking items and fail-closed offline/live closure gate.
- [x] Record the supplied prior image tag and immutable digest.
- [x] Add settled-state sample checks, negative harness and CLI rows validator.
- [x] Update shell paths, CI jobs, serving/build/workflow contract tests.
- [x] Preserve legacy source, existing CSP, kit pins and chart key.
- [ ] PR CI: socket/nginx request matrix, Docker context/image tests and browser suites.
- [x] Companion deployment maker: digest/tag chart rendering tests (charts commit 7940297bb75dba989db8061769374466af5a6a6f, independently checked).
- [x] Correct cutover-job API read permissions and use a single plain-text health Content-Type.
- [x] Reproduce the missing Node health Content-Type through the HTTP handler, add it, and reconcile the routing assertion with the shared request matrix.
- [x] Reject encoded leading backslashes after the next prefix in both servers; cover literal and encoded prefixes in the shared request matrix.
- [ ] PR CI: confirm the falcone job token can read gntik-ai/gntik-ui issues 30 and 13 and PRs 86 and 49; API errors must keep failing closed.
- [ ] Operator: attach switch digest, parity/visual review and staging rollback evidence.
