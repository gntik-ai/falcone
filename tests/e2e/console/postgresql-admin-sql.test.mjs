import test from 'node:test';
import assert from 'node:assert/strict';

import { buildPostgresAdminSqlAdapterCall } from '../../../packages/adapters/src/postgresql-admin.mjs';

test('admin SQL console flow preserves preview history and confirmation fingerprint between preview and execute', () => {
  const previewCall = buildPostgresAdminSqlAdapterCall({
    callId: 'call_console_admin_sql_preview',
    tenantId: 'ten_alpha',
    workspaceId: 'wrk_01alphaprod',
    planId: 'pln_01enterprise',
    scopes: ['database.admin'],
    effectiveRoles: ['workspace_admin'],
    correlationId: 'corr_console_admin_sql_preview',
    authorizationDecisionId: 'authz_console_admin_sql_preview',
    idempotencyKey: 'idem_console_admin_sql_preview',
    targetRef: 'postgres://tenant_alpha_main/admin-sql',
    payload: {
      databaseName: 'tenant_alpha_main',
      schemaName: 'pg_catalog',
      sqlText: 'SELECT pid FROM pg_stat_activity WHERE datname = :databaseName',
      parameters: { databaseName: 'tenant_alpha_main' },
      executionMode: 'preview',
      queryLabel: 'Inspect sessions'
    },
    context: {
      originSurface: 'web_console',
      actorType: 'human_operator'
    }
  });

  const executeCall = buildPostgresAdminSqlAdapterCall({
    callId: 'call_console_admin_sql_execute',
    tenantId: 'ten_alpha',
    workspaceId: 'wrk_01alphaprod',
    planId: 'pln_01enterprise',
    scopes: ['database.admin'],
    effectiveRoles: ['workspace_admin'],
    correlationId: 'corr_console_admin_sql_execute',
    authorizationDecisionId: 'authz_console_admin_sql_execute',
    idempotencyKey: 'idem_console_admin_sql_execute',
    targetRef: 'postgres://tenant_alpha_main/admin-sql',
    payload: {
      databaseName: 'tenant_alpha_main',
      schemaName: 'pg_catalog',
      sqlText: 'SELECT pid FROM pg_stat_activity WHERE datname = :databaseName',
      parameters: { databaseName: 'tenant_alpha_main' },
      executionMode: 'execute',
      confirmation: {
        confirmed: true,
        statementFingerprint: previewCall.payload.queryPreview.statementFingerprint
      }
    },
    context: {
      originSurface: 'web_console',
      actorType: 'human_operator'
    }
  });

  assert.equal(executeCall.payload.queryPreview.statementFingerprint, previewCall.payload.queryPreview.statementFingerprint);
});
