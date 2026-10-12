# Fail closed on flow execution credentials

Production currently falls back to a public signing constant, and registered activities accept
tokenless cron runs. Reject missing or weak production secrets and require credentials before any
registered activity accesses tenant data. Mint a fresh credential inside a worker activity for
each cron firing, including existing tokenless schedules.

Source scope: executor/worker signing parity, mandatory activity validation, deterministic cron
workflow wiring, regression coverage, and the upgrade/rollout design. The paired falcone-charts
change supplies one OpenBao/External Secrets managed Secret to both workloads. This source change
does not deploy, change image pins, or alter the webhook signing-key configuration.

The token format, scrypt-v1 derivation, 24-hour maximum TTL, existing validation codes, and
non-production development round-trip remain unchanged. Add only
`EXECUTION_TOKEN_SECRET_UNCONFIGURED` for a missing or weak production signing secret.
