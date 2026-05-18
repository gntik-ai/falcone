## Why

The webhook engine silently corrupts oversized payloads, signs without
a timestamp (replay-prone), and dedupes deliveries by internal id
instead of source event id. From
`openspec/audit/cap-f3-webhook-engine.md`:

- **B3** (`services/webhook-engine/src/webhook-delivery.mjs:58-71`) —
  when the JSON-encoded payload exceeds `maxBytes`, the function
  rewrites `payload.data` with `{...payload.data, _truncated: true}`
  and returns `payload_ref: 's3://webhook-payloads/<uuid>'`. **No S3
  client exists in the package.** The original data is lost; the
  receiver gets a marker-only body; the `payload_ref` points at
  nothing.
- **B5** (`services/webhook-engine/actions/webhook-delivery-worker.mjs:27`)
  — `'x-platform-webhook-signature': computeSignature(rawBody, secret.secret)`.
  The companion `x-platform-webhook-timestamp` header is sent but not
  signed. An attacker who intercepts the body can replay it
  indefinitely against the receiver.
- **B20** (`services/webhook-engine/src/webhook-delivery.mjs:48-56`) —
  the delivery envelope sets `id: delivery.id`, not `event.eventId`.
  Receivers cannot dedupe by upstream event id because the field
  changes on every retry.
- **G20** — receiver-side replay protection is not documented.

## What Changes

- Replace the silent truncation with an explicit decision: if
  `payload_size > maxBytes` AND no S3 spillover adapter is wired,
  reject the delivery with `permanently_failed` and
  `error_detail: 'payload_too_large'`; if an adapter is wired, write
  the original payload, leave `payload.data` as a `{$ref: payload_ref}`
  envelope.
- Sign the payload as `${timestamp}.${rawBody}` with the timestamp
  also exposed in the `x-platform-webhook-timestamp` header; document
  the receiver verification recipe.
- Use `event.eventId` as the envelope's `id` field; expose the
  internal `delivery.id` separately as `x-platform-webhook-delivery-id`
  so receivers can dedupe by source event.

## Capabilities

### Modified Capabilities

- `realtime-and-events`: webhook deliveries no longer silently
  corrupt oversized payloads, signatures are bound to a timestamp,
  and receivers can dedupe by upstream event id.

## Impact

- **Affected code**:
  `services/webhook-engine/src/webhook-delivery.mjs`,
  `services/webhook-engine/src/webhook-signing.mjs`,
  `services/webhook-engine/actions/webhook-delivery-worker.mjs`,
  optionally a new `services/webhook-engine/src/payload-spillover.mjs`
  adapter port.
- **Migration**: none — `payload_ref` becomes meaningful instead of
  fictional.
- **Breaking changes**: receivers using the legacy signature scheme
  must update to verify `${timestamp}.${rawBody}`; the envelope's `id`
  semantics change from delivery-internal to source-event id. Note in
  PR and add a deprecation header `x-platform-webhook-signature-v1`
  for one release that contains the legacy signature.
- **Out of scope**: rate-limit fixes
  (`fix-f3-rate-limit-and-tenant-isolation`), worker robustness
  (`fix-f3-delivery-worker-and-scheduler`).
