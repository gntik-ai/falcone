-- Flow (workflows) quota dimensions (change: add-flows-tenancy-isolation-limits, design D6).
--
-- Seeds the five per-tenant / per-workspace flow quota dimensions into quota_dimension_catalog,
-- following the exact pattern of 098-plan-base-limits.sql (same unit='count' convention, same
-- ON CONFLICT (dimension_key) DO NOTHING idempotency). The flows control-plane calls the existing
-- quota-enforce action with these dimension keys at the flow API boundary; a hard-limit breach
-- returns HTTP 429.
--
-- Defaults are conservative (design D6):
--   max_flows                     50   stored flow definitions per tenant
--   max_flow_versions             20   published versions per flow
--   max_concurrent_executions     10   running executions per workspace
--   flow_starts_per_minute        60   execution-start rate per workspace
--   flow_signal_rate_per_minute  120   signal calls per workspace per minute
--
-- Idempotent: re-running inserts nothing new (ON CONFLICT DO NOTHING).

INSERT INTO quota_dimension_catalog (dimension_key, display_label, unit, default_value, description)
VALUES
  ('max_flows', 'Maximum Flows', 'count', 50, 'Maximum number of stored flow definitions per tenant'),
  ('max_flow_versions', 'Maximum Flow Versions', 'count', 20, 'Maximum number of published versions per flow'),
  ('max_concurrent_executions', 'Maximum Concurrent Flow Executions', 'count', 10, 'Maximum number of concurrently running flow executions per workspace'),
  ('flow_starts_per_minute', 'Flow Start Rate', 'count', 60, 'Maximum flow execution starts per workspace per minute'),
  ('flow_signal_rate_per_minute', 'Flow Signal Rate', 'count', 120, 'Maximum flow signal calls per workspace per minute')
ON CONFLICT (dimension_key) DO NOTHING;
