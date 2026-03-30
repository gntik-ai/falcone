CREATE TABLE IF NOT EXISTS workspace_sdk_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  workspace_id UUID NOT NULL,
  language VARCHAR(32) NOT NULL,
  spec_version VARCHAR(64) NOT NULL,
  status VARCHAR(16) NOT NULL CHECK (status IN ('pending','building','ready','failed','stale')),
  download_url TEXT,
  url_expires_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_sdk_lang_version UNIQUE (workspace_id, language, spec_version)
);

CREATE INDEX IF NOT EXISTS idx_wsp_workspace_lang
  ON workspace_sdk_packages (workspace_id, language, status);
