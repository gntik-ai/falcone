# workflows — spec delta for fix-flow-trigger-master-key-failclosed

## ADDED Requirements

### Requirement: Trigger-secret master key is externally provided and fails closed

The system SHALL resolve the AES-256-GCM master key used to encrypt per-trigger webhook HMAC
secrets at rest exclusively from the `FLOW_TRIGGER_SECRET_KEY` environment variable when running
in a production profile (`NODE_ENV === 'production'`). The system SHALL NOT fall back to any
hardcoded constant when the variable is unset in production — it SHALL resolve the key to a null
sentinel and fail closed. In a non-production profile (local development, automated tests) the
system MAY fall back to a well-known dev-only key so that unmodified local/test runs remain
functional without additional configuration.

The system SHALL refuse to register a webhook trigger with `503 TRIGGER_SECRET_KEY_UNCONFIGURED`
when the master key resolves to null, so no per-trigger secret is ever encrypted and persisted
under a publicly-known constant. The system SHALL return `false` from webhook signature
verification when the master key resolves to null, so no inbound webhook can be trusted without
the key.

Every production executor deployment SHALL supply `FLOW_TRIGGER_SECRET_KEY` via an external
secret mechanism (e.g. a Kubernetes `secretKeyRef`) that is distinct per deployment and not a
universal code constant.

#### Scenario: webhook trigger registration is refused when the master key is not configured in production

- **WHEN** the executor process runs with `NODE_ENV=production` and `FLOW_TRIGGER_SECRET_KEY`
  is not set in the environment
- **THEN** `registerWebhookTrigger` throws an error with `statusCode 503` and
  `code TRIGGER_SECRET_KEY_UNCONFIGURED`, and no trigger secret is written to the database

#### Scenario: webhook verification fails closed when the master key is absent in production

- **WHEN** the executor process runs with `NODE_ENV=production` and `FLOW_TRIGGER_SECRET_KEY`
  is not set in the environment
- **THEN** `verifyWebhook` returns `false` for any inbound webhook, regardless of the
  signature header or stored cipher, and no workflow run is started

#### Scenario: the dev fallback is active only in non-production profiles

- **WHEN** the process runs with a non-production `NODE_ENV` (e.g. `test`, `development`) and
  `FLOW_TRIGGER_SECRET_KEY` is not set
- **THEN** `resolveTriggerSecretKey` returns a non-null dev key so local and test runs remain
  functional without additional configuration

#### Scenario: registration succeeds with a configured key in production

- **WHEN** `NODE_ENV=production` and `FLOW_TRIGGER_SECRET_KEY` is set to a non-empty value
- **THEN** `registerWebhookTrigger` succeeds, encrypts the per-trigger secret under the
  configured key, and returns a one-time signing secret to the caller
