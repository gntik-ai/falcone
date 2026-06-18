# scheduling — spec delta for fix-scheduling-handler-dockerfile

## ADDED Requirements

### Requirement: All route-map handler modules are present in the control-plane image

The control-plane image SHALL contain every backend handler module referenced by the
runtime route map, including `services/scheduling-engine` for `/v1/scheduling/*`. The
image build SHALL fail when the route map references a handler module that was not
copied into the image, so a missing dependency is caught at build time rather than as a
runtime `ERR_MODULE_NOT_FOUND` 500.

#### Scenario: scheduling routes resolve their handler

- **WHEN** a request hits `/v1/scheduling/*`
- **THEN** the `scheduling-management` handler module resolves and the route returns a
  business response (not a 500 `ERR_MODULE_NOT_FOUND`).

#### Scenario: a missing handler module fails the build

- **WHEN** the route map references a `/repo/services/...` module not copied into the image
- **THEN** the image build fails (the build-time route-module resolution check).
