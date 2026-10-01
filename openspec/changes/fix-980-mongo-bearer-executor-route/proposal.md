# Fix Mongo bearer routing to the executor

## Why

The kind APISIX bearer route for `/v1/mongo/*` sends requests to the control plane, which does not host the Mongo document handlers. The chart route uses a single platform-realm OIDC discovery endpoint, so tenant-realm tokens cannot pass gateway authentication.

## Change

- Route 2006 to the executor and require an issuer-allowlisted JWKS verifier. The issuer list comes from configured realms. Reject missing credentials, unknown issuers, failed JWKS fetches, and invalid JWTs before forwarding.
- Keep the route-local rate limit, body cap, request validation, correlation and request IDs. Remove client identity headers and inject the Secret-backed gateway trust header. Leave route 2006-key untouched.
- Keep the chart values as the canonical source for deployed routes. The deployment repository supplies the APISIX verifier plugin, its explicit realm list, and the rendered route. It also verifies that the rendered chart upstream and kind upstream agree.
- Retain the executor's verified-JWT identity path and credential workspace check. No Mongo handler changes are needed.

## Rollout and rollback

The standalone staging ConfigMap is operator managed and needs a separate approved update after the chart render is reviewed. Record its previous SHA before that update. Reverting route 2006 restores the prior bearer failure; API-key route 2006-key remains independent.

## Open configuration decision

The deployment owner must provide the authoritative tenant realm list from realm configuration and update it when realms are provisioned. A static list denies newly provisioned tenants until refreshed. The gateway must never construct the allow-list from JWT contents.
