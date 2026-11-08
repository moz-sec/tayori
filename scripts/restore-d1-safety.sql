-- Run only on an isolated restored database, with all producers and consumers stopped.
-- Prevent restored active jobs and any previously delivered queue messages from running.
UPDATE fetch_jobs
SET status = 'failed', lease_until = NULL, completed_at = unixepoch()
WHERE status IN ('pending', 'sent', 'running');
UPDATE sources
SET generation = MAX(generation, COALESCE((SELECT MAX(generation) FROM fetch_jobs WHERE source_id = sources.id), generation)) + 1;
