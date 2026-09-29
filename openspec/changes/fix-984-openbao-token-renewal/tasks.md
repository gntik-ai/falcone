## 1. Token lifecycle

- [x] 1.1 Start Kubernetes auth eagerly, track lease expiry and health, and renew after half the lease.
- [x] 1.2 Fall back to re-login, serialize auth requests, and bound retry backoff with jitter.
- [x] 1.3 Invalidate a provider token on KV 403 and retry the request once.

## 2. Observability

- [x] 2.1 Expose the store's read-only health snapshot to the HTTP server.
- [x] 2.2 Add secret-backend state to health and readiness bodies and a bounded-label metric.
- [x] 2.3 Keep credentials out of logs, health output, metrics, and thrown errors.

## 3. Verification

- [x] 3.1 Add fake-fetch and fake-clock lifecycle coverage.
- [x] 3.2 Cover the server health response, disabled state, and metrics without a socket.
- [ ] 3.3 Run the socket-based HTTP blackbox tests and staging runtime check in CI/release (sandbox disallows local sockets).
