import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    /**
     * trigger-restore.action.test.ts covers the legacy direct-dispatch path
     * (the path that was in place before the confirmation flow was introduced).
     * These unit tests mock only `operations.repository` and `adapters/registry`
     * and do not mock `confirmations.service`, so they cannot run the
     * confirmation flow without a real PostgreSQL instance.
     *
     * Setting RESTORE_CONFIRMATION_ENABLED=false at the suite level keeps those
     * tests on the legacy path they were designed for, while the confirmation
     * flow is covered by dedicated tests in:
     *   test/unit/api/restore-tenant-binding.test.ts
     *   test/unit/confirmations/tenant-name-resolver.test.ts
     *   test/unit/api/initiate-restore-resolver.integration.test.ts
     */
    env: {
      RESTORE_CONFIRMATION_ENABLED: 'false',
    },
  },
})
