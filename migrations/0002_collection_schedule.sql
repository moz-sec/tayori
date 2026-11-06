-- Keep a failed feed's retry deadline independent of schedule changes.
ALTER TABLE sources ADD COLUMN retry_not_before INTEGER;
UPDATE sources SET retry_not_before = next_fetch_at WHERE consecutive_failures > 0;
