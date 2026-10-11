# Keep flow event-stream API keys out of application logs

## Why

The legacy console authenticates flow event streams with an `apikey` query parameter until the u5 cutover. Logging an exception unchanged can disclose that parameter through its message, stack, cause or driver metadata. A forced API-key lookup failure reproduces the leak through the real executor HTTP request handler on source HEAD `5c3f4d40b389b5b0c565a0dd10cf15c334e1f34c`.

## What changes

- For requests with query parameters, executor and control-plane error logs contain only the normalized pathname and bounded diagnostic code/status metadata. Discard arbitrary messages, stacks, causes and request objects; omit diagnostic codes that contain query values. Preserve original errors for queryless request diagnostics and leave errors used for response classification untouched.
- Cover the executor central catch, flow and LLM pre-stream catches, proxy upstream failure, and control-plane authentication and request catches. Do not change responses, authentication, SSE frames, metrics, correlation IDs or startup safety gates.
- Capture every application logger call at the public HTTP/SSE seam with a synthetic key. Assert only the presence or absence of query-key material, without printing captured diagnostics. Substitute database, JWKS, Temporal and upstream HTTP I/O only.
- Run the new log-capture suite and existing flow-events/error-code regressions in source PR CI. Existing unit CI continues to enforce route-template metric labels.

The paired deployment portion owns `charts/in-falcone/templates/apisix-config-file.yaml` and the chart contract for default, staging, prod, airgap and kind renders. Its gateway-wide access-log format must use `$request_method $uri $server_protocol`, retain status, latency and upstream address, and exclude query-bearing variables. Existing deployment, extra Lua path, plugins and Prometheus export configuration must remain unchanged. This source commit does not modify either standalone APISIX route copy or workflow chart pins.

## Verification and limits

The assigned branch initially contained only related #1118 edits, which were preserved and reviewed. Tests against an isolated archive of the assigned HEAD reproduced leaks in the central executor catch, nested proxy diagnostics, flow/LLM pre-stream catches and both control-plane catches. Corrected source passes these cases. Injecting `logger.error(req.url)` into the corrected executor copy makes the query-key assertion fail; the injection is removed afterward.

The source suite also covers successful SSE, invalid-key 401, foreign-execution 403 and a Temporal failure after stream opening. These three Temporal-dependent cases require the existing yaml/ajv dependencies and must run in CI. Runtime verification requires a sentinel SSE request and inspection of gateway, executor and control-plane pod logs by the runtime verifier.

Residual: nginx error logs can append raw request lines on upstream errors/timeouts. This ChangeSet does not claim to close that residual. Operator confirmation of ingress/OpenShift Route/load-balancer logging remains necessary. Key rotation, historical log removal, query-auth migration, route changes and deployment execution are outside this source change.

## Rollout and rollback

Publish through the existing image and release gates. Reverting this source change restores prior application diagnostics; the paired chart change has its own Helm rollback. No migration or dependency update is required.
