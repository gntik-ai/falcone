# Audit Module

This workspace is reserved for append-only audit evidence in the control plane.

Initial responsibility boundaries:

- accept versioned audit records from control and orchestration flows
- persist append-only evidence and correlation metadata
- retain evidence pointers/redaction rules behind a dedicated module boundary

Future tasks should extend this package for query/export behavior without changing the producer-facing `audit_record` contract semantics.
