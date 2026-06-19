# fix-flow-trigger-master-key-failclosed

## Change type
bugfix

## Capability
workflows

## Priority
P2

## Why
`apps/control-plane/src/runtime/flow-trigger-registry.mjs` (lines 398–417) used a hardcoded
fallback `'flow-trigger-dev-master-key'` when `FLOW_TRIGGER_SECRET_KEY` was not set in the
environment. That constant was used as the AES-256-GCM master key to encrypt per-trigger webhook
HMAC secrets before writing them to the database. Because the executor deploy (`deploy/kind/executor-demo.yaml`)
did not originally set `FLOW_TRIGGER_SECRET_KEY`, every production deployment with the default
values encrypted webhook secrets under a publicly-known key string — an attacker with read access
to the secrets table (or a leaked database backup) could decrypt every webhook signing secret
without any per-tenant credential. GitHub issue #636.

**Root cause (code-verified).** The registry default parameter:

```js
// flow-trigger-registry.mjs:417 (before fix)
secretMasterKey = process.env.FLOW_TRIGGER_SECRET_KEY ?? 'flow-trigger-dev-master-key',
```

silently substituted the hardcoded constant rather than refusing when the variable was absent.
`registerWebhookTrigger` then called `encryptSecret(secret, secretMasterKey)` with that constant,
persisting ciphertext that any party knowing the source code could reverse. `verifyWebhook` also
decrypted with it, so a forged webhook could be verified if the attacker also crafted the matching
HMAC with the known key.

## What Changes
- New exported `resolveTriggerSecretKey()` function
  (`apps/control-plane/src/runtime/flow-trigger-registry.mjs:399–404`): returns the configured
  `FLOW_TRIGGER_SECRET_KEY` when set; returns `null` (fail closed) when it is absent and
  `NODE_ENV === 'production'`; returns the well-known dev key only for non-production profiles so
  local and test runs continue to work without configuration.
- Registry default parameter now calls `resolveTriggerSecretKey()` instead of the inline `??`
  fallback (line 417).
- `registerWebhookTrigger` throws `503 TRIGGER_SECRET_KEY_UNCONFIGURED` when `secretMasterKey`
  is `null` — the operation is refused rather than persisting a secret encrypted with the
  hardcoded constant (lines 460–463).
- `verifyWebhook` returns `false` (fail closed) when `secretMasterKey` is `null` — no signature
  can be trusted without the key (line 482).
- `deploy/kind/executor-demo.yaml` (lines 162–163): `FLOW_TRIGGER_SECRET_KEY` is now injected
  into the executor container via a `secretKeyRef` to a self-contained `in-falcone-flow-trigger-secret`
  Kubernetes Secret (defined at line 19) — a kind-local placeholder that must be replaced per
  deployment; the executor runs `NODE_ENV=production` so the fail-closed path would otherwise
  activate.
- New black-box test `tests/blackbox/flow-trigger-secret-key-failclosed.test.mjs` (bbx-trigkey-01..06)
  covers: resolver fails closed in production; refuses 503 at registration; verify returns false;
  dev fallback in non-production; success with a configured key.

## Impact
- In production (or any `NODE_ENV=production` process) without `FLOW_TRIGGER_SECRET_KEY`
  set, webhook trigger registration is refused with `503 TRIGGER_SECRET_KEY_UNCONFIGURED`
  instead of silently encrypting with the hardcoded dev key. Webhook verification fails closed
  (`false`) rather than trusting signatures generated with the known constant.
- Non-production environments (local dev, test) retain the dev-key fallback so no configuration
  change is required for existing development workflows.
- Per-deployment operators MUST supply `FLOW_TRIGGER_SECRET_KEY` in any production executor
  deployment; the kind demo manifest now provides it via a Kubernetes Secret reference.
- Affected specs: `workflows`.
