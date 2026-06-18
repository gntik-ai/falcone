# Tasks — fix-events-physical-topic-workspace-id

## Reproduce (test-first)
- [ ] Add a failing black-box / live probe reproducing: acme & globex each POST `{name:collide-events}` to their `app-staging` ws -> identical `res_topic_80c2db4e` + identical physical `ws.

## Implement (kind runtime AND shippable product as applicable)
- [ ] Derive the control-plane physical name from the unique workspace id (align with `events-executor.mjs`); key `workspace_topics` by `(workspace_id, topic_name)`.

## Verify
- [ ] Black-box suite green; the live 2-tenant probe now passes.
- [ ] Acceptance: Two same-slug workspaces across tenants get distinct physical topics + distinct resourceIds; both tenants can use their topic; JWT and apiKey paths resolve to the same physical topic.

## Archive
- [ ] `openspec validate fix-events-physical-topic-workspace-id --strict`; `/opsx:archive fix-events-physical-topic-workspace-id` after merge.
