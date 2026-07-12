## ADDED Requirements

### Requirement: Deployment artifacts live in a dedicated repository
All Falcone Helm charts, chart values, templates, and chart-release automation
SHALL reside in `gntik-ai/falcone-charts` and SHALL NOT reside in the Falcone
application repository.

#### Scenario: Charts are absent from the application repository
- **WHEN** the Falcone repository is scanned for Helm charts
- **THEN** no `Chart.yaml` or Helm `templates/` tree is present

#### Scenario: The platform is installable from the charts repository
- **WHEN** an operator installs `../falcone-charts/charts/in-falcone`
- **THEN** the complete platform renders without reading deployment artifacts from
  the Falcone application repository

### Requirement: Application and chart releases are independently published
Falcone SHALL publish application images from its own CI, while
`falcone-charts` SHALL publish the umbrella chart as a GHCR OCI artifact.

#### Scenario: Chart release is isolated from application release
- **WHEN** a chart change lands on the charts repository default branch
- **THEN** its CI validates, packages, and publishes the chart without invoking
  the Falcone application image workflow

### Requirement: Extracted chart history is retained
The destination chart repository SHALL retain the commit history of every moved
chart and values file through a `git filter-repo` extraction.

#### Scenario: A moved chart file has predecessor commits
- **WHEN** an operator inspects the history of `charts/in-falcone/Chart.yaml`
  in `falcone-charts`
- **THEN** its pre-extraction chart commits are present
