-- Existing local demo feeds were intentionally paused and use reserved URLs.
-- Keep them out of normal collection while converting them to a supported state.
UPDATE sources SET status = 'active', next_fetch_at = MAX(next_fetch_at, 4102444800)
WHERE status = 'paused' AND (id, normalized_url) IN (
  ('demo-cloudflare', 'https://tayori.invalid/tayori-demo/cloudflare.xml'),
  ('demo-cncf', 'https://tayori.invalid/tayori-demo/cncf.xml'),
  ('demo-security-feed', 'https://tayori.invalid/tayori-demo/security.xml'),
  ('demo-unclassified', 'https://tayori.invalid/tayori-demo/updates.xml')
);

-- Refuse the migration rather than silently resume a paused subscription.
CREATE TABLE source_status_migration_guard (
  paused_count INTEGER NOT NULL CHECK (paused_count = 0)
);
INSERT INTO source_status_migration_guard (paused_count)
SELECT COUNT(*) FROM sources WHERE status = 'paused';
DROP TABLE source_status_migration_guard;

-- SQLite cannot alter an existing CHECK constraint; enforce the two supported states
-- without rebuilding a table referenced by articles and fetch jobs.
CREATE TRIGGER sources_no_paused_insert
BEFORE INSERT ON sources
WHEN NEW.status NOT IN ('active', 'archived')
BEGIN
  SELECT RAISE(ABORT, 'unsupported source status');
END;
CREATE TRIGGER sources_no_paused_update
BEFORE UPDATE OF status ON sources
WHEN NEW.status NOT IN ('active', 'archived')
BEGIN
  SELECT RAISE(ABORT, 'unsupported source status');
END;
