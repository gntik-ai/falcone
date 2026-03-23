# Gateway Configuration

Base location for gateway runtime configuration assets.

- `base/`: shared defaults intended to be overlaid per environment
- `base/public-api-routing.yaml`: machine-readable family-to-prefix routing baseline for the unified `/v1/*` public API, including family-level auth/context metadata
- Helm `gatewayPolicy` values: deployment-time OIDC, claims-propagation, CORS, passthrough, and access-matrix source of truth
- public domain roots and route prefixes live in the base config; environment/platform hostnames are supplied through Helm overlays
- native passthrough troubleshooting and operator guidance live in `docs/reference/architecture/gateway-authentication-and-passthrough.md`
- avoid embedding secrets in repository-tracked files
- prefer config maps and sealed/external secrets in deployment layers
