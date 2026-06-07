## 1. Parameterize the status filter

- [x] 1.1 In `services/scheduling-engine/actions/scheduling-management.mjs:156-162`, replace the string-concatenated `"AND status = '" + params.query.status + "'"` fragment with a conditional `AND status = $4` clause and append the validated value as the fourth positional parameter
- [x] 1.2 Ensure the query string is constructed without any string interpolation of caller-supplied input

## 2. Allowlist validation

- [x] 2.1 Before executing the list-jobs query, read the accepted status values from `VALID_TRANSITIONS` keys in `services/scheduling-engine/src/job-model.mjs::VALID_TRANSITIONS:4-9`
- [x] 2.2 If `params.query.status` is present and not in the allowlist, return HTTP 400 with error code `INVALID_STATUS` without executing the query
- [x] 2.3 If `params.query.status` is absent, omit the status predicate entirely (no `$4`)

## 3. Verification

- [x] 3.1 Add black-box test `bbx-sched-status-injection-01`: supply `status=active' OR '1'='1` — expect HTTP 400 `INVALID_STATUS` and no cross-tenant rows
- [x] 3.2 Add black-box test `bbx-sched-status-injection-02`: supply a UNION injection payload — expect HTTP 400 `INVALID_STATUS`
- [x] 3.3 Add black-box test: valid status value `active` returns only the authenticated tenant's jobs
- [x] 3.4 Add black-box test: absent status filter returns only the authenticated tenant's jobs
- [x] 3.5 Run `bash tests/blackbox/run.sh`
