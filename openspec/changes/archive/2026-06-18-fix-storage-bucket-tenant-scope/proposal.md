# fix-storage-bucket-tenant-scope

## Change type
bugfix

## Capability
storage

## Priority
P1

## Why
Two tenants' default slug-derived bucket name `ws-app-staging-assets` collide; `insertBucket` `ON CONFLICT (bucket_name) DO UPDATE SET tenant_id=EXCLUDED.tenant_id` overwrites the first tenant's registry row, so their bucket disappears from their list.

**Empirical evidence (live 2-tenant E2E re-run, fresh HEAD install, 2026-06-18):** Two tenants `POST /v1/storage/workspaces/{ws}/buckets` with no explicit name (both ws slug `app-staging`) -> second create hijacks the first's registry row; first tenant's bucket list drops to 0. `tenant-store.mjs::insertBucket`.

GitHub epic B. Evidence: `audit/live-campaign/evidence-rerun/13-storage-events-functions.md`.

## What Changes
Include the workspace id in the physical bucket name; key the registry by `(workspace_id, bucket_name)`; never let `ON CONFLICT` cross tenant_id.

## Impact
Same-slug workspaces across tenants get distinct buckets; neither can hijack the other's registry row.
