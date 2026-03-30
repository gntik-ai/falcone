# Data Model — OpenAPI Publishing & SDK Generation

## Tables

### `workspace_openapi_versions`

- Migration: `services/openapi-sdk-service/migrations/088-workspace-openapi-versions.sql`
- Tracks the current and historical OpenAPI documents per workspace.
- Indexed by current workspace row and tenant.

Columns:
- `id` UUID primary key
- `tenant_id` tenant scope
- `workspace_id` workspace scope
- `spec_version` semantic version string
- `content_hash` quoted SHA-256 base for ETag
- `format_json` serialized JSON document
- `format_yaml` serialized YAML document
- `capability_tags` enabled capabilities included in the spec
- `is_current` current-row marker
- `created_at` creation timestamp

Lifecycle:
1. Regeneration flips the old current row to `FALSE`.
2. New content inserts a new current row.
3. Historical rows remain available for audit/rollback.

### `workspace_sdk_packages`

- Migration: `services/openapi-sdk-service/migrations/088-workspace-sdk-packages.sql`
- Tracks generated SDK archives per workspace, language, and spec version.

Columns:
- `id` UUID primary key
- `tenant_id` tenant scope
- `workspace_id` workspace scope
- `language` target SDK language
- `spec_version` published spec version
- `status` pending/building/ready/failed/stale
- `download_url` latest presigned URL
- `url_expires_at` URL expiry timestamp
- `error_message` optional failure detail
- `created_at` creation timestamp
- `updated_at` update timestamp

Lifecycle:
1. Create or reuse a row on generate request.
2. Move through `pending` → `building` → `ready` or `failed`.
3. Mark prior `ready` rows as `stale` when a new spec version is published.

## Version Increment Strategy

- MAJOR when capability tags are removed.
- MINOR when capability tags are added.
- PATCH when the capability set is unchanged.

## Contract References

- `services/internal-contracts/src/workspace-openapi-version.json`
- `services/internal-contracts/src/sdk-package.json`
- `services/internal-contracts/src/openapi-spec-updated-event.json`
- `services/internal-contracts/src/sdk-generation-completed-event.json`
