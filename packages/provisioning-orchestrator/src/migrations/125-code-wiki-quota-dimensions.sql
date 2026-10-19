-- Product-reported tenant totals, except repository bytes (one source snapshot).
-- Preserve operator values and existing catalog rows on every startup.
INSERT INTO quota_dimension_catalog (dimension_key, display_label, unit, default_value, description)
VALUES
  ('codewiki_max_projects', 'Maximum Code Wiki Projects', 'count', 3, 'Projects per tenant'),
  ('codewiki_max_concurrent_runs', 'Maximum Concurrent Code Wiki Runs', 'count', 1, 'Analysis runs in progress per tenant'),
  ('codewiki_max_queued_runs', 'Maximum Queued Code Wiki Runs', 'count', 5, 'Runs waiting to start per tenant'),
  ('codewiki_max_indexed_repositories', 'Maximum Indexed Code Wiki Repositories', 'count', 3, 'Repositories with a current index per tenant'),
  ('codewiki_max_wiki_pages', 'Maximum Code Wiki Pages', 'count', 500, 'Pages across current wiki versions per tenant'),
  ('codewiki_max_repository_bytes', 'Maximum Code Wiki Repository Bytes', 'bytes', 524288000, 'Size of one source snapshot in bytes')
ON CONFLICT (dimension_key) DO NOTHING;
