## ADDED Requirements

### Requirement: Falcone services MUST be scraped by Prometheus

The system SHALL expose a `/metrics` endpoint on the control-plane and executor and register ServiceMonitors so that Prometheus scrapes Falcone application metrics (more than just the Prometheus self-target).

#### Scenario: Prometheus scrapes Falcone targets

- **WHEN** the deployed stack is running
- **THEN** Prometheus lists the control-plane/executor as scrape targets and exposes non-zero Falcone application metrics

### Requirement: Falcone dashboards and metrics API MUST show real data

The system SHALL ship Falcone Grafana dashboards (including a per-tenant view) and back the metrics API with the real Prometheus series so it returns non-zero data for tenants with activity.

#### Scenario: A tenant dashboard shows non-zero data

- **WHEN** a tenant has activity and an operator opens its Falcone dashboard or queries the metrics API
- **THEN** the dashboard/API shows non-zero series for that tenant
