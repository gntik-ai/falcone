# Workspace Realtime Console Route

The web console page `/console/workspaces/{workspaceId}/realtime` loads workspace realtime metadata
from `GET /v1/workspaces/{workspaceId}/realtime`. The kind control-plane serves this route as a
local handler because the shipped console page is part of the kind runtime surface; it is not a
generated public SDK route.

The handler resolves the workspace by the path id and applies tenant isolation before reading
realtime channel metadata:

- platform callers may inspect any workspace;
- tenant-scoped callers may inspect only workspaces owned by their verified tenant;
- missing or foreign workspaces return `404 WORKSPACE_NOT_FOUND`;
- an owned workspace with no available realtime channels returns `200` with an empty
  `dataSources` list and `features.realtime: false`.

The response is the shape consumed by `ConsoleRealtimePage`:

```json
{
  "workspaceId": "ws_123",
  "realtimeEndpointUrl": "wss://api.example.test",
  "features": {
    "realtime": true
  },
  "dataSources": [
    {
      "id": "channel-id",
      "type": "postgresql",
      "channelType": "postgresql-changes",
      "dataSourceRef": "orders-db",
      "displayName": "Orders DB",
      "description": "Postgres order changes",
      "status": "available"
    }
  ]
}
```

The route intentionally degrades an absent `realtime_channels` relation to an empty successful
configuration. That keeps the console page usable in partial kind installs while still preserving
the tenant boundary.
