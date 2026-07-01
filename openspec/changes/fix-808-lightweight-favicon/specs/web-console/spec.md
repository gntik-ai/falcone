# web-console Specification (delta)

## ADDED Requirements

### Requirement: Web console favicon is lightweight

The system SHALL serve the web-console favicon declared for SVG-capable browsers as a lightweight
icon asset on the order of a few KB. The system SHALL NOT ship a multi-hundred-KB raster image
base64-embedded in an SVG as the declared favicon.

#### Scenario: Browser fetches the declared favicon

- **WHEN** any web-console page declares a favicon and a browser fetches the SVG-capable declared
  favicon asset
- **THEN** the fetched favicon asset is <= about 10 KB and is not a multi-hundred-KB
  base64-PNG-in-SVG payload
