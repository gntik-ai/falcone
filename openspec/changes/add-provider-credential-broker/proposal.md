# Brokered OAuth and workload identity for LLM connections

Issue #939 (GAP-FAL-003) adds server-side credential acquisition to the named
connection registry introduced by add-multi-provider-connection-registry.

Connections may retain API-key authentication or select OAuth2 client credentials,
an OAuth2 refresh token, or an operator-defined workload identity profile. Only
configuration and secret references are durable. Access tokens remain in each
executor process. Adapters remain stateless; the transport supplies bearer auth.

The source change includes nullable metadata migrations, completion/stream/batch
integration, tenant and SSRF guards, and offline tests. The separate deployment
repository owns profile values and the opt-in projected service-account volume.
Empty profiles require no chart-render changes. No deployment is performed here.

Interactive OAuth, refresh-token writeback, embeddings, MCP and other credential
brokering are excluded. Cloud-specific exchanges beyond RFC 8693 and the JWT bearer
grant require another change.
