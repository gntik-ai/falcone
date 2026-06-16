## ADDED Requirements

### Requirement: Console same-origin API calls MUST be edge-routable

The system SHALL provide an edge (ingress controller and routes, or equivalent) in the deployed topology that routes the console host's same-origin `/v1/*` requests to the control-plane/gateway, so a browser receives API responses rather than the SPA HTML fallback.

#### Scenario: Console reaches the API end-to-end

- **WHEN** a browser on the console host issues a same-origin `/v1/*` API request
- **THEN** the request is routed to the control-plane and returns an API (JSON) response, not the SPA HTML fallback
