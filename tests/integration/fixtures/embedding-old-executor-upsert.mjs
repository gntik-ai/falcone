// Verbatim legacy upsert from embedding-executor.mjs at e381af5.
export const oldExecutorUpsert = `INSERT INTO workspace_embedding_providers
           (tenant_id, workspace_id, provider_type, model, endpoint, dimension, secret_ref, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb, now())
         ON CONFLICT (tenant_id, workspace_id) DO UPDATE SET
           provider_type = EXCLUDED.provider_type,
           model         = EXCLUDED.model,
           endpoint      = EXCLUDED.endpoint,
           dimension     = EXCLUDED.dimension,
           secret_ref    = EXCLUDED.secret_ref,
           updated_at    = now()
         RETURNING tenant_id, workspace_id, provider_type, model, endpoint, dimension, secret_ref, updated_at`;
