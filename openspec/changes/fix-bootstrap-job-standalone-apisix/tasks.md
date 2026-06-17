# Tasks — fix-bootstrap-job-standalone-apisix

## Investigation
- [ ] Locate the bootstrap Job entrypoint script / image that performs the APISIX reconciliation.
- [ ] Identify which code path issues APISIX admin-API calls and how it reads `APISIX_STAND_ALONE`.

## Implementation
- [ ] Gate the APISIX route-reconciliation loop behind `APISIX_STAND_ALONE !== 'true'`
  (or the equivalent env/config check) so the loop is entirely skipped in standalone mode.
- [ ] Add a test/smoke step at the end of the Job that verifies the platform realm, console
  client, gateway client, and superadmin are present before exiting 0.

## Verification
- [ ] Fresh kind install → bootstrap Job `Complete`.
- [ ] Superadmin login → 201 with roles.
- [ ] Run `/opsx:verify fix-bootstrap-job-standalone-apisix`.

## Archive
- [ ] `/opsx:archive fix-bootstrap-job-standalone-apisix`
