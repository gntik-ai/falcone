# fix-flow-trigger-master-key-failclosed

Fail closed on a missing FLOW_TRIGGER_SECRET_KEY so webhook trigger secrets are never AES-256-GCM-encrypted with the publicly-known hardcoded dev key in production (#636)
