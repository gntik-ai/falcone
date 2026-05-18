## 1. Failing tests

- [ ] 1.1 [test] Add a case to
      `services/workspace-docs-service/actions/workspace-docs.action.test.mjs`
      that calls `PUT /docs/notes/not-a-uuid` and asserts the response is
      `400 INVALID_NOTE_ID`, not `500 INTERNAL_ERROR`.
- [ ] 1.2 [test] Add a case calling `GET /unknown` and asserting
      `404 NOT_FOUND`, not `501 NOT_IMPLEMENTED`.
- [ ] 1.3 [test] Add a case calling `GET /foo/docs` and asserting
      `404 NOT_FOUND` — the unanchored `/\/docs$/` regex MUST NOT match.
- [ ] 1.4 [test] Add a case calling `DELETE /docs/notes/<valid-uuid>`
      and asserting `204` / `404 NOTE_NOT_FOUND`; assert
      `DELETE /foo/docs/notes/<uuid>` returns `404 NOT_FOUND`.

## 2. Implementation

- [ ] 2.1 [fix] Tighten `noteIdFromPath` at
      `actions/workspace-docs.mjs:46-49` to validate the captured string
      as a UUIDv4; throw `INVALID_NOTE_ID` on mismatch; map to 400 in the
      outer catch.
- [ ] 2.2 [fix] Replace `501 NOT_IMPLEMENTED` at line 119 with
      `404 NOT_FOUND { code: 'ROUTE_NOT_FOUND' }`.
- [ ] 2.3 [fix] Anchor the four path regexes at lines 79, 89, 97, 108
      with `^` and `$`; verify with the route-table test above.

## 3. Validation

- [ ] 3.1 [test] Re-run the K1 action test suite and `openspec validate
      fix-k1-route-handler-correctness --strict`; both green.
- [ ] 3.2 [docs] Update
      `services/workspace-docs-service/README.md` route table to reflect
      the corrected unknown-route response code.
