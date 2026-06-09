# fix-gateway-ratelimit-resolve-plan-live

Wire fetch_plan_requests_per_minute to the live control-plane plan-quota source so the gateway limit-count ceiling reflects each tenant's plan tier at request time, completing the runtime path of #248 (add-per-tenant-gateway-rate-limit).
