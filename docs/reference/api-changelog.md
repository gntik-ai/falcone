# API changelog

## Storage object contract correction (#1005)

Object uploads declare the existing `201` response with `objectKey`, `bucketName`,
`sizeBytes`, and `contentType`; `202` is no longer declared. Downloads declare the
existing flat envelope with `objectKey`, `bucketName`, `contentBase64`, `encoding`,
`contentType`, and `sizeBytes`. Range downloads add `contentRange` and `partial`,
with `Content-Range` and `Accept-Ranges` headers. Full downloads also declare
`Accept-Ranges`.

`StorageObjectWriteRequest` no longer accepts `tenantId` or `workspaceId`. Sending
either field is schema-invalid under `additionalProperties: false`; callers
should omit both, including for multipart part uploads. Scope continues to come
from bucket ownership and the verified token. Live handler behavior is unchanged.

The unused `StorageObjectDownload` and `StorageObjectPayload` schemas are removed.
Clients importing those schema names must regenerate against
`StorageObjectReadResult`, `StorageObjectRangeReadResult`, and
`StorageObjectWriteResult`. `StorageObjectMetadata` remains available.
