## ADDED Requirements

### Requirement: Webhook URL blocklist covers all private and link-local address forms

The system SHALL block webhook subscription URLs whose resolved target is any of: loopback (`127.0.0.0/8`, `::1`), private RFC-1918 ranges (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), IPv4 link-local (`169.254.0.0/16`), `0.0.0.0`/`0.0.0.0/8`, IPv6 unspecified (`::`) and IPv4-mapped link-local (`::ffff:169.254.0.0/112`), and ULA ranges (`fc00::/7`). The system SHALL normalize numeric-encoded IP forms (decimal, octal, hex) to canonical dotted-decimal before applying range checks and SHALL NOT treat a non-canonical form as a public address.

#### Scenario: IPv4 link-local instance-metadata address is rejected

- **WHEN** a caller attempts to create a webhook subscription with URL `https://169.254.169.254/latest/meta-data/`
- **THEN** the system returns `INVALID_URL` and does not create the subscription

#### Scenario: Decimal-encoded link-local address is rejected

- **WHEN** a caller attempts to create a webhook subscription with URL `https://2852039166/path` (decimal encoding of `169.254.169.254`)
- **THEN** the system returns `INVALID_URL` and does not create the subscription

#### Scenario: 0.0.0.0 is rejected

- **WHEN** a caller attempts to create a webhook subscription with URL `https://0.0.0.0/path`
- **THEN** the system returns `INVALID_URL` and does not create the subscription

### Requirement: Webhook URL validation resolves DNS hostnames at registration time

The system SHALL perform DNS resolution on all non-IP webhook URL hostnames during `validateSubscriptionInput`. The system SHALL check every resolved IP address against the complete blocklist. The system SHALL reject the subscription with `INVALID_URL` if any resolved IP is blocked or if DNS resolution fails (fail-closed behavior).

#### Scenario: DNS name resolving to link-local is rejected at registration

- **WHEN** a caller attempts to create a webhook subscription with a DNS hostname that resolves to `169.254.169.254`
- **THEN** the system returns `INVALID_URL` and does not create the subscription

#### Scenario: DNS resolution failure is rejected

- **WHEN** a caller attempts to create a webhook subscription with a DNS hostname that cannot be resolved
- **THEN** the system returns `INVALID_URL` (fail-closed) and does not create the subscription

#### Scenario: Legitimate public HTTPS URL is accepted

- **WHEN** a caller attempts to create a webhook subscription with a URL whose hostname resolves only to public IP addresses
- **THEN** the system accepts the subscription

### Requirement: Webhook delivery re-validates resolved IP at delivery time

The system SHALL re-resolve the webhook URL hostname and re-validate all resolved IP addresses against the complete blocklist immediately before each outbound HTTP delivery attempt. The system SHALL abort delivery and record a permanent failure if re-resolution yields any blocked IP address, to prevent DNS-rebinding attacks.

#### Scenario: DNS rebinding after registration causes delivery abort

- **WHEN** a webhook URL hostname that was valid at registration time subsequently resolves to a blocked IP address at delivery time
- **THEN** the system aborts the delivery without sending the HTTP request
- **AND** the delivery is recorded as a permanent failure
