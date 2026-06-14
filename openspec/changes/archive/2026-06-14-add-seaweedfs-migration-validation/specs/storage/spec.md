## ADDED Requirements

### Requirement: Storage API routes return correct tenant-scoped results against any S3-compatible backend

The system SHALL return tenant-scoped results from all five storage API routes (`GET /v1/storage/buckets`, `POST /v1/storage/workspaces/{workspaceId}/buckets`, `GET /v1/storage/workspaces/{workspaceId}/usage`, `GET /v1/storage/buckets/{bucketId}/objects`, `GET /v1/storage/buckets/{bucketId}/objects/{objectKey}/metadata`) regardless of whether the underlying S3-compatible backend is MinIO or SeaweedFS, as configured via `S3_ENDPOINT`.

#### Scenario: List-buckets returns only the requesting tenant's buckets

- **WHEN** an authenticated request for Tenant A calls `GET /v1/storage/buckets` and the `S3_ENDPOINT` env var is set to a SeaweedFS-compatible endpoint
- **THEN** the response body contains only buckets whose ownership is scoped to Tenant A and no buckets belonging to other tenants are included

#### Scenario: Provision-bucket creates a bucket scoped to the requesting tenant

- **WHEN** an authenticated request for Tenant B calls `POST /v1/storage/workspaces/{workspaceId}/buckets` and `S3_ENDPOINT` points at SeaweedFS
- **THEN** the bucket is created under Tenant B's scope, the response is HTTP 201, and the bucket does not appear in Tenant A's bucket list

### Requirement: Storage API enforces cross-tenant denial at the route level

The system SHALL return HTTP 403 or HTTP 404 on any storage API request where the authenticated tenant does not own the addressed bucket or object prefix, so that tenant isolation is enforced at the API layer independently of the S3-compatible backend implementation.

#### Scenario: Cross-tenant object-list access is denied

- **WHEN** an authenticated request for Tenant A calls `GET /v1/storage/buckets/{bucketId}/objects` and `bucketId` is owned by Tenant B
- **THEN** the response is HTTP 403 or HTTP 404 and the response body does not include any object keys from Tenant B's bucket

#### Scenario: Cross-tenant object-metadata access is denied

- **WHEN** an authenticated request for Tenant A calls `GET /v1/storage/buckets/{bucketId}/objects/{objectKey}/metadata` and the bucket is owned by Tenant B
- **THEN** the response is HTTP 403 or HTTP 404 and no metadata from Tenant B's object is disclosed
