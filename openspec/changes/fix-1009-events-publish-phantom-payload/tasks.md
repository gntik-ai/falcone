# Tasks

- [x] Verify clean assigned source worktree and issue branch.
- [x] Reproduce both handlers returning 202 for a messages wrapper before changing source.
- [x] Reject missing own payload/value fields before producer allocation.
- [x] Watch null/undefined regression cases fail, then reject unusable selected values.
- [x] Preserve valid bytes, byte lengths, headers, keys, compatibility and authorization order.
- [x] Document the behavior change and add the Events spec delta.
- [x] Run all scoped Kafka handler tests with an external Kafka boundary stub: 99 passed.
- [ ] PR CI: run handler tests with installed kafkajs and normal test subprocess isolation.
- [ ] PR CI: run event-kafka-integrations.contract.test.mjs with installed yaml.
- [ ] PR CI: run ConsoleKafkaPage.test.tsx with installed console dependencies and subprocess access.
- [ ] Release pipeline: verify a real payload returns 202 and a messages wrapper returns 400
  against an existing topic, using the response and no consume as evidence.

## Identity and public seams

Source base: 3abfae77f9f321f3ffc43d588b82f17a3dabb39b.
Assigned branch: agent/falcone/1009/d7d6884e-e609-52cf-aaac-acec892d22d5.
Assigned worktree: /srv/engineering/worktrees/falcone/d7d6884e-e609-52cf-aaac-acec892d22d5.
The initial worktree was clean and its Git worktree identity matches the assignment.

The public seams are KAFKA_HANDLERS.eventsTopicPublish and eventsWorkspaceTopicPublish.
Tests observe their response and the external Kafka producer request and allocation counters;
registry reads and Kafka are boundary fixtures. They do not establish live broker behavior.

## Red-to-green evidence

Before source changes, this command failed on both handlers with actual status 202 versus expected 400:
`node --import=/tmp/falcone-1009-kafka-boundary.mjs --test --experimental-test-isolation=none --test-name-pattern='fix-1009-01.*messages batch' tests/unit/kafka-handlers-publish-validation.test.mjs`.
The complete missing-field slice then failed all 18 cases. Removing the synthesized missing-field
fallback and validating the resolved value made all 18 pass. The next null/undefined slice failed
all 12 cases before removing the nullish empty-object substitutions, then all 30 passed.
Positive serialization and authorization controls brought the regression file to 56 passing cases.

Confirmed cause: publishValueFromBody synthesized an empty object for missing fields and nullish
selected values. Both routes share publishToTopicRecord, which previously accepted that value.

The temporary Node import hook supplied only kafkajs exports; its constructor threw if a test
failed to supply the external Kafka client through the existing test hooks. Falcone modules were
not replaced. The hook was removed after verification and is not part of the commit.

## Verification limits

PASS: `node --import=/tmp/falcone-1009-kafka-boundary.mjs --test --experimental-test-isolation=none tests/unit/kafka-handlers-*.test.mjs`
ran 99 checks, including unchanged fix-777-02 and fix-777-05. No timeout wrapper was used.

SKIPPED: ordinary handler tests cannot load the absent kafkajs dependency. Normal Node test
subprocess isolation also could not complete with the import hook in this sandbox.
SKIPPED: `node --test --experimental-test-isolation=none tests/contracts/event-kafka-integrations.contract.test.mjs`
cannot load the absent yaml dependency.
SKIPPED: `pnpm --filter @in-falcone/web-console test src/pages/ConsoleKafkaPage.test.tsx`
cannot start because spawnSync of /usr/local/bin/node returns EPERM. Console node_modules are absent.

Existing dependency manifests and lockfiles need no changes. CI must complete these checks.
Live verification belongs to the release pipeline; this handoff contains source evidence only.
