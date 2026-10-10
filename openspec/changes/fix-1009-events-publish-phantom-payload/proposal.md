# Reject phantom Events publish payloads

## Why

Issue #1009 reports that both Events publish routes accept unreadable bodies and send a
synthesized empty JSON object to Kafka under a 202 response. Missing payload fields and
null selected values become durable events with payloadSizeBytes 2.

## What changes

- Reject bodies without an own payload or value field, or with a null or undefined selected
  field, with 400 VALIDATION_ERROR naming payload.
- Validate after tenant management authorization and before producer allocation or metadata recovery.
- Preserve payload precedence, the value compatibility path, key and header handling,
  valid serialization, and the accepted response schema.
- Cover both handler boundaries with fake Kafka and registry boundary fixtures and document
  the rejection behavior.

## Impact

R1: previously accepted phantom publishes now return 400 without contacting Kafka.
Heartbeat producers relying on the implicit empty event must explicitly send payload: {} or
value: {}. Existing object and string payloads, including blank strings, remain accepted.
Historical phantom events remain on their topics.

No dependencies, migrations, deployment files, or required-field enforcement beyond the usable
payload change are needed. Full envelope validation belongs to #1005; batch wrappers remain
unsupported. Rollback is a source revert delivered through the normal image pipeline.
