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

// Verbatim item PUT SQL from falcone 6f6e5c71, llm-executor.mjs:391-393.
export const oldRegistryItemUpdate = `UPDATE workspace_llm_connections SET display_name=$4, provider_type=$5, endpoint=$6,
            allowed_models=$7::jsonb, default_model=$8, secret_ref=$9::jsonb, is_default=$10, updated_at=now()
            WHERE tenant_id=$1 AND workspace_id=$2 AND connection_id=$3 RETURNING *`;
