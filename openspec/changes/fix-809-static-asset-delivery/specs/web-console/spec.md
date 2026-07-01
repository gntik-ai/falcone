# web-console Specification (delta)

## ADDED Requirements

### Requirement: Web console static assets use compression and cache-safe headers

The system SHALL serve compressible web-console static assets (JS/CSS/JSON/SVG) with HTTP
compression when the client supports it, and SHALL set
`Cache-Control: public, max-age=31536000, immutable` on content-hashed `/assets/*` responses and
`Cache-Control: no-store` on `index.html` responses for every bundled static-serving path:
production nginx, restricted-profile `static-server.mjs`, and kind nginx.

#### Scenario: Static JavaScript and CSS assets are compressed

- **WHEN** a client requests `/assets/*.js` or `/assets/*.css` with `Accept-Encoding: gzip` or
  `Accept-Encoding: br`
- **THEN** the response carries `content-encoding: gzip` or `content-encoding: br`, varies on
  `Accept-Encoding`, and is materially smaller than the raw asset bytes

#### Scenario: Hashed assets and index use the correct cache policy

- **WHEN** a client fetches a content-hashed `/assets/*` bundle file
- **THEN** the response carries `Cache-Control: public, max-age=31536000, immutable`
- **WHEN** a client fetches `index.html`
- **THEN** the response carries `Cache-Control: no-store`
