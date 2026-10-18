# API changelog

## Native Gemini provider (#943)

The existing `gemini` provider type now uses Gemini's native `generateContent`
API with `x-goog-api-key` authentication, streaming and JSON structured output.
Operators must configure its endpoint as the models collection, for example
`https://generativelanguage.googleapis.com/v1beta/models`, rather than Google's
OpenAI-compatible endpoint. The adapter appends the encoded model and method;
existing compatible endpoints require this configuration change to avoid `424`
provider errors. Coordinate endpoint changes with rollout. A rollback must revert
both the adapter change and any endpoint changes together.

Structured output accepts only the frozen documented `responseJsonSchema`
keywords; unsupported keywords return `422 LLM_STRUCTURED_OUTPUT_UNSUPPORTED`
before a provider call. Vertex AI authentication and Gemini batch are excluded.

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
