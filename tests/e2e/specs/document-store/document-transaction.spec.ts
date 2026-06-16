// Document-store E2E — transaction (change add-ferretdb-document-store-e2e, #464, tasks 5.1-5.2).
//
// The HTTP data API exposes NO transaction route — the public route catalog has only
// documents/query/search/vector-indexes. FerretDB's deterministic transaction semantics
// (commitTransaction -> CommandNotFound(59); abortTransaction is a silent no-op, NO rollback) are
// a mongo-WIRE concern and are validated at the wire level by add-ferretdb-migration-validation
// (#462), not over HTTP. These scenarios are recorded here for traceability and skipped — there is
// no HTTP surface to exercise. (Do NOT assert rollback semantics; FerretDB 2.7.0 does not roll back.)
import { test } from '@playwright/test'

test.describe('document-store: transaction (unsupported on FerretDB)', () => {
  test('DOC-E2E-TXN-001: commitTransaction -> CommandNotFound(59) [wire-level; see #462]', () => {
    test.skip(
      true,
      'No HTTP transaction route; commitTransaction->CommandNotFound(59) is validated at the mongo-wire level by add-ferretdb-migration-validation (#462)',
    )
  })

  test('DOC-E2E-TXN-002: abortTransaction is a silent no-op, no rollback [wire-level; see #462]', () => {
    test.skip(
      true,
      'No HTTP transaction route; abortTransaction silent-no-op (no rollback) is validated at the mongo-wire level by add-ferretdb-migration-validation (#462)',
    )
  })
})
