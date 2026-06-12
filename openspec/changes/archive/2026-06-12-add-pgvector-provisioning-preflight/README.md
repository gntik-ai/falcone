# add-pgvector-provisioning-preflight

Provisioning pre-flight: fail closed with config validation error when a database_per_tenant tenant enables a Postgres extension the target instance image does not ship (especially vector/pgvector), instead of issuing CREATE EXTENSION that fails cryptically. Also exposes a real chart value for the dedicated-DB pgvector image.
