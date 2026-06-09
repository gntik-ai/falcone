# webhooks Specification

## Purpose
TBD - created by archiving change fix-webhook-delivery-ssrf-repin. Update Purpose after archive.
## Requirements
### Requirement: Webhook delivery client MUST re-resolve the target hostname and block delivery if any resolved IP is in a blocked range

The system SHALL, immediately before opening a connection to the webhook target URL, perform a fresh DNS resolution of the target hostname and call `isBlockedIp` on every resolved address; if any resolved address is blocked, the system SHALL abort the delivery attempt, record the outcome as `permanently_failed` with an `error_detail` indicating SSRF guard rejection, and SHALL NOT open the network connection.

#### Scenario: Delivery is rejected when target hostname re-resolves to a private IP at send time (bbx-webhook-rebind)

- **WHEN** a webhook subscription was registered with a hostname that resolved to a public IP at subscription time (passing validation), and at delivery time that hostname resolves to a blocked IP address (e.g. `169.254.169.254`, `127.0.0.1`, or any RFC1918 address)
- **THEN** the delivery worker refuses to open the HTTP connection, records the delivery attempt as `permanently_failed`, and does not emit the webhook payload to the private IP

#### Scenario: Delivery succeeds when hostname re-resolves to the same public IP

- **WHEN** a webhook subscription was registered with a hostname that resolved to a public IP at subscription time, and at delivery time that hostname continues to resolve to a public (non-blocked) IP
- **THEN** the delivery proceeds normally and the attempt outcome reflects the HTTP response from the target server

### Requirement: Webhook delivery client MUST connect to the pinned validated IP address

The system SHALL connect the HTTP client to the specific IP address that was resolved and validated at delivery time (IP pinning), bypassing any further OS-level DNS resolution for that connection, to prevent TOCTOU races between the re-validation step and the actual connect.

#### Scenario: HTTP client connects to the validated IP, not via a second DNS lookup

- **WHEN** the delivery worker has resolved and validated the target hostname to a specific non-blocked IP address
- **THEN** the HTTP connection is established directly to that IP address (e.g. via a custom `lookup` function or pre-resolved agent) such that no second OS DNS resolution can yield a different address

### Requirement: Webhook delivery client MUST refuse HTTP redirects that resolve to a blocked IP

The system SHALL disable automatic HTTP redirect following OR validate every redirect `Location` header by re-resolving its hostname and calling `isBlockedIp`; if the redirect target resolves to a blocked IP the delivery SHALL be aborted as `permanently_failed`.

#### Scenario: Redirect to a private IP is refused

- **WHEN** the webhook target server responds with an HTTP 3xx redirect whose `Location` header contains a hostname that resolves to a blocked IP (e.g. `169.254.169.254`)
- **THEN** the delivery worker does not follow the redirect, records the attempt as `permanently_failed`, and logs the SSRF guard rejection

