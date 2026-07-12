# EventsConsole Workspace Routes

The web console's Events data page uses workspace-scoped logical-topic routes in the kind
control-plane runtime. These routes are separate from the public resource-id Events administration
surface under `/v1/events/topics/{resourceId}` and exist so the console can work with the active
workspace and a human-readable topic name.

## Routes

| Method | Path | Handler | Purpose |
| --- | --- | --- | --- |
| `GET` | `/v1/events/workspaces/{workspaceId}/topics` | `eventsListTopics` | List topics provisioned for the owned workspace. |
| `POST` | `/v1/events/workspaces/{workspaceId}/topics` | `eventsProvisionTopic` | Create a managed Kafka topic mapping for the owned workspace. |
| `POST` | `/v1/events/workspaces/{workspaceId}/topics/{topic}/publish` | `eventsWorkspaceTopicPublish` | Publish one console message to a logical workspace topic. |
| `GET` | `/v1/events/workspaces/{workspaceId}/topics/{topic}/messages` | `eventsWorkspaceTopicMessages` | Poll a bounded batch of messages from a logical workspace topic. |

The route table lives in `apps/control-plane/routes.mjs`. The same entries are recorded in
`apps/control-plane/route-map.runtime.json` and `apps/control-plane/route-map.json` so
the kind image metadata and console-route audit stay in sync.

## Request and response shape

Topic creation reads the topic name from `body.name`:

```json
{
  "name": "orders",
  "partitions": 3
}
```

The handler normalizes the name with the same slug policy used by the managed Kafka topic registry.
The response includes both the console-friendly logical topic field and the registry metadata:

```json
{
  "resourceId": "res_topic_12345678",
  "topic": "orders",
  "topicName": "orders",
  "physicalTopicName": "evt.ws_1.orders",
  "partitionCount": 3,
  "partitions": 3,
  "status": "active"
}
```

Topic list returns `TopicRecord`-compatible items:

```json
{
  "items": [
    {
      "topic": "orders",
      "partitions": 3,
      "resourceId": "res_topic_12345678",
      "topicName": "orders"
    }
  ]
}
```

Publish accepts the console body shape and maps it onto Kafka producer semantics:

```json
{
  "key": "order-1",
  "value": {
    "amount": 10
  }
}
```

`value` is serialized the same way the existing resource-id publish path serializes `payload`: string
values are sent unchanged, and object values are JSON encoded. The existing
`POST /v1/events/topics/{resourceId}/publish` route still accepts `payload`; the shared helper also
accepts `value` as an additive compatibility path.

Message polling returns parsed values when the Kafka value is JSON and raw strings otherwise:

```json
{
  "items": [
    {
      "key": "order-1",
      "value": {
        "amount": 10
      },
      "partition": 0,
      "offset": "7",
      "timestamp": "2026-06-30T12:00:00.000Z"
    }
  ]
}
```

`maxMessages` and `timeoutMs` are accepted as query parameters. The kind handler clamps them to a
small bounded batch so a console poll cannot create an unbounded consume loop.

## Scope and authorization

Every workspace-scoped EventsConsole route resolves `{workspaceId}` through the workspace registry
before it touches topic rows or Kafka. Tenant-scoped callers can only reach workspaces owned by
their verified tenant. A missing or foreign workspace returns `404 WORKSPACE_NOT_FOUND` so guessed
workspace IDs do not leak existence.

Topic list and message polling require an authenticated same-tenant caller. Topic creation and
publish require a platform caller or tenant owner/admin for the workspace tenant, matching the
existing resource-id publish authorization rule.

The physical Kafka topic name remains derived from the globally unique workspace ID:
`evt.<workspaceId>.<topic>`. The console never accepts a physical topic name from the request, so a
caller cannot cross into another workspace's Kafka namespace by changing the logical topic path.
