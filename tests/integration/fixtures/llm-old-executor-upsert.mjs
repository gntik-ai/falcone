// Verbatim SQL from falcone 7916f62, llm-executor.mjs:248-258.
export const oldExecutorUpsert = `INSERT INTO workspace_llm_providers
           (tenant_id, workspace_id, provider_type, endpoint, allowed_models, default_model, secret_ref, updated_at)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7::jsonb, now())
         ON CONFLICT (tenant_id, workspace_id) DO UPDATE SET
           provider_type  = EXCLUDED.provider_type,
           endpoint       = EXCLUDED.endpoint,
           allowed_models = EXCLUDED.allowed_models,
           default_model  = EXCLUDED.default_model,
           secret_ref     = EXCLUDED.secret_ref,
           updated_at     = now()
         RETURNING tenant_id, workspace_id, provider_type, endpoint, allowed_models, default_model, secret_ref, updated_at`;
