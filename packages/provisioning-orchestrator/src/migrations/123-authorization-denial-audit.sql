-- Authorization denial attribution (#958). Forward-only and image-rollback safe.
ALTER TABLE scope_enforcement_denials ADD COLUMN IF NOT EXISTS required_role TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'scope_enforcement_denials'::regclass
      AND conname = 'scope_enforcement_denials_denial_type_check'
      AND pg_get_constraintdef(oid) LIKE '%ROLE_INSUFFICIENT%'
  ) THEN
    ALTER TABLE scope_enforcement_denials
      DROP CONSTRAINT IF EXISTS scope_enforcement_denials_denial_type_check;
    ALTER TABLE scope_enforcement_denials
      ADD CONSTRAINT scope_enforcement_denials_denial_type_check
      CHECK (denial_type IN ('SCOPE_INSUFFICIENT','PLAN_ENTITLEMENT_DENIED',
        'WORKSPACE_SCOPE_MISMATCH','CONFIG_ERROR','ROLE_INSUFFICIENT'));
  END IF;
END;
$$;
