## ADDED Requirements

### Requirement: Flow stream query keys remain outside application diagnostics

For query-bearing requests, executor and control-plane request error paths SHALL log only normalized pathname and bounded diagnostic metadata. They SHALL NOT pass exception messages, stacks, causes, nested driver properties, raw URLs, URL search or query values to a logger. Error classification, HTTP responses, SSE framing, authentication and correlation IDs SHALL remain unchanged.

#### Scenario: Flow event stream with query authentication

- **WHEN** a client requests the flow execution events endpoint with a synthetic `apikey` query value
- **THEN** captured application logger arguments contain neither the synthetic value nor `apikey=`
- **AND** this holds for a successful stream, invalid-key 401, foreign-execution 403, forced 5xx and proxied upstream failure

#### Scenario: Exceptions carry query material

- **WHEN** database or HTTP transport failures embed the request URL in a message, stack, cause or nested request metadata
- **THEN** the application logs the normalized pathname and safe metadata only
- **AND** its response keeps the existing status, error code and opaque server-error message

#### Scenario: Live negative control

- **WHEN** a deliberate `logger.error(req.url)` call is temporarily injected into the executor request path
- **THEN** the log-capture regression fails on the query-key assertion
- **AND** its failure output does not print captured logger content

### Requirement: HTTP metric route labels remain bounded

Executor metric labels SHALL continue to use static route templates. Query keys and resource identifiers SHALL NOT become metric labels.

### Requirement: Gateway access logs omit query-bearing variables

The paired charts change SHALL render `nginx_config.http.access_log_format` in default, staging, prod, airgap and kind profiles. It SHALL retain method, normalized `$uri`, protocol, status, latency and upstream address, and SHALL exclude `$request`, `$request_uri`, `$args`, `$query_string`, `$arg_*` and `$upstream_uri`. The existing APISIX metrics-export contract and other configuration keys SHALL remain intact.

#### Scenario: Chart format regression

- **WHEN** the format is removed or a query-bearing variable is reintroduced
- **THEN** the paired chart contract fails

#### Scenario: Access-log field layout survives YAML parsing

- **WHEN** the rendered ConfigMap's `config.yaml` is parsed for each supported profile
- **THEN** the format equals the known-good APISIX 3.10 default with only `$request` replaced by `$request_method $uri $server_protocol` and `$upstream_uri` replaced by `$uri`
- **AND** literal field delimiters remain unchanged, with no enclosing double quotes or backslash characters in the parsed format
- **AND** the paired chart contract fails for a folded scalar containing YAML-style outer quotes or escaped delimiters

Application and access-log protection SHALL NOT be represented as protection from nginx error-log request-line disclosure or unverified external ingress/load-balancer logging.
