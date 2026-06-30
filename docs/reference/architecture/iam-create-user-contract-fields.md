# IAM Create-User Contract Fields

`POST /v1/iam/realms/{realmId}/users` is the platform API path for a
superadmin to create a managed realm user. The request body is
`IamUserCreateRequest` in the control-plane OpenAPI family.

The kind control-plane runtime maps these documented fields directly:

| Contract field | Runtime behavior |
| --- | --- |
| `username`, `email`, `firstName`, `lastName` | Forwarded to Keycloak user creation. |
| `enabled` | Forwarded to Keycloak; defaults to `true` when omitted. |
| `emailVerified` | Forwarded to Keycloak; defaults to `true` when omitted. |
| `attributes` | Forwarded as Keycloak multi-valued user attributes. Scalar legacy values are wrapped as one-item arrays. |
| `realmRoles` | Assigned after user creation through Keycloak realm-role mappings. |
| `requiredActions` | Forwarded as Keycloak required actions. |
| `bootstrapCredentials.temporaryPassword` | Used as the initial password for the created user. |
| `bootstrapCredentials.requiredActions` | Merged with top-level `requiredActions`. |

The handler still accepts legacy `roles`, `password`, and
`credentials:[{type:"password",value,temporary}]` payloads for compatibility
with older internal callers.

Some documented fields are intentionally rejected until the runtime can perform
them end to end:

| Field | Current response |
| --- | --- |
| `groups` | `400 UNSUPPORTED_FIELD` |
| `metadata` | `400 UNSUPPORTED_FIELD` |
| `bootstrapCredentials.sendEmail: true` | `400 UNSUPPORTED_FIELD` |

Rejecting these fields is deliberate. A request that asks for group membership
or bootstrap email delivery must not receive `201 Created` while those effects
are silently discarded.
