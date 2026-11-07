import { MAX_QUEUE_OPERATIONS_PER_DAY, type QueueMessage } from "./index";

const FETCH_RESERVATION = 4;
const JOB_DELIVERY_SECONDS = 3_600;

/** Only the pending-job claimant may reserve budget and dispatch it. Expired claims are recovered by the hourly tick. */
export async function dispatchFetchJob(
  db: D1Database,
  jobs: Queue<QueueMessage>,
  jobId: string,
  now: number,
): Promise<boolean> {
  const leaseUntil = now + JOB_DELIVERY_SECONDS;
  const claimed = await db
    .prepare(
      "UPDATE fetch_jobs SET status = 'sent', lease_until = ? WHERE id = ? AND status = 'pending'",
    )
    .bind(leaseUntil, jobId)
    .run();
  if (!claimed.meta.changes) return true;

  const release = () =>
    db
      .prepare(
        "UPDATE fetch_jobs SET status = 'pending', lease_until = NULL WHERE id = ? AND status = 'sent' AND lease_until = ?",
      )
      .bind(jobId, leaseUntil)
      .run();
  try {
    const day = new Date(now * 1000).toISOString().slice(0, 10);
    const reservation = await db
      .prepare(
        `INSERT INTO daily_usage(day_utc, reserved_queue_ops) VALUES (?, ?)
       ON CONFLICT(day_utc) DO UPDATE SET reserved_queue_ops = daily_usage.reserved_queue_ops + excluded.reserved_queue_ops
       WHERE daily_usage.reserved_queue_ops + excluded.reserved_queue_ops <= ?
       RETURNING day_utc`,
      )
      .bind(day, FETCH_RESERVATION, MAX_QUEUE_OPERATIONS_PER_DAY)
      .first<{ day_utc: string }>();
    if (!reservation) {
      await release();
      return false;
    }
    await jobs.send({ schemaVersion: 1, type: "fetch", jobId });
    return true;
  } catch (error) {
    await release();
    throw error;
  }
}
